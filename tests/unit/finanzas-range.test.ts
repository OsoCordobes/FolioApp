import assert from "node:assert/strict";
import test from "node:test";

import { computeRangeOverride, wallClockInTzToUtc } from "../../lib/db/finanzas";

const TZ = "America/Argentina/Cordoba"; // UTC-3 fijo (sin DST)

// ─── wallClockInTzToUtc ────────────────────────────────────────────────────

test("wallClockInTzToUtc: medianoche AR → +3h en UTC", () => {
  const utc = wallClockInTzToUtc(2026, 6, 1, 0, 0, 0, TZ);
  assert.equal(utc.toISOString(), "2026-06-01T03:00:00.000Z");
});

test("wallClockInTzToUtc: mediodía AR → 15:00 UTC", () => {
  const utc = wallClockInTzToUtc(2026, 1, 15, 12, 0, 0, TZ);
  assert.equal(utc.toISOString(), "2026-01-15T15:00:00.000Z");
});

// ─── computeRangeOverride ──────────────────────────────────────────────────

test("computeRangeOverride: 'mes' devuelve undefined (cae al cálculo mensual default)", () => {
  const r = computeRangeOverride("mes", TZ, new Date("2026-06-07T18:00:00.000Z"));
  assert.equal(r, undefined);
});

test("computeRangeOverride: 'hoy' = inicio del día AR hasta inicio del día siguiente", () => {
  // 2026-06-07 15:00 UTC = 12:00 AR → día AR = 2026-06-07.
  const r = computeRangeOverride("hoy", TZ, new Date("2026-06-07T15:00:00.000Z"));
  assert.ok(r);
  assert.equal(r!.startUtc, "2026-06-07T03:00:00.000Z");
  assert.equal(r!.endUtc, "2026-06-08T03:00:00.000Z");
});

test("computeRangeOverride: 'anio' arranca el 1 de enero AR", () => {
  const r = computeRangeOverride("anio", TZ, new Date("2026-06-07T15:00:00.000Z"));
  assert.ok(r);
  assert.equal(r!.startUtc, "2026-01-01T03:00:00.000Z");
});

test("computeRangeOverride: 'semana' arranca el lunes AR de la semana en curso", () => {
  // 2026-06-07 es domingo. ISO: el lunes de esa semana es 2026-06-01.
  const r = computeRangeOverride("semana", TZ, new Date("2026-06-07T15:00:00.000Z"));
  assert.ok(r);
  assert.equal(r!.startUtc, "2026-06-01T03:00:00.000Z");
});

test("computeRangeOverride: '6m' arranca el 1 del mes 5 meses atrás", () => {
  const r = computeRangeOverride("6m", TZ, new Date("2026-06-07T15:00:00.000Z"));
  assert.ok(r);
  // junio - 5 meses = enero.
  assert.equal(r!.startUtc, "2026-01-01T03:00:00.000Z");
});
