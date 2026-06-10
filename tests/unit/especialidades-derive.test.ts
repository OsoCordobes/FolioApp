import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveSpineState,
  extractVertebras,
  normalizeEstadoVertebra,
  quiropraxiaToolDataSchema,
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

test("quiropraxiaToolDataSchema: valida shape versionado y rechaza estados inválidos", () => {
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
