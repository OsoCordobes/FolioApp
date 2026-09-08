
import { safeLog } from "@/lib/observability/safe-log";
/**
 * Folio · rate limiting con Upstash Redis (REST API, edge-compatible).
 *
 * Tres patrones:
 *   - `limitByIp(scope, ip, ...)`: limit por IP (booking público, captcha).
 *   - `limitByUser(scope, userId, ...)`: limit por user authenticated.
 *   - `limitByOrg(scope, orgId, ...)`: limit por org (analytics queries).
 *
 * Algoritmo: ventana fija con contador y expiración en una operación atómica.
 * La identidad enviada a Redis es un HMAC, nunca la IP o correo originales.
 * Matriz ante fallo (la
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
    throw new Error("upstash_http_error");
  }
  const data = (await res.json()) as UpstashCommandResponse;
  if (data.error) throw new Error("upstash_command_error");
  return data.result;
}

// Redis executes the entire script atomically: an interrupted HTTP response
// cannot leave a newly incremented counter without an expiration.
const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}`;

async function opaqueIdentity(scope: string, key: string): Promise<string> {
  const encoded = process.env.FOLIO_ENC_HMAC_KEY?.trim();
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error("rate_limit_identity_key_invalid");
  }
  const decoded = atob(encoded);
  if (decoded.length !== 32 || btoa(decoded) !== encoded) {
    throw new Error("rate_limit_identity_key_invalid");
  }
  const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
  try {
    const signingKey = await crypto.subtle.importKey(
      "raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC", signingKey,
      new TextEncoder().encode(JSON.stringify(["folio-rate-limit-v1", scope, key])),
    );
    return `rl:v2:${Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("")}`;
  } finally {
    bytes.fill(0);
  }
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
 * Ventana fija iniciada por el primer intento, con TTL `windowSec`.
 * Permite hasta `maxRequests`; también cuenta los intentos rechazados.
 */
export async function rateLimit(
  scope: string,
  key: string,
  options: { maxRequests: number; windowSec: number },
): Promise<RateLimitResult> {
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1 || options.maxRequests > 1_000_000 ||
      !Number.isSafeInteger(options.windowSec) || options.windowSec < 1 || options.windowSec > 86_400) {
    return { ok: false, remaining: 0, resetIn: 60 };
  }
  try {
    if (!isUpstashConfigured()) throw new Error("upstash_not_configured");
    const fullKey = await opaqueIdentity(scope, key);
    const result = await upstashCommand(["EVAL", FIXED_WINDOW_SCRIPT, 1, fullKey, options.windowSec]);
    if (!Array.isArray(result) || result.length !== 2) throw new Error("upstash_counter_invalid");
    const [count, ttl]: unknown[] = result;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 ||
        typeof ttl !== "number" || !Number.isSafeInteger(ttl) || ttl < 0 || ttl > options.windowSec) {
      throw new Error("upstash_counter_invalid");
    }
    return {
      ok: count <= options.maxRequests,
      remaining: Math.max(0, options.maxRequests - count),
      resetIn: Math.max(1, ttl),
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
        safeLog("error", "lib.security.rate.limit.L127",
          `[rate-limit] Upstash keys ausentes en producción con UPSTASH_FAIL_CLOSED=true — fail-closed para scope="${scope}".`,
        );
        return { ok: false, remaining: 0, resetIn: options.windowSec };
      }
      if (isProd() && !warnedMissingEnvs) {
        warnedMissingEnvs = true;
        safeLog("error", "security.rate_limit.missing_config",
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
    safeLog("error", "lib.security.rate.limit.L145", `[rate-limit] Upstash error para scope="${scope}"`, e);
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
