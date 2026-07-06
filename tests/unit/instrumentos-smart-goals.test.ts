/**
 * Folio · tests · instrumento objetivos SMART (lib/instrumentos/scoring/smart-goals.ts).
 *
 * Fija el conteo de criterios (0–5 → banda incompleto/parcial/completo), la
 * flag de estado y el contrato laxo (null ante texto vacío / estado inválido /
 * criterios no booleanos).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  SMART_FLAG_ESTADO,
  scoreSmartGoal,
  smartGoals,
} from "../../lib/instrumentos/scoring/smart-goals";

function goal(over: Record<string, unknown> = {}) {
  return {
    texto: "Caminar 30 min, 4 veces por semana, durante 8 semanas",
    especifico: true,
    medible: true,
    alcanzable: true,
    relevante: true,
    temporal: true,
    estado: "en_curso",
    ...over,
  };
}

test("smart: conteo de criterios → banda", () => {
  // 5/5 → completo.
  assert.equal(scoreSmartGoal(goal())?.total, 5);
  assert.equal(scoreSmartGoal(goal())?.banda, "completo");
  // 4/5 → parcial.
  assert.equal(scoreSmartGoal(goal({ temporal: false }))?.banda, "parcial");
  // 3/5 → parcial.
  assert.equal(scoreSmartGoal(goal({ temporal: false, relevante: false }))?.banda, "parcial");
  // 2/5 → incompleto.
  assert.equal(
    scoreSmartGoal(goal({ temporal: false, relevante: false, alcanzable: false }))?.banda,
    "incompleto",
  );
  // 0/5 → incompleto.
  assert.equal(
    scoreSmartGoal(
      goal({
        especifico: false,
        medible: false,
        alcanzable: false,
        relevante: false,
        temporal: false,
      }),
    )?.total,
    0,
  );
});

test("smart: flag de estado del objetivo", () => {
  assert.deepEqual(scoreSmartGoal(goal({ estado: "en_curso" }))?.flags, [
    SMART_FLAG_ESTADO.en_curso,
  ]);
  assert.deepEqual(scoreSmartGoal(goal({ estado: "logrado" }))?.flags, [
    SMART_FLAG_ESTADO.logrado,
  ]);
  assert.deepEqual(scoreSmartGoal(goal({ estado: "pausado" }))?.flags, [
    SMART_FLAG_ESTADO.pausado,
  ]);
});

test("smart: interpretación incluye criterios y estado", () => {
  const r = scoreSmartGoal(goal({ estado: "logrado" }));
  assert.match(r?.interpretacion ?? "", /5\/5/);
  assert.match(r?.interpretacion ?? "", /Logrado/);
});

test("smart: contrato laxo — null ante inválidos", () => {
  assert.equal(scoreSmartGoal(undefined), null);
  assert.equal(scoreSmartGoal(null), null);
  assert.equal(scoreSmartGoal([]), null); // array no es objeto de objetivo
  assert.equal(scoreSmartGoal(goal({ texto: "" })), null); // texto vacío
  assert.equal(scoreSmartGoal(goal({ texto: "   " })), null); // solo espacios
  assert.equal(scoreSmartGoal(goal({ estado: "terminado" })), null); // estado fuera de catálogo
  assert.equal(scoreSmartGoal(goal({ especifico: "si" })), null); // criterio no booleano
  const { medible, ...sinMedible } = goal();
  void medible;
  assert.equal(scoreSmartGoal(sinMedible), null); // falta un criterio
});

test("smart: def bien formada", () => {
  assert.equal(smartGoals.id, "smart_goals.v1");
  assert.equal(smartGoals.dominio, "objetivos");
  // 1 ítem de texto + 5 criterios.
  assert.equal(smartGoals.items.length, 6);
});
