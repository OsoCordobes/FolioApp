/**
 * Folio · tests del seed demo por especialidad (lib/demo/seed-especialidades).
 *
 * Lo que protege: /api/admin/seed-demo siembra sesiones clínicas en PROD para
 * las orgs demo. Un tool_data que no valide contra el schema vigente (o un
 * tool_id que no pertenezca a la especialidad) = ficha que no renderiza en
 * plena llamada de venta. buildDemoToolData ya parsea con los schemas reales
 * para quiro/kinesio/nutrición — estos tests ejercitan ese parse para TODOS
 * los índices que usa el endpoint y fijan las invariantes de consistencia.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDemoToolData,
  demoOrgNombre,
  demoOrgSlug,
  PACIENTES_DEMO,
  SOAP_DEMO,
} from "../../lib/demo/seed-especialidades";
import {
  ESPECIALIDAD_SLUGS,
  toolPerteneceAEspecialidad,
} from "../../lib/especialidades/meta";

// El endpoint genera payloads para índices 0..N-1 (+k de sesiones cerradas):
// cubrimos un rango holgado para que ninguna variación por índice rompa.
const INDICES = Array.from({ length: 16 }, (_, i) => i);

// Mismo CHECK que organization_slug_format (M02).
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$/;

for (const esp of ESPECIALIDAD_SLUGS) {
  test(`buildDemoToolData(${esp}): valida y su tool_id pertenece a la especialidad`, () => {
    for (const i of INDICES) {
      const { toolId, data } = buildDemoToolData(esp, i);
      assert.equal(
        toolPerteneceAEspecialidad(toolId, esp),
        true,
        `tool_id ${toolId} no pertenece a ${esp}`,
      );
      assert.equal(typeof data, "object");
      assert.ok(data !== null);
      // Serializable: el endpoint hace JSON.stringify antes de cifrar.
      assert.doesNotThrow(() => JSON.stringify(data));
    }
  });

  test(`datos demo (${esp}): pacientes ficticios completos y org demo válida`, () => {
    const pacientes = PACIENTES_DEMO[esp];
    assert.ok(pacientes.length >= 4, "al menos 4 pacientes demo por especialidad");
    for (const p of pacientes) {
      // Ficticios por contrato: emails example.com y teléfonos 555 de fantasía.
      assert.match(p.email, /@example\.com$/);
      assert.match(p.tel, / 555 /);
      assert.match(p.nac, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(p.motivo.length > 0 && p.cond.length > 0);
    }
    assert.match(demoOrgSlug(esp), SLUG_RE);
    assert.ok(demoOrgNombre(esp).startsWith("Demo"));
    const soap = SOAP_DEMO[esp];
    for (const campo of [soap.s, soap.o, soap.a, soap.p]) {
      assert.ok(campo.length > 0);
    }
  });
}

test("los DNIs demo no colisionan dentro de una especialidad", () => {
  for (const esp of ESPECIALIDAD_SLUGS) {
    const dnis = PACIENTES_DEMO[esp].map((p) => p.dni);
    assert.equal(new Set(dnis).size, dnis.length, `DNIs duplicados en ${esp}`);
  }
});
