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
 */

import { NextResponse, type NextRequest } from "next/server";

import { verifyMpSignature } from "@/lib/mercadopago/webhook-security";
import { getPaymentProvider } from "@/lib/payments";
import {
  applySubscriptionUpdate,
  recordChargeAttempt,
} from "@/lib/db/suscripcion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      return new NextResponse("processing-timeout", { status: 503 });
    }
    if (outcome) return outcome;
  } catch (e) {
    // Errores transitorios (MP API down, DB hiccup) → 500 para que MP reintente.
    // Errores de lógica con la fila local los logueamos pero devolvemos 200.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[mp-webhook] error procesando type=${payload.type} dataId=${dataId}: ${msg}`);
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
          return new NextResponse("subscription-not-linked-yet", { status: 503 });
        }
        console.warn(`[mp-webhook] recordChargeAttempt falló: ${res.error.message}`);
      }
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
