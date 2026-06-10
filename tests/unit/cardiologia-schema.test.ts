/**
 * Folio · tests · herramienta de cardiología (Fase D).
 *
 * Cubre lib/especialidades/cardiologia/schema.ts:
 *   - schema zod versionado (parse válido / parcial / inválido)
 *   - scoreRiesgoCV (bordes del conteo + edad, orientativo)
 *   - deriveCardioSeries (orden ASC, sesiones sin panel, shapes ajenos)
 *   - extractEstudios (items inválidos descartados)
 *   - resumenSesionCardiologia (variantes panel / estudios / vacío)
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  cardiologiaToolDataSchema,
  deriveCardioSeries,
  extractEstudios,
  resumenSesionCardiologia,
  scoreRiesgoCV,
} from "../../lib/especialidades/cardiologia/schema";

// ─── Schema ─────────────────────────────────────────────────────────────────

test("schema: payload completo válido", () => {
  const data = {
    v: 1,
    panel: {
      taSistolica: 130,
      taDiastolica: 85,
      fc: 72,
      factores: { tabaquismo: true, diabetes: false, sedentarismo: true },
    },
    estudios: [
      {
        tipo: "Ergometría",
        fecha: "2026-06-01",
        hallazgos: "Prueba suficiente, sin cambios isquémicos.",
        conclusion: "requiere_seguimiento",
      },
    ],
  };
  const parsed = cardiologiaToolDataSchema.safeParse(data);
  assert.equal(parsed.success, true);
});

test("schema: opcional-friendly — solo TA, solo factores, solo estudios, vacío", () => {
  assert.equal(
    cardiologiaToolDataSchema.safeParse({ v: 1, panel: { taSistolica: 120, taDiastolica: 80 } }).success,
    true,
  );
  assert.equal(
    cardiologiaToolDataSchema.safeParse({ v: 1, panel: { factores: { hta: true } } }).success,
    true,
  );
  assert.equal(
    cardiologiaToolDataSchema.safeParse({
      v: 1,
      estudios: [{ tipo: "ECG", fecha: "2026-05-10", hallazgos: "", conclusion: "normal" }],
    }).success,
    true,
  );
  // {v:1} pelado es válido para el schema; el Tool igual emite null si no hay
  // contenido (limpiarDraft) para no cifrar payloads vacíos.
  assert.equal(cardiologiaToolDataSchema.safeParse({ v: 1 }).success, true);
});

test("schema: inválidos — sin v, v incorrecta, vitales fuera de rango, enums malos", () => {
  assert.equal(cardiologiaToolDataSchema.safeParse({}).success, false);
  assert.equal(cardiologiaToolDataSchema.safeParse(null).success, false);
  assert.equal(cardiologiaToolDataSchema.safeParse({ v: 2 }).success, false);
  // TA sistólica fuera de rango (50–300) o no entera.
  assert.equal(
    cardiologiaToolDataSchema.safeParse({ v: 1, panel: { taSistolica: 12 } }).success,
    false,
  );
  assert.equal(
    cardiologiaToolDataSchema.safeParse({ v: 1, panel: { taSistolica: 400 } }).success,
    false,
  );
  assert.equal(
    cardiologiaToolDataSchema.safeParse({ v: 1, panel: { fc: 72.5 } }).success,
    false,
  );
  // Tipo de estudio fuera del enum / fecha mal formateada / conclusión mala.
  assert.equal(
    cardiologiaToolDataSchema.safeParse({
      v: 1,
      estudios: [{ tipo: "Resonancia", fecha: "2026-05-10", hallazgos: "", conclusion: "normal" }],
    }).success,
    false,
  );
  assert.equal(
    cardiologiaToolDataSchema.safeParse({
      v: 1,
      estudios: [{ tipo: "ECG", fecha: "10/05/2026", hallazgos: "", conclusion: "normal" }],
    }).success,
    false,
  );
  assert.equal(
    cardiologiaToolDataSchema.safeParse({
      v: 1,
      estudios: [{ tipo: "ECG", fecha: "2026-05-10", hallazgos: "", conclusion: "dudoso" }],
    }).success,
    false,
  );
});

// ─── scoreRiesgoCV ──────────────────────────────────────────────────────────

test("scoreRiesgoCV: bordes del conteo (0-1 bajo, 2-3 moderado, >=4 alto)", () => {
  assert.equal(scoreRiesgoCV(undefined).nivel, "bajo");
  assert.equal(scoreRiesgoCV(null).nivel, "bajo");
  assert.equal(scoreRiesgoCV({}).nivel, "bajo");
  assert.equal(scoreRiesgoCV({ tabaquismo: true }).nivel, "bajo");
  assert.equal(scoreRiesgoCV({ tabaquismo: true, diabetes: true }).nivel, "moderado");
  assert.equal(
    scoreRiesgoCV({ tabaquismo: true, diabetes: true, hta: true }).nivel,
    "moderado",
  );
  assert.equal(
    scoreRiesgoCV({ tabaquismo: true, diabetes: true, hta: true, dislipemia: true }).nivel,
    "alto",
  );
  assert.equal(
    scoreRiesgoCV({
      tabaquismo: true,
      diabetes: true,
      hta: true,
      dislipemia: true,
      antecedentesFamiliares: true,
      sedentarismo: true,
    }).nivel,
    "alto",
  );
  // false NO cuenta como factor presente.
  assert.equal(scoreRiesgoCV({ tabaquismo: false, diabetes: false }).nivel, "bajo");
});

test("scoreRiesgoCV: edad >= 60 suma un factor; etiqueta siempre orientativa", () => {
  // 1 factor + edad 59 → sigue bajo; + edad 60 → cruza a moderado.
  assert.equal(scoreRiesgoCV({ tabaquismo: true }, 59).nivel, "bajo");
  assert.equal(scoreRiesgoCV({ tabaquismo: true }, 60).nivel, "moderado");
  // 3 factores + edad 70 → cruza a alto.
  assert.equal(
    scoreRiesgoCV({ tabaquismo: true, diabetes: true, hta: true }, 70).nivel,
    "alto",
  );
  // Edad sola no clasifica más que bajo (0 factores + edad = conteo 1).
  assert.equal(scoreRiesgoCV({}, 80).nivel, "bajo");
  // Etiqueta es-AR con la marca de orientativo.
  assert.equal(scoreRiesgoCV({ tabaquismo: true, hta: true }).etiqueta, "Riesgo moderado (orientativo)");
  assert.match(scoreRiesgoCV(undefined).etiqueta, /orientativo/);
});

// ─── deriveCardioSeries ─────────────────────────────────────────────────────

test("deriveCardioSeries: historial DESC → serie ASC, sesiones sin panel se omiten", () => {
  const historial = [
    { fecha: "2026-06-08", toolData: { v: 1, panel: { taSistolica: 128, taDiastolica: 82, fc: 70 } } },
    { fecha: "2026-05-20", toolData: { v: 1, estudios: [] } },            // sin panel
    { fecha: "2026-05-04", toolData: { v: 1, panel: { factores: { hta: true } } } }, // panel sin vitales
    { fecha: "2026-04-18", toolData: { v: 1, panel: { taSistolica: 140, taDiastolica: 90 } } },
  ];
  const serie = deriveCardioSeries(historial);
  assert.deepEqual(serie, [
    { fecha: "2026-04-18", taS: 140, taD: 90, fc: null },
    { fecha: "2026-06-08", taS: 128, taD: 82, fc: 70 },
  ]);
});

test("deriveCardioSeries: tolera shapes ajenos/legacy y vitales parciales", () => {
  const historial = [
    { fecha: "2026-06-01", toolData: { v: 1, panel: { fc: 88 } } },
    { fecha: "2026-05-01", toolData: { v: 1, vertebras: [{ id: "C4", estado: "ajustada" }] } }, // quiro legacy
    { fecha: "2026-04-01", toolData: null },
    { fecha: "2026-03-01", toolData: { v: 1, panel: { taSistolica: "alta" } } }, // no numérico
  ];
  const serie = deriveCardioSeries(historial);
  assert.deepEqual(serie, [{ fecha: "2026-06-01", taS: null, taD: null, fc: 88 }]);
  assert.deepEqual(deriveCardioSeries([]), []);
});

// ─── extractEstudios ────────────────────────────────────────────────────────

test("extractEstudios: items inválidos se descartan sin romper", () => {
  const toolData = {
    v: 1,
    estudios: [
      { tipo: "Holter", fecha: "2026-05-30", hallazgos: "RS, sin pausas.", conclusion: "normal" },
      { tipo: "Inventado", fecha: "2026-05-30", hallazgos: "", conclusion: "normal" }, // tipo malo
      "basura",
      null,
    ],
  };
  const estudios = extractEstudios(toolData);
  assert.equal(estudios.length, 1);
  assert.equal(estudios[0].tipo, "Holter");
  assert.deepEqual(extractEstudios(null), []);
  assert.deepEqual(extractEstudios({ v: 1 }), []);
});

// ─── resumenSesionCardiologia ───────────────────────────────────────────────

test("resumenSesion: TA + FC + factores → 'TA 130/85 · FC 72 · riesgo moderado'", () => {
  assert.equal(
    resumenSesionCardiologia({
      v: 1,
      panel: {
        taSistolica: 130,
        taDiastolica: 85,
        fc: 72,
        factores: { tabaquismo: true, sedentarismo: true },
      },
    }),
    "TA 130/85 · FC 72 · riesgo moderado",
  );
});

test("resumenSesion: variantes parciales del panel", () => {
  assert.equal(
    resumenSesionCardiologia({ v: 1, panel: { taSistolica: 130, taDiastolica: 85 } }),
    "TA 130/85",
  );
  assert.equal(resumenSesionCardiologia({ v: 1, panel: { fc: 72 } }), "FC 72");
  assert.equal(resumenSesionCardiologia({ v: 1, panel: { taSistolica: 130 } }), "TA sist. 130");
  assert.equal(resumenSesionCardiologia({ v: 1, panel: { taDiastolica: 85 } }), "TA diast. 85");
  // Factores todos false → sin segmento de riesgo.
  assert.equal(
    resumenSesionCardiologia({ v: 1, panel: { fc: 60, factores: { tabaquismo: false } } }),
    "FC 60",
  );
});

test("resumenSesion: estudios — uno con conclusión, varios con conteo", () => {
  assert.equal(
    resumenSesionCardiologia({
      v: 1,
      estudios: [
        { tipo: "Ergometría", fecha: "2026-06-01", hallazgos: "x", conclusion: "requiere_seguimiento" },
      ],
    }),
    "Ergometría: requiere seguimiento",
  );
  assert.equal(
    resumenSesionCardiologia({
      v: 1,
      estudios: [
        { tipo: "ECG", fecha: "2026-06-01", hallazgos: "", conclusion: "normal" },
        { tipo: "Holter", fecha: "2026-06-02", hallazgos: "", conclusion: "anormal" },
        { tipo: "Laboratorio", fecha: "2026-06-03", hallazgos: "", conclusion: "normal" },
      ],
    }),
    "3 estudios",
  );
  // Panel + estudio se combinan.
  assert.equal(
    resumenSesionCardiologia({
      v: 1,
      panel: { taSistolica: 118, taDiastolica: 76 },
      estudios: [{ tipo: "ECG", fecha: "2026-06-01", hallazgos: "", conclusion: "normal" }],
    }),
    "TA 118/76 · ECG: normal",
  );
});

test("resumenSesion: vacío o shape desconocido → 'Sesión registrada'", () => {
  assert.equal(resumenSesionCardiologia({ v: 1 }), "Sesión registrada");
  assert.equal(resumenSesionCardiologia(null), "Sesión registrada");
  assert.equal(resumenSesionCardiologia(undefined), "Sesión registrada");
  assert.equal(resumenSesionCardiologia({ cualquier: "cosa" }), "Sesión registrada");
  // Shape quiro en una org que migró de especialidad: degrada sin romper.
  assert.equal(
    resumenSesionCardiologia({ v: 1, vertebras: [{ id: "C4", estado: "ajustada" }] }),
    "Sesión registrada",
  );
});
