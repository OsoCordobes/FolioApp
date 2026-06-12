/**
 * Folio · tests · preservación de tool data en guardados solo-SOAP
 * (lib/db/sesiones.ts → sesionTieneToolData + debePreservarToolData — F-PHI,
 * review PR #56).
 *
 * Escenario que motiva la regla: la sesión del turno en curso tiene tool_id de
 * OTRA especialidad que la efectiva actual (member.especialidad cambiada /
 * turno reasignado entre medio). La ficha da toolDraft = null (no re-hidrata
 * un draft cross-tool) y un guardado solo-SOAP llega al writer SIN toolData.
 * Sin la regla, el UPDATE nulleaba tool_id/tool_data_cifrado y vaciaba
 * vertebras_json — pérdida silenciosa de PHI con badge "guardado".
 *
 * Semántica (espejo del criterio de re-hidratación de paciente-ficha.ts):
 *   - fila RE-HIDRATABLE (tool_data_cifrado != null + tool_id de la
 *     especialidad efectiva) → la UI mostró los datos; un toolValue null es un
 *     vaciado deliberado (los Tools cardio/psico emiten null al quedar vacíos)
 *     → NO preservar.
 *   - fila NO re-hidratable con datos (tool_id ajeno / desconocido / legacy
 *     quiro solo-vertebras_json) → la UI nunca los mostró → PRESERVAR.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { debePreservarToolData, sesionTieneToolData } from "../../lib/db/sesiones";

const CIFRADO = "\\x6f70616375"; // ciphertext opaco — solo importa la nulidad

// ─── sesionTieneToolData ─────────────────────────────────────────────────────

test("sesionTieneToolData: detecta tool_data_cifrado, tool_id o vertebras_json con filas", () => {
  assert.equal(
    sesionTieneToolData({ tool_id: null, tool_data_cifrado: null, vertebras_json: [] }),
    false,
  );
  assert.equal(
    sesionTieneToolData({ tool_id: null, tool_data_cifrado: null, vertebras_json: null }),
    false,
  );
  assert.equal(
    sesionTieneToolData({ tool_id: "cardiologia.cv.v1", tool_data_cifrado: CIFRADO, vertebras_json: [] }),
    true,
  );
  // tool_id sin payload (estado raro pero posible) también cuenta como dato.
  assert.equal(
    sesionTieneToolData({ tool_id: "cardiologia.cv.v1", tool_data_cifrado: null, vertebras_json: [] }),
    true,
  );
  // Fila legacy quiro pre-M50: solo el espejo vertebras_json.
  assert.equal(
    sesionTieneToolData({
      tool_id: null,
      tool_data_cifrado: null,
      vertebras_json: [{ id: "C4", estado: "ajustada" }],
    }),
    true,
  );
});

// ─── debePreservarToolData: el escenario del hallazgo ────────────────────────

test("cross-tool: sesión cardio + especialidad efectiva psico → PRESERVAR (no se pisa PHI)", () => {
  const existente = {
    tool_id: "cardiologia.cv.v1",
    tool_data_cifrado: CIFRADO,
    vertebras_json: [],
  };
  assert.equal(debePreservarToolData(existente, "psicologia"), true);
  assert.equal(debePreservarToolData(existente, "quiropraxia"), true);
  // Con la efectiva correcta NO se preserva: el draft se re-hidrató y un null
  // es un vaciado deliberado.
  assert.equal(debePreservarToolData(existente, "cardiologia"), false);
});

test("cross-tool: las tres especialidades preservan los datos de las otras dos", () => {
  const filas = [
    { toolId: "quiropraxia.spine.v1", propia: "quiropraxia" as const },
    { toolId: "cardiologia.cv.v1", propia: "cardiologia" as const },
    { toolId: "psicologia.escalas.v1", propia: "psicologia" as const },
  ];
  for (const fila of filas) {
    const existente = { tool_id: fila.toolId, tool_data_cifrado: CIFRADO, vertebras_json: [] };
    for (const efectiva of ["quiropraxia", "cardiologia", "psicologia"] as const) {
      assert.equal(
        debePreservarToolData(existente, efectiva),
        efectiva !== fila.propia,
        `tool_id ${fila.toolId} con efectiva ${efectiva}`,
      );
    }
  }
});

test("tool_id desconocido para el registry → PRESERVAR siempre (no se mezcla con la tool activa)", () => {
  const existente = {
    tool_id: "odontologia.dientes.v1",
    tool_data_cifrado: CIFRADO,
    vertebras_json: [],
  };
  for (const efectiva of ["quiropraxia", "cardiologia", "psicologia"] as const) {
    assert.equal(debePreservarToolData(existente, efectiva), true, efectiva);
  }
});

// ─── Bordes: legacy, vaciado, fila sin datos ─────────────────────────────────

test("fila legacy quiro (tool_id NULL, solo vertebras_json) → PRESERVAR: la ficha no la re-hidrata", () => {
  // toolDraft exige tool_data_cifrado != null, así que la UI nunca mostró este
  // espejo como borrador — un solo-SOAP no debe vaciarlo. (El Tool quiro
  // además nunca emite null: un vaciado deliberado viaja como
  // { v: 1, vertebras: [] }, con toolData NO null.)
  const legacy = {
    tool_id: null,
    tool_data_cifrado: null,
    vertebras_json: [{ id: "L5", estado: "severo" }],
  };
  assert.equal(debePreservarToolData(legacy, "quiropraxia"), true);
  assert.equal(debePreservarToolData(legacy, "cardiologia"), true);
});

test("sin datos de herramienta (o sin fila existente) → NO preservar: nada que pisar", () => {
  assert.equal(debePreservarToolData(null, "cardiologia"), false);
  assert.equal(
    debePreservarToolData(
      { tool_id: null, tool_data_cifrado: null, vertebras_json: [] },
      "psicologia",
    ),
    false,
  );
});

test("vaciado deliberado: fila re-hidratable de la MISMA especialidad → NO preservar (se honra el null)", () => {
  assert.equal(
    debePreservarToolData(
      { tool_id: "psicologia.escalas.v1", tool_data_cifrado: CIFRADO, vertebras_json: [] },
      "psicologia",
    ),
    false,
  );
});
