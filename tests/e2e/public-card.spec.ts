import { expect, test } from "@playwright/test";

/**
 * Folio · <PublicCard> structural + variant smoke — Playwright e2e.
 *
 * Drives /dev/card which mounts three variants of the sample data
 * (preview without logo, full with data-URL logo, editing with bio = null).
 * Asserts the contract of each variant without snapshotting pixels —
 * baseline visual is captured separately under tests/visual/.
 *
 * Plan reference: docs/specs/2026-05-21-public-card-and-onboarding-redesign-plan.md §F4.
 */

test.describe("PublicCard at /dev/card", () => {
  test("renders all three variants with the correct chassis classes", async ({ page }) => {
    await page.goto("/dev/card");
    await expect(page.locator(".fpc-card.fpc-variant-preview").first()).toBeVisible();
    await expect(page.locator(".fpc-card.fpc-variant-full").first()).toBeVisible();
    await expect(page.locator(".fpc-card.fpc-variant-editing").first()).toBeVisible();
  });

  test("default mood is editorial", async ({ page }) => {
    await page.goto("/dev/card");
    await expect(page.locator(".fpc-card").first()).toHaveAttribute(
      "data-card-mood",
      "editorial",
    );
  });

  test("preview variant: shows the public link footer (mono)", async ({ page }) => {
    await page.goto("/dev/card");
    const preview = page.locator(".fpc-card.fpc-variant-preview").first();
    await expect(preview.locator(".fpc-link-footer")).toContainText(
      "folio-app-ten.vercel.app/book/lorenzo-martinez",
    );
  });

  test("full variant: ships the 'Reservar turno' CTA", async ({ page }) => {
    await page.goto("/dev/card");
    const full = page.locator(".fpc-card.fpc-variant-full");
    await expect(full.getByRole("button", { name: /reservar turno/i })).toBeVisible();
  });

  test("logoUrl drives <img> render; absence falls back to AvatarIniciales", async ({ page }) => {
    await page.goto("/dev/card");
    const full = page.locator(".fpc-card.fpc-variant-full");
    await expect(full.locator("img.fpc-logo")).toBeVisible();
    const preview = page.locator(".fpc-card.fpc-variant-preview").first();
    await expect(preview.locator("img.fpc-logo")).toHaveCount(0);
    // AvatarIniciales should render initials "LM" inside the preview hero.
    await expect(preview.locator(".fpc-hero")).toContainText(/LM/);
  });

  test("editing variant: placeholder bio when bio is null", async ({ page }) => {
    await page.goto("/dev/card");
    const editing = page.locator(".fpc-card.fpc-variant-editing");
    await expect(editing.locator(".fpc-bio.is-placeholder")).toContainText(/Agregá una bio/i);
  });

  test("name uses Fraunces (the display family token)", async ({ page }) => {
    await page.goto("/dev/card");
    const name = page.locator(".fpc-card").first().locator(".fpc-name").first();
    const family = await name.evaluate(
      (el) => getComputedStyle(el as HTMLElement).fontFamily,
    );
    expect(family).toMatch(/Fraunces/i);
  });
});
