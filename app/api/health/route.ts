/**
 * Folio · /api/health
 *
 * Health check público para load balancers / uptime monitoring (UptimeRobot,
 * BetterStack, etc.). Devuelve:
 *   - ok: true si todas las dependencias críticas responden
 *   - checks: status individual por dependencia (db, env)
 *   - version: SHA del commit deployado (Vercel inyecta `VERCEL_GIT_COMMIT_SHA`)
 *
 * No expone secrets ni datos del tenant. Safe para exponer en GET sin auth.
 */

import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export async function GET() {
  const checks: Record<string, CheckResult> = {};

  // 1. Database ping
  checks.db = await timed(async () => {
    const service = createSupabaseServiceClient();
    const { error } = await service.from("organization").select("id").limit(1);
    if (error) throw new Error(error.message);
  });

  // 2. Env críticas presentes
  const requiredEnv = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "FOLIO_ENC_KEY",
  ];
  const missing = requiredEnv.filter((k) => !process.env[k]);
  checks.env = { ok: missing.length === 0, error: missing.length > 0 ? `falta: ${missing.join(",")}` : undefined };

  const ok = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      ok,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      env: process.env.VERCEL_ENV ?? "development",
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}

async function timed(fn: () => Promise<void>): Promise<CheckResult> {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
