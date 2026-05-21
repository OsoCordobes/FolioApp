import { expect, test } from "@playwright/test";

/**
 * Folio · mood system — Playwright e2e.
 *
 * Drives /dev/card-moods which renders all 4 moods side-by-side plus a live
 * <MoodPicker> attached to a single sample card. Asserts:
 *
 *   - All 4 moods render with their canonical data-card-mood.
 *   - Each mood resolves a distinct --fpc-radius (16 / 10 / 20 / 24).
 *   - The picker is an ARIA radiogroup with 4 radios.
 *   - Clicking a different mood updates the controlled card's
 *     data-card-mood attribute.
 *
 * The differentiation acceptance criterion ("two moods at thumbnail are
 * distinguishable") is a founder-eyeball check at the F5 visual gate —
 * not amenable to a single assertion. The --fpc-radius differential is
 * the closest mechanical proxy.
 */

test.describe("Mood system at /dev/card-moods", () => {
  test("all 4 moods render with their data-card-mood", async ({ page }) => {
    await page.goto("/dev/card-moods");
    for (const id of ["calido", "clinico", "editorial", "boutique"]) {
      await expect(
        page.locator(`.fpc-card[data-card-mood="${id}"]`).first(),
      ).toBeVisible();
    }
  });

  test("each mood resolves a distinct --fpc-radius", async ({ page }) => {
    await page.goto("/dev/card-moods");
    const radii: Record<string, string> = {};
    for (const id of ["calido", "clinico", "editorial", "boutique"]) {
      radii[id] = await page
        .locator(`.fpc-card[data-card-mood="${id}"]`)
        .first()
        .evaluate(
          (el) => getComputedStyle(el as HTMLElement).getPropertyValue("--fpc-radius").trim(),
        );
    }
    expect(radii).toEqual({
      calido:    "16px",
      clinico:   "10px",
      editorial: "20px",
      boutique:  "24px",
    });
  });

  test("MoodPicker is a radiogroup with 4 radios; editorial is initially active", async ({ page }) => {
    await page.goto("/dev/card-moods");
    const group = page.getByRole("radiogroup", { name: /estilo visual/i });
    await expect(group).toBeVisible();
    await expect(group.getByRole("radio")).toHaveCount(4);
    await expect(group.getByRole("radio", { name: /editorial/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("clicking a mood swaps the controlled card's data-card-mood", async ({ page }) => {
    await page.goto("/dev/card-moods");
    // The "live picker" full-variant card is the one bound to MoodPicker state.
    const fullCard = page.locator(".fpc-card.fpc-variant-full").first();
    await expect(fullCard).toHaveAttribute("data-card-mood", "editorial");
    await page.getByRole("radio", { name: /clínico/i }).click();
    await expect(fullCard).toHaveAttribute("data-card-mood", "clinico");
    await page.getByRole("radio", { name: /boutique/i }).click();
    await expect(fullCard).toHaveAttribute("data-card-mood", "boutique");
  });

  test("Clínico mood CTA uses ink-blue (--accent-ink), not brass", async ({ page }) => {
    await page.goto("/dev/card-moods");
    await page.getByRole("radio", { name: /clínico/i }).click();
    const ctaBg = await page
      .locator(".fpc-card.fpc-variant-full .fpc-cta")
      .evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
    // Expect rgb(42, 67, 101) — Folio ink-blue (#2A4365).
    expect(ctaBg).toBe("rgb(42, 67, 101)");
  });
});
