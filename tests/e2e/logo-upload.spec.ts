import { expect, test } from "@playwright/test";

/**
 * Folio · LogoUpload state machine — Playwright e2e.
 *
 * Drives /dev/logo-upload (a dev-only preview that injects mock upload/remove
 * actions into <LogoUpload>). Tests cover the four state transitions the user
 * can hit without a real upload:
 *
 *   idle        →  helper text visible
 *   drag-over   →  .is-drag-over class on the dropzone
 *   error/MIME  →  .is-error class + Spanish error text ("PNG")
 *   error/size  →  .is-error class + Spanish error text ("500 KB")
 *   success     →  preview image appears (data URL via mock)
 *
 * Plan reference: docs/specs/2026-05-21-public-card-and-onboarding-redesign-plan.md §F3.3.
 */

const TINY_PNG = Buffer.from(
  // 1×1 transparent PNG (smallest valid PNG payload)
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6300010000000500010d0a2db40000000049454e44ae426082",
  "hex",
);
const TINY_JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0xff, 0xd9]);

test.describe("LogoUpload at /dev/logo-upload", () => {
  test("idle: helper text visible", async ({ page }) => {
    await page.goto("/dev/logo-upload");
    await expect(page.locator(".fpc-dropzone")).toBeVisible();
    await expect(
      page.locator(".fpc-dropzone-hint").filter({ hasText: /PNG/i }),
    ).toBeVisible();
  });

  test("drag-over: dropzone gets .is-drag-over class", async ({ page }) => {
    await page.goto("/dev/logo-upload");
    // DataTransfer must be a real instance — construct in page context.
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page.locator(".fpc-dropzone").dispatchEvent("dragover", { dataTransfer });
    await expect(page.locator(".fpc-dropzone")).toHaveClass(/is-drag-over/);
  });

  test("error on JPG: .is-error + Spanish PNG error", async ({ page }) => {
    await page.goto("/dev/logo-upload");
    await page.locator('input[type="file"]').setInputFiles({
      name: "logo.jpg",
      mimeType: "image/jpeg",
      buffer: TINY_JPG,
    });
    const dz = page.locator(".fpc-dropzone");
    await expect(dz).toHaveClass(/is-error/);
    await expect(page.locator(".fpc-dropzone-error")).toContainText(/PNG/i);
  });

  test("error on > 500 KB PNG: .is-error + Spanish size error", async ({ page }) => {
    await page.goto("/dev/logo-upload");
    // 600 KB buffer — content doesn't have to be a valid PNG; the validator
    // checks size + MIME before reading the bytes.
    const big = Buffer.alloc(600 * 1024);
    await page.locator('input[type="file"]').setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: big,
    });
    const dz = page.locator(".fpc-dropzone");
    await expect(dz).toHaveClass(/is-error/);
    await expect(page.locator(".fpc-dropzone-error")).toContainText(/500 KB/i);
  });

  test("success on valid PNG: preview image appears", async ({ page }) => {
    await page.goto("/dev/logo-upload");
    await page.locator('input[type="file"]').setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    const preview = page.locator(".fpc-dropzone-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(page.locator(".fpc-dropzone-headline")).toContainText(/Cambiar logo/i);
  });
});
