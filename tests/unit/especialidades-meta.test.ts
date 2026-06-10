import assert from "node:assert/strict";
import test from "node:test";

import {
  ESPECIALIDAD_SLUGS,
  ESPECIALIDADES_META,
  getEspecialidadMeta,
  getEspecialidadMetaByToolId,
  normalizeEspecialidadSlug,
} from "../../lib/especialidades/meta";

test("resumenSesion quiro: reproduce el formato histórico del reader", () => {
  const meta = ESPECIALIDADES_META.quiropraxia;
  assert.equal(
    meta.resumenSesion({ v: 1, vertebras: [{ id: "C4", estado: "ajustada" }, { id: "L5", estado: "ajustada" }] }),
    "C4, L5 ajustadas",
  );
  assert.equal(meta.resumenSesion({ v: 1, vertebras: [] }), "Sin notas vertebrales");
  // Turno cerrado sin sesion row / sin tool data → mismo copy que antes.
  assert.equal(meta.resumenSesion(null), "Sin notas vertebrales");
  assert.equal(meta.resumenSesion(undefined), "Sin notas vertebrales");
});

test("resumenSesion fallbacks: shapes desconocidos degradan al copy genérico", () => {
  // Los resúmenes reales se testean en tests/unit/cardiologia-schema.test.ts
  // y tests/unit/psicologia-schema.test.ts.
  assert.equal(ESPECIALIDADES_META.cardiologia.resumenSesion({ cualquier: "cosa" }), "Sesión registrada");
  assert.equal(
    ESPECIALIDADES_META.cardiologia.resumenSesion({
      v: 1,
      panel: { taSistolica: 130, taDiastolica: 85 },
    }),
    "TA 130/85",
  );
  assert.equal(ESPECIALIDADES_META.psicologia.resumenSesion(null), "Sesión registrada");
  assert.equal(
    ESPECIALIDADES_META.psicologia.resumenSesion({ v: 1, gad7: [1, 1, 1, 0, 0, 1, 1] }),
    "GAD-7 5 (leve)",
  );
});

test("slugs y toolIds: registry consistente con M50", () => {
  assert.deepEqual([...ESPECIALIDAD_SLUGS], ["quiropraxia", "cardiologia", "psicologia"]);
  assert.equal(ESPECIALIDADES_META.quiropraxia.toolId, "quiropraxia.spine.v1");
  assert.equal(ESPECIALIDADES_META.cardiologia.toolId, "cardiologia.cv.v1");
  assert.equal(ESPECIALIDADES_META.psicologia.toolId, "psicologia.escalas.v1");
});

test("getEspecialidadMeta: fallback a quiropraxia para slugs desconocidos", () => {
  assert.equal(getEspecialidadMeta("cardiologia").slug, "cardiologia");
  assert.equal(getEspecialidadMeta("odontologia").slug, "quiropraxia");
  assert.equal(getEspecialidadMeta(null).slug, "quiropraxia");
  assert.equal(normalizeEspecialidadSlug(undefined), "quiropraxia");
  assert.equal(normalizeEspecialidadSlug("psicologia"), "psicologia");
});

test("getEspecialidadMetaByToolId: resuelve por toolId, null para desconocidos", () => {
  assert.equal(getEspecialidadMetaByToolId("quiropraxia.spine.v1")?.slug, "quiropraxia");
  assert.equal(getEspecialidadMetaByToolId("cardiologia.cv.v1")?.slug, "cardiologia");
  assert.equal(getEspecialidadMetaByToolId("psicologia.escalas.v1")?.slug, "psicologia");
  // Los toolIds placeholder pre-Fase D ya no existen en el registry.
  assert.equal(getEspecialidadMetaByToolId("cardiologia.placeholder"), null);
  assert.equal(getEspecialidadMetaByToolId("psicologia.placeholder"), null);
  assert.equal(getEspecialidadMetaByToolId("inexistente.v9"), null);
  assert.equal(getEspecialidadMetaByToolId(null), null);
});

test("schemas: las tres especialidades validan estricto (v literal, shape propio)", () => {
  assert.equal(
    ESPECIALIDADES_META.quiropraxia.schema.safeParse({ v: 1, vertebras: [] }).success,
    true,
  );
  assert.equal(
    ESPECIALIDADES_META.quiropraxia.schema.safeParse({ vertebras: [] }).success,
    false,
  );
  assert.equal(ESPECIALIDADES_META.cardiologia.schema.safeParse({ x: 1 }).success, false);
  assert.equal(ESPECIALIDADES_META.cardiologia.schema.safeParse({ v: 1 }).success, true);
  assert.equal(ESPECIALIDADES_META.psicologia.schema.safeParse(null).success, false);
  assert.equal(ESPECIALIDADES_META.psicologia.schema.safeParse({ v: 1 }).success, true);
  assert.equal(
    ESPECIALIDADES_META.psicologia.schema.safeParse({ v: 1, phq9: [0, 0, 0] }).success,
    false,
  );
});
