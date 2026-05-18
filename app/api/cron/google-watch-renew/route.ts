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

async function runRenew(): Promise<NextResponse> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json(
      { ok: false, error: "NEXT_PUBLIC_APP_URL no configurada" },
      { status: 500 },
    );
  }

  const service = createSupabaseServiceClient();

  const { data, error } = await service
    .from("integration")
    .select("id, organization_id, profesional_id, refresh_token_cifrado, meta_json")
    .eq("proveedor", "GOOGLE_CALENDAR")
    .limit(50);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as IntegrationRow[];
  const cutoffMs = Date.now() + RENEW_WINDOW_MS;
  const due = rows.filter((row) => {
    const meta = row.meta_json ?? {};
    const expires = typeof meta.watch_expires_at === "string" ? meta.watch_expires_at : null;
    if (!expires) return true;                                  // nunca tuvo watch
    return new Date(expires).getTime() <= cutoffMs;
  });

  const stats = { processed: 0, renewed: 0, failed: 0, errors: [] as string[] };
  const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/google/webhook`;

  for (const row of due) {
    stats.processed += 1;
    try {
      const refreshToken = decryptColumn(row.refresh_token_cifrado);
      if (!refreshToken) throw new Error("refresh_token vacío o no desencriptable");

      const meta = row.meta_json ?? {};
      const prevChannel = typeof meta.watch_channel_id === "string" ? meta.watch_channel_id : null;
      const prevResource = typeof meta.watch_resource_id === "string" ? meta.watch_resource_id : null;

      // Stop previous channel (best-effort)
      if (prevChannel && prevResource) {
        try {
          await stopWatchChannel(refreshToken, prevChannel, prevResource);
        } catch (e) {
          // Channel expirado/inválido — Google retorna 404. Ignoramos.
          void e;
        }
      }

      const channelId = `folio-${row.id}-${randomUUID().slice(0, 8)}`;
      const { resourceId, expiration } = await startWatchChannel(
        refreshToken,
        channelId,
        webhookUrl,
      );

      const expiresAt = expiration ? new Date(Number(expiration)).toISOString() : null;
      await service
        .from("integration")
        .update({
          meta_json: {
            ...meta,
            watch_channel_id: channelId,
            watch_resource_id: resourceId,
            watch_expires_at: expiresAt,
          },
          ultimo_uso_ts: new Date().toISOString(),
          ultimo_error: null,
          ultimo_error_ts: null,
        })
        .eq("id", row.id);

      stats.renewed += 1;
    } catch (e) {
      stats.failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      stats.errors.push(`${row.id}: ${msg}`);

      await service
        .from("integration")
        .update({ ultimo_error: msg.slice(0, 500), ultimo_error_ts: new Date().toISOString() })
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
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  return runRenew();
}

export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  return runRenew();
}
