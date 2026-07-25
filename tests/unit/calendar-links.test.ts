import assert from "node:assert/strict";
import test from "node:test";

import {
  addMinutesIso,
  buildGoogleCalendarUrl,
  buildIcsContent,
  buildIcsDataUri,
  toIcsUtc,
} from "../../lib/booking/calendar-links";

// Fechas inyectadas (nunca Date.now): 10 jun 2026 10:00-10:30 AR = 13:00-13:30 UTC.
const evento = {
  inicioIso: "2026-06-10T13:00:00.000Z",
  finIso: "2026-06-10T13:30:00.000Z",
  titulo: "Consulta inicial · Consultorio Lorenzo",
  ubicacion: "Av. Siempreviva 742, Córdoba",
};

// ─── toIcsUtc / addMinutesIso ───────────────────────────────────────────────

test("toIcsUtc: ISO → formato iCalendar UTC básico", () => {
  assert.equal(toIcsUtc("2026-06-10T13:00:00.000Z"), "20260610T130000Z");
  // Acepta ISO con offset y normaliza a UTC (10:00 -03:00 = 13:00 Z).
  assert.equal(toIcsUtc("2026-06-10T10:00:00-03:00"), "20260610T130000Z");
});

test("addMinutesIso: computa el fin desde duracion_min, cruzando horas y días", () => {
  assert.equal(addMinutesIso("2026-06-10T13:00:00.000Z", 30), "2026-06-10T13:30:00.000Z");
  assert.equal(addMinutesIso("2026-06-10T23:45:00.000Z", 30), "2026-06-11T00:15:00.000Z");
});

// ─── buildGoogleCalendarUrl ─────────────────────────────────────────────────

test("buildGoogleCalendarUrl: render?action=TEMPLATE con fechas UTC y datos del turno", () => {
  const url = buildGoogleCalendarUrl(evento);
  assert.ok(url.startsWith("https://calendar.google.com/calendar/render?"));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("action"), "TEMPLATE");
  assert.equal(parsed.searchParams.get("text"), evento.titulo);
  assert.equal(parsed.searchParams.get("dates"), "20260610T130000Z/20260610T133000Z");
  assert.equal(parsed.searchParams.get("location"), evento.ubicacion);
});

test("buildGoogleCalendarUrl: sin ubicacion no agrega location", () => {
  const url = buildGoogleCalendarUrl({ ...evento, ubicacion: null });
  assert.ok(!new URL(url).searchParams.has("location"));
});

// ─── buildIcsContent ────────────────────────────────────────────────────────

test("buildIcsContent: VEVENT con DTSTART/DTEND/SUMMARY/LOCATION y envoltura VCALENDAR", () => {
  const ics = buildIcsContent(evento);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.includes("BEGIN:VEVENT\r\n"));
  assert.ok(ics.includes("DTSTART:20260610T130000Z\r\n"));
  assert.ok(ics.includes("DTEND:20260610T133000Z\r\n"));
  assert.ok(ics.includes("SUMMARY:Consulta inicial · Consultorio Lorenzo\r\n"));
  // La coma de la dirección va escapada (RFC 5545 §3.3.11).
  assert.ok(ics.includes("LOCATION:Av. Siempreviva 742\\, Córdoba\r\n"));
  assert.ok(ics.includes("END:VEVENT\r\n"));
});

test("buildIcsContent: determinístico — UID/DTSTAMP derivan del evento, sin Date.now", () => {
  const a = buildIcsContent(evento);
  const b = buildIcsContent(evento);
  assert.equal(a, b);
  assert.ok(a.includes("UID:20260610T130000Z-20260610T133000Z@folio\r\n"));
  assert.ok(a.includes("DTSTAMP:20260610T130000Z\r\n"));
});

test("buildIcsContent: escapa ; , \\ y saltos de línea en los campos TEXT", () => {
  const ics = buildIcsContent({
    ...evento,
    titulo: "Turno; con, cosas\\raras",
    descripcion: "línea 1\nlínea 2",
  });
  assert.ok(ics.includes("SUMMARY:Turno\\; con\\, cosas\\\\raras\r\n"));
  assert.ok(ics.includes("DESCRIPTION:línea 1\\nlínea 2\r\n"));
});

test("buildIcsContent: sin ubicacion/descripcion omite LOCATION/DESCRIPTION", () => {
  const ics = buildIcsContent({ ...evento, ubicacion: null, descripcion: null });
  assert.ok(!ics.includes("LOCATION:"));
  assert.ok(!ics.includes("DESCRIPTION:"));
});

// ─── buildIcsDataUri ────────────────────────────────────────────────────────

test("buildIcsDataUri: data-URI text/calendar con el contenido URI-encodeado", () => {
  const ics = buildIcsContent(evento);
  const uri = buildIcsDataUri(ics);
  assert.ok(uri.startsWith("data:text/calendar;charset=utf-8,"));
  assert.equal(decodeURIComponent(uri.slice("data:text/calendar;charset=utf-8,".length)), ics);
});
