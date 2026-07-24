import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIMEROS_PASOS_MAX_DIAS,
  PRIMEROS_PASOS_MAX_TURNOS,
  computePrimerosPasos,
  esOrgJoven,
  type PrimerosPasosSnapshot,
} from "../../lib/primeros-pasos";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");
const DIA_MS = 24 * 60 * 60 * 1000;

/** Org recién creada, sin ninguna tarea hecha. */
const base: PrimerosPasosSnapshot = {
  tipo: "INDEPENDIENTE",
  onboardingCompleted: true,
  orgCreatedAt: new Date(NOW - 2 * DIA_MS).toISOString(),
  turnosTotal: 0,
  reservasOnline: 0,
  pacientesTotal: 0,
  gcalConectado: false,
  cobrosMpListos: false,
  equipoInvitado: false,
};

// ─── esOrgJoven ─────────────────────────────────────────────────────────────

test("org de 2 días → joven", () => {
  assert.equal(esOrgJoven(base.orgCreatedAt, NOW), true);
});

test("día 30 exacto → ya no es joven (ventana semiabierta)", () => {
  const creada = new Date(NOW - PRIMEROS_PASOS_MAX_DIAS * DIA_MS).toISOString();
  assert.equal(esOrgJoven(creada, NOW), false);
});

test("día 29 → todavía joven", () => {
  const creada = new Date(NOW - (PRIMEROS_PASOS_MAX_DIAS - 1) * DIA_MS).toISOString();
  assert.equal(esOrgJoven(creada, NOW), true);
});

test("fecha inválida → no joven (fail-safe: no molestar)", () => {
  assert.equal(esOrgJoven("", NOW), false);
  assert.equal(esOrgJoven("no-es-fecha", NOW), false);
});

test("fecha futura (clock skew de org recién creada) → joven", () => {
  const futura = new Date(NOW + DIA_MS).toISOString();
  assert.equal(esOrgJoven(futura, NOW), true);
});

// ─── Visibilidad ────────────────────────────────────────────────────────────

test("org joven sin nada hecho → visible con 5 pasos (INDEPENDIENTE)", () => {
  const estado = computePrimerosPasos(base, NOW);
  assert.equal(estado.visible, true);
  assert.equal(estado.total, 5);
  assert.equal(estado.completados, 0);
  assert.deepEqual(
    estado.pasos.map((p) => p.id),
    ["compartir_link", "primer_paciente", "primer_turno", "google_calendar", "cobros_mp"],
  );
});

test("onboarding incompleto → no visible", () => {
  const estado = computePrimerosPasos({ ...base, onboardingCompleted: false }, NOW);
  assert.equal(estado.visible, false);
});

test("org con >=30 días → no visible aunque no haya hecho nada", () => {
  const vieja = new Date(NOW - 31 * DIA_MS).toISOString();
  const estado = computePrimerosPasos({ ...base, orgCreatedAt: vieja }, NOW);
  assert.equal(estado.visible, false);
});

test("5 turnos creados → la org dejó de ser 'joven en actividad' → no visible", () => {
  const estado = computePrimerosPasos(
    { ...base, turnosTotal: PRIMEROS_PASOS_MAX_TURNOS },
    NOW,
  );
  assert.equal(estado.visible, false);
});

test("4 turnos creados → sigue visible", () => {
  const estado = computePrimerosPasos(
    { ...base, turnosTotal: PRIMEROS_PASOS_MAX_TURNOS - 1 },
    NOW,
  );
  assert.equal(estado.visible, true);
});

test("todo completo → desaparece sola aunque la org siga siendo joven", () => {
  const estado = computePrimerosPasos(
    {
      ...base,
      turnosTotal: 2,
      reservasOnline: 1,
      pacientesTotal: 3,
      gcalConectado: true,
      cobrosMpListos: true,
    },
    NOW,
  );
  assert.equal(estado.completados, 5);
  assert.equal(estado.visible, false);
});

// ─── Estado por tarea (datos reales, no localStorage) ───────────────────────

test("compartir_link se completa con una reserva BOOKING, no con turnos manuales", () => {
  const sinReserva = computePrimerosPasos({ ...base, turnosTotal: 3 }, NOW);
  assert.equal(sinReserva.pasos.find((p) => p.id === "compartir_link")?.done, false);

  const conReserva = computePrimerosPasos(
    { ...base, turnosTotal: 3, reservasOnline: 1 },
    NOW,
  );
  assert.equal(conReserva.pasos.find((p) => p.id === "compartir_link")?.done, true);
});

test("primer_paciente y primer_turno derivan de los counts", () => {
  const estado = computePrimerosPasos({ ...base, pacientesTotal: 1, turnosTotal: 1 }, NOW);
  assert.equal(estado.pasos.find((p) => p.id === "primer_paciente")?.done, true);
  assert.equal(estado.pasos.find((p) => p.id === "primer_turno")?.done, true);
  assert.equal(estado.pasos.find((p) => p.id === "google_calendar")?.done, false);
  assert.equal(estado.completados, 2);
});

test("google_calendar y cobros_mp derivan de integración/suscripción", () => {
  const estado = computePrimerosPasos(
    { ...base, gcalConectado: true, cobrosMpListos: true },
    NOW,
  );
  assert.equal(estado.pasos.find((p) => p.id === "google_calendar")?.done, true);
  assert.equal(estado.pasos.find((p) => p.id === "cobros_mp")?.done, true);
});

// ─── CLINICA ────────────────────────────────────────────────────────────────

test("CLINICA agrega invitar_equipo al final (6 pasos)", () => {
  const estado = computePrimerosPasos({ ...base, tipo: "CLINICA" }, NOW);
  assert.equal(estado.total, 6);
  assert.equal(estado.pasos.at(-1)?.id, "invitar_equipo");
  assert.equal(estado.pasos.at(-1)?.done, false);
});

test("CLINICA con equipo invitado marca el paso como hecho", () => {
  const estado = computePrimerosPasos(
    { ...base, tipo: "CLINICA", equipoInvitado: true },
    NOW,
  );
  assert.equal(estado.pasos.find((p) => p.id === "invitar_equipo")?.done, true);
});

test("CLINICA con 5/6: sigue visible hasta completar invitar_equipo", () => {
  const estado = computePrimerosPasos(
    {
      ...base,
      tipo: "CLINICA",
      turnosTotal: 1,
      reservasOnline: 1,
      pacientesTotal: 1,
      gcalConectado: true,
      cobrosMpListos: true,
      equipoInvitado: false,
    },
    NOW,
  );
  assert.equal(estado.completados, 5);
  assert.equal(estado.total, 6);
  assert.equal(estado.visible, true);
});

test("INDEPENDIENTE ignora equipoInvitado (no existe el paso)", () => {
  const estado = computePrimerosPasos({ ...base, equipoInvitado: true }, NOW);
  assert.equal(estado.pasos.some((p) => p.id === "invitar_equipo"), false);
  assert.equal(estado.completados, 0);
});
