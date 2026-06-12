import assert from "node:assert/strict";
import test from "node:test";

import { deriveCapacidadSemana, type FranjaDisponibilidad } from "../../lib/db/calendario";

/** Semana de referencia: lunes 2026-06-08 … domingo 2026-06-14. */
const WEEK = [
  "2026-06-08", // LUN (i=0)
  "2026-06-09", // MAR
  "2026-06-10", // MIÉ
  "2026-06-11", // JUE
  "2026-06-12", // VIE
  "2026-06-13", // SÁB (i=5)
  "2026-06-14", // DOM (i=6)
];

const franja = (
  diaSemana: number,
  horaInicio: string,
  horaFin: string,
  vigenciaDesde = "2026-01-01",
  vigenciaHasta: string | null = null,
): FranjaDisponibilidad => ({ diaSemana, horaInicio, horaFin, vigenciaDesde, vigenciaHasta });

test("sin franjas → todos null (la UI cae al 600 histórico)", () => {
  assert.deepEqual(deriveCapacidadSemana(WEEK, []), [null, null, null, null, null, null, null]);
});

test("un profesional 09:00-17:00 lun-vie → 480 min esos días, null el finde", () => {
  const franjas = [1, 2, 3, 4, 5].map((d) => franja(d, "09:00", "17:00"));
  assert.deepEqual(deriveCapacidadSemana(WEEK, franjas), [480, 480, 480, 480, 480, null, null]);
});

test("vista 'Todos': dos profesionales el mismo día SUMAN capacidad (no saturan el 100% con la agenda de uno)", () => {
  // DB dow 1 = lunes. Prof A 08:00-12:00 (240), Prof B 14:00-20:00 (360).
  const franjas = [franja(1, "08:00", "12:00"), franja(1, "14:00", "20:00")];
  const out = deriveCapacidadSemana(WEEK, franjas);
  assert.equal(out[0], 600); // LUN = 240 + 360
  assert.equal(out[1], null);
});

test("franjas partidas del MISMO profesional también suman (mañana + tarde)", () => {
  const franjas = [franja(3, "08:00", "12:00"), franja(3, "16:00", "20:00")]; // miércoles
  assert.equal(deriveCapacidadSemana(WEEK, franjas)[2], 480);
});

test("mapeo índice UI→DB: franja de sábado (DB 6) cae en i=5 y la de domingo (DB 0) en i=6", () => {
  const out = deriveCapacidadSemana(WEEK, [
    franja(6, "09:00", "13:00"),
    franja(0, "10:00", "12:00"),
  ]);
  assert.equal(out[5], 240); // SÁB
  assert.equal(out[6], 120); // DOM
  assert.equal(out[0], null);
});

test("vigencia: franja vencida antes de la semana no aporta capacidad", () => {
  const franjas = [franja(1, "09:00", "17:00", "2026-01-01", "2026-05-31")];
  assert.equal(deriveCapacidadSemana(WEEK, franjas)[0], null);
});

test("vigencia: franja que arranca después de la semana no aporta", () => {
  const franjas = [franja(1, "09:00", "17:00", "2026-07-01", null)];
  assert.equal(deriveCapacidadSemana(WEEK, franjas)[0], null);
});

test("vigencia: bordes exactos (desde/hasta = el mismo día) cuentan", () => {
  const franjas = [franja(1, "09:00", "10:30", "2026-06-08", "2026-06-08")];
  assert.equal(deriveCapacidadSemana(WEEK, franjas)[0], 90);
});

test("minutos con medias horas: 08:30-12:15 → 225", () => {
  assert.equal(deriveCapacidadSemana(WEEK, [franja(1, "08:30", "12:15")])[0], 225);
});
