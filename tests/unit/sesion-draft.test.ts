/**
 * Folio · tests · transformación borrador de ficha → UpsertSesionInput
 * (lib/especialidades/draft.ts — Fase D1, persistencia del slot clínico).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildUpsertSesionInput } from "../../lib/especialidades/draft";
import { ESPECIALIDADES_META } from "../../lib/especialidades/meta";

const BASE = {
  turnoId: "11111111-1111-4111-8111-111111111111",
  pacienteId: "22222222-2222-4222-8222-222222222222",
};

const SOAP_VACIO = { subjetivo: "", objetivo: "", analisis: "", plan: "" };

test("soap: mapea subjetivo/objetivo/analisis/plan → s/o/a/p con trim", () => {
  const input = buildUpsertSesionInput({
    ...BASE,
    especialidad: "quiropraxia",
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

test("toolValue null/undefined → sin toolId ni toolData", () => {
  // El caller debe re-hidratar el borrador con el toolData ya guardado
  // (turnoActivo.toolDraft) — el writer sobreescribe columnas en el upsert.
  const conNull = buildUpsertSesionInput({
    ...BASE,
    especialidad: "cardiologia",
    toolValue: null,
    soap: SOAP_VACIO,
  });
  assert.ok(!("toolId" in conNull));
  assert.ok(!("toolData" in conNull));

  const conUndefined = buildUpsertSesionInput({
    ...BASE,
    especialidad: "psicologia",
    toolValue: undefined,
    soap: SOAP_VACIO,
  });
  assert.ok(!("toolId" in conUndefined));
  assert.ok(!("toolData" in conUndefined));
});

test("quiropraxia: toolId del registry y toolData opaco (el espejo vertebras_json es del writer)", () => {
  const toolData = { v: 1, vertebras: [{ id: "L4", estado: "severo" }] };
  const input = buildUpsertSesionInput({
    ...BASE,
    especialidad: "quiropraxia",
    toolValue: toolData,
    soap: SOAP_VACIO,
  });
  assert.equal(input.toolId, ESPECIALIDADES_META.quiropraxia.toolId);
  assert.deepEqual(input.toolData, toolData);
  // El borrador NO arma `vertebras` legacy: el writer espeja desde toolData.
  assert.ok(!("vertebras" in input));
});

test("especialidades no-quiro: toolData puro con el toolId de la especialidad de la org", () => {
  const cardio = { v: 1, ta: { sistolica: 120, diastolica: 80 } };
  const inputCardio = buildUpsertSesionInput({
    ...BASE,
    especialidad: "cardiologia",
    toolValue: cardio,
    soap: SOAP_VACIO,
  });
  assert.equal(inputCardio.toolId, ESPECIALIDADES_META.cardiologia.toolId);
  assert.deepEqual(inputCardio.toolData, cardio);

  const psico = { v: 1, phq9: { items: [0, 1, 0, 0, 0, 0, 0, 0, 0] } };
  const inputPsico = buildUpsertSesionInput({
    ...BASE,
    especialidad: "psicologia",
    toolValue: psico,
    soap: SOAP_VACIO,
  });
  assert.equal(inputPsico.toolId, ESPECIALIDADES_META.psicologia.toolId);
  assert.deepEqual(inputPsico.toolData, psico);
});

test("slug desconocido o null → fallback quiropraxia (mismo criterio que el registry)", () => {
  const toolData = { v: 1, vertebras: [] };
  assert.equal(
    buildUpsertSesionInput({ ...BASE, especialidad: "odontologia", toolValue: toolData, soap: SOAP_VACIO }).toolId,
    ESPECIALIDADES_META.quiropraxia.toolId,
  );
  assert.equal(
    buildUpsertSesionInput({ ...BASE, especialidad: null, toolValue: toolData, soap: SOAP_VACIO }).toolId,
    ESPECIALIDADES_META.quiropraxia.toolId,
  );
});
