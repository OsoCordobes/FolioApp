import type { NextConfig } from "next";

/**
 * Folio · Next.js config.
 *
 * Security headers — Ley 25.326 + OWASP best-practice for healthcare apps.
 * CSP ships in REPORT-ONLY mode for the first 48 h of the audit-prep sprint
 * so we can review violation reports in Sentry before flipping to enforcing
 * (Phase 8). HSTS / X-Frame / Referrer / Permissions are enforced now —
 * they have low compatibility risk and no need for a soak period.
 *
 * Sources to allow:
 *   - 'self' for everything from this origin
 *   - Supabase Storage + Realtime + Auth (img + connect + fonts)
 *   - Sentry ingest (Sentry SaaS — replace with self-hosted DSN host if needed)
 *   - PostHog ingest + assets
 *   - Cloudflare Turnstile (script + frame for the widget)
 *   - Mercado Pago (frame + form for checkout; init_point UI)
 *   - Google Fonts (Geist + Geist Mono + Fraunces; transitional pre-self-host)
 *   - data: + blob: for image previews from FileReader (LogoUpload, consent signature)
 */

const SUPABASE_HOST = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
  : "*.supabase.co";

const CSP_DIRECTIVES = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://*.posthog.com https://app.posthog.com https://*.sentry.io https://*.ingest.sentry.io https://sdk.mercadopago.com`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com data:`,
  `img-src 'self' data: blob: https://${SUPABASE_HOST} https://www.mercadopago.com https://*.posthog.com`,
  `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST} https://*.sentry.io https://*.ingest.sentry.io https://*.posthog.com https://app.posthog.com https://api.mercadopago.com`,
  `frame-src 'self' https://challenges.cloudflare.com https://www.mercadopago.com https://www.mercadopago.com.ar`,
  `form-action 'self' https://www.mercadopago.com https://www.mercadopago.com.ar`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `object-src 'none'`,
  `upgrade-insecure-requests`,
].join("; ");

const SECURITY_HEADERS = [
  // CSP ships report-only first. Phase 8 flips to enforcing.
  { key: "Content-Security-Policy-Report-Only", value: CSP_DIRECTIVES },
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

export default nextConfig;
