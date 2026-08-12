/**
 * Folio · tests · elección del turno ANCLA del guardado de la ficha
 * (lib/db/paciente-ficha.ts → elegirTurnoAncla — feedback quiro jul-2026).
 *
 * La ficha ya no se bloquea sin turno en curso: guarda contra una cascada de
 * anclas. Invariantes cubiertas:
 *
 *   1. en_curso    — EN_SALA/ATENDIENDO gana siempre (comportamiento histórico).
 *   2. por_iniciar — AGENDADO/CONFIRMADO cuentan SOLO si su inicio cae HOY en
 *                    la tz de la org (un turno de mañana NO ancla: escribir la
 *                    visita de hoy sobre el turno de mañana sería corrupción).
 *                    Borde tz: 23:30 AR es madrugada UTC del día siguiente.
 *   3. retroactivo — el CERRADO más reciente con sesión editable (sin sesión o
 *                    locked_at null). Sesión lockeada → null, SIN caer a un
 *                    cerrado más viejo.
 *   4. CANCELADO / NO_ASISTIO / REAGENDADO nunca anclan.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { elegirTurnoAncla } from "../../lib/db/paciente-ficha";

const TZ = "America/Argentina/Buenos_Aires";

// Mediodía AR fijo (15:00Z = 12:00 AR, sin DST en Argentina).
const AHORA = new Date("2026-07-03T15:00:00.000Z");

function turno(id: string, estado: string, inicio: string) {
  return { id, estado, inicio };
}

// ─── 1. en_curso ─────────────────────────────────────────────────────────────

test("en_curso: ATENDIENDO gana sobre cualquier otra ancla", () => {
  const res = elegirTurnoAncla(
    [
      turno("agendado-hoy", "AGENDADO", "2026-07-03T18:00:00+00:00"),
      turno("atendiendo", "ATENDIENDO", "2026-07-03T14:00:00+00:00"),
      turno("cerrado", "CERRADO", "2026-06-20T14:00:00+00:00"),
    ],
    [],
    AHORA,
    TZ,
  );
  assert.equal(res?.turno.id, "atendiendo");
  assert.equal(res?.modo, "en_curso");
});

test("en_curso: EN_SALA también cuenta como turno en curso", () => {
  const res = elegirTurnoAncla(
    [turno("en-sala", "EN_SALA", "2026-07-03T14:00:00+00:00")],
    [],
    AHORA,
    TZ,
  );
  assert.equal(res?.turno.id, "en-sala");
  assert.equal(res?.modo, "en_curso");
});

// ─── 2. por_iniciar ──────────────────────────────────────────────────────────

test("por_iniciar: AGENDADO de hoy ancla; el guardado inicia la atención", () => {
  const res = elegirTurnoAncla(
    [
      turno("hoy", "AGENDADO", "2026-07-03T18:00:00+00:00"), // 15:00 AR
      turno("cerrado", "CERRADO", "2026-06-20T14:00:00+00:00"),
    ],
    [],
    AHORA,
    TZ,
  );
  assert.equal(res?.turno.id, "hoy");
  assert.equal(res?.modo, "por_iniciar");
});

test("por_iniciar: CONFIRMADO de hoy también ancla", () => {
  const res = elegirTurnoAncla(
    [turno("hoy", "CONFIRMADO", "2026-07-03T13:00:00+00:00")],
    [],
    AHORA,
    TZ,
  );
  assert.equal(res?.turno.id, "hoy");
  assert.equal(res?.modo, "por_iniciar");
});

test("por_iniciar: un AGENDADO de MAÑANA no ancla (cae al cerrado editable)", () => {
  const res = elegirTurnoAncla(
    [
      turno("maniana", "AGENDADO", "2026-07-04T18:00:00+00:00"),
      turno("cerrado", "CERRADO", "2026-06-20T14:00:00+00:00"),
    ],
    [],
    AHORA,
    TZ,
  );
  assert.equal(res?.turno.id, "cerrado");
  assert.equal(res?.modo, "retroactivo");
});

test("por_iniciar · borde tz: 23:30 AR de hoy (02:30Z de mañana) sigue siendo hoy", () => {
  // 2026-07-04T02:30:00Z == 2026-07-03 23:30 en AR (UTC-3).
  const res = elegirTurnoAncla(
    [turno("noche", "AGENDADO", "2026-07-04T02:30:00+00:00")],
    [],
    AHORA,
    TZ,
  );
  assert.equal(res?.turno.id, "noche");
  assert.equal(res?.modo, "por_iniciar");
});

test("por_iniciar: con varios turnos hoy, ancla el más cercano a ahora", () => {
  const res = elegirTurnoAncla(
    [
      // DESC por inicio, como los lee getPacienteFicha.
      turno("tarde", "AGENDADO", "2026-07-03T21:00:00+00:00"),  // 18:00 AR (a 6h)
      turno("cercano", "AGENDADO", "2026-07-03T16:00:00+00:00"), // 13:00 AR (a 1h)
      turno("temprano", "AGENDADO", "2026-07-03T11:00:00+00:00"), // 08:00 AR (hace 4h)
    ],
    [],
    AHORA,
    TZ,
  );
  assert.equal(res?.turno.id, "cercano");
});

test("por_iniciar: una timezone inválida cae al default AR sin tirar", () => {
  const res = elegirTurnoAncla(
    [turno("hoy", "AGENDADO", "2026-07-03T18:00:00+00:00")],
    [],
    AHORA,
    "No/Existe",
  );
  assert.equal(res?.turno.id, "hoy");
  assert.equal(res?.modo, "por_iniciar");
});

// ─── 3. retroactivo ──────────────────────────────────────────────────────────

test("retroactivo: el CERRADO más reciente sin sesión ancla (ficha nunca guardada)", () => {
  const res = elegirTurnoAncla(
    [
      turno("cerrado-nuevo", "CERRADO", "2026-06-25T14:00:00+00:00"),
      turno("cerrado-viejo", "CERRADO", "2026-06-10T14:00:00+00:00"),
    ],
    [],
    AHORA,
    TZ,
  );
  assert.equal(res?.turno.id, "cerrado-nuevo");
  assert.equal(res?.modo, "retroactivo");
});

test("retroactivo: sesión existente NO lockeada sigue siendo editable", () => {
  const res = elegirTurnoAncla(
    [turno("cerrado", "CERRADO", "2026-06-25T14:00:00+00:00")],
    [{ turno_id: "cerrado", locked_at: null }],
    AHORA,
    TZ,
  );
  assert.equal(res?.turno.id, "cerrado");
  assert.equal(res?.modo, "retroactivo");
});

test("retroactivo: sesión lockeada → null, SIN caer a un cerrado más viejo", () => {
  const res = elegirTurnoAncla(
    [
      turno("cerrado-nuevo", "CERRADO", "2026-06-25T14:00:00+00:00"),
      turno("cerrado-viejo", "CERRADO", "2026-06-10T14:00:00+00:00"),
    ],
    [{ turno_id: "cerrado-nuevo", locked_at: "2026-06-25T15:00:00+00:00" }],
    AHORA,
    TZ,
  );
  assert.equal(res, null);
});

// ─── 4. estados que nunca anclan / sin turnos ────────────────────────────────

test("CANCELADO, NO_ASISTIO y REAGENDADO nunca anclan", () => {
  const res = elegirTurnoAncla(
    [
      turno("cancelado", "CANCELADO", "2026-07-03T16:00:00+00:00"),
      turno("no-asistio", "NO_ASISTIO", "2026-07-02T14:00:00+00:00"),
      turno("reagendado", "REAGENDADO", "2026-07-01T14:00:00+00:00"),
    ],
    [],
    AHORA,
    TZ,
  );
  assert.equal(res, null);
});

test("sin turnos → null (la ficha queda read-only con CTA)", () => {
  assert.equal(elegirTurnoAncla([], [], AHORA, TZ), null);
});

// ─── 5. B3 · el ancla no roba la visita atendida ni factura un ausente ───────
//
// Antes, CUALQUIER turno AGENDADO de hoy ganaba sin mirar la hora. Con dos
// turnos el mismo día —un no-show a las 08:00 y la visita real de las 16:00—,
// a las 19:00 la ficha anclaba al no-show: la nota se colgaba del turno
// equivocado y, al guardar, la action lo empujaba a EN_SALA→ATENDIENDO. Con
// "Guardar y cerrar" quedaba CERRADO y con fila `pago`: un ausente facturado,
// contaminando /finanzas y la métrica de ausentismo.

// 19:00 AR = 22:00Z.
const TARDE = new Date("2026-07-03T22:00:00.000Z");

test("doble turno: el no-show de la mañana no le roba el ancla a la visita cerrada", () => {
  const res = elegirTurnoAncla(
    [
      // DESC por inicio, como los lee getPacienteFicha.
      turno("visita-real", "CERRADO", "2026-07-03T19:00:00+00:00"), // 16:00 AR
      turno("no-show", "AGENDADO", "2026-07-03T11:00:00+00:00"), //    08:00 AR
    ],
    [],
    TARDE,
    TZ,
  );
  assert.equal(res?.turno.id, "visita-real");
  assert.equal(res?.modo, "retroactivo");
});

test("un AGENDADO de hoy que ya venció no ancla como 'por iniciar'", () => {
  // Sin ningún CERRADO: el turno de la mañana que nadie marcó ya no es la
  // visita de hoy, así que la ficha queda read-only en vez de mentir con
  // "turno de hoy, sin iniciar" y empujar a ATENDIENDO al guardar.
  const res = elegirTurnoAncla(
    [turno("no-show", "AGENDADO", "2026-07-03T11:00:00+00:00")],
    [],
    TARDE,
    TZ,
  );
  assert.equal(res, null);
});

test("el margen cubre al profesional que arranca tarde", () => {
  // 12:00 AR y el turno era 11:00 AR: una hora de atraso sigue siendo la visita
  // de hoy. Si el margen fuera demasiado corto, la ficha dejaría de anclar
  // justo cuando el profesional la necesita.
  const res = elegirTurnoAncla(
    [turno("turno-11", "AGENDADO", "2026-07-03T14:00:00+00:00")], // 11:00 AR
    [],
    AHORA, // 12:00 AR
    TZ,
  );
  assert.equal(res?.turno.id, "turno-11");
  assert.equal(res?.modo, "por_iniciar");
});

test("un turno próximo del mismo día gana sobre un CERRADO anterior", () => {
  // Regresión del comportamiento correcto: si el turno de hoy todavía no pasó,
  // la ficha edita ESA visita, no la anterior.
  const res = elegirTurnoAncla(
    [
      turno("turno-16", "AGENDADO", "2026-07-03T19:00:00+00:00"), // 16:00 AR, futuro
      turno("cerrado-viejo", "CERRADO", "2026-06-20T14:00:00+00:00"),
    ],
    [],
    AHORA, // 12:00 AR
    TZ,
  );
  assert.equal(res?.turno.id, "turno-16");
  assert.equal(res?.modo, "por_iniciar");
});

test("con el CERRADO de hoy lockeado, un AGENDADO vencido no se cuela", () => {
  // La sesión de la visita real está cerrada bajo llave (locked_at): la ficha
  // tiene que quedar read-only, NO caer al no-show de la mañana.
  const res = elegirTurnoAncla(
    [
      turno("visita-real", "CERRADO", "2026-07-03T19:00:00+00:00"),
      turno("no-show", "AGENDADO", "2026-07-03T11:00:00+00:00"),
    ],
    [{ turno_id: "visita-real", locked_at: "2026-07-03T20:00:00.000Z" }],
    TARDE,
    TZ,
  );
  assert.equal(res, null);
});
