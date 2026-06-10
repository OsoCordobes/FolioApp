/**
 * Fase E · E1 — PaymentProvider (implementación Mercado Pago).
 *
 * Fija el contrato del mapeo MP → dominio:
 *   - status de preapproval (TODOS los valores) → SubscriptionStatus canónico
 *   - status de payment → ChargeStatus canónico
 *   - dominio → enum de DB (PENDIENTE → PENDIENTE_ACTIVACION)
 *   - redondeos ARS (unidad MP, con decimales) ↔ centavos enteros de dominio
 *   - mapeo de entidades MpPreapproval/MpAuthorizedPayment → SubscriptionInfo/
 *     ChargeAttemptInfo (passthrough de watermark CR-3, fallbacks de fechas)
 *   - factory getPaymentProvider(): default + singleton + fallback ante env rota
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  MpAuthorizedPayment,
  MpPreapproval,
  MpPreapprovalStatus,
} from "../../lib/mercadopago/client";
import {
  arsToCents,
  centsToArs,
  createMercadoPagoProvider,
  mapMpPaymentStatus,
  mapMpPreapprovalStatus,
  toChargeAttemptInfo,
  toSubscriptionInfo,
} from "../../lib/payments/mercadopago";
import { __resetPaymentProviderForTests, getPaymentProvider } from "../../lib/payments";
import { subscriptionStatusToEstado } from "../../lib/db/suscripcion";

// ─── Mapeo de estados ────────────────────────────────────────────────────────

test("mapMpPreapprovalStatus: cubre TODOS los status de MP", () => {
  const expected: Record<MpPreapprovalStatus, string> = {
    pending: "PENDIENTE",
    authorized: "ACTIVA",
    paused: "PAUSADA",
    cancelled: "CANCELADA",
    // finished = preapproval con end_date vencida: no hay cobro futuro → terminal.
    finished: "CANCELADA",
  };
  for (const [mp, domain] of Object.entries(expected)) {
    assert.equal(mapMpPreapprovalStatus(mp as MpPreapprovalStatus), domain, `status MP "${mp}"`);
  }
});

test("mapMpPaymentStatus: approved/rejected/refunded + default PENDIENTE", () => {
  assert.equal(mapMpPaymentStatus("approved"), "APROBADO");
  assert.equal(mapMpPaymentStatus("rejected"), "RECHAZADO");
  assert.equal(mapMpPaymentStatus("refunded"), "REFUNDED");
  // Mismo default histórico de lib/db/suscripcion.ts: lo desconocido es PENDIENTE.
  assert.equal(mapMpPaymentStatus("in_process"), "PENDIENTE");
  assert.equal(mapMpPaymentStatus("authorized"), "PENDIENTE");
  assert.equal(mapMpPaymentStatus("algo-nuevo-de-mp"), "PENDIENTE");
});

test("subscriptionStatusToEstado: PENDIENTE → PENDIENTE_ACTIVACION, resto identidad", () => {
  assert.equal(subscriptionStatusToEstado("PENDIENTE"), "PENDIENTE_ACTIVACION");
  assert.equal(subscriptionStatusToEstado("ACTIVA"), "ACTIVA");
  assert.equal(subscriptionStatusToEstado("PAUSADA"), "PAUSADA");
  assert.equal(subscriptionStatusToEstado("CANCELADA"), "CANCELADA");
  assert.equal(subscriptionStatusToEstado("MOROSA"), "MOROSA");
});

// ─── Redondeos ARS ↔ centavos ────────────────────────────────────────────────

test("arsToCents: redondea a centavos enteros pese al floating point", () => {
  assert.equal(arsToCents(30000), 3_000_000);
  // 30000.01 * 100 = 3000000.9999... en IEEE-754 → round salva el centavo.
  assert.equal(arsToCents(30000.01), 3_000_001);
  assert.equal(arsToCents(25000.5), 2_500_050);
  assert.equal(arsToCents(0.01), 1);
  assert.equal(arsToCents(0), 0);
  // Clásico 0.1 + 0.2 = 0.30000000000000004.
  assert.equal(arsToCents(0.1 + 0.2), 30);
});

test("centsToArs: centavos enteros → ARS con decimales para la API de MP", () => {
  assert.equal(centsToArs(3_000_000), 30000);
  assert.equal(centsToArs(3_000_001), 30000.01);
  assert.equal(centsToArs(2_500_050), 25000.5);
});

test("roundtrip: arsToCents(centsToArs(c)) === c para montos reales del plan", () => {
  // Plan Solo, Clinic base, Clinic con 1/2/3 seats extra, y centavos sueltos.
  for (const cents of [3_000_000, 10_000_000, 12_500_000, 15_000_000, 17_500_000, 3_000_001, 1, 99, 2_500_050]) {
    assert.equal(arsToCents(centsToArs(cents)), cents, `roundtrip de ${cents} centavos`);
  }
});

// ─── Mapeo de entidades ──────────────────────────────────────────────────────

function mpPreapprovalFixture(overrides: Partial<MpPreapproval> = {}): MpPreapproval {
  return {
    id: "pre-123",
    status: "authorized",
    init_point: "https://mp.example/init/pre-123",
    preapproval_plan_id: null,
    payer_id: 42,
    payer_email: "dra@example.com",
    back_url: "https://folio.example/configuracion/billing?activation=ok",
    external_reference: "org_abc",
    reason: "Folio - Plan Profesional",
    date_created: "2026-06-01T10:00:00.000Z",
    last_modified: "2026-06-02T11:30:00.000Z",
    next_payment_date: "2026-07-01T10:00:00.000Z",
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: 30000,
      currency_id: "ARS",
    },
    ...overrides,
  };
}

test("toSubscriptionInfo: mapea preapproval completo a dominio", () => {
  const info = toSubscriptionInfo(mpPreapprovalFixture());
  assert.equal(info.providerSubscriptionId, "pre-123");
  assert.equal(info.status, "ACTIVA");
  assert.equal(info.amountCents, 3_000_000); // 30000 ARS → centavos int
  assert.equal(info.currency, "ARS");
  assert.equal(info.payerEmail, "dra@example.com");
  assert.equal(info.externalReference, "org_abc");
  assert.equal(info.checkoutUrl, "https://mp.example/init/pre-123");
  assert.equal(info.nextChargeDate, "2026-07-01T10:00:00.000Z");
  // Watermark CR-3: passthrough exacto — el guard de staleness depende de esto.
  assert.equal(info.lastModified, "2026-06-02T11:30:00.000Z");
});

test("toSubscriptionInfo: monto con decimales ARS no pierde centavos", () => {
  const info = toSubscriptionInfo(
    mpPreapprovalFixture({
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 30000.01,
        currency_id: "ARS",
      },
    }),
  );
  assert.equal(info.amountCents, 3_000_001);
});

test("toSubscriptionInfo: campos opcionales ausentes caen a null", () => {
  const info = toSubscriptionInfo(
    mpPreapprovalFixture({
      status: "pending",
      next_payment_date: null,
      external_reference: null,
      last_modified: undefined as unknown as string, // payload MP sin el campo
    }),
  );
  assert.equal(info.status, "PENDIENTE");
  assert.equal(info.nextChargeDate, null);
  assert.equal(info.externalReference, null);
  assert.equal(info.lastModified, null);
});

function mpAuthorizedPaymentFixture(
  overrides: Partial<MpAuthorizedPayment> = {},
): MpAuthorizedPayment {
  return {
    id: 555,
    preapproval_id: "pre-123",
    status: "processed",
    payment: {
      id: 777,
      status: "approved",
      status_detail: "accredited",
    },
    transaction_amount: 30000,
    currency_id: "ARS",
    debit_date: "2026-06-01T12:00:00.000Z",
    date_created: "2026-06-01T11:59:00.000Z",
    last_modified: "2026-06-01T12:01:00.000Z",
    ...overrides,
  };
}

test("toChargeAttemptInfo: cargo aprobado completo", () => {
  const charge = toChargeAttemptInfo(mpAuthorizedPaymentFixture());
  assert.equal(charge.providerChargeId, "555"); // id numérico de MP → string
  assert.equal(charge.providerSubscriptionId, "pre-123");
  assert.equal(charge.amountCents, 3_000_000);
  assert.equal(charge.currency, "ARS");
  assert.equal(charge.attemptDate, "2026-06-01T12:00:00.000Z");
  assert.ok(charge.payment);
  assert.equal(charge.payment.paymentId, "777"); // idempotencia: UNIQUE(mp_payment_id)
  assert.equal(charge.payment.status, "APROBADO");
  assert.equal(charge.payment.statusDetail, "accredited");
});

test("toChargeAttemptInfo: scheduled sin payment → payment null (no es un cobro)", () => {
  const charge = toChargeAttemptInfo(
    mpAuthorizedPaymentFixture({ status: "scheduled", payment: null }),
  );
  assert.equal(charge.payment, null);
});

test("toChargeAttemptInfo: rechazado sin debit_date cae a date_created (L-B)", () => {
  const charge = toChargeAttemptInfo(
    mpAuthorizedPaymentFixture({
      payment: { id: 888, status: "rejected", status_detail: "cc_rejected_insufficient_amount" },
      debit_date: null as unknown as string,
    }),
  );
  assert.equal(charge.attemptDate, "2026-06-01T11:59:00.000Z");
  assert.ok(charge.payment);
  assert.equal(charge.payment.status, "RECHAZADO");
  assert.equal(charge.payment.statusDetail, "cc_rejected_insufficient_amount");
});

test("toChargeAttemptInfo: sin debit_date ni date_created → attemptDate null (caller pone now)", () => {
  const charge = toChargeAttemptInfo(
    mpAuthorizedPaymentFixture({
      debit_date: null as unknown as string,
      date_created: null as unknown as string,
    }),
  );
  assert.equal(charge.attemptDate, null);
});

// ─── Factory / singleton ─────────────────────────────────────────────────────

test("getPaymentProvider: default mercadopago y singleton (misma instancia)", () => {
  __resetPaymentProviderForTests();
  delete process.env.PAYMENT_PROVIDER;
  const a = getPaymentProvider();
  const b = getPaymentProvider();
  assert.equal(a.name, "mercadopago");
  assert.equal(a, b);
});

test("getPaymentProvider: PAYMENT_PROVIDER desconocido cae a mercadopago con warn", () => {
  __resetPaymentProviderForTests();
  process.env.PAYMENT_PROVIDER = "stripe-todavia-no";
  try {
    assert.equal(getPaymentProvider().name, "mercadopago");
  } finally {
    delete process.env.PAYMENT_PROVIDER;
    __resetPaymentProviderForTests();
  }
});

test("provider MP: expone la superficie completa de la interfaz", () => {
  const p = createMercadoPagoProvider();
  assert.equal(typeof p.createSubscription, "function");
  assert.equal(typeof p.fetchSubscription, "function");
  assert.equal(typeof p.cancelSubscription, "function");
  assert.equal(typeof p.pauseSubscription, "function");
  assert.equal(typeof p.updateSubscriptionAmount, "function");
  assert.equal(typeof p.fetchChargeAttempt, "function");
});

test("updateSubscriptionAmount: rechaza centavos no enteros o <= 0 antes de pegarle a MP", async () => {
  const p = createMercadoPagoProvider();
  await assert.rejects(() => p.updateSubscriptionAmount("pre-123", 30000.5), /amountCents inválido/);
  await assert.rejects(() => p.updateSubscriptionAmount("pre-123", 0), /amountCents inválido/);
  await assert.rejects(() => p.updateSubscriptionAmount("pre-123", -100), /amountCents inválido/);
});

test("createSubscription: rechaza amountCents no entero o <= 0 antes de pegarle a MP", async () => {
  const p = createMercadoPagoProvider();
  const base = {
    payerEmail: "dra@example.com",
    externalReference: "org_abc",
    backUrl: "https://folio.example/billing",
  };
  await assert.rejects(
    () => p.createSubscription({ ...base, amountCents: 30000.5 }),
    /amountCents inválido/,
  );
  await assert.rejects(() => p.createSubscription({ ...base, amountCents: 0 }), /amountCents inválido/);
  await assert.rejects(() => p.createSubscription({ ...base, amountCents: -1 }), /amountCents inválido/);
});

// ─── Wire real: redondeo centavos→ARS en el PUT a MP (fetch stub) ───────────

test("updateSubscriptionAmount: PUT /preapproval con transaction_amount en ARS exactos + currency ARS", async () => {
  const prevToken = process.env.MP_ACCESS_TOKEN;
  process.env.MP_ACCESS_TOKEN = "test-token";
  const originalFetch = globalThis.fetch;

  let capturedUrl = "";
  let capturedMethod = "";
  let capturedBody: {
    auto_recurring?: { transaction_amount?: number; currency_id?: string };
  } = {};

  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedMethod = init?.method ?? "GET";
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    // MP responde el preapproval actualizado: 150000.01 ARS.
    const responseBody = mpPreapprovalFixture({
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 150000.01,
        currency_id: "ARS",
      },
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const p = createMercadoPagoProvider();
    // 15.000.001 centavos → 150000.01 ARS en el wire (división exacta, sin drift IEEE-754).
    const info = await p.updateSubscriptionAmount("pre-123", 15_000_001);

    assert.ok(capturedUrl.endsWith("/preapproval/pre-123"), `URL: ${capturedUrl}`);
    assert.equal(capturedMethod, "PUT");
    assert.equal(capturedBody.auto_recurring?.transaction_amount, 150000.01);
    assert.equal(capturedBody.auto_recurring?.currency_id, "ARS");
    // Y la respuesta vuelve mapeada a dominio en centavos enteros.
    assert.equal(info.amountCents, 15_000_001);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevToken === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = prevToken;
  }
});
