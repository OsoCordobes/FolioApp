import assert from "node:assert/strict";
import test from "node:test";

import type { GoogleEvent } from "../../lib/google/calendar";
import { planInboundSync, type BloqueoGoogleRow } from "../../lib/google/inbound";

const T0 = Date.parse("2026-06-10T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;
// Timezone de la organización: define dónde cae la medianoche que corta los
// eventos all-day de Google (su `end.date` es EXCLUSIVO).
const TZ_TEST = "America/Argentina/Buenos_Aires";

const WINDOW = { windowStartMs: T0, windowEndMs: T0 + 30 * DAY, timeZone: TZ_TEST };

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

function existing(overrides: Partial<BloqueoGoogleRow> & { id: string }): BloqueoGoogleRow {
  return {
    gcal_event_id: "ev-1",
    inicio: new Date(T0 + DAY).toISOString(),
    duracion_min: 60,
    titulo: "Evento",
    ...overrides,
  };
}

test("evento ocupado nuevo genera upsert con duración en minutos", () => {
  const plan = planInboundSync({
    events: [ev({ id: "ev-1", summary: "Kine particular" })],
    existing: [],
    folioEventIds: new Set(),
    ...WINDOW,
  });
  assert.equal(plan.upserts.length, 1);
  assert.deepEqual(plan.upserts[0], {
    gcal_event_id: "ev-1",
    inicio: new Date(T0 + DAY).toISOString(),
    duracion_min: 60,
    titulo: "Kine particular",
  });
  assert.deepEqual(plan.deleteIds, []);
});

test("bloqueo idéntico al evento no genera upsert (idempotencia)", () => {
  const plan = planInboundSync({
    events: [ev({ id: "ev-1" })],
    existing: [existing({ id: "row-1" })],
    folioEventIds: new Set(),
    ...WINDOW,
  });
  assert.deepEqual(plan.upserts, []);
  assert.deepEqual(plan.deleteIds, []);
});

test("evento movido de horario actualiza el bloqueo existente", () => {
  const nuevoInicio = new Date(T0 + 2 * DAY).toISOString();
  const plan = planInboundSync({
    events: [ev({ id: "ev-1", start: nuevoInicio, end: new Date(T0 + 2 * DAY + 30 * 60_000).toISOString() })],
    existing: [existing({ id: "row-1" })],
    folioEventIds: new Set(),
    ...WINDOW,
  });
  assert.equal(plan.upserts.length, 1);
  assert.equal(plan.upserts[0].inicio, nuevoInicio);
  assert.equal(plan.upserts[0].duracion_min, 30);
  // El upsert pisa la misma fila vía gcal_event_id — no se borra.
  assert.deepEqual(plan.deleteIds, []);
});

test("evento desaparecido del calendar borra su bloqueo", () => {
  const plan = planInboundSync({
    events: [],
    existing: [existing({ id: "row-1" })],
    folioEventIds: new Set(),
    ...WINDOW,
  });
  assert.deepEqual(plan.upserts, []);
  assert.deepEqual(plan.deleteIds, ["row-1"]);
});

test("se excluyen: cancelados, all-day, transparentes y eventos creados por Folio", () => {
  const plan = planInboundSync({
    events: [
      ev({ id: "cancelado", status: "cancelled" }),
      ev({ id: "all-day", allDay: true }),
      ev({ id: "libre", transparency: "transparent" }),
      ev({ id: "de-folio" }),
    ],
    existing: [],
    folioEventIds: new Set(["de-folio"]),
    ...WINDOW,
  });
  assert.deepEqual(plan.upserts, []);
});

test("eventos fuera de la ventana o con fechas inválidas se ignoran", () => {
  const plan = planInboundSync({
    events: [
      ev({ id: "pasado", start: new Date(T0 - DAY).toISOString(), end: new Date(T0 - DAY + 60_000).toISOString() }),
      ev({ id: "lejano", start: new Date(T0 + 31 * DAY).toISOString(), end: new Date(T0 + 31 * DAY + 60_000).toISOString() }),
      ev({ id: "invalido", start: "no-es-fecha", end: "tampoco" }),
      ev({ id: "vacio", start: new Date(T0 + DAY).toISOString(), end: new Date(T0 + DAY).toISOString() }),
    ],
    existing: [],
    folioEventIds: new Set(),
    ...WINDOW,
  });
  assert.deepEqual(plan.upserts, []);
});

test("duración se clampa al mínimo del CHECK de bloqueo (5 min)", () => {
  const plan = planInboundSync({
    events: [ev({ id: "corto", end: new Date(T0 + DAY + 60_000).toISOString() })], // 1 min
    existing: [],
    folioEventIds: new Set(),
    ...WINDOW,
  });
  const byId = new Map(plan.upserts.map((u) => [u.gcal_event_id, u]));
  assert.equal(byId.get("corto")?.duracion_min, 5);
});

test("un evento de varios días se PARTE en un bloqueo por día, no se trunca", () => {
  // Antes se recortaba a 1440 min y los otros dos días quedaban SIN bloquear:
  // la agenda seguía ofreciendo turnos en medio de las vacaciones. El CHECK de
  // `bloqueo` topa la duración en un día, así que un rango largo se expande.
  const plan = planInboundSync({
    events: [ev({ id: "larguisimo", end: new Date(T0 + DAY + 3 * DAY).toISOString() })],
    existing: [],
    folioEventIds: new Set(),
    ...WINDOW,
  });
  const segmentos = plan.upserts.filter((u) => u.gcal_event_id.startsWith("larguisimo"));
  assert.ok(segmentos.length > 1, "tiene que haber más de un bloqueo");
  for (const seg of segmentos) {
    assert.ok(seg.duracion_min >= 5 && seg.duracion_min <= 1440, `duración fuera del CHECK: ${seg.duracion_min}`);
  }
  // La clave lleva la fecha para que el upsert por (org, prof, gcal_event_id)
  // siga siendo idempotente: re-sincronizar no duplica bloqueos.
  const claves = new Set(segmentos.map((s) => s.gcal_event_id));
  assert.equal(claves.size, segmentos.length, "cada segmento necesita su propia clave");
});

test("título se trunca a 200 chars y summary vacío queda null", () => {
  const plan = planInboundSync({
    events: [
      ev({ id: "largo", summary: "x".repeat(300) }),
      ev({ id: "sin-titulo", summary: null }),
    ],
    existing: [],
    folioEventIds: new Set(),
    ...WINDOW,
  });
  const byId = new Map(plan.upserts.map((u) => [u.gcal_event_id, u]));
  assert.equal(byId.get("largo")?.titulo?.length, 200);
  assert.equal(byId.get("sin-titulo")?.titulo, null);
});

test("eventos duplicados por id: gana el último (Map dedup)", () => {
  const plan = planInboundSync({
    events: [
      ev({ id: "ev-1", summary: "primero" }),
      ev({ id: "ev-1", summary: "segundo" }),
    ],
    existing: [],
    folioEventIds: new Set(),
    ...WINDOW,
  });
  assert.equal(plan.upserts.length, 1);
  assert.equal(plan.upserts[0].titulo, "segundo");
});
