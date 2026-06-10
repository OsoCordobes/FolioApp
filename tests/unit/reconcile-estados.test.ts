/**
 * A2 (docs/AUDIT.md): el cron de reconciliación re-chequea contra MP todos los
 * estados NO terminales. Estos tests fijan el contrato de RECONCILABLE_ESTADOS:
 * si alguien agrega un estado nuevo a EstadoSuscripcion o saca uno de la lista,
 * tiene que decidir conscientemente si el cron lo cubre.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { RECONCILABLE_ESTADOS, type EstadoSuscripcion } from "../../lib/db/suscripcion";

test("reconcilia todos los estados no terminales (webhook perdido en ambas direcciones)", () => {
  // PENDIENTE_ACTIVACION: webhook de activación perdido → cliente paga sin acceso.
  // ACTIVA: webhook de cancelación/pausa perdido → acceso sin pago.
  // PAUSADA/MOROSA: recuperación o cancelación que no llegó.
  for (const estado of ["PENDIENTE_ACTIVACION", "ACTIVA", "PAUSADA", "MOROSA"] as const) {
    assert.ok(RECONCILABLE_ESTADOS.includes(estado), `falta ${estado} en RECONCILABLE_ESTADOS`);
  }
});

test("CANCELADA es terminal y NO se reconcilia", () => {
  assert.equal(RECONCILABLE_ESTADOS.includes("CANCELADA"), false);
});

test("la lista no tiene duplicados", () => {
  assert.equal(new Set(RECONCILABLE_ESTADOS).size, RECONCILABLE_ESTADOS.length);
});

test("cada entrada es un EstadoSuscripcion válido (chequeo de tipos en compile-time)", () => {
  // El type annotation de RECONCILABLE_ESTADOS ya fuerza esto en tsc; acá solo
  // documentamos el contrato en runtime.
  const valid: EstadoSuscripcion[] = ["PENDIENTE_ACTIVACION", "ACTIVA", "PAUSADA", "CANCELADA", "MOROSA"];
  for (const estado of RECONCILABLE_ESTADOS) {
    assert.ok(valid.includes(estado), `${estado} no es un EstadoSuscripcion`);
  }
});
