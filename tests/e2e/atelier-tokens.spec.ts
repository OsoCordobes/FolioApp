import { test, expect } from "@playwright/test";

/**
 * Folio Atelier · F1 token-bootstrap acceptance.
 *
 * These tests guard the F1 phase output:
 *   - Fraunces is loadable from the same Google Fonts <link> as Geist.
 *   - All Folio Atelier design tokens resolve on `:root`.
 *   - The three decoration primitives render at `/decoration`.
 *
 * They run against the dev server on http://localhost:3010 via the `e2e`
 * Playwright project (see `playwright.config.ts`). The dev server is
 * launched automatically by Playwright as a webServer dependency.
 */

test.describe("Atelier tokens · F1 acceptance", () => {
  test("Fraunces is loadable on /onboarding", async ({ page }) => {
    await page.goto("/onboarding");
    // document.fonts.load triggers fetch + returns array of resolved FontFace.
    // If Fraunces is unreachable (404, blocked, missing <link>), the promise
    // resolves to []. Asserting length catches both a missing <link> and a
    // CDN block.
    const loaded = await page.evaluate(async () => {
      const faces = await document.fonts.load("400 1em Fraunces");
      return faces.length;
    });
    expect(loaded).toBeGreaterThan(0);
  });
});

test.describe("Atelier tokens · :root computed style", () => {
  const REQUIRED_TOKENS = [
    "--accent-warm",
    "--accent-warm-soft",
    "--accent-warm-glow",
    "--accent-ink",
    "--accent-ink-soft",
    "--accent-ink-glow",
    "--fpc-accent",
    "--fpc-bg-tint-style",
    "--fpc-name-family",
    "--fpc-name-weight",
    "--fpc-bio-style",
    "--fpc-radius",
    "--fpc-decoration",
    "--space-4",
    "--r-2xl",
    "--r-3xl",
    "--r-pill",
    "--shadow-card",
    "--shadow-focus-warm",
    "--shadow-focus-ink",
    "--track-tight-2",
    "--font-display",
  ] as const;

  for (const token of REQUIRED_TOKENS) {
    test(`:root declares ${token}`, async ({ page }) => {
      await page.goto("/onboarding");
      const value = await page.evaluate(
        (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
        token,
      );
      expect(value, `${token} should resolve to a non-empty value`).not.toBe("");
    });
  }

  test("--accent-ink resolves to #2A4365 in light mode", async ({ page }) => {
    await page.goto("/onboarding");
    const value = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--accent-ink")
        .trim()
        .toLowerCase(),
    );
    expect(value).toBe("#2a4365");
  });
});

test.describe("Atelier decoration primitives", () => {
  test("EditorialRule, BrassCornerMark, DateBadge render at /dev/decoration", async ({ page }) => {
    await page.goto("/dev/decoration");
    // The page lives under /dev/* (public-prefixed in middleware) and 404s
    // in production via notFound(); in dev/test it renders the three primitives.
    await expect(page.locator(".fpc-rule").first()).toBeVisible();
    const svg = page.locator("svg.fpc-corner-mark").first();
    await expect(svg).toBeVisible();
    await expect(svg).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByText("EST. 2026 · CÓRDOBA")).toHaveClass(/fpc-date-badge/);
  });
});
