import assert from "node:assert/strict";
import test from "node:test";

import { buildMonthGrid, shiftMonth, monthAnchorInTz } from "../../lib/db/calendario";

const TZ = "America/Argentina/Cordoba"; // UTC-3 fijo (sin DST)

// ─── buildMonthGrid ─────────────────────────────────────────────────────────

test("buildMonthGrid: la grilla son semanas completas (length % 7 === 0)", () => {
  const grid = buildMonthGrid("2026-06", "2026-06-07");
  assert.equal(grid.length % 7, 0);
  assert.ok(grid.length >= 28 && grid.length <= 42);
});

test("buildMonthGrid: empieza en lunes y termina en domingo", () => {
  const grid = buildMonthGrid("2026-06", "2026-06-07");
  const dow = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0 dom..6 sab
  };
  assert.equal(dow(grid[0].dateIso), 1); // lunes
  assert.equal(dow(grid[grid.length - 1].dateIso), 0); // domingo
});

test("buildMonthGrid: el 1° del mes cae en la primera semana", () => {
  const grid = buildMonthGrid("2026-06", "2026-06-07");
  const primeraSemana = grid.slice(0, 7).map((c) => c.dateIso);
  assert.ok(primeraSemana.includes("2026-06-01"));
});

test("buildMonthGrid: inCurrentMonth correcto para junio 2026", () => {
  // Junio 2026: el 1° es lunes → la grilla arranca exactamente el 2026-06-01.
  const grid = buildMonthGrid("2026-06", "2026-06-15");
  assert.equal(grid[0].dateIso, "2026-06-01");
  assert.equal(grid[0].inCurrentMonth, true);

  const inMonth = grid.filter((c) => c.inCurrentMonth);
  assert.equal(inMonth.length, 30); // junio tiene 30 días
  assert.ok(inMonth.every((c) => c.dateIso.slice(0, 7) === "2026-06"));

  // Junio termina martes 30 → la grilla rellena con días de julio.
  const out = grid.filter((c) => !c.inCurrentMonth);
  assert.ok(out.length > 0);
  assert.ok(out.some((c) => c.dateIso.startsWith("2026-07")));
});

test("buildMonthGrid: isToday flag marca exactamente el día de hoy", () => {
  const grid = buildMonthGrid("2026-06", "2026-06-07");
  const today = grid.filter((c) => c.isToday);
  assert.equal(today.length, 1);
  assert.equal(today[0].dateIso, "2026-06-07");
});

test("buildMonthGrid: mes que arranca en domingo incluye semana previa completa", () => {
  // Febrero 2026: el 1° es domingo → la primera semana es lun 26-ene .. dom 1-feb.
  const grid = buildMonthGrid("2026-02", "2026-02-10");
  assert.equal(grid.length % 7, 0);
  assert.equal(grid[0].dateIso, "2026-01-26");
  assert.equal(grid[6].dateIso, "2026-02-01");
  assert.equal(grid[6].inCurrentMonth, true);
});

// ─── shiftMonth ─────────────────────────────────────────────────────────────

test("shiftMonth: avanza y cruza el año", () => {
  assert.equal(shiftMonth("2026-06", 1), "2026-07");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-06", -6), "2025-12");
});

// ─── monthAnchorInTz ────────────────────────────────────────────────────────

test("monthAnchorInTz: valida formato y cae al default si es inválido", () => {
  assert.equal(monthAnchorInTz("2026-06", TZ), "2026-06");
  assert.equal(monthAnchorInTz("basura", TZ), monthAnchorInTz(null, TZ));
  // formato YYYY-MM-DD (semana) no es válido como ancla de mes → default.
  assert.equal(monthAnchorInTz("2026-06-01", TZ), monthAnchorInTz(null, TZ));
});
