/**
 * Folio · pluralización de contadores (E1).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { contar, palabra } from "../../lib/format/plural";

test("uno es singular, todo lo demás plural", () => {
  assert.equal(contar(1, "turno"), "1 turno");
  assert.equal(contar(2, "turno"), "2 turnos");
  assert.equal(contar(17, "turno"), "17 turnos");
});

test("cero es plural en castellano", () => {
  // "0 turno" suena a traducción automática; en castellano el cero pluraliza.
  assert.equal(contar(0, "turno"), "0 turnos");
});

test("las palabras irregulares se pasan explícitas", () => {
  // "sesión" pierde la tilde al pluralizar: `${singular}s` daría "sesións".
  assert.equal(contar(1, "sesión", "sesiones"), "1 sesión");
  assert.equal(contar(4, "sesión", "sesiones"), "4 sesiones");
});

test("los negativos siguen la misma regla que su magnitud", () => {
  // Aparecen en saldos y diferencias; "-1 turnos" es el mismo error al revés.
  assert.equal(contar(-1, "turno"), "-1 turno");
  assert.equal(contar(-3, "turno"), "-3 turnos");
});

test("palabra() sirve cuando el número se pinta aparte", () => {
  // La vista mes muestra el número en su propio chip y necesita solo el
  // sustantivo para el aria-label.
  assert.equal(palabra(1, "turno"), "turno");
  assert.equal(palabra(9, "turno"), "turnos");
});
