/**
 * Folio · tests · derivación de la especialidad EFECTIVA por profesional
 * (lib/especialidades/meta.ts — M55, CLINICA-5).
 *
 * Regla: especialidad efectiva del slot clínico =
 *   member(turno.profesional_id).especialidad ?? organization.especialidad
 *
 * La usan el writer único de sesiones (lib/db/sesiones.ts deriva el toolId)
 * y el reader de la ficha (lib/db/paciente-ficha.ts → TabPlan). Estos tests
 * fijan también la compat Solo total: member.especialidad NULL reproduce
 * bit a bit el comportamiento org-level pre-M55.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ESPECIALIDADES_META,
  filtrarToolHistorial,
  resolveEspecialidadEfectiva,
  toolPerteneceAEspecialidad,
} from "../../lib/especialidades/meta";
import type { ToolHistorialEntry } from "../../lib/especialidades/types";

// ─── resolveEspecialidadEfectiva ─────────────────────────────────────────────

test("member NULL → hereda la especialidad de la org (compat Solo)", () => {
  assert.equal(resolveEspecialidadEfectiva(null, "cardiologia"), "cardiologia");
  assert.equal(resolveEspecialidadEfectiva(undefined, "psicologia"), "psicologia");
  assert.equal(resolveEspecialidadEfectiva(null, "quiropraxia"), "quiropraxia");
});

test("member con especialidad propia → gana sobre la org (clínica mixta)", () => {
  // La psicóloga de una clínica 'cardiologia' usa SU herramienta.
  assert.equal(resolveEspecialidadEfectiva("psicologia", "cardiologia"), "psicologia");
  assert.equal(resolveEspecialidadEfectiva("cardiologia", "quiropraxia"), "cardiologia");
  // member == org también funciona (redundante pero válido).
  assert.equal(resolveEspecialidadEfectiva("quiropraxia", "quiropraxia"), "quiropraxia");
});

test("turno sin profesional (defensivo) ≡ member NULL → org", () => {
  // El writer pasa null cuando turno.profesional_id es NULL (imposible
  // post-CLINICA-3, pero defensivo): misma rama que member sin especialidad.
  assert.equal(resolveEspecialidadEfectiva(null, "cardiologia"), "cardiologia");
});

test("slug de member desconocido para el registry → degrada a la org, no a quiro directo", () => {
  // CHECK futuro más amplio que este deploy: caer a la org mantiene el
  // comportamiento org-level histórico en vez de cambiar de herramienta.
  assert.equal(resolveEspecialidadEfectiva("odontologia", "psicologia"), "psicologia");
});

test("org NULL/desconocida → normaliza a quiropraxia (mismo criterio del registry)", () => {
  assert.equal(resolveEspecialidadEfectiva(null, null), "quiropraxia");
  assert.equal(resolveEspecialidadEfectiva(null, undefined), "quiropraxia");
  assert.equal(resolveEspecialidadEfectiva("inexistente", "tampoco"), "quiropraxia");
});

// ─── toolPerteneceAEspecialidad ──────────────────────────────────────────────

test("tool_id NULL = fila legacy pre-M50 → solo matchea quiropraxia", () => {
  assert.equal(toolPerteneceAEspecialidad(null, "quiropraxia"), true);
  assert.equal(toolPerteneceAEspecialidad(undefined, "quiropraxia"), true);
  assert.equal(toolPerteneceAEspecialidad(null, "cardiologia"), false);
  assert.equal(toolPerteneceAEspecialidad(null, "psicologia"), false);
});

test("tool_id persistido matchea SOLO su especialidad", () => {
  assert.equal(toolPerteneceAEspecialidad("psicologia.escalas.v1", "psicologia"), true);
  assert.equal(toolPerteneceAEspecialidad("psicologia.escalas.v1", "cardiologia"), false);
  assert.equal(toolPerteneceAEspecialidad("cardiologia.cv.v1", "cardiologia"), true);
  assert.equal(toolPerteneceAEspecialidad("quiropraxia.spine.v1", "quiropraxia"), true);
  assert.equal(toolPerteneceAEspecialidad("quiropraxia.spine.v1", "psicologia"), false);
});

test("tool_id desconocido para el registry → no matchea ninguna", () => {
  for (const slug of ["quiropraxia", "cardiologia", "psicologia"] as const) {
    assert.equal(toolPerteneceAEspecialidad("futura.tool.v9", slug), false);
  }
});

// ─── filtrarToolHistorial (ficha mixta en lectura) ───────────────────────────

const HISTORIAL_MIXTO: ToolHistorialEntry[] = [
  { fecha: "2026-06-10", toolData: { v: 1, panel: {} }, toolId: ESPECIALIDADES_META.cardiologia.toolId },
  { fecha: "2026-06-09", toolData: { v: 1, phq9: [] }, toolId: ESPECIALIDADES_META.psicologia.toolId },
  { fecha: "2026-06-08", toolData: { v: 1, vertebras: [] }, toolId: ESPECIALIDADES_META.quiropraxia.toolId },
  { fecha: "2026-06-07", toolData: { v: 1, vertebras: [] }, toolId: null },        // legacy pre-M50
  { fecha: "2026-06-06", toolData: { v: 1 }, toolId: "futura.tool.v9" },            // desconocida
];

test("ficha mixta: cada Tool recibe SOLO el historial de su tool_id", () => {
  const cardio = filtrarToolHistorial(HISTORIAL_MIXTO, "cardiologia");
  assert.deepEqual(cardio.map((e) => e.fecha), ["2026-06-10"]);

  const psico = filtrarToolHistorial(HISTORIAL_MIXTO, "psicologia");
  assert.deepEqual(psico.map((e) => e.fecha), ["2026-06-09"]);

  // Quiropraxia suma las legacy con toolId NULL (vertebras_json implícita).
  const quiro = filtrarToolHistorial(HISTORIAL_MIXTO, "quiropraxia");
  assert.deepEqual(quiro.map((e) => e.fecha), ["2026-06-08", "2026-06-07"]);
});

test("compat Solo: historial homogéneo pasa entero (con y sin toolId)", () => {
  // Org quiro pre-M50: todas las entradas legacy sin toolId.
  const legacy: ToolHistorialEntry[] = [
    { fecha: "2026-05-02", toolData: { v: 1, vertebras: [] } },
    { fecha: "2026-05-01", toolData: { v: 1, vertebras: [] }, toolId: null },
  ];
  assert.equal(filtrarToolHistorial(legacy, "quiropraxia").length, 2);

  // Org cardio post-M50: todas con su toolId.
  const cardio: ToolHistorialEntry[] = [
    { fecha: "2026-05-02", toolData: { v: 1 }, toolId: ESPECIALIDADES_META.cardiologia.toolId },
  ];
  assert.equal(filtrarToolHistorial(cardio, "cardiologia").length, 1);
});

test("historial vacío → vacío", () => {
  assert.deepEqual(filtrarToolHistorial([], "psicologia"), []);
});
