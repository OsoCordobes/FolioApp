import assert from "node:assert/strict";
import test from "node:test";

import { normalizeModalidad } from "../../lib/types";

// ─── normalizeModalidad (M72, pura) ──────────────────────────────────────
//
// Regla T1: la modalidad del turno se lee de turno.modalidad (lowercase en DB:
// 'presencial' | 'telemedicina'). Cualquier ausencia/valor inesperado cae a
// 'presencial' (el default histórico) para preservar el comportamiento y no
// romper el render de una fila con datos legacy/nulos.

test("normalizeModalidad: 'telemedicina' se mapea a telemedicina", () => {
  assert.equal(normalizeModalidad("telemedicina"), "telemedicina");
});

test("normalizeModalidad: 'presencial' se mapea a presencial", () => {
  assert.equal(normalizeModalidad("presencial"), "presencial");
});

test("normalizeModalidad: null/undefined caen a presencial (default histórico)", () => {
  assert.equal(normalizeModalidad(null), "presencial");
  assert.equal(normalizeModalidad(undefined), "presencial");
});

test("normalizeModalidad: valor inesperado cae a presencial (defensivo)", () => {
  assert.equal(normalizeModalidad("hibrido"), "presencial");
  assert.equal(normalizeModalidad(""), "presencial");
  assert.equal(normalizeModalidad("TELEMEDICINA"), "presencial"); // case-sensitive: DB es lowercase
});
