/**
 * Folio · tests · instrumento C-SSRS screener (lib/instrumentos/scoring/cssrs.ts).
 *
 * Fija:
 *   - el nivel de riesgo por la pregunta positiva de mayor severidad,
 *   - las flags accionables (intención / plan / conducta),
 *   - la aceptación de boolean[] y (0|1)[],
 *   - el contrato laxo (null ante longitud/valores inválidos).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CSSRS_FLAG_CONDUCTA,
  CSSRS_FLAG_INTENCION,
  CSSRS_FLAG_PLAN,
  CSSRS_LEN,
  cssrs,
  scoreCssrs,
} from "../../lib/instrumentos/scoring/cssrs";

/** 6 respuestas todas false, con las posiciones `pos` (1-based) en true. */
function resp(...pos: number[]): boolean[] {
  const out = Array<boolean>(CSSRS_LEN).fill(false);
  for (const p of pos) out[p - 1] = true;
  return out;
}

test("cssrs: banda por pregunta positiva de mayor severidad", () => {
  assert.equal(scoreCssrs(resp())?.banda, "sin_riesgo");
  assert.equal(scoreCssrs(resp(1))?.banda, "bajo"); // deseo de estar muerto
  assert.equal(scoreCssrs(resp(2))?.banda, "bajo"); // ideación activa inespecífica
  assert.equal(scoreCssrs(resp(3))?.banda, "moderado"); // ideación con método
  assert.equal(scoreCssrs(resp(4))?.banda, "alto"); // intención
  assert.equal(scoreCssrs(resp(5))?.banda, "alto"); // plan
  assert.equal(scoreCssrs(resp(6))?.banda, "alto"); // conducta
  // La más severa gana aunque haya positivas de menor severidad.
  assert.equal(scoreCssrs(resp(1, 2, 3))?.banda, "moderado");
  assert.equal(scoreCssrs(resp(1, 2, 6))?.banda, "alto");
});

test("cssrs: flags accionables (intención / plan / conducta)", () => {
  assert.equal(scoreCssrs(resp(1, 2, 3))?.flags, undefined); // sin ítems 4–6
  assert.deepEqual(scoreCssrs(resp(4))?.flags, [CSSRS_FLAG_INTENCION]);
  // Plan (ítem 5) implica intención + plan.
  assert.deepEqual(scoreCssrs(resp(5))?.flags, [CSSRS_FLAG_INTENCION, CSSRS_FLAG_PLAN]);
  assert.deepEqual(scoreCssrs(resp(6))?.flags, [CSSRS_FLAG_CONDUCTA]);
  // Todo junto: intención + plan + conducta.
  assert.deepEqual(scoreCssrs(resp(4, 5, 6))?.flags, [
    CSSRS_FLAG_INTENCION,
    CSSRS_FLAG_PLAN,
    CSSRS_FLAG_CONDUCTA,
  ]);
});

test("cssrs: total = cantidad de positivas", () => {
  assert.equal(scoreCssrs(resp())?.total, 0);
  assert.equal(scoreCssrs(resp(1, 3, 5))?.total, 3);
});

test("cssrs: acepta boolean[] y (0|1)[]", () => {
  assert.equal(scoreCssrs([0, 0, 1, 0, 0, 0])?.banda, "moderado");
  assert.equal(scoreCssrs([false, false, false, false, false, true])?.banda, "alto");
});

test("cssrs: contrato laxo — null ante longitud/valores inválidos", () => {
  assert.equal(scoreCssrs(undefined), null);
  assert.equal(scoreCssrs(null), null);
  assert.equal(scoreCssrs([false, false]), null); // corta
  assert.equal(scoreCssrs(Array(7).fill(false)), null); // larga
  assert.equal(scoreCssrs([0, 1, 2, 0, 0, 0]), null); // 2 no es 0/1 ni bool
  assert.equal(scoreCssrs(["si", "no", "no", "no", "no", "no"]), null);
});

test("cssrs: def bien formada", () => {
  assert.equal(cssrs.id, "cssrs.v1");
  assert.equal(cssrs.items.length, CSSRS_LEN);
  assert.equal(cssrs.dominio, "riesgo");
  const ids = new Set(cssrs.bandas.map((b) => b.id));
  for (const b of ["sin_riesgo", "bajo", "moderado", "alto"]) {
    assert.ok(ids.has(b));
  }
});
