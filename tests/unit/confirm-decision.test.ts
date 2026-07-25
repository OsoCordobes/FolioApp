/**
 * Folio · tests de la decisión pura de la página /t/[token] (F7b · M90).
 *
 * decideResultadoConfirmacion no toca DB ni reloj (nowMs inyectado) —
 * matriz completa accion × estado × (antes/después del inicio).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIRM_CAS_FROM,
  decideResultadoConfirmacion,
  type EstadoTurnoDb,
  type ResultadoConfirmacion,
} from "../../lib/booking/confirm-decision";

const ESTADOS: EstadoTurnoDb[] = [
  "AGENDADO",
  "CONFIRMADO",
  "EN_SALA",
  "ATENDIENDO",
  "CERRADO",
  "NO_ASISTIO",
  "CANCELADO",
  "REAGENDADO",
];

const NOW = 1_700_000_000_000;
const INICIO_FUTURO = NOW + 60 * 60 * 1000;

function decide(accion: "confirmar" | "cancelar", estado: string, inicioMs = INICIO_FUTURO) {
  return decideResultadoConfirmacion({ accion, estado, inicioMs, nowMs: NOW });
}

// ─── Matriz confirmar (turno todavía en el futuro) ──────────────────────────

const MATRIZ_CONFIRMAR: Record<EstadoTurnoDb, ResultadoConfirmacion> = {
  AGENDADO: "ejecutar",
  CONFIRMADO: "ya_confirmado",
  EN_SALA: "ya_confirmado",
  ATENDIENDO: "ya_confirmado",
  CERRADO: "no_disponible",
  NO_ASISTIO: "no_disponible",
  CANCELADO: "no_disponible",
  REAGENDADO: "no_disponible",
};

for (const estado of ESTADOS) {
  test(`confirmar × ${estado} → ${MATRIZ_CONFIRMAR[estado]}`, () => {
    assert.equal(decide("confirmar", estado), MATRIZ_CONFIRMAR[estado]);
  });
}

// ─── Matriz cancelar (turno todavía en el futuro) ───────────────────────────

const MATRIZ_CANCELAR: Record<EstadoTurnoDb, ResultadoConfirmacion> = {
  AGENDADO: "ejecutar",
  CONFIRMADO: "ejecutar",
  EN_SALA: "no_disponible",
  ATENDIENDO: "no_disponible",
  CERRADO: "no_disponible",
  NO_ASISTIO: "no_disponible",
  CANCELADO: "ya_cancelado",
  REAGENDADO: "no_disponible",
};

for (const estado of ESTADOS) {
  test(`cancelar × ${estado} → ${MATRIZ_CANCELAR[estado]}`, () => {
    assert.equal(decide("cancelar", estado), MATRIZ_CANCELAR[estado]);
  });
}

// ─── Turno ya pasado: gana sobre cualquier estado ───────────────────────────

test("inicio en el pasado → turno_pasado para toda accion × estado", () => {
  for (const accion of ["confirmar", "cancelar"] as const) {
    for (const estado of ESTADOS) {
      assert.equal(
        decide(accion, estado, NOW - 1),
        "turno_pasado",
        `${accion} × ${estado}`,
      );
    }
  }
});

test("borde: nowMs === inicioMs → turno_pasado (el token expira al inicio)", () => {
  assert.equal(decide("confirmar", "AGENDADO", NOW), "turno_pasado");
});

test("borde: inicio 1ms en el futuro → todavía ejecuta", () => {
  assert.equal(decide("confirmar", "AGENDADO", NOW + 1), "ejecutar");
});

// ─── Estados desconocidos: fail-safe ────────────────────────────────────────

test("estado desconocido → no_disponible (nunca ejecutar)", () => {
  for (const estado of ["", "agendado", "PENDIENTE", "???"]) {
    assert.equal(decide("confirmar", estado), "no_disponible", `confirmar × "${estado}"`);
    assert.equal(decide("cancelar", estado), "no_disponible", `cancelar × "${estado}"`);
  }
});

// ─── Consistencia decisión ↔ guard CAS ──────────────────────────────────────
// El .in("estado", CONFIRM_CAS_FROM[accion]) de la action y la decisión de la
// página tienen que coincidir EXACTAMENTE: si divergen, o mostramos un botón
// que después no-opea, o el CAS escribe desde un estado que la página negó.

test("CONFIRM_CAS_FROM[accion] ≡ estados que deciden 'ejecutar'", () => {
  for (const accion of ["confirmar", "cancelar"] as const) {
    const ejecutan = ESTADOS.filter((e) => decide(accion, e) === "ejecutar").sort();
    const cas = [...CONFIRM_CAS_FROM[accion]].sort();
    assert.deepEqual(ejecutan, cas, `accion: ${accion}`);
  }
});
