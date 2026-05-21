import { expect, test } from "@playwright/test";

/**
 * Folio · security headers acceptance — Phase 1 of pre-audit sprint.
 *
 * Verifies that every response (HTML routes + API routes) carries the
 * security headers configured in next.config.ts. CSP is shipped in
 * Report-Only mode during the sprint; Phase 8 flips to enforcing.
 *
 * Reference: docs/audit/csp-policy.md (to be authored in Phase 9 packet).
 */

const REQUIRED_HEADERS = [
  "content-security-policy-report-only",
  "strict-transport-security",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

test.describe("Security headers · /login (public HTML route)", () => {
  test("all required headers present", async ({ request }) => {
    const res = await request.get("/login");
    expect(res.status()).toBe(200);
    const headers = res.headers();
    for (const h of REQUIRED_HEADERS) {
      expect(headers[h], `${h} should be set`).toBeTruthy();
    }
  });

  test("HSTS has 2-year max-age + includeSubDomains + preload", async ({ request }) => {
    const res = await request.get("/login");
    expect(res.headers()["strict-transport-security"]).toMatch(
      /max-age=63072000.*includeSubDomains.*preload/,
    );
  });

  test("X-Frame-Options is DENY (anti-clickjacking)", async ({ request }) => {
    const res = await request.get("/login");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
  });

  test("CSP allows Supabase + Sentry + PostHog + Turnstile + MP", async ({ request }) => {
    const res = await request.get("/login");
    const csp = res.headers()["content-security-policy-report-only"] ?? "";
    // Allowlist sanity checks — connect-src must include Supabase + Sentry + PostHog + MP.
    expect(csp).toContain("supabase.co");
    expect(csp).toContain("sentry.io");
    expect(csp).toContain("posthog.com");
    expect(csp).toContain("mercadopago.com");
    expect(csp).toContain("challenges.cloudflare.com"); // Turnstile
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});

test.describe("Security headers · /api/health (API route)", () => {
  test("headers reach API routes too", async ({ request }) => {
    const res = await request.get("/api/health");
    expect([200, 503]).toContain(res.status()); // 503 if DB check fails — acceptable for header test
    expect(res.headers()["strict-transport-security"]).toBeTruthy();
    expect(res.headers()["x-frame-options"]).toBe("DENY");
  });
});
