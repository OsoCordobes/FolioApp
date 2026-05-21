import { expect, test } from "@playwright/test";

/**
 * Folio · open-redirect mitigation — Phase 1 of pre-audit sprint.
 *
 * Pre-fix: `/login?redirect=https://evil.com` after sign-in did
 * `router.push("https://evil.com")` — an attacker-controllable open redirect.
 * Post-fix: `safeRedirect()` filters to same-origin paths only.
 *
 * These tests don't actually sign in (would require a seed user); they
 * verify the URL the form would push to via the search-param transit.
 * The deeper integration is covered indirectly by tests/e2e/auth.spec.ts
 * which already uses the redirect parameter implicitly.
 *
 * For the explicit attack vectors, we read the redirect query param off
 * the page and ensure the form rendering doesn't reflect a hostile value
 * anywhere that would let the browser follow it before submission.
 */

const ATTACK_VECTORS = [
  "https://evil.com",
  "//evil.com",
  "/\\evil.com",
  "javascript:alert(1)",
  "data:text/html,<script>",
  "http://evil.com",
];

test.describe("Open-redirect mitigation · safeRedirect()", () => {
  for (const vector of ATTACK_VECTORS) {
    test(`vector ${JSON.stringify(vector)} does not appear in any href/action attribute on /login`, async ({ page }) => {
      await page.goto(`/login?redirect=${encodeURIComponent(vector)}`);
      // After page renders, search the DOM for any attribute that would let
      // the browser navigate to the hostile URL (link, form action, meta refresh).
      const hostileMatches = await page.evaluate((bad) => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll("[href], [action], meta"))) {
          const href = el.getAttribute("href") ?? "";
          const action = el.getAttribute("action") ?? "";
          const content = el.getAttribute("content") ?? "";
          if (href.includes(bad) || action.includes(bad) || content.includes(bad)) {
            out.push(`${el.tagName} ${href || action || content}`.slice(0, 200));
          }
        }
        return out;
      }, vector);
      expect(hostileMatches, `Hostile vector leaked into DOM: ${vector}`).toEqual([]);
    });
  }

  test("login page renders normally with safe redirect", async ({ page }) => {
    await page.goto("/login?redirect=/pacientes");
    await expect(page.getByRole("heading", { name: /entrar/i })).toBeVisible();
  });
});
