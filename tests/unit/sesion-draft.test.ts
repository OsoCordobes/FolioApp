/**
 * Folio · tests · transformación borrador de ficha → UpsertSesionInput
 * (lib/especialidades/draft.ts — Fase D1, persistencia del slot clínico).
 *
 * M55: el borrador ya NO deriva ni transporta toolId — el toolValue viaja
 * como toolData OPACO y el WRITER (upsertSesion) deriva la herramienta de la
 * especialidad efectiva del PROFESIONAL del turno (member.especialidad ??
 * organization.especialidad). Acá se fija ese contrato: ningún campo de
 * especialidad entra ni sale de buildUpsertSesionInput.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildUpsertSesionInput } from "../../lib/especialidades/draft";

const BASE = {
  turnoId: "11111111-1111-4111-8111-111111111111",
  pacienteId: "22222222-2222-4222-8222-222222222222",
};

const SOAP_VACIO = { subjetivo: "", objetivo: "", analisis: "", plan: "" };

test("soap: mapea subjetivo/objetivo/analisis/plan → s/o/a/p con trim", () => {
  const input = buildUpsertSesionInput({
    ...BASE,
    toolValue: null,
    soap: {
      subjetivo: "  Dolor lumbar EVA 6/10 ",
      objetivo: "ROM limitado en flexión",
      analisis: "",
      plan: "   ",
    },
  });
  assert.equal(input.turnoId, BASE.turnoId);
  assert.equal(input.pacienteId, BASE.pacienteId);
  assert.deepEqual(input.soap, {
    s: "Dolor lumbar EVA 6/10",
    o: "ROM limitado en flexión",
    a: undefined,
    p: undefined,
  });
});

test("toolValue null/undefined → sin toolData (y nunca un toolId)", () => {
  // El caller debe re-hidratar el borrador con el toolData ya guardado
  // (turnoActivo.toolDraft) — el writer sobreescribe columnas en el upsert.
  const conNull = buildUpsertSesionInput({ ...BASE, toolValue: null, soap: SOAP_VACIO });
  assert.ok(!("toolData" in conNull));
  assert.ok(!("toolId" in conNull));

  const conUndefined = buildUpsertSesionInput({ ...BASE, toolValue: undefined, soap: SOAP_VACIO });
  assert.ok(!("toolData" in conUndefined));
  assert.ok(!("toolId" in conUndefined));
});

test("toolValue != null → toolData OPACO, sin toolId ni vertebras legacy (M55)", () => {
  const quiro = { v: 1, vertebras: [{ id: "L4", estado: "severo" }] };
  const inputQuiro = buildUpsertSesionInput({ ...BASE, toolValue: quiro, soap: SOAP_VACIO });
  assert.deepEqual(inputQuiro.toolData, quiro);
  // M55: la derivación del toolId es exclusiva del writer (profesional del
  // turno) — el borrador no opina sobre la especialidad.
  assert.ok(!("toolId" in inputQuiro));
  // El borrador tampoco arma `vertebras` legacy: el writer espeja desde toolData.
  assert.ok(!("vertebras" in inputQuiro));

  const cardio = { v: 1, ta: { sistolica: 120, diastolica: 80 } };
  const inputCardio = buildUpsertSesionInput({ ...BASE, toolValue: cardio, soap: SOAP_VACIO });
  assert.deepEqual(inputCardio.toolData, cardio);
  assert.ok(!("toolId" in inputCardio));

  const psico = { v: 1, phq9: { items: [0, 1, 0, 0, 0, 0, 0, 0, 0] } };
  const inputPsico = buildUpsertSesionInput({ ...BASE, toolValue: psico, soap: SOAP_VACIO });
  assert.deepEqual(inputPsico.toolData, psico);
  assert.ok(!("toolId" in inputPsico));
});

// ─── B4 · versión de la sesión (control de concurrencia optimista) ───────────
//
// Sin esto el guardado era last-write-wins ciego: el profesional escribe en la
// tablet durante la consulta y después, desde la PC con la ficha abierta desde
// antes, agrega una palabra — y el autosave pisaba el hallazgo de la tablet
// mostrando "Guardado ✓".

test("B4 · el borrador transporta updatedAtEsperado cuando lo conoce", () => {
  const input = buildUpsertSesionInput({
    turnoId: "11111111-1111-4111-8111-111111111111",
    pacienteId: "22222222-2222-4222-8222-222222222222",
    toolValue: null,
    soap: { subjetivo: "dolor lumbar", objetivo: "", analisis: "", plan: "" },
    updatedAtEsperado: "2026-08-11T12:00:00.000Z",
  });
  assert.equal(input.updatedAtEsperado, "2026-08-11T12:00:00.000Z");
});

test("B4 · sin versión conocida el campo NO viaja (sesión nueva / caller legacy)", () => {
  // Importa que sea ausente y no undefined explícito: el writer sólo agrega el
  // `.eq("updated_at", …)` cuando el caller dijo contra qué versión escribe;
  // una sesión que todavía no existe no tiene versión contra la cual comparar.
  const input = buildUpsertSesionInput({
    turnoId: "11111111-1111-4111-8111-111111111111",
    pacienteId: "22222222-2222-4222-8222-222222222222",
    toolValue: null,
    soap: { subjetivo: "dolor lumbar", objetivo: "", analisis: "", plan: "" },
  });
  assert.equal("updatedAtEsperado" in input, false);
});

test("B4 · la versión no se cuela en el payload clínico", () => {
  // Es metadato de concurrencia, no contenido: no puede terminar cifrado en
  // una columna de la historia clínica.
  const input = buildUpsertSesionInput({
    turnoId: "11111111-1111-4111-8111-111111111111",
    pacienteId: "22222222-2222-4222-8222-222222222222",
    toolValue: { v: 2, vista: "posterior" },
    soap: { subjetivo: "s", objetivo: "o", analisis: "a", plan: "p" },
    updatedAtEsperado: "2026-08-11T12:00:00.000Z",
  });
  assert.deepEqual(input.soap, { s: "s", o: "o", a: "a", p: "p" });
  assert.deepEqual(input.toolData, { v: 2, vista: "posterior" });
});
