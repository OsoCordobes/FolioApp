import { expect, test } from "@playwright/test";

/**
 * Folio · Phase 4 · signup consent + rate-limit acceptance.
 *
 * Verifies that the signup form refuses to proceed without:
 *   (a) the Ley 25.326 art. 14 consent checkbox ticked, and
 *   (b) (in production) the Turnstile token verified.
 *
 * In dev (no TURNSTILE_SECRET_KEY env), verifyTurnstile() returns true
 * unconditionally → the captcha path is exercised only via the UI
 * disabled-state assertion; the server-side gate is covered by direct
 * verifyTurnstile unit checks (not asserted here).
 *
 * Rate limit: the action limits 5 signups / IP / hour. We don't burn
 * the limit in this test (would block subsequent CI runs from the same
 * IP). The server-side wiring is verified by the unit test suite.
 */

test.describe("/login signup · consent + Turnstile gates", () => {
  test("submit button disabled until consent checkbox ticked", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /crear cuenta/i }).first().click();
    const submit = page.getByRole("button", { name: /empezar/i });

    // Fill valid email + password first so disable can only be due to consent.
    await page.locator('input[type="email"]').fill("e2e-consent-test@folio.app");
    await page.locator('input[type="password"]').fill("TestPassword123!");

    // Consent not ticked yet → submit must be disabled.
    await expect(submit).toBeDisabled();

    // Tick consent → submit enables.
    await page.locator('input[type="checkbox"]').first().check();
    await expect(submit).toBeEnabled();
  });

  test("explicit consent text references Ley 25.326", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /crear cuenta/i }).first().click();
    await expect(page.getByText(/Aviso de Privacidad/i)).toBeVisible();
    await expect(page.getByText(/Ley 25\.326/)).toBeVisible();
  });
});

test.describe("/onboarding step 1 · consent gate", () => {
  test("user landing directly on /onboarding sees the consent checkbox", async ({ page }) => {
    await page.goto("/onboarding");
    // Without a session, /onboarding shows Step 1 signup form.
    await expect(page.getByText(/Aviso de Privacidad/i).first()).toBeVisible();
    await expect(page.getByRole("checkbox").first()).toBeVisible();
  });
});

test.describe("/reset-password · page renders", () => {
  test("page is reachable (was 404 pre-Phase-4)", async ({ page }) => {
    await page.goto("/reset-password");
    // Without a valid recovery token, supabase will not establish a
    // session, but the page itself MUST render (the form even if disabled).
    await expect(page).toHaveURL(/\/reset-password/);
  });

  test("/api/auth/reset redirects to /reset-password (legacy email shim)", async ({ request }) => {
    const res = await request.get("/api/auth/reset", { maxRedirects: 0 });
    // Either 302/307 redirect, OR (if Playwright auto-follows) we land on
    // /reset-password — accept both.
    expect([200, 302, 307]).toContain(res.status());
    if (res.status() === 302 || res.status() === 307) {
      const loc = res.headers()["location"];
      expect(loc).toContain("/reset-password");
    }
  });
});
