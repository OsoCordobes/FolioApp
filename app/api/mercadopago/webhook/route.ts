/**
 * Folio · Mercado Pago webhook · suscripciones.
 *
 * POST → eventos de MP. Topics relevantes:
 *
 *   - subscription_preapproval         · cambios en la suscripción (autorizada,
 *                                        pausada, cancelada). Disparado al volver
 *                                        del init_point cuando el usuario aprueba,
 *                                        y cada vez que el preapproval cambia estado.
 *
 *   - subscription_authorized_payment  · cobro recurrente mensual (ejecutado por
 *                                        MP automáticamente). Trae authorized_payment_id
 *                                        que hay que resolver con GET a MP para obtener
 *                                        payment_id + status + monto.
 *
 *   - payment                          · pago individual. Lo ignoramos: MP también lo
 *                                        manda en addición al subscription_authorized_payment.
 *                                        Procesar ambos duplica trabajo (la UNIQUE constraint
 *                                        lo evita, pero gastamos calls a MP de gusto).
 *
 * Seguridad: HMAC-SHA256 sobre manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * con `MP_WEBHOOK_SECRET`. Ver lib/mercadopago/webhook-security.ts.
 *
 * Idempotencia: cargo_suscripcion tiene UNIQUE(mp_payment_id). MP reenvía
 * webhooks ante timeout (3 reintentos). Devolvemos 200 siempre que procesemos
 * sin error inesperado — los 4xx/5xx hacen que MP reintente con backoff.
 *
 * Emails de lifecycle (PR 1.2): un cargo NUEVO (isNewCharge — jamás una
 * re-entrega) puede disparar notifyPagoFallido / notifySuscripcionReactivada /
 * notifySuscripcionActivada. Se despachan post-respuesta (runAfterResponse) y
 * son fail-safe de punta a punta: notify* nunca throwea, y el wiring entero va
 * envuelto en try/catch + Sentry — un email JAMÁS rompe el procesamiento de
 * un cobro ni cambia el status que ve MP.
 */

import { NextResponse, type NextRequest } from "next/server";
import { captureException, captureMessage } from "@sentry/nextjs";

import { runAfterResponse } from "@/lib/after-response";
import {
  notifyPagoFallido,
  notifySuscripcionActivada,
  notifySuscripcionReactivada,
} from "@/lib/email/notify";
import { verifyMpSignature } from "@/lib/mercadopago/webhook-security";
import { getPaymentProvider, type ChargeAttemptInfo } from "@/lib/payments";
import {
  applySubscriptionUpdate,
  recordChargeAttempt,
  type ChargeAttemptOutcome,
} from "@/lib/db/suscripcion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// El handler hace GETs a la API de MP (preapproval / authorized payment) +
// writes a la DB. Damos margen sobre el default de Vercel para no cortar a
// mitad de un evento de cobro; aun así MP corta su lado a ~22s y reintenta.
export const maxDuration = 60;

interface MpWebhookPayload {
  id?: number | string;
  type?: string;       // "subscription_preapproval" | "subscription_authorized_payment" | "payment"
  action?: string;     // "created" | "updated" | "payment.created" | ...
  data?: { id?: string };
  date_created?: string;
  user_id?: string;
  api_version?: string;
  live_mode?: boolean;
}

export async function POST(request: NextRequest) {
  // 1. Leer body como texto. NO lo usamos para HMAC (MP firma manifest sintética),
  //    pero sí lo necesitamos crudo para parsear y guardar como raw_payload.
  const rawBody = await request.text();

  let payload: MpWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.warn("[mp-webhook] body no es JSON válido:", e);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const dataId = payload.data?.id ?? null;

  // 2. Validar firma. MP firma id+request-id+ts, no el body crudo.
  const sigCheck = verifyMpSignature({
    signatureHeader: request.headers.get("x-signature"),
    requestIdHeader: request.headers.get("x-request-id"),
    dataId,
  });
  if (!sigCheck.ok) {
    return new NextResponse(`signature ${sigCheck.reason}`, {
      status: sigCheck.reason === "server-misconfigured" ? 503 : 403,
    });
  }

  if (!dataId || !payload.type) {
    // Webhook mal formado o que ignoramos (ej. test del panel MP sin data).
    return NextResponse.json({ ok: true });
  }

  // M6 (docs/AUDIT.md): MP descarta la respuesta a los ~22s y reintenta con
  // backoff. Si MP API o la DB se cuelgan, cortamos nosotros a los 20s y
  // devolvemos 503 — el evento llega de nuevo en el retry y el doble
  // procesamiento es inocuo (UNIQUE mp_payment_id + guard de last_modified).
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      processEvent(payload, dataId),
      new Promise<"timeout">((resolve) => {
        deadlineTimer = setTimeout(() => resolve("timeout"), WEBHOOK_DEADLINE_MS);
      }),
    ]);
    if (outcome === "timeout") {
      console.error(
        `[mp-webhook] deadline ${WEBHOOK_DEADLINE_MS}ms excedido type=${payload.type} dataId=${dataId}. 503 para retry de MP.`,
      );
      captureMessage(`[mp-webhook] deadline ${WEBHOOK_DEADLINE_MS}ms excedido`, {
        level: "warning",
        tags: { component: "mp-webhook", op: "deadline" },
        extra: { type: payload.type, dataId },
      });
      return new NextResponse("processing-timeout", { status: 503 });
    }
    if (outcome) return outcome;
  } catch (e) {
    // Errores transitorios (MP API down, DB hiccup) → 500 para que MP reintente.
    // Errores de lógica con la fila local los logueamos pero devolvemos 200.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[mp-webhook] error procesando type=${payload.type} dataId=${dataId}: ${msg}`);
    captureException(e, {
      tags: { component: "mp-webhook", op: "process-event" },
      extra: { type: payload.type, dataId },
    });
    return new NextResponse("processing-error", { status: 500 });
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }

  return NextResponse.json({ ok: true });
}

const WEBHOOK_DEADLINE_MS = 20_000;

/**
 * Procesa un evento ya autenticado. Devuelve una NextResponse para cortar con
 * un status especial (503 retry), o null para el 200 por default del caller.
 */
async function processEvent(
  payload: MpWebhookPayload,
  dataId: string,
): Promise<NextResponse | null> {
  const provider = getPaymentProvider();
  switch (payload.type) {
    case "subscription_preapproval": {
      // dataId = preapproval_id. GET para obtener estado actualizado.
      const subscription = await provider.fetchSubscription(dataId);
      const res = await applySubscriptionUpdate(subscription);
      if (!res.ok) {
        console.warn(`[mp-webhook] applySubscriptionUpdate falló: ${res.error.message}`);
        captureException(new Error(`applySubscriptionUpdate falló: ${res.error.detail ?? res.error.message}`), {
          tags: { component: "mp-webhook", op: "applySubscriptionUpdate" },
          extra: { dataId },
        });
      }
      return null;
    }

    case "subscription_authorized_payment": {
      // dataId = authorized_payment_id. GET para obtener payment + preapproval_id.
      const charge = await provider.fetchChargeAttempt(dataId);
      const res = await recordChargeAttempt({
        charge,
        rawPayload: payload,
      });
      if (!res.ok) {
        // M-BILL-1: si la suscripción todavía no está linkeada (el webhook de
        // cargo llegó antes que el de preapproval), devolvemos 5xx para que MP
        // reintente más tarde — si no, el primer cobro se perdería para siempre.
        if (res.error.code === "not_found") {
          console.warn(`[mp-webhook] recordChargeAttempt not_found: ${res.error.message}. Devolviendo 503 para retry de MP.`);
          // warning (no exception): es una carrera esperada que el retry de MP
          // resuelve solo; en Sentry queremos verla solo si loopea.
          captureMessage("[mp-webhook] recordChargeAttempt not_found (cargo antes que preapproval)", {
            level: "warning",
            tags: { component: "mp-webhook", op: "recordChargeAttempt" },
            extra: { dataId, detail: res.error.message },
          });
          return new NextResponse("subscription-not-linked-yet", { status: 503 });
        }
        console.warn(`[mp-webhook] recordChargeAttempt falló: ${res.error.message}`);
        captureException(new Error(`recordChargeAttempt falló: ${res.error.detail ?? res.error.message}`), {
          tags: { component: "mp-webhook", op: "recordChargeAttempt" },
          extra: { dataId },
        });
        return null;
      }

      // Emails de lifecycle (PR 1.2): SOLO en cargos nuevos, nunca en
      // re-entregas. Post-respuesta + fail-safe: nada de esto puede cambiar
      // el status HTTP que ve MP.
      scheduleChargeLifecycleEmails(res.data, charge);
      return null;
    }

    case "payment": {
      // Lo ignoramos — viene también como subscription_authorized_payment.
      return null;
    }

    default: {
      console.warn(`[mp-webhook] type desconocido: ${payload.type}`);
      return null;
    }
  }
}

// ─── Emails de lifecycle (PR 1.2) ────────────────────────────────────────────

/**
 * Matriz de disparo (SOLO cargos nuevos — `isNewCharge`; una re-entrega del
 * mismo mp_payment_id jamás llega acá):
 *
 *   - cargo RECHAZADO nuevo                      → notifyPagoFallido
 *   - transición MOROSA → ACTIVA                 → notifySuscripcionReactivada
 *   - transición PENDIENTE_ACTIVACION → ACTIVA   → notifySuscripcionActivada
 *
 * Todo lo demás NO dispara: cargos APROBADO sin transición (mensualidad
 * normal), APROBADO con warning de monto (no transiciona por diseño),
 * PENDIENTE/REFUNDED, y activaciones que llegan por el topic
 * subscription_preapproval (la fila ya quedó ACTIVA antes del primer cargo →
 * ese primer cargo no ve transición; gap documentado en el PR).
 *
 * Fail-safe en capas: cada notify* es no-throw por contrato; este wiring
 * además va en try/catch + .catch con Sentry, y corre post-respuesta
 * (runAfterResponse). El webhook NUNCA puede fallar por un email.
 */
function scheduleChargeLifecycleEmails(
  outcome: ChargeAttemptOutcome,
  charge: ChargeAttemptInfo,
): void {
  try {
    if (!outcome.isNewCharge || !charge.payment) return;
    const payment = charge.payment;

    const transicion =
      outcome.estadoAntes !== outcome.estadoDespues
        ? `${outcome.estadoAntes}→${outcome.estadoDespues}`
        : null;

    const tareas: Array<() => Promise<void>> = [];

    if (payment.status === "RECHAZADO") {
      tareas.push(() =>
        notifyPagoFallido({
          organizationId: outcome.organizationId,
          destinatario: outcome.payerEmail,
          mpPaymentId: payment.paymentId,
          ultimoError: payment.statusDetail,
          montoCents: charge.amountCents,
        }),
      );
    }

    if (outcome.estadoAntes === "MOROSA" && outcome.estadoDespues === "ACTIVA") {
      // El episodio que se cierra es morosa_desde ANTES de limpiar. Filas
      // MOROSA pre-M65 (episodio abierto antes del wiring) no tienen ISO
      // estable → preferimos saltear el email a dedupe-ar mal (at-most-once).
      const episodioIso = outcome.morosaDesdeAntes;
      if (episodioIso) {
        tareas.push(() =>
          notifySuscripcionReactivada({
            organizationId: outcome.organizationId,
            destinatario: outcome.payerEmail,
            episodioIso,
            montoMensualCents: outcome.montoMensualCents,
          }),
        );
      } else {
        console.warn(
          `[mp-webhook] recuperación MOROSA→ACTIVA org=${outcome.organizationId} sin morosa_desde (episodio pre-M65): email de reactivación salteado.`,
        );
      }
    }

    if (outcome.estadoAntes === "PENDIENTE_ACTIVACION" && outcome.estadoDespues === "ACTIVA") {
      tareas.push(() =>
        notifySuscripcionActivada({
          organizationId: outcome.organizationId,
          destinatario: outcome.payerEmail,
          mpPreapprovalId: outcome.mpPreapprovalId,
          montoMensualCents: outcome.montoMensualCents,
        }),
      );
    }

    if (tareas.length === 0) return;

    runAfterResponse(() =>
      (async () => {
        for (const tarea of tareas) await tarea();
      })().catch((e) => {
        captureException(e, {
          tags: { component: "mp-webhook", op: "lifecycle-emails" },
          extra: { organizationId: outcome.organizationId, transicion },
        });
      }),
    );
  } catch (e) {
    // Ni siquiera armar las tareas puede romper el webhook.
    captureException(e, {
      tags: { component: "mp-webhook", op: "lifecycle-emails-schedule" },
      extra: { organizationId: outcome.organizationId },
    });
  }
}
