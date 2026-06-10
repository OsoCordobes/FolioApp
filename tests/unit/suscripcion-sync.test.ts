/**
 * Fase E · E2 — cobro Clinic variable por seats.
 *
 * Fija el contrato de las dos decisiones puras de lib/db/suscripcion.ts:
 *
 *   1. decideSubscriptionAmountSync — cuándo corresponde el PUT del monto al
 *      proveedor. Regla dura: INDEPENDIENTE jamás se toca (cero cambio de
 *      comportamiento para el plan Solo legacy), y solo ACTIVA/MOROSA con
 *      mp_preapproval_id son elegibles.
 *
 *   2. validateChargeAmount — M-BILL-2 per-org: cada cargo del webhook se
 *      valida contra `suscripcion.monto_cents` de ESA org (Solo 30K o Clinic
 *      base+seats), tolerancia ±1 centavo, moneda ARS.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { computeMonthlyPriceCents } from "../../lib/billing/pricing";
import {
  decideSubscriptionAmountSync,
  validateChargeAmount,
  type EstadoSuscripcion,
} from "../../lib/db/suscripcion";
import { MP_PLAN_PRICE_CENTS } from "../../lib/mercadopago/client";

const SOLO_CENTS = 3_000_000; //  ARS 30.000 (default del plan Solo)
const CLINIC_3_SEATS_CENTS = 15_000_000; // ARS 150.000 = base 100K + 2 seats × 25K

function clearPricingEnv() {
  delete process.env.CLINIC_BASE_PRICE_CENTS;
  delete process.env.CLINIC_SEAT_PRICE_CENTS;
}

function sub(overrides: Partial<{
  estado: EstadoSuscripcion;
  montoCents: number;
  mpPreapprovalId: string | null;
}> = {}) {
  return {
    estado: "ACTIVA" as EstadoSuscripcion,
    montoCents: 10_000_000,
    mpPreapprovalId: "pre-123",
    ...overrides,
  };
}

// ─── decideSubscriptionAmountSync ────────────────────────────────────────────

test("sync: INDEPENDIENTE jamás se sincroniza, aunque el monto difiera y el estado sea elegible", () => {
  const d = decideSubscriptionAmountSync({
    tipo: "INDEPENDIENTE",
    expectedCents: SOLO_CENTS,
    subscription: sub({ estado: "ACTIVA", montoCents: 999_999 }), // drift deliberado
  });
  assert.deepEqual(d, { action: "skip", reason: "org_independiente" });
});

test("sync: CLINICA sin suscripción → skip sin_suscripcion", () => {
  const d = decideSubscriptionAmountSync({
    tipo: "CLINICA",
    expectedCents: CLINIC_3_SEATS_CENTS,
    subscription: null,
  });
  assert.deepEqual(d, { action: "skip", reason: "sin_suscripcion" });
});

test("sync: CLINICA sin mp_preapproval_id → skip sin_preapproval (nada que PUTear)", () => {
  const d = decideSubscriptionAmountSync({
    tipo: "CLINICA",
    expectedCents: CLINIC_3_SEATS_CENTS,
    subscription: sub({ mpPreapprovalId: null }),
  });
  assert.deepEqual(d, { action: "skip", reason: "sin_preapproval" });
});

test("sync: estados no elegibles (PENDIENTE_ACTIVACION/CANCELADA/PAUSADA) → skip aunque haya drift", () => {
  for (const estado of ["PENDIENTE_ACTIVACION", "CANCELADA", "PAUSADA"] as const) {
    const d = decideSubscriptionAmountSync({
      tipo: "CLINICA",
      expectedCents: CLINIC_3_SEATS_CENTS,
      subscription: sub({ estado, montoCents: 10_000_000 }),
    });
    assert.deepEqual(d, { action: "skip", reason: "estado_no_elegible" }, `estado ${estado}`);
  }
});

test("sync: monto ya igual al esperado → skip monto_igual (idempotente, sin PUT)", () => {
  const d = decideSubscriptionAmountSync({
    tipo: "CLINICA",
    expectedCents: CLINIC_3_SEATS_CENTS,
    subscription: sub({ estado: "ACTIVA", montoCents: CLINIC_3_SEATS_CENTS }),
  });
  assert.deepEqual(d, { action: "skip", reason: "monto_igual" });
});

test("sync: ACTIVA con monto distinto → sync con antes/después", () => {
  const d = decideSubscriptionAmountSync({
    tipo: "CLINICA",
    expectedCents: CLINIC_3_SEATS_CENTS,
    subscription: sub({ estado: "ACTIVA", montoCents: 12_500_000 }), // tenía 1 seat extra
  });
  assert.deepEqual(d, { action: "sync", fromCents: 12_500_000, toCents: CLINIC_3_SEATS_CENTS });
});

test("sync: MOROSA también es elegible (el preapproval sigue debitando/reintentando)", () => {
  const d = decideSubscriptionAmountSync({
    tipo: "CLINICA",
    expectedCents: 12_500_000, // se dio de baja un seat
    subscription: sub({ estado: "MOROSA", montoCents: CLINIC_3_SEATS_CENTS }),
  });
  assert.deepEqual(d, { action: "sync", fromCents: CLINIC_3_SEATS_CENTS, toCents: 12_500_000 });
});

test("sync: expectedCents coherente con computeMonthlyPriceCents (CLINICA, 3 seats = 150K)", () => {
  clearPricingEnv();
  assert.equal(computeMonthlyPriceCents("CLINICA", 3), CLINIC_3_SEATS_CENTS);
  const d = decideSubscriptionAmountSync({
    tipo: "CLINICA",
    expectedCents: computeMonthlyPriceCents("CLINICA", 3),
    subscription: sub({ montoCents: computeMonthlyPriceCents("CLINICA", 2) }),
  });
  assert.deepEqual(d, { action: "sync", fromCents: 12_500_000, toCents: 15_000_000 });
});

// ─── validateChargeAmount (M-BILL-2 per-org) ─────────────────────────────────

test("cargo Solo: 30.000 ARS contra monto_cents del plan Solo → válido", () => {
  assert.equal(
    validateChargeAmount({ amountCents: SOLO_CENTS, currency: "ARS", expectedCents: SOLO_CENTS }),
    null,
  );
  // El plan vigente real (env-aware) también valida contra sí mismo.
  assert.equal(
    validateChargeAmount({
      amountCents: MP_PLAN_PRICE_CENTS,
      currency: "ARS",
      expectedCents: MP_PLAN_PRICE_CENTS,
    }),
    null,
  );
});

test("cargo Clinic: 150.000 ARS (base + 2 seats extra) contra monto_cents de ESA org → válido", () => {
  clearPricingEnv();
  const expected = computeMonthlyPriceCents("CLINICA", 3);
  assert.equal(expected, CLINIC_3_SEATS_CENTS);
  assert.equal(
    validateChargeAmount({ amountCents: CLINIC_3_SEATS_CENTS, currency: "ARS", expectedCents: expected }),
    null,
  );
  // Un cargo Clinic NO valida contra el plan Solo global (el bug que esta fase elimina).
  assert.notEqual(
    validateChargeAmount({ amountCents: CLINIC_3_SEATS_CENTS, currency: "ARS", expectedCents: SOLO_CENTS }),
    null,
  );
});

test("cargo: tolerancia de ±1 centavo (redondeos MP)", () => {
  assert.equal(
    validateChargeAmount({ amountCents: CLINIC_3_SEATS_CENTS + 1, currency: "ARS", expectedCents: CLINIC_3_SEATS_CENTS }),
    null,
  );
  assert.equal(
    validateChargeAmount({ amountCents: CLINIC_3_SEATS_CENTS - 1, currency: "ARS", expectedCents: CLINIC_3_SEATS_CENTS }),
    null,
  );
});

test("cargo: monto inesperado (>1 centavo de desvío) → warning con esperado, sin PII", () => {
  const warning = validateChargeAmount({
    amountCents: SOLO_CENTS, // a la org Clinic le debitaron el monto Solo
    currency: "ARS",
    expectedCents: CLINIC_3_SEATS_CENTS,
  });
  assert.ok(warning, "debe devolver warning");
  assert.match(warning, /Monto inesperado \(30000 ARS\); esperado 150000 ARS\./);
});

test("cargo: moneda distinta de ARS → warning de moneda (gana sobre el monto)", () => {
  const warning = validateChargeAmount({
    amountCents: CLINIC_3_SEATS_CENTS,
    currency: "USD",
    expectedCents: CLINIC_3_SEATS_CENTS,
  });
  assert.ok(warning);
  assert.match(warning, /moneda inesperada \(USD\); esperado ARS\./);
});
