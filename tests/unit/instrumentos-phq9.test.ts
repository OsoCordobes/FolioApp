/**
 * Folio · tests · instrumento PHQ-9 (lib/instrumentos/scoring/phq9.ts).
 *
 * Fija los cortes de banda publicados (0–4 mínima, 5–9 leve, 10–14 moderada,
 * 15–19 moderadamente severa, 20–27 severa), la flag de ideación (ítem 9 > 0),
 * y el contrato laxo (null ante incompleto/inválido).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PHQ9_FLAG_IDEACION, PHQ9_LEN, phq9, scorePhq9 } from "../../lib/instrumentos/scoring/phq9";

/** Escala completa de longitud `len` que suma exactamente `total` (ítems 0–3). */
function escala(total: number, len: number): number[] {
  const out = Array<number>(len).fill(0);
  let resto = total;
  for (let i = 0; i < len; i++) {
    const v = Math.min(3, resto);
    out[i] = v;
    resto -= v;
  }
  if (resto > 0) throw new Error(`total ${total} no entra en ${len} ítems`);
  return out;
}

test("phq9: cortes de banda publicados", () => {
  assert.equal(scorePhq9(escala(0, PHQ9_LEN))?.banda, "minima");
  assert.equal(scorePhq9(escala(4, PHQ9_LEN))?.banda, "minima");
  assert.equal(scorePhq9(escala(5, PHQ9_LEN))?.banda, "leve");
  assert.equal(scorePhq9(escala(9, PHQ9_LEN))?.banda, "leve");
  assert.equal(scorePhq9(escala(10, PHQ9_LEN))?.banda, "moderada");
  assert.equal(scorePhq9(escala(14, PHQ9_LEN))?.banda, "moderada");
  assert.equal(scorePhq9(escala(15, PHQ9_LEN))?.banda, "moderadamente_severa");
  assert.equal(scorePhq9(escala(19, PHQ9_LEN))?.banda, "moderadamente_severa");
  assert.equal(scorePhq9(escala(20, PHQ9_LEN))?.banda, "severa");
  assert.equal(scorePhq9(escala(27, PHQ9_LEN))?.banda, "severa");
});

test("phq9: total correcto e interpretación es-AR", () => {
  const r = scorePhq9([1, 2, 0, 3, 1, 1, 2, 1, 1]);
  assert.equal(r?.total, 12);
  assert.equal(r?.banda, "moderada");
  assert.match(r?.interpretacion ?? "", /moderada/);
  assert.match(r?.interpretacion ?? "", /no diagnóstico/);
});

test("phq9: flag de ideación cuando el ítem 9 > 0", () => {
  // Ítem 9 (índice 8) en 0 → sin flag aunque el total sea alto.
  const sinIdeacion = scorePhq9([3, 3, 3, 3, 3, 2, 2, 0, 0]);
  assert.equal(sinIdeacion?.flags, undefined);
  // Ítem 9 > 0 → flag presente.
  const conIdeacion = scorePhq9([0, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(conIdeacion?.flags, [PHQ9_FLAG_IDEACION]);
  assert.equal(conIdeacion?.total, 1);
  assert.equal(conIdeacion?.banda, "minima");
});

test("phq9: contrato laxo — null ante incompleto/inválido", () => {
  assert.equal(scorePhq9(undefined), null);
  assert.equal(scorePhq9(null), null);
  assert.equal(scorePhq9("alto"), null);
  assert.equal(scorePhq9([]), null);
  assert.equal(scorePhq9(Array(8).fill(0)), null); // corta
  assert.equal(scorePhq9(Array(10).fill(0)), null); // larga
  assert.equal(scorePhq9([0, 1, 2, 3, null, 0, 0, 0, 0]), null); // parcial
  assert.equal(scorePhq9([0, 1, 2, 3, 4, 0, 0, 0, 0]), null); // fuera de rango
  assert.equal(scorePhq9([0, 1, 2, 3, 0.5, 0, 0, 0, 0]), null); // no entero
});

test("phq9: def bien formada", () => {
  assert.equal(phq9.id, "phq9.v1");
  assert.equal(phq9.items.length, PHQ9_LEN);
  assert.equal(phq9.dominio, "salud_mental");
  assert.equal(phq9.score, scorePhq9);
  // Todas las bandas devueltas por score() existen en la def.
  const ids = new Set(phq9.bandas.map((b) => b.id));
  for (const t of [0, 5, 10, 15, 20, 27]) {
    assert.ok(ids.has(scorePhq9(escala(t, PHQ9_LEN))!.banda));
  }
});
