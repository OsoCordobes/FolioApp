import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveSpineState,
  extractVertebras,
  migrateV1ToV2,
  mirrorVertebrasV2,
  normalizeEstadoVertebra,
  parseQuiropraxiaToolData,
  quiropraxiaToolDataSchema,
  quiropraxiaToolDataV2Schema,
  resumenSesionQuiropraxia,
} from "../../lib/especialidades/quiropraxia/schema";
import type { ToolHistorialEntry } from "../../lib/especialidades/types";

function quiro(fecha: string, vertebras: Array<{ id: string; estado: string }>): ToolHistorialEntry {
  return { fecha, toolData: { v: 1, vertebras } };
}

test("deriveSpineState: la sesión MÁS RECIENTE que menciona una vértebra gana", () => {
  // Historial DESC (más reciente primero), igual que el reader.
  const historial: ToolHistorialEntry[] = [
    quiro("2026-06-09", [{ id: "C4", estado: "ajustada" }]),
    quiro("2026-06-02", [{ id: "C4", estado: "severo" }, { id: "L5", estado: "leve" }]),
  ];
  const { vertebrasEstado, ultimoAjuste } = deriveSpineState(historial);
  assert.equal(vertebrasEstado.C4, "ajustada");      // primera ocurrencia (más reciente)
  assert.equal(vertebrasEstado.L5, "leve");
  assert.equal(ultimoAjuste.C4, "2026-06-09");
  assert.equal(ultimoAjuste.L5, "2026-06-02");
});

test("deriveSpineState: fallback legacy (vertebras_json mapeada a { v: 1, vertebras })", () => {
  // El reader mapea filas pre-M50 a este shape — la derivación debe ser
  // idéntica a la lógica histórica de paciente-ficha.ts.
  const historial: ToolHistorialEntry[] = [
    { fecha: "2026-05-20", toolData: { v: 1, vertebras: [{ id: "T7", estado: "moderado" }] } },
  ];
  const { vertebrasEstado, ultimoAjuste } = deriveSpineState(historial);
  assert.deepEqual(vertebrasEstado, { T7: "moderado" });
  assert.deepEqual(ultimoAjuste, { T7: "2026-05-20" });
});

test("deriveSpineState: estado desconocido normaliza a 'normal' (data legacy)", () => {
  const historial: ToolHistorialEntry[] = [
    quiro("2026-06-01", [{ id: "C1", estado: "AJUSTADA " }, { id: "C2", estado: "rarísimo" }]),
  ];
  const { vertebrasEstado } = deriveSpineState(historial);
  // "AJUSTADA " no matchea el lowercase exacto → normal; "rarísimo" → normal.
  assert.equal(vertebrasEstado.C1, "normal");
  assert.equal(vertebrasEstado.C2, "normal");
});

test("deriveSpineState: toolData de otra especialidad / corrupto se ignora", () => {
  const historial: ToolHistorialEntry[] = [
    { fecha: "2026-06-09", toolData: { presionArterial: "120/80" } },     // cardiología futura
    { fecha: "2026-06-08", toolData: null },                              // sesión sin tool
    { fecha: "2026-06-07", toolData: "garbage" },                         // corrupto
    quiro("2026-06-01", [{ id: "L4", estado: "severo" }]),
  ];
  const { vertebrasEstado, ultimoAjuste } = deriveSpineState(historial);
  assert.deepEqual(vertebrasEstado, { L4: "severo" });
  assert.deepEqual(ultimoAjuste, { L4: "2026-06-01" });
});

test("deriveSpineState: historial vacío → mapas vacíos", () => {
  const { vertebrasEstado, ultimoAjuste } = deriveSpineState([]);
  assert.deepEqual(vertebrasEstado, {});
  assert.deepEqual(ultimoAjuste, {});
});

test("extractVertebras: filtra items sin id string y tolera shapes raros", () => {
  const out = extractVertebras({
    v: 1,
    vertebras: [{ id: "C3", estado: "leve" }, { id: 42 }, "x", null, { estado: "severo" }],
  });
  assert.deepEqual(out, [{ id: "C3", estado: "leve" }]);
  assert.deepEqual(extractVertebras(null), []);
  assert.deepEqual(extractVertebras({ vertebras: "nope" }), []);
});

test("normalizeEstadoVertebra: valores válidos pasan, el resto cae a normal", () => {
  assert.equal(normalizeEstadoVertebra("ajustada"), "ajustada");
  assert.equal(normalizeEstadoVertebra("LEVE"), "leve");
  assert.equal(normalizeEstadoVertebra(undefined), "normal");
  assert.equal(normalizeEstadoVertebra("otro"), "normal");
});

test("quiropraxiaToolDataSchema (v1 legacy): valida shape versionado y rechaza estados inválidos", () => {
  assert.equal(
    quiropraxiaToolDataSchema.safeParse({ v: 1, vertebras: [{ id: "C4", estado: "ajustada" }] }).success,
    true,
  );
  assert.equal(
    quiropraxiaToolDataSchema.safeParse({ v: 2, vertebras: [] }).success,
    false,
  );
  assert.equal(
    quiropraxiaToolDataSchema.safeParse({ v: 1, vertebras: [{ id: "C4", estado: "roto" }] }).success,
    false,
  );
});

// ─── v2 (Workstream 6) ───────────────────────────────────────────────────────

test("extractVertebras: un toolData v2 NO aporta al mapa acumulado legacy (gate v===2)", () => {
  // Las vértebras v2 no tienen `estado`: si se leyeran, normalizarían a
  // "normal" (no "ajustada"), pero igual se cortan en la raíz → [].
  const out = extractVertebras({
    v: 2,
    vista: "posterior",
    vertebras: [{ id: "C4", tecnicaAjuste: "drop" }, { id: "L5", listado: "PLI" }],
  });
  assert.deepEqual(out, []);
});

test("deriveSpineState: una sesión v2 no pinta el mapa lateral legacy", () => {
  const historial: ToolHistorialEntry[] = [
    {
      fecha: "2026-06-10",
      toolData: { v: 2, vista: "posterior", vertebras: [{ id: "C4", tecnicaAjuste: "drop" }] },
    },
    quiro("2026-06-01", [{ id: "L4", estado: "severo" }]),
  ];
  const { vertebrasEstado } = deriveSpineState(historial);
  // Solo la sesión v1 contribuye; la v2 se ignora (sin estados inventados).
  assert.deepEqual(vertebrasEstado, { L4: "severo" });
});

test("quiropraxiaToolDataV2Schema: acepta el shape v2 y aplica default vista", () => {
  const parsed = quiropraxiaToolDataV2Schema.safeParse({ v: 2 });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.vista, "posterior");

  const completo = quiropraxiaToolDataV2Schema.safeParse({
    v: 2,
    vista: "lateral",
    vertebras: [{ id: "C4", tecnicaAjuste: "drop", listado: "PLI" }],
    postura: { strokes: [[{ x: 1, y: 2 }, { x: 3, y: 4 }]], nota: "hombro alto" },
    palpacionEstatica: "x",
    palpacionDinamica: "y",
    legCheck: { modo: "supino", supinoNota: "pierna corta der" },
    tecnicaAjuste: "diversificada",
    termografia: "asimetría C4",
    notasLibres: "ok",
  });
  assert.equal(completo.success, true);
});

test("quiropraxiaToolDataV2Schema: rechaza claves desconocidas top-level (.strict) y v != 2", () => {
  assert.equal(quiropraxiaToolDataV2Schema.safeParse({ v: 1, vertebras: [] }).success, false);
  // Clave desconocida a nivel raíz → rechaza (.strict, defensa cross-tool).
  assert.equal(quiropraxiaToolDataV2Schema.safeParse({ v: 2, foo: "bar" }).success, false);
  // un trazo de un solo punto no es un trazo (min 2).
  assert.equal(
    quiropraxiaToolDataV2Schema.safeParse({ v: 2, postura: { strokes: [[{ x: 1, y: 1 }]] } }).success,
    false,
  );
  // El `estado` de v1 en un item de vértebras NO está en el shape v2: el objeto
  // anidado no es .strict, así que esa clave se STRIPEA (no rechaza) y queda un
  // v2 válido con solo {id} — la migración esperada de una vértebra v1.
  const conEstado = quiropraxiaToolDataV2Schema.safeParse({
    v: 2,
    vertebras: [{ id: "C4", estado: "ajustada" }],
  });
  assert.equal(conEstado.success, true);
  if (conEstado.success) assert.deepEqual(conEstado.data.vertebras, [{ id: "C4" }]);
});

test("migrateV1ToV2: mapea {id, estado} → {id} (estado se descarta), vista posterior", () => {
  const v2 = migrateV1ToV2({
    v: 1,
    vertebras: [{ id: "C4", estado: "ajustada" }, { id: "L5", estado: "severo" }],
  });
  assert.equal(v2.v, 2);
  assert.equal(v2.vista, "posterior");
  assert.deepEqual(v2.vertebras, [{ id: "C4" }, { id: "L5" }]);
  // El resultado debe ser un v2 válido.
  assert.equal(quiropraxiaToolDataV2Schema.safeParse(v2).success, true);
});

test("migrateV1ToV2: input vacío / no-v1 → v2 vacío válido (sin campo vertebras)", () => {
  const vacio = migrateV1ToV2(null);
  assert.deepEqual(vacio, { v: 2, vista: "posterior" });
  assert.equal(quiropraxiaToolDataV2Schema.safeParse(vacio).success, true);

  const v1Vacio = migrateV1ToV2({ v: 1, vertebras: [] });
  assert.deepEqual(v1Vacio, { v: 2, vista: "posterior" });
});

test("mirrorVertebrasV2: solo vértebras con contenido → estado 'ajustada'", () => {
  const data = quiropraxiaToolDataV2Schema.parse({
    v: 2,
    vertebras: [
      { id: "C4", tecnicaAjuste: "drop" },          // contenido → espeja
      { id: "L5", listado: "PLI" },                 // contenido → espeja
      { id: "T7" },                                 // sin contenido → NO
      { id: "T8", tecnicaAjuste: "   " },            // solo espacios → NO
    ],
  });
  assert.deepEqual(mirrorVertebrasV2(data), [
    { id: "C4", estado: "ajustada" },
    { id: "L5", estado: "ajustada" },
  ]);
  // SIEMPRE un array (columna NOT NULL DEFAULT []).
  assert.deepEqual(mirrorVertebrasV2({ v: 2, vista: "posterior" }), []);
});

test("parseQuiropraxiaToolData: discrimina v2 → v1 → empty", () => {
  assert.equal(parseQuiropraxiaToolData({ v: 2, vista: "posterior" }).kind, "v2");
  assert.equal(parseQuiropraxiaToolData({ v: 1, vertebras: [{ id: "C4", estado: "ajustada" }] }).kind, "v1");
  assert.equal(parseQuiropraxiaToolData(null).kind, "empty");
  assert.equal(parseQuiropraxiaToolData({ presionArterial: "120/80" }).kind, "empty");
});

test("resumenSesionQuiropraxia: v1 conserva el formato; v2 cuenta vértebras con notas", () => {
  // v1 (pinneado).
  assert.equal(
    resumenSesionQuiropraxia({ v: 1, vertebras: [{ id: "C4", estado: "ajustada" }, { id: "L5", estado: "ajustada" }] }),
    "C4, L5 ajustadas",
  );
  assert.equal(resumenSesionQuiropraxia({ v: 1, vertebras: [] }), "Sin notas vertebrales");
  // v2.
  assert.equal(
    resumenSesionQuiropraxia({
      v: 2,
      vista: "posterior",
      vertebras: [{ id: "C4", tecnicaAjuste: "drop" }, { id: "L5", listado: "PLI" }],
    }),
    "2 vértebras con notas",
  );
  assert.equal(
    resumenSesionQuiropraxia({ v: 2, vista: "posterior", vertebras: [{ id: "C4", listado: "PLI" }] }),
    "1 vértebra con notas",
  );
  assert.equal(resumenSesionQuiropraxia(null), "Sin notas vertebrales");
});
