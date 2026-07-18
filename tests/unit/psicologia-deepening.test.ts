/**
 * Folio · tests · psicología · deepening 2 (C8).
 *
 * Cubre lo NUEVO de lib/especialidades/psicologia/schema.ts para C8:
 *   - psicologiaToolDataV3Schema — parse válido/parcial/inválido + .strict() del
 *     bloque procesoNota (formato + campos acotados a las claves de sección).
 *   - MSE completo — los dominios agregados (orientación/atención/memoria/…) en
 *     registro parsean; extractRegistro los extrae laxo y descarta enums malos.
 *   - extractProcesoNota — extracción laxa (v1/v2 sin nota, shapes ajenos → null).
 *   - parsePsicologiaToolData — ahora discrimina v3/v2/v1/vacío.
 *   - Dashboard: familiaInstrumento, deriveOutcomeSeries (agrega por fecha, filtra
 *     familias, descarta scores null/fechas malas), deriveEstadoObjetivos,
 *     OUTCOME_METRICAS.
 *   - Compat: v1/v2 se siguen leyendo (sin migración de datos).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveEstadoObjetivos,
  deriveOutcomeSeries,
  extractProcesoNota,
  extractRegistro,
  familiaInstrumento,
  NOTA_FORMATO_SECCIONES,
  OUTCOME_METRICAS,
  parsePsicologiaToolData,
  psicologiaToolDataSchema,
  psicologiaToolDataV2Schema,
  psicologiaToolDataV3Schema,
  type OutcomeRespuesta,
} from "../../lib/especialidades/psicologia/schema";
import type { ToolHistorialEntry } from "../../lib/especialidades/types";

// ─── Schema v3 · bloque procesoNota ──────────────────────────────────────────

test("v3 schema: procesoNota completo válido (SOAP con dos secciones)", () => {
  const data = {
    v: 3,
    phq9: [0, 1, 2, 3, 0, 1, 2, 3, 0],
    procesoNota: {
      formato: "soap",
      campos: { subjetivo: "Refiere mejoría.", plan: "Continuar TCC." },
    },
  };
  assert.equal(psicologiaToolDataV3Schema.safeParse(data).success, true);
});

test("v3 schema: procesoNota parcial (solo formato, o solo campos) válido", () => {
  assert.equal(
    psicologiaToolDataV3Schema.safeParse({ v: 3, procesoNota: { formato: "dap" } }).success,
    true,
  );
  assert.equal(
    psicologiaToolDataV3Schema.safeParse({ v: 3, procesoNota: { campos: { datos: "x" } } }).success,
    true,
  );
  // {v:3} pelado y procesoNota vacío también válidos (todo opcional).
  assert.equal(psicologiaToolDataV3Schema.safeParse({ v: 3 }).success, true);
  assert.equal(psicologiaToolDataV3Schema.safeParse({ v: 3, procesoNota: {} }).success, true);
});

test("v3 schema: procesoNota inválido rechaza (formato malo, clave de sección ajena, v mala)", () => {
  // v1/v2 no parsean contra el schema v3 (literal).
  assert.equal(psicologiaToolDataV3Schema.safeParse({ v: 1 }).success, false);
  assert.equal(psicologiaToolDataV3Schema.safeParse({ v: 2 }).success, false);
  // Formato fuera de catálogo.
  assert.equal(
    psicologiaToolDataV3Schema.safeParse({ v: 3, procesoNota: { formato: "xxx" } }).success,
    false,
  );
  // .strict(): clave de sección DESCONOCIDA en campos RECHAZA (no se stripea).
  assert.equal(
    psicologiaToolDataV3Schema.safeParse({ v: 3, procesoNota: { campos: { inventada: "z" } } }).success,
    false,
  );
  // .strict(): clave desconocida en procesoNota RECHAZA.
  assert.equal(
    psicologiaToolDataV3Schema.safeParse({ v: 3, procesoNota: { xxx: 1 } }).success,
    false,
  );
  // .strict(): clave ajena a nivel raíz RECHAZA (garantía cross-tool).
  assert.equal(psicologiaToolDataV3Schema.safeParse({ v: 3, vertebras: [] }).success, false);
  // Valor de sección no-string rechaza.
  assert.equal(
    psicologiaToolDataV3Schema.safeParse({ v: 3, procesoNota: { campos: { subjetivo: 123 } } }).success,
    false,
  );
});

test("v3 schema: campos acepta claves válidas de cualquier formato (unión de secciones)", () => {
  // La unión de claves incluye subjetivo/objetivo/analisis/plan (SOAP),
  // datos (DAP) y conducta/intervencion/respuesta (BIRP).
  const claves = ["subjetivo", "objetivo", "analisis", "plan", "datos", "conducta", "intervencion", "respuesta"];
  for (const k of claves) {
    assert.equal(
      psicologiaToolDataV3Schema.safeParse({ v: 3, procesoNota: { campos: { [k]: "texto" } } }).success,
      true,
      `clave de sección ${k} debería ser válida`,
    );
  }
});

test("NOTA_FORMATO_SECCIONES: cada formato define secciones con clave/label/guia no vacíos", () => {
  for (const formato of ["soap", "dap", "birp"] as const) {
    const secciones = NOTA_FORMATO_SECCIONES[formato];
    assert.ok(secciones.length >= 3, `${formato} tiene al menos 3 secciones`);
    for (const s of secciones) {
      assert.ok(s.key.length > 0, `${formato}.${s.key}: clave no vacía`);
      assert.ok(s.label.trim().length > 0, `${formato}: label no vacío`);
      assert.ok(s.guia.trim().length > 0, `${formato}.${s.key}: guía no vacía`);
    }
  }
});

// ─── MSE completo (dominios agregados por C8) ─────────────────────────────────

test("MSE completo: los dominios nuevos parsean en registro (aditivo sobre v1/v2/v3)", () => {
  const registro = {
    animo: "deprimido",
    orientacion: "orientado",
    atencion: "conservada",
    memoria: "hipomnesia_reciente",
    sensopercepcion: "alucinaciones_auditivas",
    contenidoPensamiento: "delirios",
    juicio: "debilitado",
    insight: "parcial",
    lenguaje: "verborragico",
    psicomotricidad: "agitacion",
  };
  // Aditivo: v1/v2/v3 comparten registro → los tres deberían parsear.
  assert.equal(psicologiaToolDataSchema.safeParse({ v: 1, registro }).success, true);
  assert.equal(psicologiaToolDataV2Schema.safeParse({ v: 2, registro }).success, true);
  assert.equal(psicologiaToolDataV3Schema.safeParse({ v: 3, registro }).success, true);
});

test("MSE completo: enum fuera de catálogo en un dominio nuevo rechaza", () => {
  assert.equal(
    psicologiaToolDataV3Schema.safeParse({ v: 3, registro: { insight: "total" } }).success,
    false,
  );
  assert.equal(
    psicologiaToolDataV3Schema.safeParse({ v: 3, registro: { orientacion: "perfecta" } }).success,
    false,
  );
});

test("extractRegistro: extrae dominios nuevos laxo y descarta valores fuera de enum", () => {
  assert.deepEqual(
    extractRegistro({
      animo: "ansioso",
      orientacion: "desorientado_tiempo",
      juicio: "conservado",
      insight: "inventado", // fuera de enum → descartado
      memoria: 42, // no-string → descartado
    }),
    { animo: "ansioso", orientacion: "desorientado_tiempo", juicio: "conservado" },
  );
  // Solo dominios nuevos, sin los originales, sigue devolviendo el registro.
  assert.deepEqual(extractRegistro({ sensopercepcion: "ilusiones" }), {
    sensopercepcion: "ilusiones",
  });
});

// ─── extractProcesoNota ──────────────────────────────────────────────────────

test("extractProcesoNota: bloque válido se extrae; v1/v2 y ajenos → null", () => {
  const nota = extractProcesoNota({
    v: 3,
    procesoNota: { formato: "birp", campos: { conducta: "colaborador", plan: "seguir" } },
  });
  assert.ok(nota);
  assert.equal(nota?.formato, "birp");
  assert.equal(nota?.campos?.conducta, "colaborador");
  // v1/v2 (sin procesoNota) y ajenos → null (el historial nunca rompe).
  assert.equal(extractProcesoNota({ v: 1 }), null);
  assert.equal(extractProcesoNota({ v: 2, crisisPlan: { planTexto: "x" } }), null);
  assert.equal(extractProcesoNota(null), null);
  // procesoNota con shape inválido → null.
  assert.equal(extractProcesoNota({ v: 3, procesoNota: { formato: "zzz" } }), null);
  assert.equal(extractProcesoNota({ v: 3, procesoNota: { campos: { inventada: "x" } } }), null);
});

// ─── parsePsicologiaToolData (discriminador v3/v2/v1/vacío) ──────────────────

test("parsePsicologiaToolData: discrimina v3, v2, v1 y vacío", () => {
  assert.equal(parsePsicologiaToolData({ v: 3, procesoNota: { formato: "soap" } }).kind, "v3");
  assert.equal(parsePsicologiaToolData({ v: 3 }).kind, "v3");
  assert.equal(parsePsicologiaToolData({ v: 2, crisisPlan: { planTexto: "x" } }).kind, "v2");
  assert.equal(parsePsicologiaToolData({ v: 2 }).kind, "v2");
  assert.equal(parsePsicologiaToolData({ v: 1 }).kind, "v1");
  assert.equal(parsePsicologiaToolData(null).kind, "empty");
  assert.equal(parsePsicologiaToolData({ v: 1, vertebras: [] }).kind, "empty");
});

// ─── Dashboard: familiaInstrumento + deriveOutcomeSeries ─────────────────────

test("familiaInstrumento: recorta la versión del id", () => {
  assert.equal(familiaInstrumento("phq9.v1"), "phq9");
  assert.equal(familiaInstrumento("dass21.v1"), "dass21");
  assert.equal(familiaInstrumento("pcl5.v2"), "pcl5");
  assert.equal(familiaInstrumento("sinversion"), "sinversion");
});

test("OUTCOME_METRICAS: cubre las cuatro escalas de salud mental del dashboard", () => {
  const keys = OUTCOME_METRICAS.map((m) => m.key).sort();
  assert.deepEqual(keys, ["dass21", "gad7", "pcl5", "phq9"]);
  // Cada métrica trae label y color (token folio.css).
  for (const m of OUTCOME_METRICAS) {
    assert.ok(m.label.length > 0);
    assert.ok(m.color.startsWith("var(--"), `${m.key}: color como token folio.css`);
  }
});

test("deriveOutcomeSeries: agrupa por fecha, ubica cada familia, ASC por fecha", () => {
  const filas: OutcomeRespuesta[] = [
    { instrumentoId: "phq9.v1", scoreTotal: 15, createdAt: "2026-04-01T10:00:00Z" },
    { instrumentoId: "gad7.v1", scoreTotal: 12, createdAt: "2026-04-01T10:05:00Z" },
    { instrumentoId: "dass21.v1", scoreTotal: 40, createdAt: "2026-05-01T09:00:00Z" },
    { instrumentoId: "pcl5.v1", scoreTotal: 33, createdAt: "2026-06-01T09:00:00Z" },
  ];
  assert.deepEqual(deriveOutcomeSeries(filas), [
    { fecha: "2026-04-01", valores: { phq9: 15, gad7: 12, dass21: null, pcl5: null } },
    { fecha: "2026-05-01", valores: { phq9: null, gad7: null, dass21: 40, pcl5: null } },
    { fecha: "2026-06-01", valores: { phq9: null, gad7: null, dass21: null, pcl5: 33 } },
  ]);
});

test("deriveOutcomeSeries: dentro de una fecha el ÚLTIMO score de cada familia gana", () => {
  const filas: OutcomeRespuesta[] = [
    { instrumentoId: "phq9.v1", scoreTotal: 20, createdAt: "2026-04-01T08:00:00Z" },
    { instrumentoId: "phq9.v1", scoreTotal: 10, createdAt: "2026-04-01T18:00:00Z" }, // más tarde
  ];
  assert.deepEqual(deriveOutcomeSeries(filas), [
    { fecha: "2026-04-01", valores: { phq9: 10, gad7: null, dass21: null, pcl5: null } },
  ]);
});

test("deriveOutcomeSeries: descarta scores null, familias ajenas y fechas mal formadas", () => {
  const filas: OutcomeRespuesta[] = [
    { instrumentoId: "phq9.v1", scoreTotal: null, createdAt: "2026-04-01T08:00:00Z" }, // borrador incompleto
    { instrumentoId: "cssrs.v1", scoreTotal: 3, createdAt: "2026-04-01T08:00:00Z" }, // familia de riesgo, no del dashboard
    { instrumentoId: "gad7.v1", scoreTotal: 8, createdAt: "fecha-mala" }, // fecha inválida
    { instrumentoId: "gad7.v1", scoreTotal: 8, createdAt: "2026-04-02T08:00:00Z" }, // válida
  ];
  assert.deepEqual(deriveOutcomeSeries(filas), [
    { fecha: "2026-04-02", valores: { phq9: null, gad7: 8, dass21: null, pcl5: null } },
  ]);
  assert.deepEqual(deriveOutcomeSeries([]), []);
});

// ─── Dashboard: deriveEstadoObjetivos ─────────────────────────────────────────

test("deriveEstadoObjetivos: toma la última sesión con objetivos y cuenta por estado", () => {
  const historial: ToolHistorialEntry[] = [
    // DESC (más reciente primero). La más reciente CON objetivos manda.
    {
      fecha: "2026-06-10",
      toolData: {
        v: 3,
        objetivos: [
          { texto: "A", estado: "logrado" },
          { texto: "B", estado: "en_curso" },
          { texto: "C", estado: "en_curso" },
          { texto: "D", estado: "pausado" },
        ],
      },
    },
    {
      fecha: "2026-05-10",
      toolData: { v: 1, objetivos: [{ texto: "viejo", estado: "logrado" }] },
    },
  ];
  assert.deepEqual(deriveEstadoObjetivos(historial), {
    fecha: "2026-06-10",
    enCurso: 2,
    logrados: 1,
    pausados: 1,
    total: 4,
  });
});

test("deriveEstadoObjetivos: salta sesiones sin objetivos; null si ninguna tiene", () => {
  const historial: ToolHistorialEntry[] = [
    { fecha: "2026-06-10", toolData: { v: 3, phq9: [0, 0, 0, 0, 0, 0, 0, 0, 0] } }, // sin objetivos
    { fecha: "2026-05-10", toolData: { v: 1, objetivos: [{ texto: "X", estado: "pausado" }] } },
  ];
  assert.deepEqual(deriveEstadoObjetivos(historial), {
    fecha: "2026-05-10",
    enCurso: 0,
    logrados: 0,
    pausados: 1,
    total: 1,
  });
  assert.equal(deriveEstadoObjetivos([]), null);
  assert.equal(
    deriveEstadoObjetivos([{ fecha: "2026-06-10", toolData: { v: 3 } }]),
    null,
  );
});
