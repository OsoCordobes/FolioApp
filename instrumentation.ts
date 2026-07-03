/**
 * Folio · Next.js instrumentation hook.
 *
 * Carga Sentry en el runtime correcto (Node.js vs Edge). Sin DSN configurada,
 * Sentry no envía datos.
 */

export async function register() {
  // Audit-prep Phase 8: production startup hard-fail if critical envs are
  // missing. Pre-Phase-8 the middleware fell open when NEXT_PUBLIC_SUPABASE_URL
  // was absent — acceptable for visual regression, dangerous in production
  // (would expose authenticated routes to anonymous traffic). Fail fast at
  // boot so a misconfigured deploy can never serve.
  if (process.env.NODE_ENV === "production" && process.env.NEXT_RUNTIME === "nodejs") {
    const required = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "FOLIO_ENC_KEY",
      "FOLIO_ENC_HMAC_KEY",
    ];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      // Throw immediately. Vercel marks the deploy as failed, which is the
      // desired posture for missing critical secrets.
      throw new Error(
        `[Folio · startup] Missing required env vars in production: ${missing.join(", ")}. Refusing to boot.`,
      );
    }

    // Dominio único (ítem 1.3): confirmada seteada en prod (health app_url:true),
    // pero mientras F0.2 (dominio custom) esté pendiente esto es WARN, no throw —
    // lib/config/app-url.ts degrada a VERCEL_PROJECT_PRODUCTION_URL/VERCEL_URL.
    // TODO(F0.2): mover "NEXT_PUBLIC_APP_URL" al array `required` de arriba
    // cuando el dominio final exista y la env apunte a él (en prod Y preview).
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      console.error(
        "[Folio · startup] NEXT_PUBLIC_APP_URL no está seteada — URLs absolutas degradan a VERCEL_PROJECT_PRODUCTION_URL/VERCEL_URL.",
      );
    }
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = async (...args: unknown[]) => {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    const { captureRequestError } = await import("@sentry/nextjs");
    return (captureRequestError as (...args: unknown[]) => unknown)(...args);
  }
};
