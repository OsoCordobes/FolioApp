/**
 * Folio · tests · instrumento DASS-21 (lib/instrumentos/scoring/dass21.ts).
 *
 * Fija:
 *   - subescala sum × 2 (equiparación al DASS-42),
 *   - cortes de banda publicados por subescala,
 *   - asignación de ítems (depresión/ansiedad/estrés) a los índices correctos,
 *   - banda global = severidad máxima entre subescalas,
 *   - contrato laxo (null ante incompleto/inválido).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DASS21_LEN, dass21, scoreDass21 } from "../../lib/instrumentos/scoring/dass21";

// Índices 0-based por subescala (ítems 1-based estándar):
//   Depresión: 3,5,10,13,16,17,21 → 2,4,9,12,15,16,20
//   Ansiedad:  2,4,7,9,15,19,20   → 1,3,6,8,14,18,19
//   Estrés:    1,6,8,11,12,14,18  → 0,5,7,10,11,13,17
const IDX = {
  depresion: [2, 4, 9, 12, 15, 16, 20],
  ansiedad: [1, 3, 6, 8, 14, 18, 19],
  estres: [0, 5, 7, 10, 11, 13, 17],
} as const;

/**
 * Construye un array de 21 respuestas donde cada subescala tiene el `bruto`
 * pedido (suma de sus 7 ítems 0–3, antes de ×2). `bruto` máximo por subescala
 * es 21 (7×3).
 */
function armar(brutos: { depresion: number; ansiedad: number; estres: number }): number[] {
  const arr = Array<number>(DASS21_LEN).fill(0);
  for (const sub of ["depresion", "ansiedad", "estres"] as const) {
    let resto = brutos[sub];
    for (const i of IDX[sub]) {
      const v = Math.min(3, resto);
      arr[i] = v;
      resto -= v;
    }
    if (resto > 0) throw new Error(`bruto ${brutos[sub]} no entra en la subescala ${sub}`);
  }
  return arr;
}

function subOf(r: ReturnType<typeof scoreDass21>, id: string) {
  return r?.subescalas?.find((s) => s.id === id);
}

test("dass21: subescala = suma × 2", () => {
  // bruto depresión 5 → total 10; ansiedad 3 → 6; estrés 7 → 14.
  const r = scoreDass21(armar({ depresion: 5, ansiedad: 3, estres: 7 }));
  assert.equal(subOf(r, "depresion")?.total, 10);
  assert.equal(subOf(r, "ansiedad")?.total, 6);
  assert.equal(subOf(r, "estres")?.total, 14);
  // total global = suma de las tres subescalas (ya ×2).
  assert.equal(r?.total, 10 + 6 + 14);
});

test("dass21: cortes depresión (0-9 normal, 10-13 leve, 14-20 mod, 21-27 sev, 28+ ext)", () => {
  // Los cortes son sobre el puntaje ×2, así que bruto = corte/2.
  const banda = (bruto: number) =>
    subOf(scoreDass21(armar({ depresion: bruto, ansiedad: 0, estres: 0 })), "depresion")?.banda;
  assert.equal(banda(0), "normal"); // 0
  assert.equal(banda(4), "normal"); // 8
  assert.equal(banda(5), "leve"); // 10
  assert.equal(banda(6), "leve"); // 12
  assert.equal(banda(7), "moderado"); // 14
  assert.equal(banda(10), "moderado"); // 20
  assert.equal(banda(11), "severo"); // 22 (>=21)
  assert.equal(banda(13), "severo"); // 26
  assert.equal(banda(14), "extremadamente_severo"); // 28
  assert.equal(banda(21), "extremadamente_severo"); // 42
});

test("dass21: cortes ansiedad (0-7 normal, 8-9 leve, 10-14 mod, 15-19 sev, 20+ ext)", () => {
  const banda = (bruto: number) =>
    subOf(scoreDass21(armar({ depresion: 0, ansiedad: bruto, estres: 0 })), "ansiedad")?.banda;
  assert.equal(banda(3), "normal"); // 6
  assert.equal(banda(4), "leve"); // 8
  assert.equal(banda(5), "moderado"); // 10
  assert.equal(banda(7), "moderado"); // 14
  assert.equal(banda(8), "severo"); // 16 (>=15)
  assert.equal(banda(9), "severo"); // 18
  assert.equal(banda(10), "extremadamente_severo"); // 20
});

test("dass21: cortes estrés (0-14 normal, 15-18 leve, 19-25 mod, 26-33 sev, 34+ ext)", () => {
  const banda = (bruto: number) =>
    subOf(scoreDass21(armar({ depresion: 0, ansiedad: 0, estres: bruto })), "estres")?.banda;
  assert.equal(banda(7), "normal"); // 14
  assert.equal(banda(8), "leve"); // 16
  assert.equal(banda(9), "leve"); // 18 (<=18 leve)
  assert.equal(banda(10), "moderado"); // 20
  assert.equal(banda(12), "moderado"); // 24
  assert.equal(banda(13), "severo"); // 26 (>=26)
  assert.equal(banda(16), "severo"); // 32
  assert.equal(banda(17), "extremadamente_severo"); // 34
});

test("dass21: asignación de ítems — sólo la subescala tocada puntúa", () => {
  // Cargar únicamente los índices de depresión debe dejar ansiedad/estrés en 0.
  const soloDep = Array<number>(DASS21_LEN).fill(0);
  for (const i of IDX.depresion) soloDep[i] = 3; // bruto 21 → total 42
  const r = scoreDass21(soloDep);
  assert.equal(subOf(r, "depresion")?.total, 42);
  assert.equal(subOf(r, "ansiedad")?.total, 0);
  assert.equal(subOf(r, "estres")?.total, 0);
  assert.equal(subOf(r, "ansiedad")?.banda, "normal");
});

test("dass21: banda global = severidad máxima entre subescalas", () => {
  // depresión normal, ansiedad extrema, estrés normal → global extremo.
  const r = scoreDass21(armar({ depresion: 0, ansiedad: 15, estres: 0 }));
  assert.equal(r?.banda, "extremadamente_severo");
  // todo normal → global normal.
  const r2 = scoreDass21(armar({ depresion: 0, ansiedad: 0, estres: 0 }));
  assert.equal(r2?.banda, "normal");
});

test("dass21: contrato laxo — null ante incompleto/inválido", () => {
  assert.equal(scoreDass21(undefined), null);
  assert.equal(scoreDass21(null), null);
  assert.equal(scoreDass21(Array(20).fill(0)), null); // corta
  assert.equal(scoreDass21(Array(22).fill(0)), null); // larga
  assert.equal(scoreDass21(Array(21).fill(4)), null); // fuera de rango
  const parcial = Array<number>(21).fill(0);
  parcial[5] = null as unknown as number;
  assert.equal(scoreDass21(parcial), null);
});

test("dass21: def bien formada", () => {
  assert.equal(dass21.id, "dass21.v1");
  assert.equal(dass21.items.length, DASS21_LEN);
  assert.equal(dass21.subescalas?.length, 3);
  assert.equal(dass21.dominio, "salud_mental");
  // Cada ítem tiene subescala asignada y coincide con IDX.
  dass21.items.forEach((item, i) => {
    const sub = (["depresion", "ansiedad", "estres"] as const).find((s) =>
      (IDX[s] as readonly number[]).includes(i),
    );
    assert.equal(item.subescala, sub);
  });
});
