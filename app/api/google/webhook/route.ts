/**
 * Folio · /api/google/webhook
 *
 * Endpoint para push notifications de Google Calendar Watch API.
 * Google envía POST con headers indicando qué cambió; acá resolvemos la
 * integración dueña del channel y corremos el sync inbound (Google → bloqueo)
 * inline — es una sola llamada a events.list por notificación, idempotente.
 *
 * Headers que Google envía:
 *   - X-Goog-Channel-ID:         our channel.id (folio-<integration_id>-<rand>)
 *   - X-Goog-Resource-ID:        resource id del calendar
 *   - X-Goog-Resource-State:     'sync' (handshake inicial) | 'exists' (cambio)
 *   - X-Goog-Message-Number:     monotonic counter
 *
 * Autenticación: Google no firma estas notificaciones. El channel id es
 * inguessable (lo generamos con randomUUID en google-watch-renew) y además
 * exigimos que el resource id coincida con el registrado en meta_json.
 * Un channel desconocido responde 200 (channels viejos que ya rotamos —
 * devolver error solo haría que Google reintente para siempre).
 *
 * El handshake 'sync' también sincroniza: como el cron de renovación rota
 * el channel a diario, eso nos da una reconciliación diaria gratis aunque
 * se pierda alguna notificación.
 */

import { NextResponse, type NextRequest } from "next/server";

import { INVALID_GRANT_MARKER, isInvalidGrantError } from "@/lib/google/health";
import { syncGoogleInbound, type IntegrationRow } from "@/lib/google/inbound";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceId = request.headers.get("x-goog-resource-id");
  const resourceState = request.headers.get("x-goog-resource-state");

  if (!channelId || !resourceId) {
    return new NextResponse("missing headers", { status: 400 });
  }

  const service = createSupabaseServiceClient();

  const { data: integration, error: lookupErr } = await service
    .from("integration")
    .select("id, organization_id, profesional_id, refresh_token_cifrado, meta_json")
    .eq("proveedor", "GOOGLE_CALENDAR")
    .eq("meta_json->>watch_channel_id", channelId)
    .maybeSingle();

  if (lookupErr) {
    // Error de DB transitorio: 503 para que Google reintente con backoff.
    return NextResponse.json({ ok: false, error: "lookup_failed" }, { status: 503 });
  }
  if (!integration) {
    // Channel rotado/desconocido — ack para cortar los reintentos.
    return NextResponse.json({ ok: true, type: "unknown_channel" });
  }

  const meta = (integration.meta_json ?? {}) as Record<string, unknown>;
  if (meta.watch_resource_id !== resourceId) {
    return NextResponse.json({ ok: true, type: "resource_mismatch" });
  }

  try {
    const result = await syncGoogleInbound(service, integration as IntegrationRow);
    await service
      .from("integration")
      .update({
        ultimo_uso_ts: new Date().toISOString(),
        ultimo_error: null,
        ultimo_error_ts: null,
      })
      .eq("id", integration.id);
    return NextResponse.json({ state: resourceState, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const { captureException } = await import("@sentry/nextjs");
    captureException(e, {
      tags: { component: "gcal-sync", op: "inboundWebhook" },
      extra: { integrationId: integration.id, resourceState },
    });
    // invalid_grant = token revocado → integración MUERTA hasta re-OAuth.
    // Prefijo canónico para que la UI (nudge de /hoy, "Reconectar" en
    // /configuracion) lo distinga de errores transitorios sin depender del
    // texto exacto que devuelva googleapis.
    const marca = isInvalidGrantError(e) ? `${INVALID_GRANT_MARKER}: ${msg}` : msg;
    await service
      .from("integration")
      .update({ ultimo_error: marca.slice(0, 500), ultimo_error_ts: new Date().toISOString() })
      .eq("id", integration.id);
    // 503: Google reintenta con backoff exponencial y desiste solo.
    return NextResponse.json({ ok: false, error: "sync_failed" }, { status: 503 });
  }
}
