/**
 * Folio · /api/analytics/refresh
 *
 * Endpoint disparado por Vercel Cron (configurado en F9 / vercel.json) cada
 * día a las 03:00 AR (06:00 UTC). Dispara `analytics.refresh_all(periodo)`
 * que recalcula org_metrics_monthly + cohort_benchmarks + org_insights_cache
 * para el mes anterior.
 *
 * Seguridad:
 *   - Autenticación via header `Authorization: Bearer <CRON_SECRET>`.
 *   - El secret vive en env CRON_SECRET (Vercel lo inyecta en cron-triggered
 *     requests si lo configurás como `secret` o lo pasamos manualmente).
 *
 * F11: agregar fallback de notificación a Sentry/Slack si el refresh falla.
 */

import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;                    // segundos (Vercel hobby tier)

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET no configurado" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let periodo: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.periodo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.periodo)) {
      periodo = body.periodo;
    }
  } catch {
    // body opcional
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .schema("analytics")
    .rpc("refresh_all", periodo ? { p_periodo: periodo } : {});

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result: data });
}

// GET para sanity check / curl manual desde producción
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    info: "POST a este endpoint para disparar analytics.refresh_all(). Body opcional: { periodo: 'YYYY-MM-DD' }.",
  });
}
