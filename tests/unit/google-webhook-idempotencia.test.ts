/**
 * PR 4.1 · Idempotencia del webhook de Google Calendar (re-entrega del mismo push).
 *
 * Google reintenta cada push notification ante timeout (y el cron rota el
 * channel a diario, disparando un handshake 'sync' que TAMBIÉN sincroniza).
 * O sea: `syncGoogleInbound` corre muchas veces sobre el MISMO estado del
 * calendar. La garantía dura es que la 2da (3ra, …) corrida sobre un calendar
 * sin cambios NO crea bloqueos duplicados ni borra los que están.
 *
 * `syncGoogleInbound` (lib/google/inbound.ts) tiene dos dependencias a nivel de
 * módulo — `listEvents` (Google API) y `decryptColumn` (crypto) — que no se
 * inyectan; `node:test` bajo tsx además no permite `mock.module`. Pero TODA la
 * decisión de idempotencia vive en `planInboundSync`, la función PURA que el
 * webhook llama en cada entrega: reconciliar los eventos de Google contra los
 * bloqueos origen='google' existentes vía `gcal_event_id` (upsert por el índice
 * único M52 + delete de los que ya no están).
 *
 * Por eso testeamos la RE-ENTREGA a ese nivel: simulamos dos entregas
 * consecutivas del mismo push corriendo `planInboundSync` dos veces. La 1ra
 * produce los upserts (bloqueos nuevos); "aplicamos" ese plan a un estado
 * mutable (lo que haría el upsert en DB) y corremos la 2da entrega sobre ese
 * estado ya reconciliado — debe dar CERO upserts y CERO deletes. Es exactamente
 * lo que hace el webhook cuando Google reenvía la misma notificación.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { GoogleEvent } from "../../lib/google/calendar";
import {
  planInboundSync,
  type BloqueoGoogleRow,
  type BloqueoUpsert,
  type InboundSyncPlan,
} from "../../lib/google/inbound";

const T0 = Date.parse("2026-06-10T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const WINDOW = { windowStartMs: T0, windowEndMs: T0 + 30 * DAY };

function ev(overrides: Partial<GoogleEvent> & { id: string }): GoogleEvent {
  return {
    summary: "Evento",
    start: new Date(T0 + DAY).toISOString(),
    end: new Date(T0 + DAY + 60 * 60_000).toISOString(),
    status: "confirmed",
    transparency: null,
    allDay: false,
    ...overrides,
  };
}

/**
 * Aplica un `InboundSyncPlan` a un array de bloqueos existentes tal como lo
 * haría la DB: el upsert reconcilia por `gcal_event_id` (índice único M52 —
 * pisa la fila si el evento ya existía, inserta si es nuevo); el delete quita
 * las filas por `id`. Devuelve el nuevo estado de bloqueos origen='google',
 * que es lo que la SIGUIENTE entrega del webhook leería como `existing`.
 *
 * Esta función replica la semántica del onConflict del upsert real — es el
 * puente entre dos entregas del mismo push, no lógica de producción bajo test.
 */
function applyPlan(existing: BloqueoGoogleRow[], plan: InboundSyncPlan): BloqueoGoogleRow[] {
  const byEventId = new Map<string, BloqueoGoogleRow>();
  let nextId = existing.length + 1;
  for (const row of existing) {
    if (row.gcal_event_id) byEventId.set(row.gcal_event_id, row);
  }
  // Upsert: reconcilia por gcal_event_id (M52). Fila nueva → id sintético;
  // fila existente → se pisa conservando su id.
  for (const u of plan.upserts as BloqueoUpsert[]) {
    const prev = byEventId.get(u.gcal_event_id);
    byEventId.set(u.gcal_event_id, {
      id: prev?.id ?? `row-${nextId++}`,
      gcal_event_id: u.gcal_event_id,
      inicio: u.inicio,
      duracion_min: u.duracion_min,
      titulo: u.titulo,
    });
  }
  // Delete por id.
  const deleted = new Set(plan.deleteIds);
  return [...byEventId.values()].filter((row) => !deleted.has(row.id));
}

test("re-entrega del mismo push sobre un calendar sin cambios → CERO writes (idempotente)", () => {
  const events = [
    ev({ id: "gcal-A", summary: "Turno particular" }),
    ev({ id: "gcal-B", start: new Date(T0 + 2 * DAY).toISOString(), end: new Date(T0 + 2 * DAY + 30 * 60_000).toISOString() }),
  ];

  // ── 1ra entrega: calendar visto por primera vez, sin bloqueos previos.
  const plan1 = planInboundSync({ events, existing: [], folioEventIds: new Set(), ...WINDOW });
  assert.equal(plan1.upserts.length, 2, "la 1ra entrega crea un bloqueo por evento ocupado");
  assert.deepEqual(plan1.deleteIds, []);

  // Aplicamos el plan (lo que haría el upsert real en DB).
  const afterFirst = applyPlan([], plan1);
  assert.equal(afterFirst.length, 2);

  // ── 2da entrega (re-entrega del MISMO push): Google reenvía la notificación,
  // el calendar no cambió. `existing` ahora son los bloqueos que dejó la 1ra.
  const plan2 = planInboundSync({ events, existing: afterFirst, folioEventIds: new Set(), ...WINDOW });
  assert.deepEqual(plan2.upserts, [], "una re-entrega NO vuelve a crear bloqueos (no duplica)");
  assert.deepEqual(plan2.deleteIds, [], "una re-entrega NO borra los bloqueos vigentes");

  // ── 3ra entrega para dejar clavado que es un punto fijo, no una casualidad.
  const afterSecond = applyPlan(afterFirst, plan2);
  const plan3 = planInboundSync({ events, existing: afterSecond, folioEventIds: new Set(), ...WINDOW });
  assert.deepEqual(plan3.upserts, []);
  assert.deepEqual(plan3.deleteIds, []);
  assert.equal(afterSecond.length, 2, "el set de bloqueos se mantiene estable entre entregas");
});

test("re-entrega tras un cambio real de calendar: solo el delta se escribe, no todo de nuevo", () => {
  const eventsV1 = [ev({ id: "gcal-A" }), ev({ id: "gcal-B", start: new Date(T0 + 2 * DAY).toISOString(), end: new Date(T0 + 2 * DAY + 60 * 60_000).toISOString() })];

  const plan1 = planInboundSync({ events: eventsV1, existing: [], folioEventIds: new Set(), ...WINDOW });
  const state1 = applyPlan([], plan1);
  assert.equal(state1.length, 2);

  // El calendar cambia: B se cancela (desaparece), llega C. A queda igual.
  const eventsV2 = [
    ev({ id: "gcal-A" }),
    ev({ id: "gcal-C", start: new Date(T0 + 3 * DAY).toISOString(), end: new Date(T0 + 3 * DAY + 45 * 60_000).toISOString() }),
  ];
  const plan2 = planInboundSync({ events: eventsV2, existing: state1, folioEventIds: new Set(), ...WINDOW });

  // A NO se reescribe (idéntico); C se inserta; B se borra. El delta, nada más.
  assert.equal(plan2.upserts.length, 1, "solo el evento nuevo genera upsert");
  assert.equal(plan2.upserts[0].gcal_event_id, "gcal-C");
  assert.equal(plan2.deleteIds.length, 1, "solo el evento desaparecido se borra");
  const bRowId = state1.find((r) => r.gcal_event_id === "gcal-B")!.id;
  assert.deepEqual(plan2.deleteIds, [bRowId]);

  // Re-entrega de ESA misma notificación (V2 otra vez): ya reconciliado → no-op.
  const state2 = applyPlan(state1, plan2);
  const plan2again = planInboundSync({ events: eventsV2, existing: state2, folioEventIds: new Set(), ...WINDOW });
  assert.deepEqual(plan2again.upserts, []);
  assert.deepEqual(plan2again.deleteIds, []);
});

test("re-entrega con un evento que Folio creó (outbound) → nunca se duplica como bloqueo", () => {
  // Un evento cuyo id figura en turno.gcal_event_id NO debe reflejarse como
  // bloqueo (se resta como turno). Ni la 1ra ni las re-entregas lo tocan.
  const events = [ev({ id: "gcal-A" }), ev({ id: "de-folio" })];
  const folioEventIds = new Set(["de-folio"]);

  const plan1 = planInboundSync({ events, existing: [], folioEventIds, ...WINDOW });
  assert.equal(plan1.upserts.length, 1);
  assert.equal(plan1.upserts[0].gcal_event_id, "gcal-A");

  const state1 = applyPlan([], plan1);
  const plan2 = planInboundSync({ events, existing: state1, folioEventIds, ...WINDOW });
  assert.deepEqual(plan2.upserts, [], "re-entrega no duplica; el evento de Folio sigue excluido");
  assert.deepEqual(plan2.deleteIds, []);
});
