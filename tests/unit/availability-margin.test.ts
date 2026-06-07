import assert from "node:assert/strict";
import test from "node:test";

import { generateSlotsForFranja } from "../../lib/booking/availability";

const MIN = 60_000;
// Franja base de 60 min arrancando en un epoch fijo. nowMs muy en el pasado
// para que el filtro de "no pasado" no descarte slots.
const FRANJA_START = new Date("2026-06-01T13:00:00.000Z").getTime();
const NOW_PAST = new Date("2020-01-01T00:00:00.000Z").getTime();

test("generateSlotsForFranja: sin margen → step = duración (60min/30min → 2 slots)", () => {
  const slots = generateSlotsForFranja(
    FRANJA_START,
    FRANJA_START + 60 * MIN,
    30 * MIN, // duración
    0,        // margen
    NOW_PAST,
    [],
  );
  assert.equal(slots.length, 2);
  assert.equal(slots[0].inicio, FRANJA_START);
  assert.equal(slots[0].fin, FRANJA_START + 30 * MIN);
  assert.equal(slots[1].inicio, FRANJA_START + 30 * MIN);
  assert.equal(slots[1].fin, FRANJA_START + 60 * MIN);
});

test("generateSlotsForFranja: 5min de margen → step 35 → solo 1 slot cabe (35+30=65>60)", () => {
  const slots = generateSlotsForFranja(
    FRANJA_START,
    FRANJA_START + 60 * MIN,
    30 * MIN,
    5 * MIN, // margen
    NOW_PAST,
    [],
  );
  assert.equal(slots.length, 1);
  assert.equal(slots[0].inicio, FRANJA_START);
  assert.equal(slots[0].fin, FRANJA_START + 30 * MIN);
});

test("generateSlotsForFranja: el margen NO extiende la ocupación (un ocupado bloquea solo su span real)", () => {
  // Ocupado = exactamente el segundo slot [30,60). Sin margen habría 2 slots;
  // el ocupado bloquea solo ese segundo slot → queda 1 (el primero).
  const ocupados: Array<[number, number]> = [
    [FRANJA_START + 30 * MIN, FRANJA_START + 60 * MIN],
  ];
  const slots = generateSlotsForFranja(
    FRANJA_START,
    FRANJA_START + 60 * MIN,
    30 * MIN,
    0, // sin margen → 2 slots candidatos
    NOW_PAST,
    ocupados,
  );
  assert.equal(slots.length, 1);
  assert.equal(slots[0].inicio, FRANJA_START);

  // El primer slot [0,30) NO se bloquea aunque esté pegado al ocupado [30,60):
  // overlap es half-open, el margen no agranda el span del ocupado.
  const ocupadoAdyacente: Array<[number, number]> = [
    [FRANJA_START - 30 * MIN, FRANJA_START], // termina justo cuando arranca la franja
  ];
  const slots2 = generateSlotsForFranja(
    FRANJA_START,
    FRANJA_START + 60 * MIN,
    30 * MIN,
    0,
    NOW_PAST,
    ocupadoAdyacente,
  );
  assert.equal(slots2.length, 2); // adyacente no bloquea
});

test("generateSlotsForFranja: descarta slots pasados (t <= nowMs)", () => {
  // now justo en el medio de la franja → solo el segundo slot (estricto >).
  const nowMid = FRANJA_START + 30 * MIN;
  const slots = generateSlotsForFranja(
    FRANJA_START,
    FRANJA_START + 60 * MIN,
    30 * MIN,
    0,
    nowMid,
    [],
  );
  // t=0 (<=now) descartado; t=30 (<=now) descartado → 0 slots.
  assert.equal(slots.length, 0);
});
