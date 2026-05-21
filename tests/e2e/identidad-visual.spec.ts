import { expect, test } from "@playwright/test";

/**
 * Folio · /dev/identidad-visual e2e.
 *
 * Verifies the three-section composition that powers Step 4 "Identidad
 * visual" (logo + acento + mood) and that each section, when interacted
 * with, updates the live PublicCard preview to the right.
 *
 * Real Step4Personalizacion uses real server actions (uploadOrgLogo +
 * updateOnboardingStep) — those are covered by the lower-level
 * tests/e2e/logo-upload.spec.ts and (later) the full /onboarding flow
 * happy-path. This spec is the integration of the three UI pieces.
 */

const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6300010000000500010d0a2db40000000049454e44ae426082",
  "hex",
);

test.describe("Identidad visual at /dev/identidad-visual", () => {
  test("renders the 3 section headers", async ({ page }) => {
    await page.goto("/dev/identidad-visual");
    await expect(page.getByRole("heading", { name: "Logo", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Color de acento", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Estilo de tu card", level: 2 })).toBeVisible();
  });

  test("MoodPicker change updates the preview card's data-card-mood", async ({ page }) => {
    await page.goto("/dev/identidad-visual");
    const preview = page.locator(".fpc-card").first();
    await expect(preview).toHaveAttribute("data-card-mood", "editorial");
    await page.getByRole("radio", { name: /Cálido/i }).click();
    await expect(preview).toHaveAttribute("data-card-mood", "calido");
    await page.getByRole("radio", { name: /Clínico/i }).click();
    await expect(preview).toHaveAttribute("data-card-mood", "clinico");
  });

  test("acento change updates the preview's --fpc-accent inline style", async ({ page }) => {
    await page.goto("/dev/identidad-visual");
    const preview = page.locator(".fpc-card").first();
    const initial = await preview.getAttribute("data-acento");
    expect(initial).toBe("#8A6722");
    // Pick Verde antiguo
    await page.getByRole("button", { name: /Verde antiguo/i }).click();
    await expect(preview).toHaveAttribute("data-acento", "#3F6B49");
  });

  test("logo upload swaps AvatarIniciales for <img> in the preview", async ({ page }) => {
    await page.goto("/dev/identidad-visual");
    const preview = page.locator(".fpc-card").first();
    // Initial: no logo, AvatarIniciales 'LM' visible.
    await expect(preview.locator("img.fpc-logo")).toHaveCount(0);
    // Upload a valid PNG via the dropzone's hidden input.
    await page.locator('input[type="file"]').setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    // The harness mock converts the file to a data URL → preview <img> appears.
    await expect(preview.locator("img.fpc-logo")).toBeVisible();
  });
});
