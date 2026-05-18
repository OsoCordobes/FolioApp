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
    // Sin Upstash en dev: permitir. En producción, esto rompe el flow para
    // que el dev se entere y configure las env vars.
    if (e instanceof Error && e.message === "upstash_not_configured") {
      if (process.env.NODE_ENV === "production") {
        console.error("[rate-limit] Upstash no configurado en producción — fail-closed");
        return { ok: false, remaining: 0, resetIn: options.windowSec };
      }
      return { ok: true, remaining: options.maxRequests, resetIn: 0 };
    }
    // Cualquier otro error: log + fail-open (preferimos disponibilidad sobre
    // bloqueo cuando Upstash mismo está caído). Sentry capturará en F11.
    console.error("[rate-limit] error", e);
    return { ok: true, remaining: 0, resetIn: 0 };
  }
}

/** Wrapper conveniente para booking público (IP-based). */
export function limitByIp(scope: string, ip: string | null, maxPerHour = 20) {
  const key = ip ?? "unknown";
  return rateLimit(scope, key, { maxRequests: maxPerHour, windowSec: 3600 });
}
