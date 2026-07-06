/**
 * Folio · tests · scores cardiológicos validados (lib/especialidades/cardiologia/scores.ts).
 *
 * Fija los cutoffs publicados de tres calculadoras orientativas:
 *   - CHA₂DS₂-VASc (riesgo tromboembólico en FA no valvular) — puntaje 0–9.
 *   - HAS-BLED (riesgo hemorrágico) — puntaje 0–9.
 *   - SCORE2 / SCORE2-OP — categoría de riesgo por franja etaria (ESC 2021).
 *
 * Contrato laxo: inputs no-objeto / sin edad → null. Todas las interpretaciones
 * marcan "orientativo" (no diagnóstico).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  bandaSCORE2,
  scoreCHA2DS2VASc,
  scoreHASBLED,
} from "../../lib/especialidades/cardiologia/scores";

// ─── CHA₂DS₂-VASc ────────────────────────────────────────────────────────────

test("CHA2DS2-VASc: suma de puntos por categoría (edad, sexo, antecedentes)", () => {
  // Sólo edad 40, sin nada → 0 puntos, riesgo bajo.
  const r0 = scoreCHA2DS2VASc({ edad: 40 });
  assert.equal(r0?.total, 0);
  assert.equal(r0?.nivel, "bajo");

  // Edad 65–74 = 1 punto.
  assert.equal(scoreCHA2DS2VASc({ edad: 65 })?.total, 1);
  assert.equal(scoreCHA2DS2VASc({ edad: 74 })?.total, 1);
  // Edad ≥ 75 = 2 puntos.
  assert.equal(scoreCHA2DS2VASc({ edad: 75 })?.total, 2);
  assert.equal(scoreCHA2DS2VASc({ edad: 80 })?.total, 2);

  // Sexo femenino = 1 punto adicional.
  assert.equal(scoreCHA2DS2VASc({ edad: 50, sexoFemenino: true })?.total, 1);

  // ACV/AIT previo = 2; enfermedad vascular = 1; el resto 1 c/u.
  const rMax = scoreCHA2DS2VASc({
    edad: 76, // 2 (≥75)
    sexoFemenino: true, // 1
    insuficienciaCardiaca: true, // 1
    hipertension: true, // 1
    diabetes: true, // 1
    acvAitTromboembolismo: true, // 2
    enfermedadVascular: true, // 1
  });
  assert.equal(rMax?.total, 9);
  assert.equal(rMax?.nivel, "alto");
});

test("CHA2DS2-VASc: bandas (0 bajo, 1 moderado, ≥2 alto)", () => {
  assert.equal(scoreCHA2DS2VASc({ edad: 40 })?.nivel, "bajo"); // 0
  assert.equal(scoreCHA2DS2VASc({ edad: 40, hipertension: true })?.nivel, "moderado"); // 1
  assert.equal(
    scoreCHA2DS2VASc({ edad: 40, hipertension: true, diabetes: true })?.nivel,
    "alto",
  ); // 2
  // Etiqueta singular/plural y marca orientativa.
  assert.equal(scoreCHA2DS2VASc({ edad: 40, hipertension: true })?.etiqueta, "1 punto");
  assert.equal(scoreCHA2DS2VASc({ edad: 40 })?.etiqueta, "0 puntos");
  assert.match(scoreCHA2DS2VASc({ edad: 40 })!.interpretacion, /orientativo/);
});

test("CHA2DS2-VASc: inputs inválidos → null; booleanos no-true no suman", () => {
  assert.equal(scoreCHA2DS2VASc(null), null);
  assert.equal(scoreCHA2DS2VASc(undefined), null);
  assert.equal(scoreCHA2DS2VASc("x"), null);
  assert.equal(scoreCHA2DS2VASc({}), null); // sin edad
  assert.equal(scoreCHA2DS2VASc({ edad: -1 }), null);
  assert.equal(scoreCHA2DS2VASc({ edad: 200 }), null);
  // Un antecedente en 1/"si" (no boolean true) NO cuenta.
  assert.equal(scoreCHA2DS2VASc({ edad: 40, hipertension: 1 as unknown as boolean })?.total, 0);
});

// ─── HAS-BLED ────────────────────────────────────────────────────────────────

test("HAS-BLED: suma de puntos por categoría (1 c/u; edad > 65)", () => {
  // Edad 60, nada → 0.
  assert.equal(scoreHASBLED({ edad: 60 })?.total, 0);
  // Edad > 65 = 1 punto (66 suma, 65 no).
  assert.equal(scoreHASBLED({ edad: 65 })?.total, 0);
  assert.equal(scoreHASBLED({ edad: 66 })?.total, 1);

  // Todas las categorías presentes → 9.
  const rMax = scoreHASBLED({
    edad: 70, // 1 (>65)
    hipertensionNoControlada: true, // 1
    funcionRenalAlterada: true, // 1
    funcionHepaticaAlterada: true, // 1
    acvPrevio: true, // 1
    sangradoPrevio: true, // 1
    inrLabil: true, // 1
    farmacosPredisponentes: true, // 1
    alcohol: true, // 1
  });
  assert.equal(rMax?.total, 9);
  assert.equal(rMax?.nivel, "alto");
});

test("HAS-BLED: bandas (0-1 bajo, 2 moderado, ≥3 alto)", () => {
  assert.equal(scoreHASBLED({ edad: 60 })?.nivel, "bajo"); // 0
  assert.equal(scoreHASBLED({ edad: 60, acvPrevio: true })?.nivel, "bajo"); // 1
  assert.equal(
    scoreHASBLED({ edad: 60, acvPrevio: true, inrLabil: true })?.nivel,
    "moderado",
  ); // 2
  assert.equal(
    scoreHASBLED({ edad: 60, acvPrevio: true, inrLabil: true, alcohol: true })?.nivel,
    "alto",
  ); // 3
  assert.match(scoreHASBLED({ edad: 60 })!.interpretacion, /orientativo/);
});

test("HAS-BLED: inputs inválidos → null", () => {
  assert.equal(scoreHASBLED(null), null);
  assert.equal(scoreHASBLED(42), null);
  assert.equal(scoreHASBLED({}), null); // sin edad
  assert.equal(scoreHASBLED({ edad: "70" as unknown as number }), null);
});

// ─── SCORE2 / SCORE2-OP — banda por franja etaria ────────────────────────────

test("SCORE2 <50 años: <2.5% moderado, 2.5–<7.5% alto, ≥7.5% muy alto", () => {
  assert.equal(bandaSCORE2({ edad: 45, riesgoPct: 2.4 })?.nivel, "moderado");
  assert.equal(bandaSCORE2({ edad: 45, riesgoPct: 2.5 })?.nivel, "alto"); // borde inferior alta
  assert.equal(bandaSCORE2({ edad: 45, riesgoPct: 7.4 })?.nivel, "alto");
  assert.equal(bandaSCORE2({ edad: 45, riesgoPct: 7.5 })?.nivel, "muy_alto"); // borde muy alta
});

test("SCORE2 50–69 años: <5% moderado, 5–<10% alto, ≥10% muy alto", () => {
  assert.equal(bandaSCORE2({ edad: 55, riesgoPct: 4.9 })?.nivel, "moderado");
  assert.equal(bandaSCORE2({ edad: 55, riesgoPct: 5 })?.nivel, "alto"); // borde inferior alta
  assert.equal(bandaSCORE2({ edad: 69, riesgoPct: 9.9 })?.nivel, "alto");
  assert.equal(bandaSCORE2({ edad: 69, riesgoPct: 10 })?.nivel, "muy_alto"); // borde muy alta
});

test("SCORE2-OP ≥70 años: <7.5% moderado, 7.5–<15% alto, ≥15% muy alto", () => {
  assert.equal(bandaSCORE2({ edad: 72, riesgoPct: 7.4 })?.nivel, "moderado");
  assert.equal(bandaSCORE2({ edad: 72, riesgoPct: 7.5 })?.nivel, "alto"); // borde inferior alta
  assert.equal(bandaSCORE2({ edad: 72, riesgoPct: 14.9 })?.nivel, "alto");
  assert.equal(bandaSCORE2({ edad: 72, riesgoPct: 15 })?.nivel, "muy_alto"); // borde muy alta
  // La interpretación usa SCORE2-OP para ≥70 y SCORE2 para <70.
  assert.match(bandaSCORE2({ edad: 72, riesgoPct: 10 })!.interpretacion, /SCORE2-OP/);
  assert.match(bandaSCORE2({ edad: 55, riesgoPct: 10 })!.interpretacion, /SCORE2/);
  assert.match(bandaSCORE2({ edad: 55, riesgoPct: 10 })!.interpretacion, /orientativo/);
});

test("SCORE2: total conserva el % ingresado; edad 50 y 70 caen en la franja correcta", () => {
  assert.equal(bandaSCORE2({ edad: 45, riesgoPct: 3.2 })?.total, 3.2);
  // Edad exactamente 50 → franja media (no <50).
  assert.equal(bandaSCORE2({ edad: 50, riesgoPct: 4.9 })?.nivel, "moderado");
  // Edad exactamente 70 → franja ≥70.
  assert.equal(bandaSCORE2({ edad: 70, riesgoPct: 7.4 })?.nivel, "moderado");
});

test("SCORE2: inputs inválidos → null (falta edad o %, o fuera de rango)", () => {
  assert.equal(bandaSCORE2(null), null);
  assert.equal(bandaSCORE2({ edad: 55 }), null); // sin %
  assert.equal(bandaSCORE2({ riesgoPct: 5 }), null); // sin edad
  assert.equal(bandaSCORE2({ edad: 55, riesgoPct: -1 }), null);
  assert.equal(bandaSCORE2({ edad: 55, riesgoPct: 101 }), null);
});
