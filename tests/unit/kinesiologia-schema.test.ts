/**
 * Folio · tests · herramienta de kinesiología/fisioterapia (Fase 2 · N1).
 *
 * Cubre lib/especialidades/kinesiologia/schema.ts:
 *   - schema zod versionado (parse válido / parcial / inválido / .strict)
 *   - instrumentos embebidos completos vs parciales (NDI/ODI/Borg)
 *   - scoring delegado a lib/instrumentos (no duplica cutoffs)
 *   - deriveKinesioSeries (orden ASC, sesiones sin métrica, shapes ajenos)
 *   - extractRom / extractTests / extractObjetivosKine (items inválidos descartados)
 *   - resumenSesionKinesiologia (variantes dolor / instrumentos / conteos / vacío)
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveKinesioSeries,
  extractDolorEva,
  extractObjetivosKine,
  extractRespuestaBorg,
  extractRespuestasInstrumento,
  extractRom,
  extractTests,
  kinesiologiaToolDataSchema,
  NDI_LEN,
  ODI_LEN,
  parseKinesiologiaToolData,
  resumenSesionKinesiologia,
  scoreBorgKine,
  scoreNdiKine,
  scoreOdiKine,
} from "../../lib/especialidades/kinesiologia/schema";

// Respuestas completas de referencia.
const NDI_FULL = Array.from({ length: NDI_LEN }, () => 2); // total 20
const ODI_FULL = Array.from({ length: ODI_LEN }, () => 5); // 100 %

// ─── Schema ─────────────────────────────────────────────────────────────────

test("schema: payload completo válido", () => {
  const data = {
    v: 1,
    motivo: "Lumbalgia mecánica.",
    dolorEva: 6,
    rom: [{ region: "columna_dorsolumbar", grados: 60, nota: "Dolor al final del rango." }],
    tests: [{ nombre: "Lasègue", resultado: "positivo", nota: "45°" }],
    objetivos: [{ texto: "Recuperar flexión lumbar", estado: "en_curso" }],
    ndi: NDI_FULL,
    odi: ODI_FULL,
    borg: 13,
  };
  assert.equal(kinesiologiaToolDataSchema.safeParse(data).success, true);
});

test("schema: opcional-friendly — solo motivo, solo dolor, solo ROM, vacío", () => {
  assert.equal(kinesiologiaToolDataSchema.safeParse({ v: 1, motivo: "x" }).success, true);
  assert.equal(kinesiologiaToolDataSchema.safeParse({ v: 1, dolorEva: 0 }).success, true);
  assert.equal(
    kinesiologiaToolDataSchema.safeParse({ v: 1, rom: [{ region: "rodilla", grados: 120 }] }).success,
    true,
  );
  assert.equal(kinesiologiaToolDataSchema.safeParse({ v: 1 }).success, true);
});

test("schema: .strict rechaza claves ajenas y literal v equivocado", () => {
  assert.equal(kinesiologiaToolDataSchema.safeParse({ v: 1, foo: 1 }).success, false);
  assert.equal(kinesiologiaToolDataSchema.safeParse({ v: 2 }).success, false);
  assert.equal(kinesiologiaToolDataSchema.safeParse({}).success, false);
  assert.equal(kinesiologiaToolDataSchema.safeParse(null).success, false);
});

test("schema: instrumentos embebidos sólo válidos completos y en rango", () => {
  // NDI/ODI incompletos rechazan (longitud exacta).
  assert.equal(kinesiologiaToolDataSchema.safeParse({ v: 1, ndi: [1, 2, 3] }).success, false);
  assert.equal(kinesiologiaToolDataSchema.safeParse({ v: 1, odi: ODI_FULL.slice(1) }).success, false);
  // Valor fuera de rango en un ítem NDI rechaza (0–5).
  const ndiMal = [...NDI_FULL];
  ndiMal[0] = 6;
  assert.equal(kinesiologiaToolDataSchema.safeParse({ v: 1, ndi: ndiMal }).success, false);
  // Borg fuera de 6–20 rechaza.
  assert.equal(kinesiologiaToolDataSchema.safeParse({ v: 1, borg: 5 }).success, false);
  assert.equal(kinesiologiaToolDataSchema.safeParse({ v: 1, borg: 21 }).success, false);
  // Dolor EVA fuera de 0–10 rechaza.
  assert.equal(kinesiologiaToolDataSchema.safeParse({ v: 1, dolorEva: 11 }).success, false);
  assert.equal(kinesiologiaToolDataSchema.safeParse({ v: 1, dolorEva: -1 }).success, false);
});

test("schema: ROM grados fuera de 0–360 y resultado de test fuera de enum rechazan", () => {
  assert.equal(
    kinesiologiaToolDataSchema.safeParse({ v: 1, rom: [{ region: "codo", grados: 400 }] }).success,
    false,
  );
  assert.equal(
    kinesiologiaToolDataSchema.safeParse({ v: 1, rom: [{ region: "inventada", grados: 90 }] }).success,
    false,
  );
  assert.equal(
    kinesiologiaToolDataSchema.safeParse({ v: 1, tests: [{ nombre: "X", resultado: "tal_vez" }] }).success,
    false,
  );
});

test("parseKinesiologiaToolData: v1 vs empty", () => {
  assert.equal(parseKinesiologiaToolData({ v: 1, dolorEva: 3 }).kind, "v1");
  assert.equal(parseKinesiologiaToolData({ cualquier: "cosa" }).kind, "empty");
  assert.equal(parseKinesiologiaToolData(null).kind, "empty");
});

// ─── Scoring delegado (no duplica cutoffs) ───────────────────────────────────

test("scoreNdiKine / scoreOdiKine / scoreBorgKine: delegan en la biblioteca", () => {
  // NDI: 10 × 2 = 20 crudo.
  assert.equal(scoreNdiKine(NDI_FULL), 20);
  // ODI: 10 × 5 = 50 → 100 %.
  assert.equal(scoreOdiKine(ODI_FULL), 100);
  // Borg: valor directo.
  assert.equal(scoreBorgKine(13), 13);
  // Incompletos / inválidos → null (contrato laxo).
  assert.equal(scoreNdiKine([1, 2, 3]), null);
  assert.equal(scoreOdiKine(null), null);
  assert.equal(scoreBorgKine(3), null);
  assert.equal(scoreBorgKine(undefined), null);
});

// ─── Extracciones laxas ──────────────────────────────────────────────────────

test("extractDolorEva: entero 0–10 o null", () => {
  assert.equal(extractDolorEva({ dolorEva: 7 }), 7);
  assert.equal(extractDolorEva({ dolorEva: 0 }), 0);
  assert.equal(extractDolorEva({ dolorEva: 11 }), null);
  assert.equal(extractDolorEva({ dolorEva: "5" }), null);
  assert.equal(extractDolorEva(null), null);
});

test("extractRom / extractTests / extractObjetivosKine: descartan items inválidos", () => {
  const rom = extractRom({
    rom: [
      { region: "cadera", grados: 90 },
      { region: "mala", grados: 90 }, // región inválida → descartada
      { region: "tobillo", grados: 500 }, // grados fuera de rango → descartado
    ],
  });
  assert.equal(rom.length, 1);
  assert.equal(rom[0].region, "cadera");

  const tests = extractTests({
    tests: [
      { nombre: "Neer", resultado: "positivo" },
      { nombre: "", resultado: "negativo" }, // nombre vacío → descartado
      { nombre: "X", resultado: "quizas" }, // resultado inválido → descartado
    ],
  });
  assert.equal(tests.length, 1);
  assert.equal(tests[0].nombre, "Neer");

  const objetivos = extractObjetivosKine({
    objetivos: [
      { texto: "Meta 1", estado: "logrado" },
      { texto: "Meta 2", estado: "inventado" }, // estado inválido → descartado
    ],
  });
  assert.equal(objetivos.length, 1);
});

test("extractRespuestasInstrumento / extractRespuestaBorg: parciales toleradas para el borrador", () => {
  const parcial = extractRespuestasInstrumento([1, null, 2], NDI_LEN);
  assert.ok(parcial);
  assert.equal(parcial?.length, NDI_LEN);
  assert.equal(parcial?.[0], 1);
  assert.equal(parcial?.[1], null);
  // Sin ninguna respuesta válida → null.
  assert.equal(extractRespuestasInstrumento([], NDI_LEN), null);
  assert.equal(extractRespuestasInstrumento("no-array", NDI_LEN), null);
  // Borg: acepta n o [n].
  assert.equal(extractRespuestaBorg(13), 13);
  assert.equal(extractRespuestaBorg([13]), 13);
  assert.equal(extractRespuestaBorg(3), null);
});

// ─── Serie de evolución ──────────────────────────────────────────────────────

test("deriveKinesioSeries: DESC→ASC, omite sesiones sin métrica, tolera shapes ajenos", () => {
  const historial = [
    // más reciente primero (DESC, contrato del slot)
    { fecha: "2026-03-01", toolData: { v: 1, dolorEva: 3, ndi: NDI_FULL } },
    { fecha: "2026-02-01", toolData: { v: 1, motivo: "sin métrica" } }, // omitida
    { fecha: "2026-01-01", toolData: { v: 1, dolorEva: 8, odi: ODI_FULL, borg: 15 } },
    { fecha: "2025-12-01", toolData: { otra: "herramienta" } }, // omitida
  ];
  const serie = deriveKinesioSeries(historial);
  assert.equal(serie.length, 2);
  // ASC (la más vieja primero).
  assert.equal(serie[0].fecha, "2026-01-01");
  assert.equal(serie[1].fecha, "2026-03-01");
  assert.equal(serie[0].eva, 8);
  assert.equal(serie[0].odi, 100);
  assert.equal(serie[0].borg, 15);
  assert.equal(serie[1].eva, 3);
  assert.equal(serie[1].ndi, 20);
});

// ─── Resumen por sesión ──────────────────────────────────────────────────────

test("resumenSesionKinesiologia: variantes", () => {
  assert.equal(resumenSesionKinesiologia(null), "Sesión registrada");
  assert.equal(resumenSesionKinesiologia({ cualquier: "cosa" }), "Sesión registrada");
  assert.equal(resumenSesionKinesiologia({ v: 1 }), "Sesión registrada");
  assert.equal(resumenSesionKinesiologia({ v: 1, motivo: "Cervicalgia" }), "Motivo registrado");
  assert.equal(
    resumenSesionKinesiologia({ v: 1, dolorEva: 6, ndi: NDI_FULL }),
    "EVA 6/10 · NDI 20",
  );
  assert.equal(
    resumenSesionKinesiologia({
      v: 1,
      odi: ODI_FULL,
      borg: 13,
      tests: [{ nombre: "Neer", resultado: "positivo" }],
      objetivos: [{ texto: "Meta", estado: "en_curso" }],
    }),
    "ODI 100 % · Borg 13 · 1 test · 1 objetivo",
  );
});
