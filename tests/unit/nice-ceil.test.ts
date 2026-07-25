import assert from "node:assert/strict";
import test from "node:test";

import { niceCeil } from "../../lib/format/nice-ceil";

// E2 · eje Y del chart de /finanzas relativo al dato: techo "lindo" 1/2/5×10^n.

test("niceCeil: redondea hacia arriba a 1/2/5 × 10^n", () => {
  assert.equal(niceCeil(8), 10);
  assert.equal(niceCeil(12), 20);
  assert.equal(niceCeil(35_000), 50_000);
  assert.equal(niceCeil(172_500), 200_000);
  assert.equal(niceCeil(700_000), 1_000_000);
});

test("niceCeil: los valores 'lindos' quedan como están", () => {
  assert.equal(niceCeil(1), 1);
  assert.equal(niceCeil(2), 2);
  assert.equal(niceCeil(100), 100);
  assert.equal(niceCeil(50_000), 50_000);
  assert.equal(niceCeil(1_000), 1_000);
});

test("niceCeil: apenas por encima de un escalón salta al siguiente", () => {
  assert.equal(niceCeil(50_001), 100_000);
  assert.equal(niceCeil(20_001), 50_000);
  assert.equal(niceCeil(101), 200);
});

test("niceCeil: caso del audit — consultorio chico ya no queda aplanado", () => {
  // $40.000/día máx observado × headroom 1.15 = 46.000 → techo 50.000
  // (antes el piso hardcodeado era $150.000 y la curva quedaba pegada abajo).
  assert.equal(niceCeil(40_000 * 1.15), 50_000);
});

test("niceCeil: fallback chico para el estado vacío o valores inválidos", () => {
  assert.equal(niceCeil(0), 10_000);
  assert.equal(niceCeil(-5), 10_000);
  assert.equal(niceCeil(Number.NaN), 10_000);
  assert.equal(niceCeil(Number.POSITIVE_INFINITY), 10_000);
  assert.equal(niceCeil(0, 500), 500);
});
