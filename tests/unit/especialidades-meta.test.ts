import assert from "node:assert/strict";
import test from "node:test";

import {
  ESPECIALIDAD_SLUGS,
  ESPECIALIDADES_META,
  getEspecialidadMeta,
  getEspecialidadMetaByToolId,
  normalizeEspecialidadSlug,
} from "../../lib/especialidades/meta";

test("resumenSesion quiro v1: reproduce el formato histórico del reader", () => {
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

test("resumenSesion quiro v2: cuenta de vértebras con notas (Workstream 6)", () => {
  const meta = ESPECIALIDADES_META.quiropraxia;
  assert.equal(
    meta.resumenSesion({
      v: 2,
      vista: "posterior",
      vertebras: [
        { id: "C4", tecnicaAjuste: "drop" },
        { id: "L5", listado: "PLI" },
        { id: "T7", tecnicaAjuste: "diversificada" },
      ],
    }),
    "3 vértebras con notas",
  );
  assert.equal(
    meta.resumenSesion({ v: 2, vista: "posterior", vertebras: [{ id: "C4", listado: "PRS" }] }),
    "1 vértebra con notas",
  );
  // v2 sin vértebras con contenido → mismo copy genérico.
  assert.equal(meta.resumenSesion({ v: 2, vista: "posterior" }), "Sin notas vertebrales");
  assert.equal(
    meta.resumenSesion({ v: 2, vista: "posterior", vertebras: [{ id: "C4" }, { id: "L5", tecnicaAjuste: "  " }] }),
    "Sin notas vertebrales",
  );
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

test("slugs y toolIds: registry consistente (Workstream 6 · write id v2)", () => {
  assert.deepEqual([...ESPECIALIDAD_SLUGS], ["quiropraxia", "cardiologia", "psicologia"]);
  // El id de ESCRITURA de quiropraxia es v2; v1 se sigue LEYENDO via toolIds.
  assert.equal(ESPECIALIDADES_META.quiropraxia.toolId, "quiropraxia.ficha.v2");
  assert.deepEqual(
    [...ESPECIALIDADES_META.quiropraxia.toolIds],
    ["quiropraxia.ficha.v2", "quiropraxia.spine.v1"],
  );
  assert.equal(ESPECIALIDADES_META.cardiologia.toolId, "cardiologia.cv.v1");
  assert.deepEqual([...ESPECIALIDADES_META.cardiologia.toolIds], ["cardiologia.cv.v1"]);
  assert.equal(ESPECIALIDADES_META.psicologia.toolId, "psicologia.escalas.v1");
  assert.deepEqual([...ESPECIALIDADES_META.psicologia.toolIds], ["psicologia.escalas.v1"]);
});

test("getEspecialidadMeta: fallback a quiropraxia para slugs desconocidos", () => {
  assert.equal(getEspecialidadMeta("cardiologia").slug, "cardiologia");
  assert.equal(getEspecialidadMeta("odontologia").slug, "quiropraxia");
  assert.equal(getEspecialidadMeta(null).slug, "quiropraxia");
  assert.equal(normalizeEspecialidadSlug(undefined), "quiropraxia");
  assert.equal(normalizeEspecialidadSlug("psicologia"), "psicologia");
});

test("getEspecialidadMetaByToolId: resuelve por MEMBRESÍA (v1 + v2), null para desconocidos", () => {
  // Workstream 6 · two-id: el id v2 de escritura Y el v1 legacy resuelven a
  // quiropraxia — las sesiones viejas no quedan huérfanas al bumpear el shape.
  assert.equal(getEspecialidadMetaByToolId("quiropraxia.ficha.v2")?.slug, "quiropraxia");
  assert.equal(getEspecialidadMetaByToolId("quiropraxia.spine.v1")?.slug, "quiropraxia");
  assert.equal(getEspecialidadMetaByToolId("cardiologia.cv.v1")?.slug, "cardiologia");
  assert.equal(getEspecialidadMetaByToolId("psicologia.escalas.v1")?.slug, "psicologia");
  // Los toolIds placeholder pre-Fase D ya no existen en el registry.
  assert.equal(getEspecialidadMetaByToolId("cardiologia.placeholder"), null);
  assert.equal(getEspecialidadMetaByToolId("psicologia.placeholder"), null);
  assert.equal(getEspecialidadMetaByToolId("inexistente.v9"), null);
  assert.equal(getEspecialidadMetaByToolId(null), null);
});

// ─── Rechazo cross-tool (F-PHI, review PR #56) ───────────────────────────────
//
// Los schemas de tool son .strict(): un payload de OTRA herramienta debe
// RECHAZAR, no parsear "OK" reducido a `{ v: 1 }` por stripping de claves
// desconocidas. De esto depende el writer (lib/db/sesiones.ts): si el turno
// se reasigna o member.especialidad cambia entre render y save, el borrador
// de la herramienta vieja rebota con error visible en vez de persistirse
// vacío con el tool_id equivocado (corrupción silenciosa de PHI).

const PAYLOADS_VALIDOS = {
  // Workstream 6 · quiropraxia ahora escribe v2 (el schema del registry es v2).
  quiropraxia: {
    v: 2,
    vista: "posterior",
    vertebras: [{ id: "C4", tecnicaAjuste: "drop", listado: "PLI" }],
    palpacionEstatica: "Hipertonía paravertebral C4-C6.",
  },
  cardiologia: {
    v: 1,
    panel: { taSistolica: 130, taDiastolica: 85, fc: 72, factores: { hta: true } },
    estudios: [{ tipo: "ECG", fecha: "2026-06-01", hallazgos: "RS.", conclusion: "normal" }],
  },
  psicologia: {
    v: 1,
    phq9: [0, 1, 2, 3, 0, 1, 2, 3, 0],
    gad7: [0, 1, 2, 3, 0, 1, 2],
    registro: { animo: "ansioso", riesgo: "sin_riesgo" },
    objetivos: [{ texto: "Reducir evitación social", estado: "en_curso" }],
  },
} as const;

test("cross-tool: cada payload RECHAZA contra los schemas de las otras dos especialidades (6 direcciones)", () => {
  for (const origen of ESPECIALIDAD_SLUGS) {
    for (const destino of ESPECIALIDAD_SLUGS) {
      const parsed = ESPECIALIDADES_META[destino].schema.safeParse(PAYLOADS_VALIDOS[origen]);
      if (origen === destino) {
        assert.equal(parsed.success, true, `${origen} contra su propio schema debería parsear`);
      } else {
        assert.equal(parsed.success, false, `payload ${origen} contra schema ${destino} debería rechazar`);
      }
    }
  }
});

test("cross-tool: el rechazo es por .strict(), no por casualidad — sin claves ajenas {v:1}/{v:2} pelado donde corresponde", () => {
  // Documenta el mecanismo: cardio/psico aceptan {v:1} pelado (campos de
  // contenido opcionales) — el peligro era exactamente que un payload ajeno
  // degradara a eso. Quiro v2 exige `v: 2`, así que ni {v:1} ni {v:2} pelado
  // de otra tool le parsean; {v:2} pelado SÍ (vértebras/secciones opcionales).
  assert.equal(ESPECIALIDADES_META.cardiologia.schema.safeParse({ v: 1 }).success, true);
  assert.equal(ESPECIALIDADES_META.psicologia.schema.safeParse({ v: 1 }).success, true);
  assert.equal(ESPECIALIDADES_META.quiropraxia.schema.safeParse({ v: 1 }).success, false);
  assert.equal(ESPECIALIDADES_META.quiropraxia.schema.safeParse({ v: 2 }).success, true);
});

test("re-hidratación: lo que el writer persistió (schema.parse(...).data) re-parsea idéntico con .strict()", () => {
  // El toolDraft de la ficha es JSON.parse(descifrado(tool_data_cifrado)) y el
  // writer lo re-valida en el siguiente guardado: el output del propio schema
  // tiene que seguir parseando (sin claves extra tipo timestamps — el schema
  // stripea/define el shape persistido).
  for (const slug of ESPECIALIDAD_SLUGS) {
    const primera = ESPECIALIDADES_META[slug].schema.safeParse(PAYLOADS_VALIDOS[slug]);
    assert.equal(primera.success, true, `${slug}: primera pasada`);
    if (!primera.success) continue;
    const persistido = JSON.parse(JSON.stringify(primera.data)) as unknown;
    const segunda = ESPECIALIDADES_META[slug].schema.safeParse(persistido);
    assert.equal(segunda.success, true, `${slug}: draft re-hidratado`);
    if (segunda.success) assert.deepEqual(segunda.data, primera.data);
  }
});

test("schemas: las tres especialidades validan estricto (v literal, shape propio)", () => {
  // Workstream 6 · quiro escribe v2: {v:2} pelado válido; {v:1} y sin `v` no.
  assert.equal(
    ESPECIALIDADES_META.quiropraxia.schema.safeParse({ v: 2, vista: "posterior" }).success,
    true,
  );
  assert.equal(
    ESPECIALIDADES_META.quiropraxia.schema.safeParse({ v: 1, vertebras: [] }).success,
    false,
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
