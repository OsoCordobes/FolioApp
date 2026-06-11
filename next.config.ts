import withBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

// Sprint 2 T2.4: ANALYZE=true pnpm build → genera report HTML en
// .next/analyze para identificar chunks pesados (objetivo: onboarding
// initial bundle < 180KB).
const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/**
 * Folio · Next.js config.
 *
 * Security headers — Ley 25.326 + OWASP best-practice for healthcare apps.
 *
 * ─── CSP enforcement history ──────────────────────────────────────────────
 *
 * Phase 8 (mayo 2026) introdujo `Content-Security-Policy-Report-Only`. La
 * intención original era 48 h de soak con reportes a Sentry y luego flip a
 * enforcing. En la práctica el `report-uri` nunca se wireó, así que pasamos
 * a enforcing "ciego" en Sprint 0 (post-auditoría) con análisis estático
 * exhaustivo (docs/audit/csp-violations-2026-05-24.md) + smoke manual en
 * cada ruta crítica + deploy preview verificado antes del merge a master.
 *
 * Sources permitidos:
 *   - 'self' para todo este origen
 *   - Supabase Storage + Realtime + Auth (img + connect + fonts)
 *   - Sentry ingest (Sentry SaaS — replace con self-hosted DSN host si hace falta)
 *   - PostHog ingest + assets (`*.posthog.com` matchea `us.i.posthog.com` por
 *     CSP L3 spec — `*` matchea one or more labels)
 *   - Cloudflare Turnstile (script + frame para el widget)
 *   - Mercado Pago (frame + form para checkout; init_point UI)
 *   - Google Fonts (Geist + Geist Mono + Fraunces; transitional pre-self-host)
 *   - data: + blob: para image previews vía FileReader (LogoUpload, signature)
 *
 * Notas sobre `'unsafe-inline'`:
 *   Sigue presente en script-src y style-src porque Next 15 inyecta su
 *   bootstrap script inline y los styled-jsx producen `<style>` inline.
 *   Sacarlo requiere nonce-based CSP, que es Sprint 3+ (separate plan).
 *
 *   `'unsafe-eval'` SÍ fue removido en Sprint 0 (Next 15 + Turbopack en prod
 *   build no produce eval()).
 */

const SUPABASE_HOST = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
  : "*.supabase.co";

const CSP_DIRECTIVES = [
  `default-src 'self'`,
  // browser.sentry-cdn.com: Session Replay se carga lazy vía
  // Sentry.lazyLoadIntegration (sentry.client.config.ts) — el chunk viene
  // de ese CDN con <script>, así que necesita script-src.
  `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://*.posthog.com https://app.posthog.com https://*.sentry.io https://*.ingest.sentry.io https://browser.sentry-cdn.com https://sdk.mercadopago.com`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com data:`,
  `img-src 'self' data: blob: https://${SUPABASE_HOST} https://www.mercadopago.com https://*.posthog.com`,
  // `connect-src` incluye los hosts de Google Fonts porque `<link rel="preconnect">`
  // cuenta como conexión bajo CSP L3 estricto (warning sino).
  `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST} https://*.sentry.io https://*.ingest.sentry.io https://*.posthog.com https://app.posthog.com https://api.mercadopago.com https://fonts.googleapis.com https://fonts.gstatic.com`,
  `frame-src 'self' https://challenges.cloudflare.com https://www.mercadopago.com https://www.mercadopago.com.ar`,
  `form-action 'self' https://www.mercadopago.com https://www.mercadopago.com.ar`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `object-src 'none'`,
  `upgrade-insecure-requests`,
].join("; ");

const SECURITY_HEADERS = [
  // CSP enforcing (Sprint 0 2026-05-24 — pre-demo hardening).
  // Si una integración legítima rompe acá, ajustar este array y redeploy.
  // Para volver a Report-Only temporal: cambiar la key a
  // "Content-Security-Policy-Report-Only".
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self), fullscreen=(self)" },
  // Cross-origin isolation — useful but not strictly required for now.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  /**
   * Desactiva el badge "Building / Ready" del DevTools indicator de Next
   * en pantallas que se capturan para visual regression. El indicator
   * aparece en bottom-left durante `next dev` y rompe el diff pixel-perfect
   * en pantallas full-screen sin chrome (Focus). En producción no aparece.
   */
  devIndicators: false,
  outputFileTracingIncludes: {
    "/api/admin/migrate": ["./supabase/migrations/*.sql", "./supabase/seed/*.sql"],
  },
  async headers() {
    return [
      {
        // Match every route, including /api/*.
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default withAnalyzer(nextConfig);
