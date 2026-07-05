/**
 * Folio · unit de decideUpgradeTipo (PR 1.4 · upgrade self-serve a Clínica).
 *
 * Cubre: roles (solo OWNER), tipos (solo INDEPENDIENTE→CLINICA), montos por
 * seats con la base de Clínica que INCLUYE al titular, y el downgrade con
 * motivo "vía soporte".
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  decideUpgradeTipo,
  type MemberRol,
} from "../../lib/billing/upgrade";
import { computeMonthlyPriceCents } from "../../lib/billing/pricing";
import { MP_PLAN_PRICE_CENTS } from "../../lib/mercadopago/client";
import type { EstadoSuscripcion } from "../../lib/db/suscripcion";

const BASE_DEFAULT = 10_000_000; // ARS 100.000 (base Clínica, cubre al titular)
const SEAT_DEFAULT = 2_500_000; //  ARS 25.000 por seat adicional

function clearEnv() {
  delete process.env.CLINIC_BASE_PRICE_CENTS;
  delete process.env.CLINIC_SEAT_PRICE_CENTS;
}

const NON_OWNER_ROLES: MemberRol[] = ["DIRECTOR", "PROFESIONAL", "COORDINADOR", "ASISTENTE"];
const TODOS_LOS_ESTADOS: (EstadoSuscripcion | null)[] = [
  "PENDIENTE_ACTIVACION",
  "ACTIVA",
  "PAUSADA",
  "CANCELADA",
  "MOROSA",
  null,
];

// ─── Elegibilidad: OWNER + INDEPENDIENTE → CLINICA ──────────────────────────

test("OWNER de INDEPENDIENTE es elegible para pasar a Clínica", () => {
  clearEnv();
  const r = decideUpgradeTipo({
    tipoActual: "INDEPENDIENTE",
    rol: "OWNER",
    membersActivos: 1,
    estadoSuscripcion: "ACTIVA",
  });
  assert.equal(r.elegible, true);
  assert.equal(r.motivo, undefined);
});

test("elegible en CUALQUIER estado de suscripción (incluido null)", () => {
  clearEnv();
  for (const estado of TODOS_LOS_ESTADOS) {
    const r = decideUpgradeTipo({
      tipoActual: "INDEPENDIENTE",
      rol: "OWNER",
      membersActivos: 1,
      estadoSuscripcion: estado,
    });
    assert.equal(r.elegible, true, `estado ${estado} debería ser elegible`);
  }
});

// ─── Rol: solo OWNER ────────────────────────────────────────────────────────

test("ningún rol distinto de OWNER puede upgradear (INDEPENDIENTE)", () => {
  clearEnv();
  for (const rol of NON_OWNER_ROLES) {
    const r = decideUpgradeTipo({
      tipoActual: "INDEPENDIENTE",
      rol,
      membersActivos: 1,
      estadoSuscripcion: "ACTIVA",
    });
    assert.equal(r.elegible, false, `rol ${rol} NO debería ser elegible`);
    assert.match(r.motivo ?? "", /titular/i);
  }
});

// ─── Tipo: solo INDEPENDIENTE → CLINICA (downgrade vía soporte) ──────────────

test("CLINICA no es elegible (downgrade) — motivo vía soporte, para OWNER", () => {
  clearEnv();
  const r = decideUpgradeTipo({
    tipoActual: "CLINICA",
    rol: "OWNER",
    membersActivos: 3,
    estadoSuscripcion: "ACTIVA",
  });
  assert.equal(r.elegible, false);
  assert.match(r.motivo ?? "", /soporte/i);
});

test("downgrade gana sobre el chequeo de rol: CLINICA + no-OWNER también da 'vía soporte'", () => {
  clearEnv();
  // Verifica el ORDEN de las reglas: el tipo se evalúa antes que el rol, así
  // que un ASISTENTE en CLINICA recibe el motivo de downgrade, no el de rol.
  const r = decideUpgradeTipo({
    tipoActual: "CLINICA",
    rol: "ASISTENTE",
    membersActivos: 2,
    estadoSuscripcion: "MOROSA",
  });
  assert.equal(r.elegible, false);
  assert.match(r.motivo ?? "", /soporte/i);
});

// ─── Montos: consistentes con pricing.ts (base incluye titular) ─────────────

test("montoAntes = plan Solo vigente; montoDespues = base Clínica (1 seat = solo titular)", () => {
  clearEnv();
  const r = decideUpgradeTipo({
    tipoActual: "INDEPENDIENTE",
    rol: "OWNER",
    membersActivos: 1,
    estadoSuscripcion: "ACTIVA",
  });
  assert.equal(r.montoAntes, MP_PLAN_PRICE_CENTS);
  // 1 seat = solo el titular → base, sin adicionales.
  assert.equal(r.montoDespues, BASE_DEFAULT);
});

test("montoDespues suma un seat de 25.000 por cada member activo ADEMÁS del titular", () => {
  clearEnv();
  const r2 = decideUpgradeTipo({
    tipoActual: "INDEPENDIENTE",
    rol: "OWNER",
    membersActivos: 2,
    estadoSuscripcion: "ACTIVA",
  });
  assert.equal(r2.montoDespues, BASE_DEFAULT + SEAT_DEFAULT);

  const r4 = decideUpgradeTipo({
    tipoActual: "INDEPENDIENTE",
    rol: "OWNER",
    membersActivos: 4,
    estadoSuscripcion: "ACTIVA",
  });
  assert.equal(r4.montoDespues, BASE_DEFAULT + 3 * SEAT_DEFAULT);
});

test("montos coinciden exactamente con computeMonthlyPriceCents (fuente de verdad)", () => {
  clearEnv();
  for (const seats of [1, 2, 3, 5, 8]) {
    const r = decideUpgradeTipo({
      tipoActual: "INDEPENDIENTE",
      rol: "OWNER",
      membersActivos: seats,
      estadoSuscripcion: "ACTIVA",
    });
    assert.equal(r.montoAntes, computeMonthlyPriceCents("INDEPENDIENTE", seats));
    assert.equal(r.montoDespues, computeMonthlyPriceCents("CLINICA", seats));
  }
});

test("montos se calculan incluso cuando NO es elegible (para display)", () => {
  clearEnv();
  // No-OWNER: no elegible, pero los montos siguen presentes.
  const r = decideUpgradeTipo({
    tipoActual: "INDEPENDIENTE",
    rol: "PROFESIONAL",
    membersActivos: 3,
    estadoSuscripcion: "ACTIVA",
  });
  assert.equal(r.elegible, false);
  assert.equal(r.montoAntes, MP_PLAN_PRICE_CENTS);
  assert.equal(r.montoDespues, BASE_DEFAULT + 2 * SEAT_DEFAULT);
});

test("respeta overrides de pricing por env (base/seat) en los montos", () => {
  process.env.CLINIC_BASE_PRICE_CENTS = "20000000";
  process.env.CLINIC_SEAT_PRICE_CENTS = "1000000";
  try {
    const r = decideUpgradeTipo({
      tipoActual: "INDEPENDIENTE",
      rol: "OWNER",
      membersActivos: 3,
      estadoSuscripcion: "ACTIVA",
    });
    assert.equal(r.montoDespues, 20_000_000 + 2 * 1_000_000);
  } finally {
    clearEnv();
  }
});
