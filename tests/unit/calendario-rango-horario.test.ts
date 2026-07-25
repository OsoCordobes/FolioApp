import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveRangoDisponibilidadSemana,
  deriveRangoHorario,
  RANGO_DEFAULT,
  slotDesdeOffsetY,
  type FranjaHorariaVigente,
} from "../../lib/agenda/rango-horario";

/** Semana de referencia: lunes 2026-07-20 … domingo 2026-07-26. */
const WEEK = [
  "2026-07-20", // LUN (i=0)
  "2026-07-21", // MAR
  "2026-07-22", // MIÉ
  "2026-07-23", // JUE
  "2026-07-24", // VIE
  "2026-07-25", // SÁB (i=5)
  "2026-07-26", // DOM (i=6)
];

const franja = (
  diaSemana: number,
  horaInicio: string,
  horaFin: string,
  vigenciaDesde = "2026-01-01",
  vigenciaHasta: string | null = null,
): FranjaHorariaVigente => ({ diaSemana, horaInicio, horaFin, vigenciaDesde, vigenciaHasta });

// ─── deriveRangoHorario ─────────────────────────────────────────────────────

test("sin eventos ni disponibilidad → default 08–19 (render histórico intacto)", () => {
  assert.deepEqual(deriveRangoHorario({ eventos: [] }), {
    horaInicio: RANGO_DEFAULT.horaInicio,
    horaFin: RANGO_DEFAULT.horaFin,
  });
});

test("turno de 07:30 expande el inicio a 07 (antes era invisible)", () => {
  const out = deriveRangoHorario({ eventos: [{ hora: "07:30", dur: 45 }] });
  assert.deepEqual(out, { horaInicio: 7, horaFin: 19 });
});

test("turno de 19:30 + 45' expande el fin a 21 (ceil de 20:15)", () => {
  const out = deriveRangoHorario({ eventos: [{ hora: "19:30", dur: 45 }] });
  assert.deepEqual(out, { horaInicio: 8, horaFin: 21 });
});

test("turno que termina en hora exacta no agrega una hora de más (19:00 + 60' → fin 20)", () => {
  const out = deriveRangoHorario({ eventos: [{ hora: "19:00", dur: 60 }] });
  assert.equal(out.horaFin, 20);
});

test("eventos DENTRO del default no achican el rango", () => {
  const out = deriveRangoHorario({ eventos: [{ hora: "10:00", dur: 45 }, { hora: "12:00", dur: 30 }] });
  assert.deepEqual(out, { horaInicio: 8, horaFin: 19 });
});

test("dur ausente/invalida cae al default 45'", () => {
  // 19:45 sin dur → fin 20:30 → ceil 21.
  assert.equal(deriveRangoHorario({ eventos: [{ hora: "19:45" }] }).horaFin, 21);
  assert.equal(deriveRangoHorario({ eventos: [{ hora: "19:45", dur: -10 }] }).horaFin, 21);
});

test("hora inválida o null se ignora (no rompe el rango)", () => {
  const out = deriveRangoHorario({
    eventos: [{ hora: null }, { hora: "zz:zz", dur: 45 }, { hora: "25:00", dur: 45 }, { hora: "10:75", dur: 30 }],
  });
  assert.deepEqual(out, { horaInicio: 8, horaFin: 19 });
});

test("disponibilidad 07:00–21:00 expande el rango a 07–21", () => {
  const out = deriveRangoHorario({
    eventos: [],
    disponibilidad: { desdeMin: 7 * 60, hastaMin: 21 * 60 },
  });
  assert.deepEqual(out, { horaInicio: 7, horaFin: 21 });
});

test("disponibilidad más angosta que el default (10–13) NO achica la grilla", () => {
  const out = deriveRangoHorario({
    eventos: [],
    disponibilidad: { desdeMin: 10 * 60, hastaMin: 13 * 60 },
  });
  assert.deepEqual(out, { horaInicio: 8, horaFin: 19 });
});

test("disponibilidad invertida o corrupta se ignora", () => {
  const out = deriveRangoHorario({
    eventos: [],
    disponibilidad: { desdeMin: 900, hastaMin: 600 },
  });
  assert.deepEqual(out, { horaInicio: 8, horaFin: 19 });
  const out2 = deriveRangoHorario({
    eventos: [],
    disponibilidad: { desdeMin: Number.NaN, hastaMin: 1200 },
  });
  assert.deepEqual(out2, { horaInicio: 8, horaFin: 19 });
});

test("clamp defensivo: evento 23:50 con dur enorme no pasa de 24", () => {
  const out = deriveRangoHorario({ eventos: [{ hora: "23:50", dur: 600 }] });
  assert.equal(out.horaFin, 24);
  assert.equal(out.horaInicio, 8);
});

test("min/max combinado disponibilidad + eventos", () => {
  const out = deriveRangoHorario({
    eventos: [{ hora: "06:15", dur: 30 }],
    disponibilidad: { desdeMin: 8 * 60, hastaMin: 20 * 60 },
  });
  // inicio: floor(06:15)=6 (evento); fin: 20 (disponibilidad).
  assert.deepEqual(out, { horaInicio: 6, horaFin: 20 });
});

// ─── deriveRangoDisponibilidadSemana ────────────────────────────────────────

test("sin franjas → null (el caller cae al default + eventos)", () => {
  assert.equal(deriveRangoDisponibilidadSemana(WEEK, []), null);
});

test("franja lun 09:00–17:00 vigente → {540, 1020} (dow DB 1 = LUN de la UI)", () => {
  const out = deriveRangoDisponibilidadSemana(WEEK, [franja(1, "09:00", "17:00")]);
  assert.deepEqual(out, { desdeMin: 540, hastaMin: 1020 });
});

test("min/max entre varias franjas de distintos días", () => {
  const out = deriveRangoDisponibilidadSemana(WEEK, [
    franja(1, "10:00", "20:00"), // lunes
    franja(6, "08:00", "12:00"), // sábado
  ]);
  assert.deepEqual(out, { desdeMin: 480, hastaMin: 1200 });
});

test("franja fuera de vigencia no cuenta", () => {
  const vencida = franja(1, "07:00", "22:00", "2025-01-01", "2025-12-31");
  assert.equal(deriveRangoDisponibilidadSemana(WEEK, [vencida]), null);
  const futura = franja(1, "07:00", "22:00", "2026-12-01", null);
  assert.equal(deriveRangoDisponibilidadSemana(WEEK, [futura]), null);
});

test("franja con horario corrupto (fin <= inicio) se ignora", () => {
  assert.equal(deriveRangoDisponibilidadSemana(WEEK, [franja(1, "17:00", "09:00")]), null);
});

// ─── slotDesdeOffsetY ───────────────────────────────────────────────────────

const GRID = { horaInicio: 8, horaFin: 19, horaPx: 56 };

test("click en el tope de la columna → primer slot (08:00)", () => {
  assert.equal(slotDesdeOffsetY({ ...GRID, offsetY: 0 }), "08:00");
});

test("click a 1.5 horas del tope → 09:30", () => {
  assert.equal(slotDesdeOffsetY({ ...GRID, offsetY: 56 * 1.5 }), "09:30");
});

test("redondeo a 15': 40px (~42.8') redondea a 08:45", () => {
  assert.equal(slotDesdeOffsetY({ ...GRID, offsetY: 40 }), "08:45");
});

test("clamp inferior: offset negativo no baja de la hora de inicio", () => {
  assert.equal(slotDesdeOffsetY({ ...GRID, offsetY: -100 }), "08:00");
});

test("clamp superior: click al fondo → último slot 15' antes del fin", () => {
  assert.equal(slotDesdeOffsetY({ ...GRID, offsetY: 99999 }), "18:45");
});

test("horaPx inválido no explota (cae al inicio)", () => {
  assert.equal(slotDesdeOffsetY({ ...GRID, horaPx: 0, offsetY: 100 }), "08:00");
});
