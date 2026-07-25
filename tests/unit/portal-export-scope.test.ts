/**
 * Folio · tests · scope cross-org del export SELF-SERVE del portal
 * (lib/patient/portal-export.ts → assertLinkedOrgScope · PR P7 / Fase 3).
 *
 * El export del portal (Ley 25.326 art. 14) lo genera el PROPIO paciente y agrega
 * TODAS sus fichas linkeadas — una por org. El gating cross-org es por `cuenta_id`
 * (el fan-out de la sesión ya está scopeado por RLS a auth.uid()), NUNCA por un id
 * de org que mande el cliente. Acá fijamos, sin mockear Supabase, que:
 *
 *   1. El scope es EXACTAMENTE las fichas del fan-out (ni más ni menos): una org
 *      linkeada entra, una NO linkeada no puede entrar porque no está en el input.
 *   2. Sin ninguna ficha linkeada → no_links (estado vacío legítimo, no un leak).
 *   3. El shape verificado preserva (paciente_id, org_id) por ficha para que el
 *      caller itere sin re-leer la sesión.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { PortalPaciente } from "../../lib/db/paciente-session";
import { assertLinkedOrgScope } from "../../lib/patient/portal-export";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAC_A = "11111111-1111-4111-8111-111111111111";
const PAC_B = "22222222-2222-4222-8222-222222222222";

test("sin fichas linkeadas → no_links (estado vacío, no un error de seguridad)", () => {
  const verdict = assertLinkedOrgScope([]);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.code, "no_links");
    assert.match(verdict.message, /vincul/i);
  }
});

test("una sola ficha linkeada → scope de exactamente esa org", () => {
  const pacientes: PortalPaciente[] = [
    { pacienteId: PAC_A, organizationId: ORG_A, organizacionNombre: "Consultorio A", bookingSlug: null },
  ];
  const verdict = assertLinkedOrgScope(pacientes);
  assert.equal(verdict.ok, true);
  if (verdict.ok) {
    assert.equal(verdict.orgs.length, 1);
    assert.equal(verdict.orgs[0].organizationId, ORG_A);
    assert.equal(verdict.orgs[0].pacienteId, PAC_A);
    assert.equal(verdict.orgs[0].organizacionNombre, "Consultorio A");
  }
});

test("varias fichas linkeadas → scope agrega TODAS las orgs linkeadas (una por org)", () => {
  const pacientes: PortalPaciente[] = [
    { pacienteId: PAC_A, organizationId: ORG_A, organizacionNombre: "Consultorio A", bookingSlug: null },
    { pacienteId: PAC_B, organizationId: ORG_B, organizacionNombre: "Consultorio B", bookingSlug: null },
  ];
  const verdict = assertLinkedOrgScope(pacientes);
  assert.equal(verdict.ok, true);
  if (verdict.ok) {
    const orgIds = verdict.orgs.map((o) => o.organizationId).sort();
    assert.deepEqual(orgIds, [ORG_A, ORG_B].sort());
    // Cada org conserva su propio paciente_id (para scopear buildPatientExport).
    const parA = verdict.orgs.find((o) => o.organizationId === ORG_A);
    const parB = verdict.orgs.find((o) => o.organizationId === ORG_B);
    assert.equal(parA?.pacienteId, PAC_A);
    assert.equal(parB?.pacienteId, PAC_B);
  }
});

test("el scope NO puede incluir una org fuera del fan-out (gating por cuenta_id)", () => {
  // El input es el fan-out RLS-scopeado; una org donde el paciente NO está
  // linkeado simplemente NO aparece en la lista ⇒ no puede entrar al export.
  // Reafirmamos que el verdict jamás inventa una org que no vino en el input.
  const pacientes: PortalPaciente[] = [
    { pacienteId: PAC_A, organizationId: ORG_A, organizacionNombre: "Consultorio A", bookingSlug: null },
  ];
  const verdict = assertLinkedOrgScope(pacientes);
  assert.equal(verdict.ok, true);
  if (verdict.ok) {
    assert.equal(
      verdict.orgs.some((o) => o.organizationId === ORG_B),
      false,
      "una org NO linkeada no debe aparecer en el scope del export",
    );
  }
});

test("nombre de org null se preserva (ficha linkeada sin nombre visible)", () => {
  const pacientes: PortalPaciente[] = [
    { pacienteId: PAC_A, organizationId: ORG_A, organizacionNombre: null, bookingSlug: null },
  ];
  const verdict = assertLinkedOrgScope(pacientes);
  assert.equal(verdict.ok, true);
  if (verdict.ok) {
    assert.equal(verdict.orgs[0].organizacionNombre, null);
  }
});
