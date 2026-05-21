# Folio · Content Security Policy

Defined in `next.config.ts` via `async headers()`. **Currently shipped in `Content-Security-Policy-Report-Only` mode** during the audit window so violation reports surface in Sentry without blocking legitimate traffic. Flip to enforcing is post-audit Week 1 after the Sentry report is reviewed.

## Directives

```
default-src 'self'
script-src 'self' 'unsafe-inline' 'unsafe-eval'
           https://challenges.cloudflare.com
           https://*.posthog.com https://app.posthog.com
           https://*.sentry.io https://*.ingest.sentry.io
           https://sdk.mercadopago.com
style-src  'self' 'unsafe-inline'
           https://fonts.googleapis.com
font-src   'self' https://fonts.gstatic.com data:
img-src    'self' data: blob:
           https://<supabase-host>
           https://www.mercadopago.com
           https://*.posthog.com
connect-src 'self'
           https://<supabase-host>
           wss://<supabase-host>
           https://*.sentry.io https://*.ingest.sentry.io
           https://*.posthog.com https://app.posthog.com
           https://api.mercadopago.com
frame-src  'self'
           https://challenges.cloudflare.com
           https://www.mercadopago.com
           https://www.mercadopago.com.ar
form-action 'self'
           https://www.mercadopago.com
           https://www.mercadopago.com.ar
frame-ancestors 'none'
base-uri 'self'
object-src 'none'
upgrade-insecure-requests
```

`<supabase-host>` is derived at runtime from `NEXT_PUBLIC_SUPABASE_URL`.

## Companion headers

| Header | Value | Purpose |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | 2-year HSTS + browser preload eligibility |
| `X-Frame-Options` | `DENY` | belt-and-suspenders with `frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` | block MIME-type sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | reasonable referrer redaction |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self), payment=(self), fullscreen=(self)` | feature-policy restrictions |
| `Cross-Origin-Opener-Policy` | `same-origin` | cross-origin isolation |

## Allowlist rationale

- **Cloudflare Turnstile** (`challenges.cloudflare.com`) — invisible captcha on signup + booking.
- **Sentry** (`*.sentry.io`, `*.ingest.sentry.io`) — error ingestion + source maps + tracing.
- **PostHog** (`*.posthog.com`, `app.posthog.com`) — analytics ingestion; cookie-gated.
- **Mercado Pago** (`sdk.mercadopago.com`, `www.mercadopago.com`, `www.mercadopago.com.ar`, `api.mercadopago.com`) — checkout SDK + frame + webhook origin.
- **Supabase** (`<supabase-host>`, `wss://<supabase-host>`) — REST + Realtime + Storage.
- **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`) — Geist + Geist Mono + Fraunces. Transitional; self-hosting evaluated F11.

## Post-audit hardening

1. Flip header from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` (after 48h Sentry violation-report soak).
2. Drop `'unsafe-eval'` from `script-src` once Next.js dev-mode is no longer on the same allowlist as production.
3. Self-host Google Fonts; drop `fonts.googleapis.com` + `fonts.gstatic.com`.
4. Add `report-uri` directive pointing at a Sentry CSP-violation endpoint.

## Verification

```bash
curl -sI https://<deployment-url>/login \
  | grep -iE "content-security|strict-transport|x-frame|referrer-policy|permissions-policy"
```

E2E: `tests/e2e/security-headers.spec.ts` — 5 cases, all green.
