/**
 * Folio · tests · instrumento Borg RPE 6–20 (lib/instrumentos/scoring/borg.ts).
 *
 * Fija los cortes de banda (6–8 muy ligero, 9–11 ligero, 12–14 moderado,
 * 15–17 intenso, 18–20 máximo), la aceptación de `n` o `[n]`, y el contrato
 * laxo (null fuera de rango 6–20 / no entero).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { BORG_MAX, BORG_MIN, borg, scoreBorg } from "../../lib/instrumentos/scoring/borg";

test("borg: cortes de banda", () => {
  assert.equal(scoreBorg(6)?.banda, "muy_ligero");
  assert.equal(scoreBorg(8)?.banda, "muy_ligero");
  assert.equal(scoreBorg(9)?.banda, "ligero");
  assert.equal(scoreBorg(11)?.banda, "ligero");
  assert.equal(scoreBorg(12)?.banda, "moderado");
  assert.equal(scoreBorg(14)?.banda, "moderado");
  assert.equal(scoreBorg(15)?.banda, "intenso");
  assert.equal(scoreBorg(17)?.banda, "intenso");
  assert.equal(scoreBorg(18)?.banda, "maximo");
  assert.equal(scoreBorg(20)?.banda, "maximo");
});

test("borg: acepta n o [n]; total = valor elegido", () => {
  assert.equal(scoreBorg(13)?.total, 13);
  assert.equal(scoreBorg([13])?.total, 13);
  assert.equal(scoreBorg([13])?.banda, "moderado");
  assert.match(scoreBorg(13)?.interpretacion ?? "", /13\/20/);
});

test("borg: contrato laxo — null fuera de rango / no entero", () => {
  assert.equal(scoreBorg(undefined), null);
  assert.equal(scoreBorg(null), null);
  assert.equal(scoreBorg(BORG_MIN - 1), null); // 5, por debajo
  assert.equal(scoreBorg(BORG_MAX + 1), null); // 21, por encima
  assert.equal(scoreBorg(13.5), null); // no entero
  assert.equal(scoreBorg("13"), null);
  assert.equal(scoreBorg([]), null);
});

test("borg: def bien formada", () => {
  assert.equal(borg.id, "borg.v1");
  assert.equal(borg.items.length, 1);
  assert.equal(borg.opciones?.length, BORG_MAX - BORG_MIN + 1); // 15 valores 6..20
  assert.equal(borg.dominio, "esfuerzo_percibido");
});
