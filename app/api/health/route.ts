/**
 * Folio · /api/health
 *
 * Health check público para load balancers / uptime monitoring (UptimeRobot,
 * BetterStack, etc.). Devuelve:
 *   - ok: true si todas las dependencias críticas responden
 *   - checks: status individual por dependencia (db, env, rate_limit)
 *   - version: SHA del commit deployado (Vercel inyecta `VERCEL_GIT_COMMIT_SHA`)
 *
 * No expone secrets ni datos del tenant. Safe para exponer en GET sin auth.
 */

import { captureMessage } from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { isUpstashConfigured } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

// Alerta de Upstash ausente en prod: fire-once por proceso. `/api/health` lo
// pinguean monitores de uptime con frecuencia — sin este guard, un deploy sin
// Upstash inundaría Sentry con un evento por request. Espeja el log-once de
// lib/security/rate-limit.ts (warnedMissingEnvs) y el dedupe de lib/crypto.ts.
let alertedUpstashMissing = false;

/** Solo para tests: resetea el estado de fire-once del alert de Upstash. */
export function __resetHealthAlertState() {
  alertedUpstashMissing = false;
}

export async function GET() {
  const checks: Record<string, CheckResult> = {};

  // 1. Database ping
  checks.db = await timed(async () => {
    const service = createSupabaseServiceClient();
    const { error } = await service.from("organization").select("id").limit(1);
    if (error) throw new Error(error.message);
  });

  // 2. Env críticas presentes (bloquean boot si faltan)
  const requiredEnv = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "FOLIO_ENC_KEY",
  ];
  const missing = requiredEnv.filter((k) => !process.env[k]);
  checks.env = { ok: missing.length === 0, error: missing.length > 0 ? `falta: ${missing.join(",")}` : undefined };

  // 3. Rate limiting provisionado (Upstash). En PRODUCCIÓN es un check duro: sin
  // Upstash el rate limiting queda fail-open (booking/signup/captcha sin
  // defensa de brute-force — ver lib/security/rate-limit.ts). Se assert-ea acá
  // para que el go-live no pase con la defensa apagada en silencio; además se
  // reporta a Sentry (no sólo console) una vez por proceso. Fuera de prod no
  // baja `ok` (dev/test no necesitan Upstash). El booleano crudo sigue expuesto
  // en `integrations.upstash_redis` para diagnóstico en cualquier entorno.
  const upstashOk = isUpstashConfigured();
  const inProd = process.env.NODE_ENV === "production";
  checks.rate_limit = {
    ok: upstashOk || !inProd,
    error: !upstashOk && inProd ? "Upstash no configurado — rate limiting fail-open" : undefined,
  };
  if (!upstashOk && inProd && !alertedUpstashMissing) {
    alertedUpstashMissing = true;
    captureMessage(
      "[health] Upstash no configurado en producción — rate limiting DESACTIVADO (fail-open)",
      {
        level: "error",
        tags: { component: "health", op: "rate-limit-assertion" },
      },
    );
  }

  // 4. Envs de integraciones runtime (no bloquean boot pero sí features).
  // Reporta presencia (boolean) sin leak de valores. Útil para diagnosticar
  // qué features están funcionales en este deploy.
  const integrations = {
    google_calendar: Boolean(
      process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI,
    ),
    whatsapp: Boolean(
      process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID,
    ),
    mercadopago: Boolean(
      process.env.MP_ACCESS_TOKEN &&
      process.env.MP_WEBHOOK_SECRET,
    ),
    turnstile: Boolean(
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY &&
      process.env.TURNSTILE_SECRET_KEY,
    ),
    // Derivado de isUpstashConfigured() (misma fuente que checks.rate_limit) —
    // presencia de ambas keys, sin leak de valores.
    upstash_redis: upstashOk,
    sentry: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
    posthog: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
    // Secreto que autentica los Vercel Crons (Bearer). Sin él, todo /api/cron/*
    // responde 401 y los jobs no corren. Informativo: no baja `ok` (los crones
    // no son dependencia de boot), pero DEBE estar true antes del go-live.
    cron_secret: Boolean(process.env.CRON_SECRET),
    // Webhook de MP funcional end-to-end: necesita el secreto de firma HMAC
    // (MP_WEBHOOK_SECRET) y el token para resolver pagos/preapproval contra MP
    // (MP_ACCESS_TOKEN). Informativo: no baja `ok`, pero DEBE estar true para
    // que la suscripción se active automáticamente.
    mp_webhook_secret: Boolean(
      process.env.MP_WEBHOOK_SECRET && process.env.MP_ACCESS_TOKEN,
    ),
    // Email transaccional (confirmación de booking, invitaciones de equipo).
    // Sin esto sendEmail loguea en vez de enviar (fail-safe) — el estado era
    // invisible en el health y costó diagnosticarlo (auditoría 2026-06-11).
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    // Clave HMAC de los blind indexes (búsqueda/dedup por nombre/teléfono/DNI).
    enc_hmac_key: Boolean(process.env.FOLIO_ENC_HMAC_KEY),
    // Base URL pública (links en emails, OAuth redirects, metadata OG).
    app_url: Boolean(process.env.NEXT_PUBLIC_APP_URL),
  };

  const ok = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      ok,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      env: process.env.VERCEL_ENV ?? "development",
      region: process.env.VERCEL_REGION ?? "unknown",
      checks,
      integrations,
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
