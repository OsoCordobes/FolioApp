/**
 * Folio · tests · instrumento ODI (lib/instrumentos/scoring/odi.ts).
 *
 * Fija el cálculo por porcentaje (suma/50×100) y los cortes publicados
 * (0–20 mínima, 21–40 moderada, 41–60 severa, 61–80 incapacitante, 81–100
 * máxima) + contrato laxo.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ODI_LEN, odi, scoreOdi } from "../../lib/instrumentos/scoring/odi";

/** 10 secciones (0–5) que suman exactamente `bruto` (máx 50). */
function escala(bruto: number): number[] {
  const out = Array<number>(ODI_LEN).fill(0);
  let resto = bruto;
  for (let i = 0; i < ODI_LEN; i++) {
    const v = Math.min(5, resto);
    out[i] = v;
    resto -= v;
  }
  if (resto > 0) throw new Error(`bruto ${bruto} no entra en ${ODI_LEN} secciones (máx 50)`);
  return out;
}

test("odi: total es porcentaje (bruto × 2 con 10 secciones)", () => {
  assert.equal(scoreOdi(escala(0))?.total, 0);
  assert.equal(scoreOdi(escala(10))?.total, 20);
  assert.equal(scoreOdi(escala(25))?.total, 50);
  assert.equal(scoreOdi(escala(50))?.total, 100);
});

test("odi: cortes por porcentaje", () => {
  // bruto → porcentaje = bruto×2.
  assert.equal(scoreOdi(escala(0))?.banda, "minima"); // 0
  assert.equal(scoreOdi(escala(10))?.banda, "minima"); // 20
  assert.equal(scoreOdi(escala(11))?.banda, "moderada"); // 22
  assert.equal(scoreOdi(escala(20))?.banda, "moderada"); // 40
  assert.equal(scoreOdi(escala(21))?.banda, "severa"); // 42
  assert.equal(scoreOdi(escala(30))?.banda, "severa"); // 60
  assert.equal(scoreOdi(escala(31))?.banda, "incapacitante"); // 62
  assert.equal(scoreOdi(escala(40))?.banda, "incapacitante"); // 80
  assert.equal(scoreOdi(escala(41))?.banda, "maxima"); // 82
  assert.equal(scoreOdi(escala(50))?.banda, "maxima"); // 100
});

test("odi: interpretación con porcentaje", () => {
  const r = scoreOdi(escala(15));
  assert.equal(r?.total, 30);
  assert.match(r?.interpretacion ?? "", /30 %/);
});

test("odi: contrato laxo — null ante incompleto/inválido", () => {
  assert.equal(scoreOdi(undefined), null);
  assert.equal(scoreOdi(null), null);
  assert.equal(scoreOdi(Array(9).fill(0)), null); // corta
  assert.equal(scoreOdi(Array(11).fill(0)), null); // larga
  assert.equal(scoreOdi(Array(10).fill(6)), null); // fuera de rango
  assert.equal(scoreOdi(Array(10).fill(0).map((v, i) => (i === 4 ? null : v))), null);
});

test("odi: def bien formada", () => {
  assert.equal(odi.id, "odi.v1");
  assert.equal(odi.items.length, ODI_LEN);
  assert.equal(odi.dominio, "dolor_funcion");
});
