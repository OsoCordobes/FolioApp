import assert from "node:assert/strict";
import test from "node:test";

import { normalizarBusqueda } from "../../lib/format/busqueda";

/**
 * Folio · búsqueda con tildes (encargo C3 · plan grado A).
 *
 * `normalizarBusqueda` se aplica a AMBOS lados (query y campo) en el buscador
 * del directorio /pacientes y en el typeahead del modal de crear turno. El
 * caso más común del país: "jose" tiene que encontrar a "José".
 *
 * Runs con el runner nativo de Node:
 *   node --test --import tsx tests/unit/busqueda-normalizar.test.ts
 */

test("strip de tildes: los nombres argentinos más comunes", () => {
  assert.equal(normalizarBusqueda("José"), "jose");
  assert.equal(normalizarBusqueda("María"), "maria");
  assert.equal(normalizarBusqueda("Martín"), "martin");
  assert.equal(normalizarBusqueda("Nicolás Gómez"), "nicolas gomez");
  assert.equal(normalizarBusqueda("Agustín Díaz"), "agustin diaz");
});

test("lowercase + trim", () => {
  assert.equal(normalizarBusqueda("  PÉREZ  "), "perez");
  assert.equal(normalizarBusqueda("LAUTARO"), "lautaro");
});

test("ñ y diéresis se normalizan (munoz encuentra a Muñoz)", () => {
  assert.equal(normalizarBusqueda("Muñoz"), "munoz");
  assert.equal(normalizarBusqueda("Agüero"), "aguero");
});

test("simetría query↔campo: buscar con o sin tilde da el mismo resultado", () => {
  const campo = normalizarBusqueda("José María Gutiérrez");
  assert.ok(campo.includes(normalizarBusqueda("jose")));
  assert.ok(campo.includes(normalizarBusqueda("JOSÉ")));
  assert.ok(campo.includes(normalizarBusqueda("gutierrez")));
  assert.ok(campo.includes(normalizarBusqueda("Gutiérrez")));
  assert.ok(campo.includes(normalizarBusqueda("maría")));
});

test("no rompe strings sin diacríticos ni números/teléfonos", () => {
  assert.equal(normalizarBusqueda("Ana Lopez"), "ana lopez");
  assert.equal(normalizarBusqueda("351-555-0199"), "351-555-0199");
});

test("input vacío o falsy devuelve vacío", () => {
  assert.equal(normalizarBusqueda(""), "");
  assert.equal(normalizarBusqueda("   "), "");
});

test("idempotente: normalizar dos veces no cambia el resultado", () => {
  const una = normalizarBusqueda("Verónica Ñáñez");
  assert.equal(normalizarBusqueda(una), una);
});
