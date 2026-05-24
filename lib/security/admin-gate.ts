/**
 * Folio · admin-gate: gate compartido para endpoints administrativos en producción.
 *
 * Los endpoints bajo `/api/admin/*` son herramientas operativas (migrations,
 * confirmación manual de email, seeds de demo). Históricamente solo estaban
 * protegidos por `Authorization: Bearer ${CRON_SECRET}`. Auditoría 2026-05-23
 * (findings C1, C3) demostró que un solo factor (secret leaks → DROP SCHEMA
 * disponible) no alcanza para endpoints destructivos.
 *
 * Este helper agrega un segundo factor según el tipo de operación:
 *
 *   - `prod-disabled`     → el endpoint retorna 404 en producción siempre.
 *                            Ej: `/api/admin/seed-hoy-demo` (data fake).
 *
 *   - `prod-escape-hatch` → el endpoint requiere una env var específica
 *                            (ej. ALLOW_PROD_RESET=yes-im-sure-2026) que se
 *                            setea manualmente en Vercel por el tiempo de la
 *                            operación y luego se quita. Sin la env, 403.
 *                            Ej: `/api/admin/migrate?reset=true`.
 *
 *   - `no-gate`           → no aplica gate. Útil en tests o cuando el endpoint
 *                            mismo decide cuándo aplicar el patrón.
 *
 * Convención de uso (después del Bearer check, antes de cualquier side effect):
 *
 *   const gate = checkAdminGate({ mode: "prod-escape-hatch",
 *     escapeHatch: { envVar: "ALLOW_PROD_RESET", expected: "yes-im-sure-2026" } });
 *   if (gate) return gate;
 *
 * Detección de producción: `process.env.VERCEL_ENV === "production"`. En Vercel
 * los entornos son `production` | `preview` | `development`. Preview NO cuenta
 * como prod (queremos poder probar migrations / confirm-user en preview deploys).
 */

import { NextResponse } from "next/server";

export type AdminGateMode = "prod-disabled" | "prod-escape-hatch" | "no-gate";

export interface AdminGateOptions {
  mode: AdminGateMode;
  /** Required when mode === "prod-escape-hatch". Ignored otherwise. */
  escapeHatch?: { envVar: string; expected: string };
}

export function checkAdminGate(opts: AdminGateOptions): NextResponse | null {
  if (opts.mode === "no-gate") return null;

  const isProd = process.env.VERCEL_ENV === "production";
  if (!isProd) return null;

  if (opts.mode === "prod-disabled") {
    return NextResponse.json(
      { ok: false, error: "endpoint disabled in production" },
      { status: 404 },
    );
  }

  // mode === "prod-escape-hatch"
  const hatch = opts.escapeHatch;
  if (!hatch) {
    // Defensa: si el caller olvida pasar escapeHatch en prod-escape-hatch,
    // tratamos como prod-disabled (fail-closed). Mejor 404 que un endpoint
    // accidentalmente abierto.
    return NextResponse.json(
      { ok: false, error: "admin gate misconfigured: missing escape hatch" },
      { status: 500 },
    );
  }
  if (process.env[hatch.envVar] === hatch.expected) {
    return null;
  }
  return NextResponse.json(
    { ok: false, error: "endpoint disabled in production; set escape hatch to enable" },
    { status: 403 },
  );
}
