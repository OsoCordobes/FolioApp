/**
 * Folio · tests · IDOR guard de la sesión clínica
 * (lib/db/sesiones.ts → checkTurnoOwnership — Fase F, F-AUTH).
 *
 * El turnoId y el pacienteId viajan del cliente. Antes del upsert, upsertSesion
 * lee el turno bajo RLS y delega la decisión a este helper puro. Acá fijamos las
 * invariantes que impiden escribir PHI en un turno ajeno o cruzado de paciente:
 *
 *   1. turno de OTRA org           → forbidden (IDOR cross-tenant)
 *   2. turno inexistente (RLS ∅)   → forbidden
 *   3. turno.paciente_id != input  → forbidden (turno↔paciente cruzado)
 *   4. todo coincide               → ok
 */

import assert from "node:assert/strict";
import test from "node:test";

import { checkTurnoOwnership } from "../../lib/db/sesiones";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PACIENTE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTRO_PACIENTE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

test("turno de otra org → forbidden (IDOR cross-tenant)", () => {
  const verdict = checkTurnoOwnership(
    { organization_id: ORG_B, paciente_id: PACIENTE },
    ORG_A,
    PACIENTE,
  );
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.code, "forbidden");
    assert.match(verdict.message, /organización/i);
  }
});

test("turno inexistente (RLS no devolvió fila) → forbidden", () => {
  const verdict = checkTurnoOwnership(null, ORG_A, PACIENTE);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "forbidden");
});

test("turno de la org activa pero de otro paciente → forbidden", () => {
  const verdict = checkTurnoOwnership(
    { organization_id: ORG_A, paciente_id: OTRO_PACIENTE },
    ORG_A,
    PACIENTE,
  );
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.code, "forbidden");
    assert.match(verdict.message, /paciente/i);
  }
});

test("turno de la org activa y del paciente correcto → ok (no regresa el flujo válido)", () => {
  const verdict = checkTurnoOwnership(
    { organization_id: ORG_A, paciente_id: PACIENTE },
    ORG_A,
    PACIENTE,
  );
  assert.equal(verdict.ok, true);
});
