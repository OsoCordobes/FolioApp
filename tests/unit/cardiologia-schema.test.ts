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
  cardiologiaToolDataV2Schema,
  cardiologiaToolDataV3Schema,
  deriveCardioSeries,
  extractDerivacion,
  extractEstudios,
  extractMedicacion,
  parseCardiologiaToolData,
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

// ─── Schema v2 (C5 · panel con vitales extra) ───────────────────────────────

test("schema v2: payload con vitales extra válido; v1 rechaza contra v2 y viceversa", () => {
  const v2 = {
    v: 2,
    panel: {
      taSistolica: 130,
      taDiastolica: 85,
      fc: 72,
      peso: 78,
      talla: 172,
      satO2: 97,
      glucemia: 105,
      factores: { hta: true },
    },
    estudios: [{ tipo: "ECG", fecha: "2026-06-01", hallazgos: "RS.", conclusion: "normal" }],
  };
  assert.equal(cardiologiaToolDataV2Schema.safeParse(v2).success, true);
  // {v:2} pelado es válido (todo el contenido es opcional).
  assert.equal(cardiologiaToolDataV2Schema.safeParse({ v: 2 }).success, true);
  // v1 (literal 1) NO parsea contra v2 y v2 (literal 2) NO parsea contra v1.
  assert.equal(cardiologiaToolDataV2Schema.safeParse({ v: 1 }).success, false);
  assert.equal(cardiologiaToolDataSchema.safeParse({ v: 2 }).success, false);
});

test("schema v2: vitales extra fuera de rango rechazan; .strict() rechaza claves ajenas", () => {
  // peso 20–400, talla 50–250, satO2 50–100, glucemia 20–800.
  assert.equal(
    cardiologiaToolDataV2Schema.safeParse({ v: 2, panel: { satO2: 120 } }).success,
    false,
  );
  assert.equal(
    cardiologiaToolDataV2Schema.safeParse({ v: 2, panel: { peso: 10 } }).success,
    false,
  );
  assert.equal(
    cardiologiaToolDataV2Schema.safeParse({ v: 2, panel: { glucemia: 105.5 } }).success,
    false, // no entero
  );
  assert.equal(
    cardiologiaToolDataV2Schema.safeParse({ v: 2, panel: { peso: 78, talla: 172 } }).success,
    true,
  );
  // .strict(): una clave desconocida (payload ajeno) RECHAZA, no se stripea.
  assert.equal(
    cardiologiaToolDataV2Schema.safeParse({ v: 2, panel: {}, vertebras: [] }).success,
    false,
  );
});

// ─── Schema v3 (C6 · medicación + derivación) ───────────────────────────────

test("schema v3: payload con medicación + derivación válido; v2/v1 rechazan contra v3", () => {
  const v3 = {
    v: 3,
    panel: { taSistolica: 130, taDiastolica: 85, fc: 72, peso: 78, factores: { hta: true } },
    estudios: [{ tipo: "ECG", fecha: "2026-06-01", hallazgos: "RS.", conclusion: "normal" }],
    medicacion: [
      { droga: "Enalapril", dosis: "10 mg", frecuencia: "1 comp/día", estado: "activa", desde: "2026-05-01" },
      { droga: "Atorvastatina", estado: "suspendida" },
    ],
    derivacion: {
      destinatario: "Dr. Pérez",
      especialidad: "Electrofisiología",
      motivo: "Palpitaciones recurrentes con Holter anormal.",
      urgencia: "preferente",
      fecha: "2026-06-05",
    },
  };
  assert.equal(cardiologiaToolDataV3Schema.safeParse(v3).success, true);
  // {v:3} pelado es válido (todo el contenido es opcional).
  assert.equal(cardiologiaToolDataV3Schema.safeParse({ v: 3 }).success, true);
  // v2/v1 (literales 2/1) NO parsean contra v3, y v3 no parsea contra v2/v1.
  assert.equal(cardiologiaToolDataV3Schema.safeParse({ v: 2 }).success, false);
  assert.equal(cardiologiaToolDataV3Schema.safeParse({ v: 1 }).success, false);
  assert.equal(cardiologiaToolDataV2Schema.safeParse({ v: 3 }).success, false);
  assert.equal(cardiologiaToolDataSchema.safeParse({ v: 3 }).success, false);
});

test("schema v3: medicación requiere droga; derivación requiere motivo; .strict() rechaza claves ajenas", () => {
  // Medicamento sin droga → rechaza.
  assert.equal(
    cardiologiaToolDataV3Schema.safeParse({ v: 3, medicacion: [{ estado: "activa" }] }).success,
    false,
  );
  // Estado fuera del enum → rechaza.
  assert.equal(
    cardiologiaToolDataV3Schema.safeParse({ v: 3, medicacion: [{ droga: "X", estado: "pausada" }] }).success,
    false,
  );
  // Derivación sin motivo → rechaza.
  assert.equal(
    cardiologiaToolDataV3Schema.safeParse({ v: 3, derivacion: { urgencia: "programada" } }).success,
    false,
  );
  // Urgencia fuera del enum → rechaza.
  assert.equal(
    cardiologiaToolDataV3Schema.safeParse({ v: 3, derivacion: { motivo: "x", urgencia: "ya" } }).success,
    false,
  );
  // .strict(): una clave desconocida (payload ajeno) RECHAZA, no se stripea.
  assert.equal(
    cardiologiaToolDataV3Schema.safeParse({ v: 3, vertebras: [] }).success,
    false,
  );
});

test("extractMedicacion / extractDerivacion: validan y toleran v1/v2/ajenos", () => {
  const toolData = {
    v: 3,
    medicacion: [
      { droga: "Bisoprolol", dosis: "2.5 mg", estado: "activa" },
      { droga: "", estado: "activa" }, // droga vacía → descartado
      { estado: "activa" }, // sin droga → descartado
      "basura",
      null,
    ],
    derivacion: { motivo: "Control de arritmia.", urgencia: "urgente" },
  };
  const meds = extractMedicacion(toolData);
  assert.equal(meds.length, 1);
  assert.equal(meds[0].droga, "Bisoprolol");
  const deriv = extractDerivacion(toolData);
  assert.equal(deriv?.motivo, "Control de arritmia.");
  assert.equal(deriv?.urgencia, "urgente");
  // v1/v2 (sin esos campos) y ajenos → [] / null, sin romper.
  assert.deepEqual(extractMedicacion({ v: 1, panel: {} }), []);
  assert.deepEqual(extractMedicacion(null), []);
  assert.equal(extractDerivacion({ v: 2 }), null);
  assert.equal(extractDerivacion(null), null);
  // Derivación con motivo inválido (vacío) → null.
  assert.equal(extractDerivacion({ v: 3, derivacion: { motivo: "", urgencia: "programada" } }), null);
});

test("resumenSesion v3: suma fármacos activos y derivación al copy", () => {
  assert.equal(
    resumenSesionCardiologia({
      v: 3,
      panel: { taSistolica: 130, taDiastolica: 85 },
      medicacion: [
        { droga: "Enalapril", estado: "activa" },
        { droga: "Atorvastatina", estado: "activa" },
        { droga: "AAS", estado: "suspendida" }, // suspendida no cuenta
      ],
      derivacion: { motivo: "Interconsulta.", urgencia: "programada" },
    }),
    "TA 130/85 · 2 fármacos · derivación",
  );
  // Un único fármaco activo → singular.
  assert.equal(
    resumenSesionCardiologia({ v: 3, medicacion: [{ droga: "Enalapril", estado: "activa" }] }),
    "1 fármaco",
  );
  // v3 sólo con derivación → copy con derivación.
  assert.equal(
    resumenSesionCardiologia({ v: 3, derivacion: { motivo: "x", urgencia: "urgente" } }),
    "derivación",
  );
  // v3 pelado → genérico.
  assert.equal(resumenSesionCardiologia({ v: 3 }), "Sesión registrada");
});

test("parseCardiologiaToolData: discrimina v3 / v2 / v1 / empty", () => {
  const v3 = parseCardiologiaToolData({
    v: 3,
    panel: { peso: 80 },
    medicacion: [{ droga: "Enalapril", estado: "activa" }],
  });
  assert.equal(v3.kind, "v3");
  if (v3.kind === "v3") {
    assert.equal(v3.data.panel?.peso, 80);
    assert.equal(v3.data.medicacion?.[0].droga, "Enalapril");
  }

  const v2 = parseCardiologiaToolData({ v: 2, panel: { peso: 80 } });
  assert.equal(v2.kind, "v2");
  if (v2.kind === "v2") assert.equal(v2.data.panel?.peso, 80);

  const v1 = parseCardiologiaToolData({ v: 1, panel: { taSistolica: 120, taDiastolica: 80 } });
  assert.equal(v1.kind, "v1");
  if (v1.kind === "v1") assert.equal(v1.data.panel?.taSistolica, 120);

  // Shapes ajenos / vacíos → empty. {v:4} todavía no existe → empty.
  assert.equal(parseCardiologiaToolData(null).kind, "empty");
  assert.equal(parseCardiologiaToolData({ v: 4 }).kind, "empty");
  assert.equal(parseCardiologiaToolData({ vertebras: [] }).kind, "empty");
});

test("resumenSesion v2: lee el panel v2 con el mismo copy que v1", () => {
  assert.equal(
    resumenSesionCardiologia({
      v: 2,
      panel: {
        taSistolica: 130,
        taDiastolica: 85,
        fc: 72,
        peso: 78,
        factores: { tabaquismo: true, sedentarismo: true },
      },
    }),
    "TA 130/85 · FC 72 · riesgo moderado",
  );
  // v2 solo con vitales extra (sin TA/FC/factores/estudios) → copy genérico.
  assert.equal(resumenSesionCardiologia({ v: 2, panel: { peso: 78, talla: 172 } }), "Sesión registrada");
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

test("deriveCardioSeries: lee sesiones v2 y v1 mezcladas (por nombre de campo)", () => {
  const historial = [
    { fecha: "2026-06-08", toolData: { v: 2, panel: { taSistolica: 128, taDiastolica: 82, fc: 70, peso: 80 } } },
    { fecha: "2026-05-04", toolData: { v: 1, panel: { taSistolica: 140, taDiastolica: 90 } } },
  ];
  const serie = deriveCardioSeries(historial);
  assert.deepEqual(serie, [
    { fecha: "2026-05-04", taS: 140, taD: 90, fc: null },
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
