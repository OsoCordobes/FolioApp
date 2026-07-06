/**
 * Folio · tests · instrumento NDI (lib/instrumentos/scoring/ndi.ts).
 *
 * Fija los cortes por total crudo (0–4 ninguna, 5–14 leve, 15–24 moderada,
 * 25–34 severa, 35–50 completa), el porcentaje (×2) y el contrato laxo.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { NDI_LEN, ndi, scoreNdi } from "../../lib/instrumentos/scoring/ndi";

/** 10 ítems (0–5) que suman exactamente `total` (máx 50). */
function escala(total: number): number[] {
  const out = Array<number>(NDI_LEN).fill(0);
  let resto = total;
  for (let i = 0; i < NDI_LEN; i++) {
    const v = Math.min(5, resto);
    out[i] = v;
    resto -= v;
  }
  if (resto > 0) throw new Error(`total ${total} no entra en ${NDI_LEN} ítems (máx 50)`);
  return out;
}

test("ndi: cortes por total crudo", () => {
  assert.equal(scoreNdi(escala(0))?.banda, "ninguna");
  assert.equal(scoreNdi(escala(4))?.banda, "ninguna");
  assert.equal(scoreNdi(escala(5))?.banda, "leve");
  assert.equal(scoreNdi(escala(14))?.banda, "leve");
  assert.equal(scoreNdi(escala(15))?.banda, "moderada");
  assert.equal(scoreNdi(escala(24))?.banda, "moderada");
  assert.equal(scoreNdi(escala(25))?.banda, "severa");
  assert.equal(scoreNdi(escala(34))?.banda, "severa");
  assert.equal(scoreNdi(escala(35))?.banda, "completa");
  assert.equal(scoreNdi(escala(50))?.banda, "completa");
});

test("ndi: total crudo + porcentaje (×2) en la interpretación", () => {
  const r = scoreNdi(escala(20));
  assert.equal(r?.total, 20);
  assert.match(r?.interpretacion ?? "", /20\/50/);
  assert.match(r?.interpretacion ?? "", /40 %/); // 20 × 2
});

test("ndi: contrato laxo — null ante incompleto/inválido", () => {
  assert.equal(scoreNdi(undefined), null);
  assert.equal(scoreNdi(null), null);
  assert.equal(scoreNdi(Array(9).fill(0)), null); // corta
  assert.equal(scoreNdi(Array(11).fill(0)), null); // larga
  assert.equal(scoreNdi(Array(10).fill(6)), null); // fuera de rango (máx 5)
  assert.equal(scoreNdi(Array(10).fill(0).map((v, i) => (i === 2 ? null : v))), null);
});

test("ndi: def bien formada", () => {
  assert.equal(ndi.id, "ndi.v1");
  assert.equal(ndi.items.length, NDI_LEN);
  assert.equal(ndi.opciones?.length, 6); // 0–5
  assert.equal(ndi.dominio, "dolor_funcion");
});
