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

import {
  getAuthorizedPayment,
  getPreapproval,
} from "@/lib/mercadopago/client";
import { verifyMpSignature } from "@/lib/mercadopago/webhook-security";
import {
  applyMpPreapprovalUpdate,
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

  try {
    switch (payload.type) {
      case "subscription_preapproval": {
        // dataId = preapproval_id. GET para obtener estado actualizado.
        const preapproval = await getPreapproval(dataId);
        const res = await applyMpPreapprovalUpdate(preapproval);
        if (!res.ok) {
          console.warn(`[mp-webhook] applyMpPreapprovalUpdate falló: ${res.error.message}`);
        }
        break;
      }

      case "subscription_authorized_payment": {
        // dataId = authorized_payment_id. GET para obtener payment + preapproval_id.
        const ap = await getAuthorizedPayment(dataId);
        const res = await recordChargeAttempt({
          preapprovalId: ap.preapproval_id,
          authorizedPayment: ap,
          rawPayload: payload,
        });
        if (!res.ok) {
          console.warn(`[mp-webhook] recordChargeAttempt falló: ${res.error.message}`);
        }
        break;
      }

      case "payment": {
        // Lo ignoramos — viene también como subscription_authorized_payment.
        break;
      }

      default: {
        console.warn(`[mp-webhook] type desconocido: ${payload.type}`);
        break;
      }
    }
  } catch (e) {
    // Errores transitorios (MP API down, DB hiccup) → 500 para que MP reintente.
    // Errores de lógica con la fila local los logueamos pero devolvemos 200.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[mp-webhook] error procesando type=${payload.type} dataId=${dataId}: ${msg}`);
    return new NextResponse("processing-error", { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
