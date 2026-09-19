import { test, expect, type Page } from "../fixtures/local-test";

/**
 * Redesign baselines: desktop viewport, individual sections, and mobile viewport.
 * No stitched full-page capture. Generate only in the isolated design server,
 * inspect the images, then run again without --update-snapshots.
 */
type Theme = "light" | "dark";

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", (route) => {
    const request = route.request();
    return new URL(request.url()).origin === origin && ["GET", "HEAD"].includes(request.method())
      ? route.continue() : route.abort("blockedbyclient");
  });
});

async function loadLanding(page: Page, theme: Theme) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("folio.tweaks.v1", JSON.stringify({ theme: t }));
      localStorage.setItem("folio.cookieConsent", "denied");
    } catch { /* storage unavailable */ }
  }, theme);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: /Tu consultorio\.\s*Todo a mano\./ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.addStyleTag({ content: "nextjs-portal,[data-nextjs-toast],[data-next-mark],[data-nextjs-dev-tools-button],.tsqd-parent-container{display:none!important}" });
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const theme of ["light", "dark"] as const) {
  test(`landing · hero desktop · ${theme}`, async ({ page }) => {
    await loadLanding(page, theme);
    await expect(page).toHaveScreenshot(`landing-hero-${theme}.png`);
  });
  test(`landing · recorrido interactivo (#producto) · ${theme}`, async ({ page }) => {
    await loadLanding(page, theme);
    // A section taller than the viewport would otherwise capture the sticky
    // header over its own title. Keep the header's flow, disable only sticking.
    await page.addStyleTag({ content: ".fx-header{position:static!important}" });
    await expect(page.locator("#producto")).toHaveScreenshot(`landing-product-${theme}.png`);
  });
  test(`landing · continuidad de atención (#dia) · ${theme}`, async ({ page }) => {
    await loadLanding(page, theme);
    await page.addStyleTag({ content: ".fx-header{position:static!important}" });
    await expect(page.locator("#dia")).toHaveScreenshot(`landing-day-${theme}.png`);
  });
  test(`landing · cuidado de información (#seguridad) · ${theme}`, async ({ page }) => {
    await loadLanding(page, theme);
    await page.addStyleTag({ content: ".fx-header{position:static!important}" });
    await expect(page.locator("#seguridad")).toHaveScreenshot(`landing-vault-${theme}.png`);
  });
  test.describe(`landing · móvil · ${theme}`, () => {
    test.use({ viewport: { width: 375, height: 812 } });
    test("hero y navegación sin desbordamiento", async ({ page }) => {
      await loadLanding(page, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(page).toHaveScreenshot(`landing-mobile-${theme}.png`);
    });
  });
}

test("landing · ficha cardiovascular en escritorio", async ({ page }) => {
  await loadLanding(page, "light");
  await page.getByRole("button", { name: "Cardiología", exact: true }).click();
  await page.addStyleTag({ content: ".fx-header{position:static!important}" });
  await expect(page.locator("#ficha")).toHaveScreenshot("landing-specialty-desktop.png");
});

test("landing · ficha por segmento en móvil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadLanding(page, "light");
  await page.getByLabel("Explorá una especialidad").selectOption("quiropraxia");
  await page.addStyleTag({ content: ".fx-header{position:static!important}" });
  await expect(page.locator("#ficha")).toHaveScreenshot("landing-specialty-mobile.png");
});

test("landing · portada en monitor de 2560 px", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await loadLanding(page, "light");
  await expect(page).toHaveScreenshot("landing-hero-wide.png");
});

test("landing · cobros y explicación en dos columnas a 1920 px", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loadLanding(page, "light");
  await page.getByRole("tab", { name: "Los cobros", exact: true }).click();
  await page.addStyleTag({ content: ".fx-header{position:static!important}" });
  await expect(page.locator("#producto")).toHaveScreenshot("landing-product-wide.png");
});
