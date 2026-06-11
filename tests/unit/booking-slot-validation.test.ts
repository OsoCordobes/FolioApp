import assert from "node:assert/strict";
import test from "node:test";

import { slotEstaOfrecido, type Slot } from "../../lib/booking/availability";

// ─── slotEstaOfrecido (pura) — defensa server-side del submit público ────
//
// createPedidoPublico re-deriva la grilla de slots y rechaza cualquier
// `inicio` que no coincida exactamente con un slot ofrecido (auditoría
// 2026-06-11: un POST directo podía crear turnos a cualquier hora).

const slots: Slot[] = [
  { inicio: "2026-06-15T13:00:00.000Z", fin: "2026-06-15T13:45:00.000Z" },
  { inicio: "2026-06-15T14:00:00.000Z", fin: "2026-06-15T14:45:00.000Z" },
];

test("slotEstaOfrecido: inicio exacto de un slot ofrecido → true", () => {
  assert.equal(slotEstaOfrecido(slots, "2026-06-15T13:00:00.000Z"), true);
});

test("slotEstaOfrecido: mismo instante en otra representación ISO (offset -03:00) → true", () => {
  assert.equal(slotEstaOfrecido(slots, "2026-06-15T10:00:00.000-03:00"), true);
});

test("slotEstaOfrecido: horario fuera de la grilla (corrido 7 min) → false", () => {
  assert.equal(slotEstaOfrecido(slots, "2026-06-15T13:07:00.000Z"), false);
});

test("slotEstaOfrecido: fin de un slot no es un inicio válido → false", () => {
  assert.equal(slotEstaOfrecido(slots, "2026-06-15T13:45:00.000Z"), false);
});

test("slotEstaOfrecido: lista vacía → false", () => {
  assert.equal(slotEstaOfrecido([], "2026-06-15T13:00:00.000Z"), false);
});

test("slotEstaOfrecido: fecha inválida → false (no revienta)", () => {
  assert.equal(slotEstaOfrecido(slots, "garbage"), false);
});
