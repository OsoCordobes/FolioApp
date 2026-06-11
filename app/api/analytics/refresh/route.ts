/**
 * Folio · /api/analytics/refresh
 *
 * Endpoint disparado por Vercel Cron diariamente a las 03:00 AR (06:00 UTC).
 * Dispara `analytics.refresh_all(periodo)` que recalcula org_metrics_monthly +
 * cohort_benchmarks + org_insights_cache para el mes anterior.
 *
 * Seguridad:
 *   - Autenticación via header `Authorization: Bearer <CRON_SECRET>`.
 *   - Vercel Cron inyecta este header automáticamente cuando hay env
 *     `CRON_SECRET` configurada.
 *
 * Vercel Cron usa GET por default. También aceptamos POST con body opcional
 * `{ periodo: 'YYYY-MM-DD' }` para backfills manuales.
 *
 * F11: agregar fallback de notificación a Sentry/Slack si el refresh falla.
 */

import { NextRequest, NextResponse } from "next/server";

import { verifyBearer } from "@/lib/security/verify-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(periodo: string | null) {
  const service = createSupabaseServiceClient();
  return service.schema("analytics").rpc("refresh_all", periodo ? { p_periodo: periodo } : {});
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

  const periodo = req.nextUrl.searchParams.get("periodo");
  const validPeriodo = periodo && /^\d{4}-\d{2}-\d{2}$/.test(periodo) ? periodo : null;
  const { data, error } = await run(validPeriodo);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, result: data });
}

export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;

  let periodo: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.periodo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.periodo)) {
      periodo = body.periodo;
    }
  } catch {
    // body opcional
  }

  const { data, error } = await run(periodo);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, result: data });
}
