/**
 * Folio · tests · herramienta de psicología (Fase D).
 *
 * Cubre lib/especialidades/psicologia/schema.ts:
 *   - schema zod versionado (parse válido / parcial / inválido)
 *   - scorePhq9 / scoreGad7 (todos los cortes de banda + inputs inválidos)
 *   - deriveScoreSeries (orden ASC, sesiones sin escalas, shapes ajenos)
 *   - extractObjetivos / extractRespuestasEscala / extractRegistro (laxos)
 *   - resumenSesionPsicologia (variantes escalas / registro / riesgo / vacío)
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveScoreSeries,
  extractObjetivos,
  extractRegistro,
  extractRespuestasEscala,
  GAD7_ITEMS,
  GAD7_LEN,
  PHQ9_ITEMS,
  PHQ9_LEN,
  psicologiaToolDataSchema,
  resumenSesionPsicologia,
  scoreGad7,
  scorePhq9,
} from "../../lib/especialidades/psicologia/schema";

/** Escala completa de longitud `len` que suma exactamente `total` (ítems 0–3). */
function escala(total: number, len: number): number[] {
  const out = Array<number>(len).fill(0);
  let resto = total;
  for (let i = 0; i < len; i++) {
    const v = Math.min(3, resto);
    out[i] = v;
    resto -= v;
  }
  if (resto > 0) throw new Error(`total ${total} no entra en ${len} ítems`);
  return out;
}

// ─── Schema ─────────────────────────────────────────────────────────────────

test("schema: payload completo válido", () => {
  const data = {
    v: 1,
    phq9: escala(12, PHQ9_LEN),
    gad7: escala(8, GAD7_LEN),
    registro: {
      apariencia: "cuidada",
      animo: "deprimido",
      afecto: "congruente",
      pensamiento: "lineal",
      riesgo: "sin_riesgo",
    },
    objetivos: [
      { texto: "Reducir evitación social", estado: "en_curso" },
      { texto: "Retomar actividad física", estado: "logrado" },
    ],
  };
  assert.equal(psicologiaToolDataSchema.safeParse(data).success, true);
});

test("schema: opcional-friendly — solo una escala, solo registro, solo objetivos, vacío", () => {
  assert.equal(
    psicologiaToolDataSchema.safeParse({ v: 1, phq9: escala(5, PHQ9_LEN) }).success,
    true,
  );
  assert.equal(
    psicologiaToolDataSchema.safeParse({ v: 1, gad7: escala(15, GAD7_LEN) }).success,
    true,
  );
  assert.equal(
    psicologiaToolDataSchema.safeParse({ v: 1, registro: { animo: "ansioso" } }).success,
    true,
  );
  assert.equal(
    psicologiaToolDataSchema.safeParse({
      v: 1,
      objetivos: [{ texto: "Higiene del sueño", estado: "pausado" }],
    }).success,
    true,
  );
  // {v:1} pelado es válido para el schema; el Tool igual emite null si no hay
  // contenido (limpiarDraft) para no cifrar payloads vacíos.
  assert.equal(psicologiaToolDataSchema.safeParse({ v: 1 }).success, true);
});

test("schema: inválidos — sin v, v incorrecta, escalas mal formadas, enums malos", () => {
  assert.equal(psicologiaToolDataSchema.safeParse({}).success, false);
  assert.equal(psicologiaToolDataSchema.safeParse(null).success, false);
  assert.equal(psicologiaToolDataSchema.safeParse({ v: 2 }).success, false);
  // Longitud incorrecta (las escalas persisten SOLO completas).
  assert.equal(
    psicologiaToolDataSchema.safeParse({ v: 1, phq9: Array(8).fill(0) }).success,
    false,
  );
  assert.equal(
    psicologiaToolDataSchema.safeParse({ v: 1, gad7: Array(9).fill(0) }).success,
    false,
  );
  // Ítem fuera de rango, no entero o null (parcial).
  assert.equal(
    psicologiaToolDataSchema.safeParse({ v: 1, phq9: [0, 1, 2, 3, 4, 0, 0, 0, 0] }).success,
    false,
  );
  assert.equal(
    psicologiaToolDataSchema.safeParse({ v: 1, phq9: [0, 1, 2, 3, -1, 0, 0, 0, 0] }).success,
    false,
  );
  assert.equal(
    psicologiaToolDataSchema.safeParse({ v: 1, gad7: [0, 1, 1.5, 0, 0, 0, 0] }).success,
    false,
  );
  assert.equal(
    psicologiaToolDataSchema.safeParse({ v: 1, phq9: [null, 1, 2, 3, 0, 0, 0, 0, 0] }).success,
    false,
  );
  // Enums fuera de catálogo.
  assert.equal(
    psicologiaToolDataSchema.safeParse({ v: 1, registro: { riesgo: "alto" } }).success,
    false,
  );
  assert.equal(
    psicologiaToolDataSchema.safeParse({ v: 1, registro: { animo: "feliz" } }).success,
    false,
  );
  assert.equal(
    psicologiaToolDataSchema.safeParse({
      v: 1,
      objetivos: [{ texto: "x", estado: "terminado" }],
    }).success,
    false,
  );
  // Objetivo sin texto.
  assert.equal(
    psicologiaToolDataSchema.safeParse({
      v: 1,
      objetivos: [{ texto: "", estado: "en_curso" }],
    }).success,
    false,
  );
});

test("schema: los catálogos de ítems tienen la longitud del instrumento", () => {
  assert.equal(PHQ9_ITEMS.length, PHQ9_LEN);
  assert.equal(GAD7_ITEMS.length, GAD7_LEN);
});

// ─── scorePhq9 ──────────────────────────────────────────────────────────────

test("scorePhq9: todos los cortes de banda (0-4, 5-9, 10-14, 15-19, 20-27)", () => {
  assert.deepEqual(scorePhq9(escala(0, PHQ9_LEN))?.banda, "minima");
  assert.deepEqual(scorePhq9(escala(4, PHQ9_LEN))?.banda, "minima");
  assert.deepEqual(scorePhq9(escala(5, PHQ9_LEN))?.banda, "leve");
  assert.deepEqual(scorePhq9(escala(9, PHQ9_LEN))?.banda, "leve");
  assert.deepEqual(scorePhq9(escala(10, PHQ9_LEN))?.banda, "moderada");
  assert.deepEqual(scorePhq9(escala(14, PHQ9_LEN))?.banda, "moderada");
  assert.deepEqual(scorePhq9(escala(15, PHQ9_LEN))?.banda, "moderadamente_severa");
  assert.deepEqual(scorePhq9(escala(19, PHQ9_LEN))?.banda, "moderadamente_severa");
  assert.deepEqual(scorePhq9(escala(20, PHQ9_LEN))?.banda, "severa");
  assert.deepEqual(scorePhq9(escala(27, PHQ9_LEN))?.banda, "severa");
});

test("scorePhq9: total correcto + etiqueta es-AR", () => {
  const r = scorePhq9([1, 2, 0, 3, 1, 1, 2, 1, 1]);
  assert.deepEqual(r, { total: 12, banda: "moderada", etiqueta: "moderada" });
  assert.equal(scorePhq9(escala(17, PHQ9_LEN))?.etiqueta, "moderadamente severa");
});

test("scorePhq9: inválidos → null (parciales, longitud, rango, tipos)", () => {
  assert.equal(scorePhq9(undefined), null);
  assert.equal(scorePhq9(null), null);
  assert.equal(scorePhq9("alto"), null);
  assert.equal(scorePhq9([]), null);
  assert.equal(scorePhq9(Array(8).fill(0)), null);          // corta
  assert.equal(scorePhq9(Array(10).fill(0)), null);         // larga
  assert.equal(scorePhq9([0, 1, 2, 3, null, 0, 0, 0, 0]), null); // parcial
  assert.equal(scorePhq9([0, 1, 2, 3, 4, 0, 0, 0, 0]), null);    // fuera de rango
  assert.equal(scorePhq9([0, 1, 2, 3, 0.5, 0, 0, 0, 0]), null);  // no entero
});

// ─── scoreGad7 ──────────────────────────────────────────────────────────────

test("scoreGad7: todos los cortes de banda (0-4, 5-9, 10-14, 15-21)", () => {
  assert.deepEqual(scoreGad7(escala(0, GAD7_LEN))?.banda, "minima");
  assert.deepEqual(scoreGad7(escala(4, GAD7_LEN))?.banda, "minima");
  assert.deepEqual(scoreGad7(escala(5, GAD7_LEN))?.banda, "leve");
  assert.deepEqual(scoreGad7(escala(9, GAD7_LEN))?.banda, "leve");
  assert.deepEqual(scoreGad7(escala(10, GAD7_LEN))?.banda, "moderada");
  assert.deepEqual(scoreGad7(escala(14, GAD7_LEN))?.banda, "moderada");
  assert.deepEqual(scoreGad7(escala(15, GAD7_LEN))?.banda, "severa");
  assert.deepEqual(scoreGad7(escala(21, GAD7_LEN))?.banda, "severa");
});

test("scoreGad7: total + inválidos → null", () => {
  assert.deepEqual(scoreGad7([1, 1, 1, 0, 2, 2, 1]), {
    total: 8,
    banda: "leve",
    etiqueta: "leve",
  });
  assert.equal(scoreGad7(Array(9).fill(0)), null); // longitud de PHQ-9, no GAD-7
  assert.equal(scoreGad7([1, 1, 1, 0, 2, 2, null]), null);
  assert.equal(scoreGad7(null), null);
});

// ─── deriveScoreSeries ──────────────────────────────────────────────────────

test("deriveScoreSeries: historial DESC → serie ASC, sesiones sin escalas se omiten", () => {
  const historial = [
    { fecha: "2026-06-08", toolData: { v: 1, phq9: escala(8, PHQ9_LEN), gad7: escala(6, GAD7_LEN) } },
    { fecha: "2026-05-20", toolData: { v: 1, registro: { animo: "ansioso" } } }, // sin escalas
    { fecha: "2026-05-04", toolData: { v: 1, gad7: escala(12, GAD7_LEN) } },
    { fecha: "2026-04-18", toolData: { v: 1, phq9: escala(15, PHQ9_LEN) } },
  ];
  assert.deepEqual(deriveScoreSeries(historial), [
    { fecha: "2026-04-18", phq9: 15, gad7: null },
    { fecha: "2026-05-04", phq9: null, gad7: 12 },
    { fecha: "2026-06-08", phq9: 8, gad7: 6 },
  ]);
});

test("deriveScoreSeries: tolera shapes ajenos/legacy y escalas inválidas", () => {
  const historial = [
    { fecha: "2026-06-01", toolData: { v: 1, phq9: escala(21, PHQ9_LEN) } },
    { fecha: "2026-05-01", toolData: { v: 1, vertebras: [{ id: "C4", estado: "ajustada" }] } }, // quiro legacy
    { fecha: "2026-04-01", toolData: null },
    { fecha: "2026-03-01", toolData: { v: 1, phq9: [0, 1, 2] } },              // incompleta
    { fecha: "2026-02-01", toolData: { v: 1, gad7: "no soy un array" } },      // shape malo
  ];
  assert.deepEqual(deriveScoreSeries(historial), [
    { fecha: "2026-06-01", phq9: 21, gad7: null },
  ]);
  assert.deepEqual(deriveScoreSeries([]), []);
});

// ─── Extracciones laxas ─────────────────────────────────────────────────────

test("extractObjetivos: items inválidos se descartan sin romper", () => {
  const toolData = {
    v: 1,
    objetivos: [
      { texto: "Registrar pensamientos automáticos", estado: "en_curso" },
      { texto: "", estado: "en_curso" },          // texto vacío
      { texto: "x", estado: "inventado" },        // estado malo
      "basura",
      null,
    ],
  };
  const objetivos = extractObjetivos(toolData);
  assert.equal(objetivos.length, 1);
  assert.equal(objetivos[0].texto, "Registrar pensamientos automáticos");
  assert.deepEqual(extractObjetivos(null), []);
  assert.deepEqual(extractObjetivos({ v: 1 }), []);
});

test("extractRespuestasEscala: parciales con null, vacías → null", () => {
  // Respuestas parciales del borrador: posiciones inválidas → null.
  assert.deepEqual(
    extractRespuestasEscala([2, null, "x", 5, 1.5, 3, undefined], GAD7_LEN),
    [2, null, null, null, null, 3, null],
  );
  // Recorta/rellena a la longitud del instrumento.
  assert.deepEqual(extractRespuestasEscala([1, 2], 3), [1, 2, null]);
  assert.deepEqual(extractRespuestasEscala([1, 2, 3, 0], 3), [1, 2, 3]);
  // Sin ninguna respuesta válida → null (escala sin cargar).
  assert.equal(extractRespuestasEscala([null, null, null], 3), null);
  assert.equal(extractRespuestasEscala("x", 3), null);
  assert.equal(extractRespuestasEscala(undefined, 3), null);
});

test("extractRegistro: campo a campo, descarta valores fuera de enum", () => {
  assert.deepEqual(
    extractRegistro({ animo: "deprimido", afecto: "brillante", riesgo: "ideacion", extra: 1 }),
    { animo: "deprimido", riesgo: "ideacion" },
  );
  assert.equal(extractRegistro({ animo: "feliz" }), null);
  assert.equal(extractRegistro(null), null);
  assert.equal(extractRegistro("x"), null);
});

// ─── resumenSesionPsicologia ────────────────────────────────────────────────

test("resumenSesion: ambas escalas → 'PHQ-9 12 (moderada) · GAD-7 8 (leve)'", () => {
  assert.equal(
    resumenSesionPsicologia({
      v: 1,
      phq9: escala(12, PHQ9_LEN),
      gad7: escala(8, GAD7_LEN),
    }),
    "PHQ-9 12 (moderada) · GAD-7 8 (leve)",
  );
});

test("resumenSesion: variantes de una sola escala y bandas extremas", () => {
  assert.equal(resumenSesionPsicologia({ v: 1, phq9: escala(3, PHQ9_LEN) }), "PHQ-9 3 (mínima)");
  assert.equal(
    resumenSesionPsicologia({ v: 1, phq9: escala(17, PHQ9_LEN) }),
    "PHQ-9 17 (moderadamente severa)",
  );
  assert.equal(resumenSesionPsicologia({ v: 1, gad7: escala(18, GAD7_LEN) }), "GAD-7 18 (severa)");
});

test("resumenSesion: riesgo registrado se destaca", () => {
  assert.equal(
    resumenSesionPsicologia({
      v: 1,
      phq9: escala(21, PHQ9_LEN),
      registro: { riesgo: "plan" },
    }),
    "PHQ-9 21 (severa) · riesgo: plan",
  );
  assert.equal(
    resumenSesionPsicologia({ v: 1, registro: { animo: "deprimido", riesgo: "ideacion" } }),
    "Registro de sesión · riesgo: ideación",
  );
  // sin_riesgo NO genera segmento extra.
  assert.equal(
    resumenSesionPsicologia({ v: 1, registro: { riesgo: "sin_riesgo" } }),
    "Registro de sesión",
  );
});

test("resumenSesion: solo registro u objetivos → 'Registro de sesión'", () => {
  assert.equal(
    resumenSesionPsicologia({ v: 1, registro: { animo: "ansioso" } }),
    "Registro de sesión",
  );
  assert.equal(
    resumenSesionPsicologia({
      v: 1,
      objetivos: [{ texto: "Higiene del sueño", estado: "en_curso" }],
    }),
    "Registro de sesión",
  );
});

test("resumenSesion: vacío o shape desconocido → 'Sesión registrada'", () => {
  assert.equal(resumenSesionPsicologia({ v: 1 }), "Sesión registrada");
  assert.equal(resumenSesionPsicologia(null), "Sesión registrada");
  assert.equal(resumenSesionPsicologia(undefined), "Sesión registrada");
  assert.equal(resumenSesionPsicologia({ cualquier: "cosa" }), "Sesión registrada");
  // Escala incompleta no pasa el schema → degrada sin romper.
  assert.equal(resumenSesionPsicologia({ v: 1, phq9: [0, 1, 2] }), "Sesión registrada");
  // Shape quiro en una org que migró de especialidad: degrada sin romper.
  assert.equal(
    resumenSesionPsicologia({ v: 1, vertebras: [{ id: "C4", estado: "ajustada" }] }),
    "Sesión registrada",
  );
});
