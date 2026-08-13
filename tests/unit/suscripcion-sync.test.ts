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

// ─── validateChargeAmount (M-BILL-2 per-org · C2) ────────────────────────────
//
// C2 cambió la firma de `string | null` a `{ aceptado, warning }`. El motivo no
// es cosmético: antes cualquier desvío rechazaba el cargo y BLOQUEABA la
// activación, así que un pago perfectamente legítimo dejaba al cliente afuera
// de la app. Ahora se separan dos preguntas distintas: "¿esto habilita el
// cambio de estado?" y "¿hay algo raro que valga la pena mirar?".
//
// El criterio: sólo se rechaza lo que NO se puede explicar. Un cliente que pagó
// y queda igual afuera es el peor resultado posible.

test("cargo Solo: 30.000 ARS contra monto_cents del plan Solo → aceptado sin warning", () => {
  const r = validateChargeAmount({ amountCents: SOLO_CENTS, currency: "ARS", expectedCents: SOLO_CENTS });
  assert.equal(r.aceptado, true);
  assert.equal(r.warning, null);

  // El plan vigente real (env-aware) también valida contra sí mismo.
  const r2 = validateChargeAmount({
    amountCents: MP_PLAN_PRICE_CENTS,
    currency: "ARS",
    expectedCents: MP_PLAN_PRICE_CENTS,
  });
  assert.equal(r2.aceptado, true);
  assert.equal(r2.warning, null);
});

test("cargo Clinic: 150.000 ARS (base + 2 seats extra) contra monto_cents de ESA org → aceptado", () => {
  clearPricingEnv();
  const expected = computeMonthlyPriceCents("CLINICA", 3);
  assert.equal(expected, CLINIC_3_SEATS_CENTS);
  const r = validateChargeAmount({ amountCents: CLINIC_3_SEATS_CENTS, currency: "ARS", expectedCents: expected });
  assert.equal(r.aceptado, true);
  assert.equal(r.warning, null);

  // Un cargo Clinic NO valida contra el plan Solo global (el bug que esta fase
  // eliminó): debitaron MUCHO de más respecto de lo esperado.
  const contraSolo = validateChargeAmount({
    amountCents: CLINIC_3_SEATS_CENTS,
    currency: "ARS",
    expectedCents: SOLO_CENTS,
  });
  assert.ok(contraSolo.warning, "tiene que avisar del desvío");
});

test("cargo: tolerancia de ±1 centavo (redondeos MP) → aceptado y silencioso", () => {
  for (const delta of [1, -1]) {
    const r = validateChargeAmount({
      amountCents: CLINIC_3_SEATS_CENTS + delta,
      currency: "ARS",
      expectedCents: CLINIC_3_SEATS_CENTS,
    });
    assert.equal(r.aceptado, true, `desvío de ${delta} centavo`);
    assert.equal(r.warning, null);
  }
});

test("C2 · debitaron de MENOS por múltiplos exactos del seat → ACEPTADO con warning", () => {
  // El caso que este PR arregla. En una org Clínica, dar de baja a un
  // integrante actualiza monto_cents y el preapproval, pero el débito que MP ya
  // tenía en curso sale con el monto VIEJO. Antes eso se rechazaba: el cliente
  // pagaba y la suscripción no se activaba.
  clearPricingEnv();
  const esperado = computeMonthlyPriceCents("CLINICA", 3);
  const unSeatMenos = computeMonthlyPriceCents("CLINICA", 2);
  const r = validateChargeAmount({ amountCents: unSeatMenos, currency: "ARS", expectedCents: esperado });
  assert.equal(r.aceptado, true, "un desfasaje de seats no puede bloquear al que pagó");
  assert.ok(r.warning, "pero tiene que quedar registrado");
  assert.match(r.warning, /integrante/);
});

test("C2 · debitaron de MÁS → aceptado con warning (la plata entró)", () => {
  const r = validateChargeAmount({
    amountCents: CLINIC_3_SEATS_CENTS + 500_00,
    currency: "ARS",
    expectedCents: CLINIC_3_SEATS_CENTS,
  });
  assert.equal(r.aceptado, true, "bloquear al que pagó de más sería castigarlo dos veces");
  assert.match(r.warning ?? "", /de más/);
});

test("C2 · un faltante que NO se explica → rechazado", () => {
  // Lo único que sigue bloqueando: un monto que no coincide con nada.
  clearPricingEnv();
  const r = validateChargeAmount({
    amountCents: CLINIC_3_SEATS_CENTS - 777,
    currency: "ARS",
    expectedCents: CLINIC_3_SEATS_CENTS,
  });
  assert.equal(r.aceptado, false);
  assert.ok(r.warning);
});

test("cargo: moneda distinta de ARS → rechazado (gana sobre el monto)", () => {
  const r = validateChargeAmount({
    amountCents: CLINIC_3_SEATS_CENTS,
    currency: "USD",
    expectedCents: CLINIC_3_SEATS_CENTS,
  });
  assert.equal(r.aceptado, false, "no es nuestro cobro");
  assert.match(r.warning ?? "", /moneda inesperada \(USD\); esperado ARS\./);
});
