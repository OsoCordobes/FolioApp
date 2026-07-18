/**
 * Folio · tests · instrumento PCL-5 (lib/instrumentos/scoring/pcl5.ts).
 *
 * Fija:
 *   - total 0–80,
 *   - corte de PTSD probable ≥ 33 + flag,
 *   - bandas (mínima / subumbral / probable / marcado),
 *   - contrato laxo (null ante incompleto/inválido).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  PCL5_CORTE_PROBABLE,
  PCL5_FLAG_PROBABLE,
  PCL5_LEN,
  pcl5,
  scorePcl5,
} from "../../lib/instrumentos/scoring/pcl5";

/** Escala de 20 ítems (0–4) que suma exactamente `total` (máx 80). */
function escala(total: number): number[] {
  const out = Array<number>(PCL5_LEN).fill(0);
  let resto = total;
  for (let i = 0; i < PCL5_LEN; i++) {
    const v = Math.min(4, resto);
    out[i] = v;
    resto -= v;
  }
  if (resto > 0) throw new Error(`total ${total} no entra en ${PCL5_LEN} ítems (máx 80)`);
  return out;
}

test("pcl5: corte de PTSD probable = 33", () => {
  assert.equal(PCL5_CORTE_PROBABLE, 33);
  // 32 no dispara; 33 sí.
  assert.equal(scorePcl5(escala(32))?.banda, "subumbral");
  assert.equal(scorePcl5(escala(32))?.flags, undefined);
  assert.equal(scorePcl5(escala(33))?.banda, "probable");
  assert.deepEqual(scorePcl5(escala(33))?.flags, [PCL5_FLAG_PROBABLE]);
});

test("pcl5: cortes de banda", () => {
  assert.equal(scorePcl5(escala(0))?.banda, "minima");
  assert.equal(scorePcl5(escala(10))?.banda, "minima");
  assert.equal(scorePcl5(escala(11))?.banda, "subumbral");
  assert.equal(scorePcl5(escala(32))?.banda, "subumbral");
  assert.equal(scorePcl5(escala(33))?.banda, "probable");
  assert.equal(scorePcl5(escala(49))?.banda, "probable");
  assert.equal(scorePcl5(escala(50))?.banda, "marcado");
  assert.equal(scorePcl5(escala(80))?.banda, "marcado");
});

test("pcl5: total correcto e interpretación", () => {
  const r = scorePcl5(escala(40));
  assert.equal(r?.total, 40);
  assert.match(r?.interpretacion ?? "", /40\/80/);
  assert.match(r?.interpretacion ?? "", /≥33/);
  const bajo = scorePcl5(escala(5));
  assert.match(bajo?.interpretacion ?? "", /no diagnóstico/);
});

test("pcl5: contrato laxo — null ante incompleto/inválido", () => {
  assert.equal(scorePcl5(undefined), null);
  assert.equal(scorePcl5(null), null);
  assert.equal(scorePcl5(Array(19).fill(0)), null); // corta
  assert.equal(scorePcl5(Array(21).fill(0)), null); // larga
  assert.equal(scorePcl5(Array(20).fill(5)), null); // fuera de rango (máx 4)
  assert.equal(scorePcl5(Array(20).fill(0).map((v, i) => (i === 3 ? null : v))), null);
});

test("pcl5: def bien formada", () => {
  assert.equal(pcl5.id, "pcl5.v1");
  assert.equal(pcl5.items.length, PCL5_LEN);
  assert.equal(pcl5.opciones?.length, 5); // 0–4
  assert.equal(pcl5.dominio, "salud_mental");
  const ids = new Set(pcl5.bandas.map((b) => b.id));
  for (const t of [0, 11, 33, 50, 80]) {
    assert.ok(ids.has(scorePcl5(escala(t))!.banda));
  }
});
