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
  ESPECIALIDADES_META,
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
      // Invariante clave (ultra-review pre-demo): el seed escribe el shape de
      // ESCRITURA vigente del registry, no un legacy leído-por-compat. Un
      // toolId viejo (ej. cardiologia.cv.v1) renderiza el panel legacy en
      // plena demo — este assert lo ataja.
      assert.equal(
        toolId,
        ESPECIALIDADES_META[esp].toolId,
        `tool_id ${toolId} no es el shape de escritura vigente de ${esp} (${ESPECIALIDADES_META[esp].toolId})`,
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

test("psicología: el ítem 9 del PHQ-9 (ideación) es SIEMPRE 0 en los datos demo", () => {
  // Un valor > 0 dispara el workflow de riesgo suicida (C7) — inaceptable que
  // aparezca solo frente a un cliente en una demo de venta.
  for (const i of INDICES) {
    const { data } = buildDemoToolData("psicologia", i);
    const phq9 = (data as { phq9?: number[] }).phq9;
    assert.ok(Array.isArray(phq9) && phq9.length === 9, "phq9 completo (9 ítems)");
    assert.equal(phq9[8], 0, `phq9[8] (ítem 9, ideación) debe ser 0 — vino ${phq9[8]} (i=${i})`);
  }
});

test("cardiología v3: medicación y estudios con fechas relativas (no hardcodeadas)", () => {
  const { data } = buildDemoToolData("cardiologia", 0);
  const estudios = (data as { estudios?: Array<{ fecha: string }> }).estudios ?? [];
  assert.ok(estudios.length > 0);
  const unAnio = 366 * 24 * 60 * 60 * 1000;
  for (const e of estudios) {
    const t = new Date(`${e.fecha}T00:00:00Z`).getTime();
    assert.ok(
      Number.isFinite(t) && Math.abs(Date.now() - t) < unAnio,
      `fecha de estudio ${e.fecha} no es relativa a hoy`,
    );
  }
});
