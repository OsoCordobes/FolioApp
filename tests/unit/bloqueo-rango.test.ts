/**
 * Folio · rangos de bloqueo de agenda (D1).
 *
 * Acá vive el bug clásico de todo código que toca fechas de Google: el
 * `end.date` de un evento all-day es **EXCLUSIVO**. Unas vacaciones del 20 al
 * 22 llegan como `start=20, end=23`. Interpretarlo mal es la diferencia entre
 * bloquear tres días y bloquear cuatro — o dos.
 *
 * Y el segundo: el corte de día tiene que ser el del CONSULTORIO, no el UTC. En
 * Argentina la medianoche local es las 03:00 UTC, así que un all-day
 * interpretado en UTC arrancaría a las 21:00 del día anterior.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOQUEO_DURACION_MAX,
  BLOQUEO_DURACION_MIN,
  esFechaIso,
  fechaLocalEnTz,
  medianocheLocalUtcMs,
  partirRangoEnBloqueos,
  rangoDeDiasCompletos,
  sumarDiasIso,
} from "../../lib/agenda/bloqueo-rango";
import { rangoDeEvento } from "../../lib/google/inbound";

const TZ = "America/Argentina/Buenos_Aires";

// ─── Fechas locales ─────────────────────────────────────────────────────────

test("la medianoche local de Argentina son las 03:00 UTC, no las 00:00", () => {
  const ms = medianocheLocalUtcMs("2026-07-20", TZ);
  assert.equal(new Date(ms).toISOString(), "2026-07-20T03:00:00.000Z");
});

test("fechaLocalEnTz devuelve el día del consultorio, no el UTC", () => {
  // 01:00 UTC del 21 es todavía el 20 a las 22:00 en Argentina.
  const ms = Date.parse("2026-07-21T01:00:00.000Z");
  assert.equal(fechaLocalEnTz(ms, TZ), "2026-07-20");
});

test("sumarDiasIso cruza fin de mes y año bisiesto", () => {
  assert.equal(sumarDiasIso("2026-01-31", 1), "2026-02-01");
  assert.equal(sumarDiasIso("2028-02-28", 1), "2028-02-29");
  assert.equal(sumarDiasIso("2026-12-31", 1), "2027-01-01");
});

test("esFechaIso acepta YYYY-MM-DD y rechaza lo demás", () => {
  assert.equal(esFechaIso("2026-07-20"), true);
  for (const malo of ["2026-7-20", "20/07/2026", "2026-07-20T10:00:00Z", "", null, undefined]) {
    assert.equal(esFechaIso(malo as string), false, String(malo));
  }
});

// ─── El end EXCLUSIVO de Google ─────────────────────────────────────────────
//
// La conversión "end exclusivo → último día inclusive" vive en `rangoDeEvento`
// (lib/google/inbound.ts), que es quien habla con la forma de Google.
// `rangoDeDiasCompletos` recibe el último día INCLUSIVE.

function allDay(start: string, end: string | null) {
  return rangoDeEvento(
    { id: "x", start, end, allDay: true, summary: null, transparency: null } as never,
    TZ,
  );
}

test("un all-day de un solo día: start=20, end=21 → bloquea SOLO el 20", () => {
  const r = allDay("2026-07-20", "2026-07-21");
  assert.ok(r);
  assert.equal(new Date(r.desdeMs).toISOString(), "2026-07-20T03:00:00.000Z");
  assert.equal(new Date(r.hastaMs).toISOString(), "2026-07-21T03:00:00.000Z");
});

test("vacaciones del 20 al 22 llegan como end=23 y son TRES días, no cuatro", () => {
  const r = allDay("2026-07-20", "2026-07-23");
  assert.ok(r);
  const dias = (r.hastaMs - r.desdeMs) / (24 * 60 * 60 * 1000);
  assert.equal(dias, 3, "el end de Google es EXCLUSIVO");
});

test("un all-day sin end no se pierde: se asume un día", () => {
  // Google casi siempre manda end, pero un evento sin él no puede desaparecer
  // en silencio — sería una ausencia que la agenda ignora.
  const r = allDay("2026-07-20", null);
  assert.ok(r, "tiene que producir un rango");
  assert.equal((r.hastaMs - r.desdeMs) / (24 * 60 * 60 * 1000), 1);
});

test("rangoDeDiasCompletos recibe el último día INCLUSIVE", () => {
  const r = rangoDeDiasCompletos("2026-07-20", "2026-07-22", TZ);
  assert.ok(r);
  assert.equal((r.hastaMs - r.desdeMs) / (24 * 60 * 60 * 1000), 3);
});

test("un end anterior al start no produce rango", () => {
  assert.equal(rangoDeDiasCompletos("2026-07-23", "2026-07-20", TZ), null);
});

// ─── Partido en bloqueos ────────────────────────────────────────────────────

function rango(desde: string, hasta: string) {
  return {
    desdeMs: medianocheLocalUtcMs(desde, TZ),
    hastaMs: medianocheLocalUtcMs(hasta, TZ),
  };
}

test("un rango de un día produce UN bloqueo de 1440 minutos", () => {
  const segs = partirRangoEnBloqueos({ ...rango("2026-07-20", "2026-07-21"), timeZone: TZ });
  assert.equal(segs.length, 1);
  assert.equal(segs[0].duracionMin, BLOQUEO_DURACION_MAX);
  assert.equal(segs[0].fechaLocal, "2026-07-20");
});

test("tres días producen TRES bloqueos, uno por día", () => {
  // El CHECK de `bloqueo` topa la duración en 1440 min. Truncar en vez de
  // partir dejaba los otros dos días SIN bloquear: la agenda seguía ofreciendo
  // turnos en medio de las vacaciones.
  const segs = partirRangoEnBloqueos({ ...rango("2026-07-20", "2026-07-23"), timeZone: TZ });
  assert.equal(segs.length, 3);
  assert.deepEqual(
    segs.map((s) => s.fechaLocal),
    ["2026-07-20", "2026-07-21", "2026-07-22"],
  );
  for (const s of segs) assert.equal(s.duracionMin, BLOQUEO_DURACION_MAX);
});

test("ningún segmento viola el CHECK de duración de la tabla", () => {
  const segs = partirRangoEnBloqueos({ ...rango("2026-07-20", "2026-08-05"), timeZone: TZ });
  assert.ok(segs.length > 1);
  for (const s of segs) {
    assert.ok(
      s.duracionMin >= BLOQUEO_DURACION_MIN && s.duracionMin <= BLOQUEO_DURACION_MAX,
      `duración fuera del CHECK: ${s.duracionMin}`,
    );
  }
});

test("los segmentos son contiguos y no se solapan", () => {
  // Un hueco entre segmentos es un turno que se puede reservar en medio de las
  // vacaciones; un solapamiento rompería el EXCLUDE de la tabla.
  const segs = partirRangoEnBloqueos({ ...rango("2026-07-20", "2026-07-25"), timeZone: TZ });
  for (let i = 1; i < segs.length; i++) {
    const finAnterior = segs[i - 1].inicioMs + segs[i - 1].duracionMin * 60_000;
    assert.equal(finAnterior, segs[i].inicioMs, `hueco o solapamiento entre el segmento ${i - 1} y el ${i}`);
  }
});

test("un rango vacío o invertido no produce segmentos", () => {
  const t = medianocheLocalUtcMs("2026-07-20", TZ);
  assert.deepEqual(partirRangoEnBloqueos({ desdeMs: t, hastaMs: t, timeZone: TZ }), []);
  assert.deepEqual(
    partirRangoEnBloqueos({ desdeMs: t, hastaMs: t - 1000, timeZone: TZ }),
    [],
  );
});
