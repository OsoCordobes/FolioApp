/**
 * Folio · tests · instrumento GAD-7 (lib/instrumentos/scoring/gad7.ts).
 *
 * Fija los cortes de banda publicados (0–4 mínima, 5–9 leve, 10–14 moderada,
 * 15–21 severa) y el contrato laxo (null ante incompleto/inválido).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GAD7_LEN, gad7, scoreGad7 } from "../../lib/instrumentos/scoring/gad7";

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

test("gad7: cortes de banda publicados", () => {
  assert.equal(scoreGad7(escala(0, GAD7_LEN))?.banda, "minima");
  assert.equal(scoreGad7(escala(4, GAD7_LEN))?.banda, "minima");
  assert.equal(scoreGad7(escala(5, GAD7_LEN))?.banda, "leve");
  assert.equal(scoreGad7(escala(9, GAD7_LEN))?.banda, "leve");
  assert.equal(scoreGad7(escala(10, GAD7_LEN))?.banda, "moderada");
  assert.equal(scoreGad7(escala(14, GAD7_LEN))?.banda, "moderada");
  assert.equal(scoreGad7(escala(15, GAD7_LEN))?.banda, "severa");
  assert.equal(scoreGad7(escala(21, GAD7_LEN))?.banda, "severa");
});

test("gad7: total correcto e interpretación es-AR", () => {
  const r = scoreGad7([1, 1, 1, 0, 2, 2, 1]);
  assert.equal(r?.total, 8);
  assert.equal(r?.banda, "leve");
  assert.match(r?.interpretacion ?? "", /leve/);
  assert.match(r?.interpretacion ?? "", /no diagnóstico/);
  // GAD-7 no emite flags.
  assert.equal(r?.flags, undefined);
});

test("gad7: contrato laxo — null ante incompleto/inválido", () => {
  assert.equal(scoreGad7(undefined), null);
  assert.equal(scoreGad7(null), null);
  assert.equal(scoreGad7(Array(9).fill(0)), null); // longitud de PHQ-9, no GAD-7
  assert.equal(scoreGad7([1, 1, 1, 0, 2, 2, null]), null);
  assert.equal(scoreGad7([1, 1, 1, 0, 2, 2, 4]), null); // fuera de rango
});

test("gad7: def bien formada", () => {
  assert.equal(gad7.id, "gad7.v1");
  assert.equal(gad7.items.length, GAD7_LEN);
  assert.equal(gad7.dominio, "salud_mental");
  const ids = new Set(gad7.bandas.map((b) => b.id));
  for (const t of [0, 5, 10, 15, 21]) {
    assert.ok(ids.has(scoreGad7(escala(t, GAD7_LEN))!.banda));
  }
});
