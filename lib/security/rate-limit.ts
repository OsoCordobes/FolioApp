/**
 * Folio · rate limiting con Upstash Redis (REST API, edge-compatible).
 *
 * Tres patrones:
 *   - `limitByIp(scope, ip, ...)`: limit por IP (booking público, captcha).
 *   - `limitByUser(scope, userId, ...)`: limit por user authenticated.
 *   - `limitByOrg(scope, orgId, ...)`: limit por org (analytics queries).
 *
 * Algoritmo: sliding window con `INCR` + `EXPIRE`. Si Upstash no está
 * configurado (dev), retorna `{ ok: true, remaining: Infinity }` para no
 * romper el flow local. En producción la falta de env vars hace `ok: false`.
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
  });
  if (!res.ok) {
    throw new Error(`upstash HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as UpstashCommandResponse;
  if (data.error) throw new Error(`upstash error: ${data.error}`);
  return data.result;
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
    // ─── upstash_not_configured ────────────────────────────────────────────
    // Triggered when UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is
    // missing at request time. Behavior is gated by `UPSTASH_FAIL_CLOSED`:
    //
    //   - Default (env unset, or "false"): fail-open with a loud warning in
    //     production. This preserves availability during the demo phase
    //     while Upstash is being provisioned. Earlier history: fail-closed
    //     here bricked signups in production because Upstash was never
    //     wired (audit 2026-05-25 + hotfix f69cd1b).
    //
    //   - UPSTASH_FAIL_CLOSED=true: fail-closed in production. Operators
    //     should flip this AFTER Upstash is provisioned and the /api/health
    //     `integrations.upstash_redis` flag reads true. From that point on
    //     this branch is unreachable in normal operation — if it ever fires,
    //     someone removed the keys, and we want to fail-closed to avoid a
    //     silent regression of the rate-limit defense. The captured exception
    //     pages on-call (assuming Sentry is wired).
    //
    // This dual mode lets the code merge today (safe defaults) and lets the
    // operator opt into fail-closed AFTER Upstash + Sentry are verified
    // live, with a single env flip and no code change.
    if (e instanceof Error && e.message === "upstash_not_configured") {
      const failClosed =
        process.env.NODE_ENV === "production" &&
        process.env.UPSTASH_FAIL_CLOSED === "true";
      if (failClosed) {
        console.error(
          `[rate-limit] Upstash keys missing in production AND UPSTASH_FAIL_CLOSED=true — failing closed for scope="${scope}". Restore UPSTASH_REDIS_REST_URL/TOKEN or unset UPSTASH_FAIL_CLOSED.`,
        );
        return { ok: false, remaining: 0, resetIn: options.windowSec };
      }
      if (process.env.NODE_ENV === "production") {
        console.warn(
          `[rate-limit] Upstash no configurado en producción — fail-open para scope="${scope}". Configurar UPSTASH_REDIS_REST_URL/TOKEN y setear UPSTASH_FAIL_CLOSED=true para defensa completa.`,
        );
      }
      return { ok: true, remaining: options.maxRequests, resetIn: 0 };
    }
    // Cualquier otro error: log + fail-open (preferimos disponibilidad sobre
    // bloqueo cuando Upstash mismo está caído — Upstash dropping connections
    // shouldn't take signup down). Sentry capturará en F11.
    console.error("[rate-limit] error", e);
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
