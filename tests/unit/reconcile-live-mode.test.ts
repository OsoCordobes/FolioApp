/**
 * FIX 3 (review de billing 2026-07-18) · Guardrail live_mode en la INGESTA de
 * estado MP fuera del webhook.
 *
 * Riesgo cubierto: el guardrail A-4 del webhook descartaba eventos sandbox en
 * producción, pero el cron /api/cron/reconcile-suscripciones (horario, GH
 * Actions) y el refresh manual de billing ingieren estado por GET /preapproval
 * → toSubscriptionInfo, que ANTES descartaba `live_mode`. Con un
 * MP_ACCESS_TOKEN de test en prod, un preapproval sandbox "authorized"
 * activaba la suscripción igual vía reconcile, bypasseando A-4.
 *
 * El fix: SubscriptionInfo.liveMode (opcional) + checkMpLiveMode ANTES de
 * applySubscriptionUpdate en ambos ingest points. Igual que los otros tests de
 * este repo (mp-webhook-live-mode): node:test bajo tsx no permite mock.module
 * y el route/action arrastran deps de módulo (Sentry, Supabase), así que
 * testeamos la cadena de decisión extraída — toSubscriptionInfo → liveMode →
 * checkMpLiveMode — que es exactamente lo que el cron y la action evalúan para
 * decidir si llaman applySubscriptionUpdate.
 *
 * Matriz (entorno = producción real salvo que se indique):
 *   - preapproval sandbox (live_mode:false)  → discard (NO se aplica el update;
 *                                              el estado local queda como está)
 *   - live_mode:true                         → se aplica
 *   - live_mode ausente (undefined)          → se aplica (compat con providers
 *                                              que no exponen el dato: el campo
 *                                              es opcional en SubscriptionInfo)
 *   - Vercel preview + sandbox               → se aplica (ahí sandbox es lo
 *                                              esperado; VERCEL_ENV manda)
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { MpPreapproval } from "../../lib/mercadopago/client";
import { checkMpLiveMode } from "../../lib/mercadopago/webhook-security";
import { toSubscriptionInfo } from "../../lib/payments/mercadopago";
import type { SubscriptionInfo } from "../../lib/payments/types";

// Helper: corre `fn` con env seteado y restaura al final (mismo patrón que
// tests/unit/mp-webhook-live-mode.test.ts).
function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const PROD_ENV = { VERCEL_ENV: "production", NODE_ENV: "production" };

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

/**
 * La decisión EXACTA que corren el cron reconcile y refreshSubscriptionAction
 * entre provider.fetchSubscription y applySubscriptionUpdate.
 */
function ingestShouldApply(info: SubscriptionInfo): boolean {
  return !checkMpLiveMode(info.liveMode).discard;
}

test("reconcile en prod: preapproval sandbox (live_mode=false) authorized → discard, NO se activa", () => {
  withEnv(PROD_ENV, () => {
    const info = toSubscriptionInfo(mpPreapprovalFixture({ live_mode: false, status: "authorized" }));
    // El mapeo diría ACTIVA — justamente por eso el guardrail corre ANTES del apply.
    assert.equal(info.status, "ACTIVA");
    assert.equal(ingestShouldApply(info), false);
    const check = checkMpLiveMode(info.liveMode);
    assert.equal(check.discard, true);
    if (check.discard) assert.equal(check.reason, "sandbox-event-in-production");
  });
});

test("reconcile en prod: live_mode=true → se aplica (suscripción real)", () => {
  withEnv(PROD_ENV, () => {
    const info = toSubscriptionInfo(mpPreapprovalFixture({ live_mode: true }));
    assert.equal(ingestShouldApply(info), true);
  });
});

test("reconcile en prod: live_mode ausente → se aplica (compat providers sin el campo)", () => {
  withEnv(PROD_ENV, () => {
    // MP sin el campo en el payload…
    const info = toSubscriptionInfo(mpPreapprovalFixture());
    assert.equal(info.liveMode, undefined);
    assert.equal(ingestShouldApply(info), true);
    // …y un SubscriptionInfo de un provider futuro que ni declara liveMode.
    const foreign: SubscriptionInfo = {
      providerSubscriptionId: "sub-eu-1",
      status: "ACTIVA",
      amountCents: 3_000_000,
      currency: "EUR",
      payerEmail: null,
      externalReference: null,
      checkoutUrl: null,
      nextChargeDate: null,
      lastModified: null,
    };
    assert.equal(ingestShouldApply(foreign), true);
  });
});

test("reconcile en Vercel preview: sandbox → se aplica (ahí sandbox es lo esperado)", () => {
  withEnv({ VERCEL_ENV: "preview", NODE_ENV: "production" }, () => {
    const info = toSubscriptionInfo(mpPreapprovalFixture({ live_mode: false }));
    assert.equal(ingestShouldApply(info), true);
  });
});

test("reconcile en dev local: sandbox → se aplica", () => {
  withEnv({ VERCEL_ENV: undefined, NODE_ENV: "development" }, () => {
    const info = toSubscriptionInfo(mpPreapprovalFixture({ live_mode: false }));
    assert.equal(ingestShouldApply(info), true);
  });
});

test("reconcile en self-host prod (sin VERCEL_ENV): sandbox → discard", () => {
  withEnv({ VERCEL_ENV: undefined, NODE_ENV: "production" }, () => {
    const info = toSubscriptionInfo(mpPreapprovalFixture({ live_mode: false }));
    assert.equal(ingestShouldApply(info), false);
  });
});
