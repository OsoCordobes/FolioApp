/**
 * Folio · tests · scope anti-IDOR del export del paciente
 * (lib/patient/export-builder.ts → assertPacienteScope · PR X2).
 *
 * El export del paciente (Ley 25.326 art. 14) es mediado por el profesional. Su
 * riesgo central es IDOR: exportar los datos de un paciente ajeno. El builder lee
 * `paciente` bajo RLS scopeado por (org de la sesión, paciente_id) y delega la
 * verificación final a este helper puro. Acá fijamos las invariantes que impiden
 * armar el paquete de un paciente de otra org, sin mockear Supabase:
 *
 *   1. fila ausente (RLS ∅ / inexistente / otra org)  → not_found
 *   2. fila de OTRA org que la esperada                → forbidden (defensa en profundidad)
 *   3. fila de la org esperada                         → ok
 */

import assert from "node:assert/strict";
import test from "node:test";

import { assertPacienteScope } from "../../lib/patient/export-builder";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PACIENTE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("fila ausente (RLS no devolvió paciente) → not_found (no filtra existencia cross-tenant)", () => {
  const verdict = assertPacienteScope(null, ORG_A);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.code, "not_found");
    assert.match(verdict.message, /no encontrado/i);
  }
});

test("fila undefined → not_found", () => {
  const verdict = assertPacienteScope(undefined, ORG_A);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "not_found");
});

test("fila de OTRA org que la esperada → forbidden (defensa en profundidad sobre la RLS)", () => {
  const verdict = assertPacienteScope(
    { id: PACIENTE, organization_id: ORG_B },
    ORG_A,
  );
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.code, "forbidden");
    assert.match(verdict.message, /organización/i);
  }
});

test("fila de la org esperada → ok (no regresa el flujo válido)", () => {
  const verdict = assertPacienteScope(
    { id: PACIENTE, organization_id: ORG_A },
    ORG_A,
  );
  assert.equal(verdict.ok, true);
});
