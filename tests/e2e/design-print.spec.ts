import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", route => {
    const request = route.request();
    return new URL(request.url()).origin === origin && ["GET", "HEAD"].includes(request.method())
      ? route.continue() : route.abort("blockedbyclient");
  });
  await context.addInitScript(() => localStorage.setItem("folio.cookieConsent", "denied"));
});

test.describe("Impresión · sólo estilos y DOM sintético", () => {
  test("la ficha conserva papel blanco con tema oscuro y oculta controles", async ({ page }) => {
    await page.goto("/dev/experience?panel=ficha", { waitUntil: "networkidle" });
    const printable = page.locator("[data-printable]");
    await expect(printable).toHaveCount(1);
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.emulateMedia({ media: "print" });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim())).toMatch(/^#(?:fff|ffffff)$/i);
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(printable).toBeVisible();
    await expect(page.locator(".fi-sidebar")).not.toBeVisible();
    for (const button of await printable.getByRole("button", { includeHidden: true }).all()) await expect(button).not.toBeVisible();
  });

  test("el panel Hoy con varios pacientes permanece oculto en papel", async ({ page }) => {
    await page.goto("/dev/experience?panel=hoy", { waitUntil: "networkidle" });
    const heading = page.getByRole("heading", { level: 1, name: "Tu día en Folio" });
    await expect(heading).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("[data-printable]")).toHaveCount(0);
    await expect(heading).not.toBeVisible();
    for (const child of await page.locator(".fi-main > *").all()) await expect(child).not.toBeVisible();
  });
});
