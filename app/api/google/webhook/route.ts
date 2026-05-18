/**
 * Folio · /api/google/webhook
 *
 * Endpoint para push notifications de Google Calendar Watch API.
 * Google envía POST con headers indicando qué cambió. Nosotros respondemos
 * 200 OK rápido y enqueueamos un job para hacer sync incremental.
 *
 * Headers que Google envía:
 *   - X-Goog-Channel-ID:         our channel.id (= memberId hash)
 *   - X-Goog-Resource-ID:        resource id del calendar
 *   - X-Goog-Resource-State:     'sync' (initial) | 'exists' (event change)
 *   - X-Goog-Resource-URI:       URL al recurso modificado
 *   - X-Goog-Message-Number:     monotonic counter
 *
 * En F9 el cron renueva watch channels (Google expiration max ~7 días).
 */

import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceId = request.headers.get("x-goog-resource-id");
  const resourceState = request.headers.get("x-goog-resource-state");

  if (!channelId || !resourceId) {
    return new NextResponse("missing headers", { status: 400 });
  }

  // Google envía un POST inicial con resourceState='sync' como handshake.
  // No-op excepto loguear.
  if (resourceState === "sync") {
    return NextResponse.json({ ok: true, type: "sync_ack" });
  }

  // Para resourceState='exists', encolar sync incremental.
  // En F9 cron lo procesa; acá solo respondemos rápido para no bloquear Google.
  // TODO: insertar en cola Supabase realtime o tabla `webhook_event` para procesamiento async.

  return NextResponse.json({ ok: true });
}
