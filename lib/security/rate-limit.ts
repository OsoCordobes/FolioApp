/**
 * Folio · rate limiting con Upstash Redis (REST API, edge-compatible).
 *
 * Tres patrones:
 *   - `limitByIp(scope, ip, ...)`: limit por IP (booking público, captcha).
 *   - `limitByUser(scope, userId, ...)`: limit por user authenticated.
 *   - `limitByOrg(scope, orgId, ...)`: limit por org (analytics queries).
 *
 * Algoritmo: sliding window con `INCR` + `EXPIRE`. Matriz ante fallo (la
 * versión completa vive en el catch de `rateLimit`):
 *   - Keys AUSENTES: fail-open (`ok: true`, `remaining: options.maxRequests`).
 *     En producción loguea un console.error UNA vez por proceso;
 *     UPSTASH_FAIL_CLOSED="true" fuerza fail-closed.
 *   - Keys PRESENTES pero Upstash falla (HTTP/red/timeout): fail-CLOSED en
 *     producción (`ok: false`), salvo UPSTASH_FAIL_CLOSED="false" (escape
 *     hatch fail-open).
 *   - Fuera de producción: siempre fail-open.
 *
 * Env vars (Upstash dashboard → REST URL & Token):
 *   - UPSTASH_REDIS_REST_URL
 *   - UPSTASH_REDIS_REST_TOKEN
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetIn: number;                                // segundos hasta reset
}

interface UpstashCommandResponse {
  result?: unknown;
  error?: string;
}

async function upstashCommand(args: (string | number)[]): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("upstash_not_configured");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
    // Un Upstash colgado no debe colgar la server action: el timeout convierte
    // el cuelgue en un error catcheable (branch (b) del catch de rateLimit).
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) {
    throw new Error(`upstash HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as UpstashCommandResponse;
  if (data.error) throw new Error(`upstash error: ${data.error}`);
  return data.result;
}

const isProd = () => process.env.NODE_ENV === "production";

/**
 * TRUE si ambas envs de Upstash (REST URL + token) están presentes, o sea si el
 * rate limiting está efectivamente provisionado. Fuente de verdad única para
 * `upstashCommand` (que tira `upstash_not_configured` si falta alguna) y para
 * el health check (`/api/health`), que assert-ea esto en producción. Sin leak
 * de valores: sólo booleano.
 */
export function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

let warnedMissingEnvs = false;

/** Solo para tests: resetea el estado de log-once. */
export function __resetRateLimitLogState() {
  warnedMissingEnvs = false;
}

/**
 * Sliding window: `${scope}:${key}` con TTL `windowSec`. Permite hasta
 * `maxRequests` en la ventana. Retorna `ok: false` si se excede.
 */
export async function rateLimit(
  scope: string,
  key: string,
  options: { maxRequests: number; windowSec: number },
): Promise<RateLimitResult> {
  const fullKey = `rl:${scope}:${key}`;
  try {
    const count = (await upstashCommand(["INCR", fullKey])) as number;
    if (count === 1) {
      await upstashCommand(["EXPIRE", fullKey, options.windowSec]);
    }
    const ttl = (await upstashCommand(["TTL", fullKey])) as number;
    return {
      ok: count <= options.maxRequests,
      remaining: Math.max(0, options.maxRequests - count),
      resetIn: typeof ttl === "number" && ttl > 0 ? ttl : options.windowSec,
    };
  } catch (e) {
    // ─── Matriz de fallo (gateada por UPSTASH_FAIL_CLOSED) ────────────────
    //
    //   Situación (en producción)        | unset (default) | "true"  | "false"
    //   keys AUSENTES (not_configured)   | open + error 1× | CLOSED  | open
    //   keys PRESENTES + Upstash falla   | CLOSED          | CLOSED  | open
    //
    // Fuera de producción: siempre fail-open (dev/test no se endurecen).
    //
    //   - unset: default por situación. Keys ausentes → fail-open (F0.4
    //     pendiente: Upstash puede no estar provisionado en prod; fail-closed
    //     acá brickeó signups — audit 2026-05-25 + hotfix f69cd1b), con un
    //     console.error una vez por proceso para visibilidad en Vercel logs.
    //     Keys presentes + error → fail-CLOSED: la infra existe; que falle no
    //     debe apagar la defensa en silencio.
    //   - "true": fail-closed también con keys ausentes. Flip recién cuando
    //     /api/health reporte integrations.upstash_redis=true.
    //   - "false": escape hatch operativo — fail-open total ante un incidente
    //     de Upstash que esté denegando booking/signup (env flip, sin deploy).
    if (e instanceof Error && e.message === "upstash_not_configured") {
      // (a) Envs AUSENTES. Default: fail-open (F0.4 pendiente — Upstash puede
      // no estar provisionado en prod). UPSTASH_FAIL_CLOSED="true" fuerza closed.
      if (isProd() && process.env.UPSTASH_FAIL_CLOSED === "true") {
        console.error(
          `[rate-limit] Upstash keys ausentes en producción con UPSTASH_FAIL_CLOSED=true — fail-closed para scope="${scope}".`,
        );
        return { ok: false, remaining: 0, resetIn: options.windowSec };
      }
      if (isProd() && !warnedMissingEnvs) {
        warnedMissingEnvs = true;
        console.error(
          `[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN ausentes en producción — rate limiting DESACTIVADO (fail-open). Provisionar Upstash (F0.4) cuanto antes.`,
        );
      }
      return { ok: true, remaining: options.maxRequests, resetIn: 0 };
    }
    // (b) Envs PRESENTES pero Upstash tiró error/timeout. NUEVO default en prod:
    // fail-closed (la infra existe; que falle no debe apagar la defensa en
    // silencio). Escape hatch operativo: UPSTASH_FAIL_CLOSED="false" fuerza
    // fail-open. Nota: el AbortError/TimeoutError de AbortSignal.timeout cae
    // acá (no matchea el message del branch (a)).
    console.error(`[rate-limit] Upstash error para scope="${scope}"`, e);
    if (isProd() && process.env.UPSTASH_FAIL_CLOSED !== "false") {
      return { ok: false, remaining: 0, resetIn: options.windowSec };
    }
    return { ok: true, remaining: 0, resetIn: 0 };
  }
}

/** Wrapper conveniente para booking público (IP-based). */
export function limitByIp(scope: string, ip: string | null, maxPerHour = 20) {
  const key = ip ?? "unknown";
  return rateLimit(scope, key, { maxRequests: maxPerHour, windowSec: 3600 });
}

/**
 * Wrapper conveniente para gates por identidad de cuenta (email, user id,
 * org id). Útil para defenderse de ataques de brute-force contra un email
 * específico que vengan distribuidos en muchas IPs.
 */
export function limitByKey(scope: string, key: string | null, maxPerHour = 5) {
  const safeKey = key && key.trim() !== "" ? key.trim().toLowerCase() : "unknown";
  return rateLimit(scope, safeKey, { maxRequests: maxPerHour, windowSec: 3600 });
}

/**
 * Convierte el `resetIn` (segundos) de un `RateLimitResult` en un mensaje
 * user-facing en español argentino, redondeando hacia arriba a minutos
 * enteros y manejando singular/plural.
 *
 *   formatResetMessage(45)   → "Esperá 1 minuto e intentá de nuevo."
 *   formatResetMessage(120)  → "Esperá 2 minutos e intentá de nuevo."
 *   formatResetMessage(0)    → "Esperá un momento e intentá de nuevo."
 */
export function formatResetMessage(resetInSeconds: number): string {
  if (!Number.isFinite(resetInSeconds) || resetInSeconds <= 0) {
    return "Esperá un momento e intentá de nuevo.";
  }
  const mins = Math.ceil(resetInSeconds / 60);
  return `Esperá ${mins} minuto${mins === 1 ? "" : "s"} e intentá de nuevo.`;
}
