/**
 * Folio · PaymentProvider — implementación Mercado Pago (Fase E · E1).
 *
 * Envuelve lib/mercadopago/client.ts (wrapper REST con X-Idempotency-Key) y
 * traduce payloads MP ↔ tipos de dominio (lib/payments/types.ts). Los callers
 * nunca ven MpPreapproval/MpAuthorizedPayment.
 *
 * La validación HMAC de webhooks NO está acá: sigue en
 * lib/mercadopago/webhook-security.ts, consumida por el route handler de MP
 * (app/api/mercadopago/webhook) — es transporte, no dominio.
 *
 * Los mappers y helpers de redondeo se exportan para unit tests
 * (tests/unit/payment-provider-mp.test.ts).
 */

import {
  cancelPreapproval,
  createPreapproval,
  getAuthorizedPayment,
  getPreapproval,
  pausePreapproval,
  updatePreapprovalAmount,
  type MpAuthorizedPayment,
  type MpPreapproval,
  type MpPreapprovalStatus,
} from "@/lib/mercadopago/client";

import type {
  ChargeAttemptInfo,
  ChargeStatus,
  CreateSubscriptionInput,
  CreateSubscriptionOutput,
  PaymentProvider,
  SubscriptionInfo,
  SubscriptionStatus,
} from "./types";

// ─── Conversión de montos ────────────────────────────────────────────────────

/**
 * ARS (unidad de MP, admite decimales) → centavos enteros de dominio.
 * Redondeo half-up vía Math.round: 30000.01 ARS → 3.000.001 centavos aunque
 * `30000.01 * 100` dé 3000000.9999… en floating point.
 */
export function arsToCents(amountArs: number): number {
  return Math.round(amountArs * 100);
}

/**
 * Centavos enteros de dominio → ARS para la API de MP. División exacta a nivel
 * decimal (JSON.stringify serializa 3000001/100 como 30000.01).
 */
export function centsToArs(amountCents: number): number {
  return amountCents / 100;
}

// ─── Mapeo de estados MP → dominio ───────────────────────────────────────────

/**
 * Status de preapproval MP → estado canónico de dominio.
 * `finished` (preapproval con end_date que terminó) se trata como CANCELADA:
 * no hay cobro futuro. MOROSA nunca sale de acá — es un estado local derivado
 * de cargos rechazados.
 */
export function mapMpPreapprovalStatus(mpStatus: MpPreapprovalStatus): SubscriptionStatus {
  switch (mpStatus) {
    case "pending":
      return "PENDIENTE";
    case "authorized":
      return "ACTIVA";
    case "paused":
      return "PAUSADA";
    case "cancelled":
    case "finished":
      return "CANCELADA";
  }
}

/**
 * Status de payment MP → estado canónico de cargo. Cualquier status desconocido
 * (in_process, pending, authorized, …) cae a PENDIENTE — mismo default que el
 * mapPaymentStatus histórico de lib/db/suscripcion.ts.
 */
export function mapMpPaymentStatus(mpStatus: string): ChargeStatus {
  switch (mpStatus) {
    case "approved":
      return "APROBADO";
    case "rejected":
      return "RECHAZADO";
    case "refunded":
      return "REFUNDED";
    default:
      return "PENDIENTE";
  }
}

// ─── Mapeo de entidades MP → dominio ─────────────────────────────────────────

export function toSubscriptionInfo(preapproval: MpPreapproval): SubscriptionInfo {
  return {
    providerSubscriptionId: preapproval.id,
    status: mapMpPreapprovalStatus(preapproval.status),
    amountCents: arsToCents(preapproval.auto_recurring.transaction_amount),
    currency: preapproval.auto_recurring.currency_id,
    payerEmail: preapproval.payer_email ?? null,
    externalReference: preapproval.external_reference ?? null,
    checkoutUrl: preapproval.init_point ?? null,
    nextChargeDate: preapproval.next_payment_date ?? null,
    lastModified: preapproval.last_modified ?? null,
  };
}

export function toChargeAttemptInfo(ap: MpAuthorizedPayment): ChargeAttemptInfo {
  return {
    providerChargeId: String(ap.id),
    providerSubscriptionId: ap.preapproval_id,
    amountCents: arsToCents(ap.transaction_amount),
    currency: ap.currency_id,
    // Mismo fallback histórico de recordChargeAttempt (L-B): debit_date puede
    // venir null en cobros rechazados → caemos a date_created. El caller cae a
    // now() si ambos faltan.
    attemptDate: ap.debit_date ?? ap.date_created ?? null,
    payment: ap.payment
      ? {
          paymentId: String(ap.payment.id),
          status: mapMpPaymentStatus(ap.payment.status),
          statusDetail: ap.payment.status_detail ?? null,
        }
      : null,
  };
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function createMercadoPagoProvider(): PaymentProvider {
  return {
    name: "mercadopago",

    async createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionOutput> {
      if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
        throw new Error(
          `createSubscription: amountCents inválido (${input.amountCents}); se espera entero > 0 en centavos.`,
        );
      }
      const preapproval = await createPreapproval({
        payerEmail: input.payerEmail,
        externalReference: input.externalReference,
        backUrl: input.backUrl,
        amountArs: centsToArs(input.amountCents),
      });
      if (!preapproval.init_point) {
        // Defensivo: MP siempre devuelve init_point para un preapproval pending.
        throw new Error(
          `MP devolvió preapproval ${preapproval.id} sin init_point; no hay URL de checkout.`,
        );
      }
      return {
        subscription: toSubscriptionInfo(preapproval),
        checkoutUrl: preapproval.init_point,
      };
    },

    async fetchSubscription(providerSubscriptionId: string): Promise<SubscriptionInfo> {
      return toSubscriptionInfo(await getPreapproval(providerSubscriptionId));
    },

    async cancelSubscription(providerSubscriptionId: string): Promise<SubscriptionInfo> {
      return toSubscriptionInfo(await cancelPreapproval(providerSubscriptionId));
    },

    async pauseSubscription(providerSubscriptionId: string): Promise<SubscriptionInfo> {
      return toSubscriptionInfo(await pausePreapproval(providerSubscriptionId));
    },

    async updateSubscriptionAmount(
      providerSubscriptionId: string,
      amountCents: number,
    ): Promise<SubscriptionInfo> {
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new Error(
          `updateSubscriptionAmount: amountCents inválido (${amountCents}); se espera entero > 0 en centavos.`,
        );
      }
      const updated = await updatePreapprovalAmount(
        providerSubscriptionId,
        centsToArs(amountCents),
      );
      return toSubscriptionInfo(updated);
    },

    async fetchChargeAttempt(providerChargeId: string): Promise<ChargeAttemptInfo> {
      return toChargeAttemptInfo(await getAuthorizedPayment(providerChargeId));
    },
  };
}
