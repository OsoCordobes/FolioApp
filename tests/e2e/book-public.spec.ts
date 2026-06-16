import { expect, test } from "@playwright/test";

/**
 * Folio · /dev/book-preview · BookLanding + booking flow — Playwright e2e.
 *
 * Drives /dev/book-preview (mock data shape identical to /book/[slug]).
 * Verifies the doctor-first landing integration:
 *   - The hero renders the org name + a "Reservar" CTA that anchors to the
 *     focused booking section (#reservar).
 *   - The booking flow itself is unchanged ("Elegí el servicio", id="bk-flow").
 *   - The landing surfaces the services vitrine + the "Hecho con Folio"
 *     powered-by footer.
 *   - On desktop the sticky mobile CTA is hidden; on mobile it is mounted
 *     with #reservar/#bk-flow as its smooth-scroll target.
 *
 * The real /book/[slug] route fetches the same data shape from Supabase;
 * this test isolates the UI integration without touching the DB.
 */

test.describe("/dev/book-preview · BookLanding + booking flow", () => {
  test("hero renders the org name + a Reservar CTA above the flow", async ({ page }) => {
    await page.goto("/dev/book-preview");
    const hero = page.locator(".bl-hero");
    await expect(hero).toBeVisible();
    await expect(hero.locator(".bl-hero-title")).toContainText("Atelier Kinesiología");
    const cta = hero.locator("a.bl-btn-lg");
    await expect(cta).toContainText(/reservar/i);
    await expect(cta).toHaveAttribute("href", "#reservar");
  });

  test("booking flow renders inside #reservar with id='bk-flow'", async ({ page }) => {
    await page.goto("/dev/book-preview");
    await expect(page.locator("#reservar #bk-flow")).toBeVisible();
    await expect(
      page.locator("#bk-flow").getByRole("heading", { name: /elegí el servicio/i }),
    ).toBeVisible();
  });

  test("landing surfaces the services vitrine + 'Hecho con Folio' footer", async ({ page }) => {
    await page.goto("/dev/book-preview");
    await expect(page.locator(".bl-services .bl-service-card").first()).toBeVisible();
    await expect(page.locator(".bl-powered")).toContainText(/hecho con\s*folio/i);
    await expect(page.locator(".bl-powered-cta")).toContainText(/creá la tuya/i);
  });

  test("equipo: el grid de profesionales muestra nombre + matrícula (M62)", async ({ page }) => {
    await page.goto("/dev/book-preview");
    const cards = page.locator(".bl-team .bl-team-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.first().locator(".bl-team-name")).toContainText("Lorenzo Martínez");
    await expect(cards.first().locator(".bl-team-matricula")).toContainText(/M\.P\./);
  });

  test("desktop: sticky mobile CTA is hidden", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/dev/book-preview");
    const sticky = page.locator(".bl-sticky-cta");
    await expect(sticky).toBeAttached();
    await expect(sticky).not.toBeVisible();
  });

  test("mobile: sticky CTA is mounted with #reservar/#bk-flow scroll target", async ({ page }) => {
    // The IntersectionObserver-driven `is-shown` toggle is verified manually at
    // the visual gate against a real /book/<slug> page — recreating that scroll
    // interaction reliably headless proved brittle across viewports, so we
    // assert the deterministic parts:
    //   - the sticky bar exists in the DOM on mobile
    //   - it carries the reserve CTA anchored to #reservar
    //   - the booking flow target (#reservar / #bk-flow) resolves
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto("/dev/book-preview");
    const sticky = page.locator(".bl-sticky-cta");
    await expect(sticky).toBeAttached();
    const btn = sticky.locator(".bl-sticky-btn");
    await expect(btn).toContainText(/reservar/i);
    await expect(btn).toHaveAttribute("href", "#reservar");
    await expect(page.locator("#reservar")).toBeAttached();
    await expect(page.locator("#bk-flow")).toBeAttached();
  });
});
