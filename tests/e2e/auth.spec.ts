/**
 * Folio · E2E · auth flow happy path.
 *
 * Verifies the post-fix signup flow:
 *   1. /login → "Crear cuenta"
 *   2. Signup form submits → signUpAndInitOrganization runs server-side
 *      (creates auth.user + organization placeholder + member OWNER)
 *   3. Cookie set + redirect to /onboarding
 *   4. /onboarding resume state lands at Step 2 (skipping Step 1's signup
 *      form since the session already exists with a member)
 *
 * Pre-requisitos:
 *   1. Dev server at E2E_BASE_URL (default localhost:3010 via pnpm dev).
 *   2. Real Supabase envs (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      FOLIO_ENC_KEY, FOLIO_ENC_HMAC_KEY).
 *   3. The signup creates a real row in auth.users. Tests namespace emails
 *      with `e2e-test-<ts>@folio.app` so cleanup is mechanical via
 *      scripts/reset-user-password.mjs or a periodic cron.
 *
 * Run:
 *   pnpm exec playwright test --project=e2e tests/e2e/auth.spec.ts
 */

import { expect, test } from "@playwright/test";

const NS_E2E = "e2e-test";

// Phase 6b · pre-dismiss the cookie banner so it doesn't intercept
// clicks on fixed-bottom UI. Setting the consent in localStorage before
// the first page.goto prevents the banner from rendering at all.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { window.localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* ignore */ }
  });
});

function nuevoEmail(): string {
  const ts = Date.now();
  return `${NS_E2E}-${ts}@folio.app`;
}

test.describe("Auth · signup → onboarding", () => {
  test("happy path · /login signup creates account inline", async ({ page }) => {
    const email = nuevoEmail();
    const password = "TestPassword123!";

    // 1. /login renders with the "Entrar" heading.
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /entrar/i })).toBeVisible({
      timeout: 10_000,
    });

    // 2. Switch to signup view.
    await page.getByRole("button", { name: /crear cuenta/i }).first().click();
    await expect(page.getByRole("heading", { name: /crear cuenta/i })).toBeVisible();

    // 3. Fill signup form and submit. The button label changes to "Creando
    //    cuenta…" while pending, then we get redirected.
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    // Ley 25.326 art. 14 consent (Phase 4): must be ticked before signup.
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole("button", { name: /empezar/i }).click();

    // 4. The signup action creates auth.user + org + member, then sets a
    //    session cookie. The Signup component redirects to /onboarding.
    //    Resume state lands at Step 2 (signup already done).
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    // 5. Step 1 (signup) should NOT be visible — we should be at Step 2 or
    //    later. The Step 1 button text was "Continuar" with the "Empezá
    //    creando tu cuenta" headline; if we see that, signup didn't work.
    await expect(page.getByText(/Empezá creando tu cuenta/i)).toHaveCount(0);
  });

  test("login form shows generic error for invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /entrar/i })).toBeVisible();
    await page.locator('input[type="email"]').fill("noexiste-e2e@folio.app");
    await page.locator('input[type="password"]').fill("ContraseñaCualquiera1!");
    await page.getByRole("button", { name: /^entrar/i }).click();
    await expect(
      page.getByText(/email o contraseña incorrectos|inválido/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("existing-email signup → switches to login view with banner", async ({ page }) => {
    // Re-use the email from the happy-path test by signing up once, then
    // attempting to sign up again with the same email + a different password.
    const email = nuevoEmail();
    const password = "TestPassword123!";

    // First signup — creates the account.
    await page.goto("/login");
    await page.getByRole("button", { name: /crear cuenta/i }).first().click();
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    // Ley 25.326 art. 14 consent (Phase 4): must be ticked before signup.
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole("button", { name: /empezar/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    // Sign out by clearing cookies and going back to /login.
    await page.context().clearCookies();
    await page.goto("/login");

    // Attempt signup with the same email but a different password.
    await page.getByRole("button", { name: /crear cuenta/i }).first().click();
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill("CompletelyDifferent9!");
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole("button", { name: /empezar/i }).click();

    // The flow should detect "already exists" and switch to login view with
    // the notice banner + the email prefilled.
    await expect(page.getByRole("heading", { name: /entrar/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/ya existe/i)).toBeVisible();
    await expect(page.locator('input[type="email"]')).toHaveValue(email);
  });
});
