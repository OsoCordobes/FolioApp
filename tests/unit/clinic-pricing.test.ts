import assert from "node:assert/strict";
import test from "node:test";

import {
  computeClinicBreakdownCents,
  computeMonthlyPriceCents,
  resolveClinicBasePriceCents,
  resolveClinicSeatPriceCents,
} from "../../lib/billing/pricing";
import { MP_PLAN_PRICE_CENTS } from "../../lib/mercadopago/client";

const BASE_DEFAULT = 10_000_000; // ARS 100.000
const SEAT_DEFAULT = 2_500_000; //  ARS 25.000

function clearEnv() {
  delete process.env.CLINIC_BASE_PRICE_CENTS;
  delete process.env.CLINIC_SEAT_PRICE_CENTS;
}

test("INDEPENDIENTE: siempre el plan único vigente, sin importar seats", () => {
  clearEnv();
  assert.equal(computeMonthlyPriceCents("INDEPENDIENTE", 1), MP_PLAN_PRICE_CENTS);
  assert.equal(computeMonthlyPriceCents("INDEPENDIENTE", 5), MP_PLAN_PRICE_CENTS);
  assert.equal(computeMonthlyPriceCents("INDEPENDIENTE", 0), MP_PLAN_PRICE_CENTS);
});

test("CLINICA: 1 seat (solo OWNER) = base, sin adicionales", () => {
  clearEnv();
  assert.equal(computeMonthlyPriceCents("CLINICA", 1), BASE_DEFAULT);
});

test("CLINICA: cada member activo adicional suma un seat de 25.000", () => {
  clearEnv();
  assert.equal(computeMonthlyPriceCents("CLINICA", 2), BASE_DEFAULT + SEAT_DEFAULT);
  assert.equal(computeMonthlyPriceCents("CLINICA", 4), BASE_DEFAULT + 3 * SEAT_DEFAULT);
});

test("CLINICA: seats 0 o negativos no descuentan de la base", () => {
  clearEnv();
  assert.equal(computeMonthlyPriceCents("CLINICA", 0), BASE_DEFAULT);
  assert.equal(computeMonthlyPriceCents("CLINICA", -3), BASE_DEFAULT);
});

test("CLINICA: seats fraccionales se truncan hacia abajo", () => {
  clearEnv();
  assert.equal(computeMonthlyPriceCents("CLINICA", 2.9), BASE_DEFAULT + SEAT_DEFAULT);
});

test("overrides por env CLINIC_BASE_PRICE_CENTS / CLINIC_SEAT_PRICE_CENTS", () => {
  process.env.CLINIC_BASE_PRICE_CENTS = "20000000";
  process.env.CLINIC_SEAT_PRICE_CENTS = "1000000";
  try {
    assert.equal(resolveClinicBasePriceCents(), 20_000_000);
    assert.equal(resolveClinicSeatPriceCents(), 1_000_000);
    assert.equal(computeMonthlyPriceCents("CLINICA", 3), 20_000_000 + 2 * 1_000_000);
  } finally {
    clearEnv();
  }
});

test("env inválida (no entera / <= 0) cae al default con warn", () => {
  process.env.CLINIC_BASE_PRICE_CENTS = "cien mil";
  process.env.CLINIC_SEAT_PRICE_CENTS = "-5";
  try {
    assert.equal(resolveClinicBasePriceCents(), BASE_DEFAULT);
    assert.equal(resolveClinicSeatPriceCents(), SEAT_DEFAULT);
    assert.equal(computeMonthlyPriceCents("CLINICA", 2), BASE_DEFAULT + SEAT_DEFAULT);
  } finally {
    clearEnv();
  }
});

test("computeClinicBreakdownCents: desglose consistente con computeMonthlyPriceCents", () => {
  clearEnv();
  const b = computeClinicBreakdownCents(3);
  assert.equal(b.seats, 3);
  assert.equal(b.extraSeats, 2);
  assert.equal(b.basePriceCents, BASE_DEFAULT);
  assert.equal(b.seatPriceCents, SEAT_DEFAULT);
  assert.equal(b.totalCents, computeMonthlyPriceCents("CLINICA", 3));
});
