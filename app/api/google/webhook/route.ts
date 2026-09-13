/** Provider notifications are authenticated by the persisted channel secret and
 * resource pair. A durable dirty marker + lease preserves concurrent notifications;
 * only a fully validated window snapshot can replace local Google blocks. */

import { NextResponse, type NextRequest } from "next/server";

import { verifyBearer } from "@/lib/security/verify-bearer";
import { syncGoogleInbound, type IntegrationRow } from "@/lib/google/inbound";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceId = request.headers.get("x-goog-resource-id");
  const resourceState = request.headers.get("x-goog-resource-state");

  if (!channelId || !resourceId || channelId.length>200 || resourceId.length>300 || !["sync","exists","not_exists"].includes(resourceState??"")) {
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
  const token=request.headers.get("x-goog-channel-token");
  if (meta.watch_resource_id !== resourceId || typeof meta.watch_token!=="string" || !verifyBearer(token?`Bearer ${token}`:null,meta.watch_token) || typeof meta.watch_expires_at!=="string" || !Number.isFinite(Date.parse(meta.watch_expires_at)) || Date.parse(meta.watch_expires_at)<=Date.now()) {
    return NextResponse.json({ ok: true, type: "resource_mismatch" });
  }

  try {
    const result = await syncGoogleInbound(service, integration as IntegrationRow, AbortSignal.any([request.signal,AbortSignal.timeout(45_000)]));
    return NextResponse.json({ state: resourceState, ...result });
  } catch (e) {
    const { captureException } = await import("@sentry/nextjs");
    captureException(e, {
      tags: { component: "gcal-sync", op: "inboundWebhook" },
    });
    // 503: Google reintenta con backoff exponencial y desiste solo.
    return NextResponse.json({ ok: false, error: "sync_failed" }, { status: 503 });
  }
}
