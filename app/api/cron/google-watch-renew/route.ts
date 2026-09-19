/**
 * Folio · /api/cron/google-watch-renew
 *
 * Disparado por Vercel Cron 1x/día. Renueva watch channels de Google Calendar
 * que están por expirar en <48h. Google requiere re-suscribir cada 7 días
 * (TTL máximo).
 *
 * Mapeo schema:
 *   - `integration.proveedor = 'GOOGLE_CALENDAR'`
 *   - `meta_json.watch_channel_id`, `meta_json.watch_resource_id`,
 *     `meta_json.watch_expires_at` (ISO string) son los campos relevantes.
 *
 * Si la integración no tiene refresh_token válido (usuario revocó), guarda
 * el error en `ultimo_error/ultimo_error_ts` y el dueño debe reconectar
 * desde /configuracion (UI en F11).
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { decryptColumn } from "@/lib/crypto";
import { startWatchChannel, stopWatchChannel } from "@/lib/google/calendar";
import { isInvalidGrantError } from "@/lib/google/health";
import { verifyBearer } from "@/lib/security/verify-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RENEW_WINDOW_MS = 48 * 60 * 60 * 1000;

interface IntegrationRow {
  id: string;
  organization_id: string;
  profesional_id: string | null;
  refresh_token_cifrado: Buffer | null;
  meta_json: Record<string, unknown> | null;
}

async function runRenew(requestSignal: AbortSignal): Promise<NextResponse> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json(
      { ok: false, error: "NEXT_PUBLIC_APP_URL no configurada" },
      { status: 500 },
    );
  }

  const service = createSupabaseServiceClient();

  const listed = await service.rpc("google_due_integrations",{p_limit:20,p_watch:true});
  if(listed.error)return NextResponse.json({ok:false,error:"integration_lookup_failed"},{status:503});
  const data=listed.data;
  const signal=AbortSignal.any([requestSignal,AbortSignal.timeout(45_000)]);
  const rows = (data ?? []) as IntegrationRow[];
  const cutoffMs = Date.now() + RENEW_WINDOW_MS;
  const due = rows.filter((row) => {
    const meta = row.meta_json ?? {};
    const expires = typeof meta.watch_expires_at === "string" ? meta.watch_expires_at : null;
    if (!expires || typeof meta.watch_token !== "string") return true;                                  // nunca tuvo watch
    return !Number.isFinite(Date.parse(expires)) || new Date(expires).getTime() <= cutoffMs;
  });

  for(const row of rows.filter(row=>!due.includes(row))) {
    await service.from("integration").update({google_watch_next_attempt_at:new Date(Date.now()+24*60*60_000).toISOString()}).eq("id",row.id);
  }
  const stats = { processed: 0, renewed: 0, failed: 0 };
  const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/google/webhook`;

  for (const row of due.slice(0,20)) {
    if(signal.aborted)break;
    stats.processed += 1;
    try {
      const allowed=await service.rpc("google_integration_access",{p_id:row.id});
      if(allowed.error||allowed.data!==true)throw new Error("google_scope_revoked");
      const refreshToken = decryptColumn(row.refresh_token_cifrado);
      if (!refreshToken) throw new Error("refresh_token vacío o no desencriptable");

      const meta = row.meta_json ?? {};
      const prevChannel = typeof meta.watch_channel_id === "string" ? meta.watch_channel_id : null;
      const prevResource = typeof meta.watch_resource_id === "string" ? meta.watch_resource_id : null;

      const calendarId=typeof meta.calendar_id==="string"?meta.calendar_id:"primary";
      const channelId=`folio-${randomUUID()}`;
      const channelToken=randomUUID()+randomUUID();
      const {resourceId,expiration}=await startWatchChannel(refreshToken,channelId,webhookUrl,calendarId,channelToken,signal);
      const expiresAt = expiration ? new Date(Number(expiration)).toISOString() : null;
      const committed=await service.rpc("google_commit_watch",{p_id:row.id,p_calendar:calendarId,p_previous:prevChannel,p_channel:channelId,p_resource:resourceId,p_token:channelToken,p_expires:expiresAt});
      if(committed.error)throw new Error("watch_commit_uncertain");
      if(committed.data!==true){
        try{await stopWatchChannel(refreshToken,channelId,resourceId,signal)}catch{/* Own rejected new channel expires naturally. */}
        throw new Error("watch_commit_conflict");
      }
      // Preserve the working old channel until its replacement is durably committed.
      if(prevChannel&&prevResource){try{await stopWatchChannel(refreshToken,prevChannel,prevResource,signal)}catch{/* Old channel expires; new one is already durable. */}}
      stats.renewed += 1;
    } catch (e) {
      stats.failed += 1;
      const marca=isInvalidGrantError(e)?"invalid_grant":"watch_renew_failed";
      await service
        .from("integration")
        .update({ ultimo_error: marca, ultimo_error_ts: new Date().toISOString(),google_watch_next_attempt_at:new Date(Date.now()+60*60_000).toISOString() })
        .eq("id", row.id);
    }
  }

  return NextResponse.json({ ok: true, ...stats });
}

function authorize(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET no configurado" }, { status: 500 });
  }
  if (!verifyBearer(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  return runRenew(req.signal);
}

export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  return runRenew(req.signal);
}
