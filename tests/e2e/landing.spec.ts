/**
 * Folio · E2E · Landing de marketing en `/` (Fase C · QA).
 *
 * El landing es la primera ruta pública del producto: un visitante anónimo
 * tiene que poder leer el hero (sin redirect a /login ni a /hoy), llegar a
 * /onboarding y /login desde los CTAs, y abrir las páginas legales del
 * footer — incluida /cookies, que históricamente no estaba en la allowlist
 * del middleware. También valida el trabajo SEO de la fase: JSON-LD
 * (SoftwareApplication + FAQPage), /sitemap.xml y /robots.txt.
 */

import { expect, test } from "@playwright/test";

const HERO_H1 = /el día se arma solo\. la historia, cifrada\./i;

// El cookie banner sale en cada navegación — lo pre-dismisseamos para que
// las queries de página no choquen con su DOM (mismo approach que el resto
// de los specs e2e).
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { window.localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* ignore */ }
  });
});

test.describe("Landing · anónimo", () => {
  test("/ responde 200 sin redirect y muestra el h1 del hero", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    // Anónimo NO debe ser redirigido (ni a /login ni a /hoy).
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("heading", { level: 1, name: HERO_H1 })).toBeVisible();
  });

  test("CTA del hero apunta a /onboarding e Ingresar del header a /login", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-fl-cta="hero"]')).toHaveAttribute("href", "/onboarding");
    await expect(
      page.locator(".fl-header-actions").getByRole("link", { name: "Ingresar" }),
    ).toHaveAttribute("href", "/login");
  });

  test("links legales del footer responden 200 (incluye /cookies, fix de middleware)", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    // Los tres links existen en el footer…
    const footer = page.locator(".fl-footer");
    await expect(footer.getByRole("link", { name: "Privacidad" })).toHaveAttribute("href", "/privacidad");
    await expect(footer.getByRole("link", { name: "Términos" })).toHaveAttribute("href", "/terminos");
    await expect(footer.getByRole("link", { name: "Cookies" })).toHaveAttribute("href", "/cookies");
    // …y las tres rutas son públicas (200, no 307 al login).
    for (const path of ["/privacidad", "/terminos", "/cookies"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), `${path} debería responder 200 sin sesión`).toBe(200);
    }
  });
});

test.describe("Landing · SEO (JSON-LD + sitemap + robots)", () => {
  test("JSON-LD parseable con SoftwareApplication y FAQPage", async ({ page }) => {
    await page.goto("/");
    const scripts = page.locator('script[type="application/ld+json"]');
    expect(await scripts.count(), "debe existir al menos un script ld+json").toBeGreaterThan(0);

    const contents = await scripts.allTextContents();
    for (const raw of contents) {
      expect(() => JSON.parse(raw), "el JSON-LD debe ser JSON válido").not.toThrow();
    }
    const joined = contents.join("\n");
    expect(joined).toContain("SoftwareApplication");
    expect(joined).toContain("FAQPage");
  });

  test("/sitemap.xml responde 200 con XML (sin redirect al login)", async ({ request }) => {
    const res = await request.get("/sitemap.xml", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toContain("xml");
  });

  test("/robots.txt responde 200 con text/plain (sin redirect al login)", async ({ request }) => {
    const res = await request.get("/robots.txt", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toContain("text/plain");
  });
});

test.describe("Landing · interacciones", () => {
  test("el primer <details> del FAQ se abre con teclado y muestra la respuesta", async ({
    page,
  }) => {
    await page.goto("/");
    const first = page.locator("details[data-fl-faq]").first();
    await expect(first).toHaveJSProperty("open", false);

    await first.locator("summary").focus();
    await page.keyboard.press("Enter");

    await expect(first).toHaveJSProperty("open", true);
    await expect(first.locator(".fl-faq-a")).toBeVisible();
  });

  test("las anclas del header navegan: Precios → #precios en viewport", async ({ page }) => {
    await page.goto("/");
    await page.locator(".fl-nav").getByRole("link", { name: "Precios" }).click();
    await expect(page).toHaveURL(/#precios$/);
    await expect(page.locator("#precios")).toBeInViewport();
  });

  test("las anclas del header navegan: Seguridad → #seguridad en viewport", async ({ page }) => {
    await page.goto("/");
    await page.locator(".fl-nav").getByRole("link", { name: "Seguridad" }).click();
    await expect(page).toHaveURL(/#seguridad$/);
    await expect(page.locator("#seguridad")).toBeInViewport();
  });
});

test.describe("Landing · contenido server-rendered", () => {
  test("timeline (#dia) y bóveda (#seguridad) llegan con su contenido en el HTML inicial", async ({
    page,
    request,
  }) => {
    // El HTML inicial (sin ejecutar JS) ya trae las escenas del día y las
    // cifras de la bóveda — nada depende de un mount client-side diferido.
    const res = await request.get("/");
    const html = await res.text();
    // AES-256-GCM vive en la escena de cifrado (14:00); la bóveda habla en
    // lenguaje humano (AES-256 / 10 años) para la audiencia médica.
    for (const needle of ["10:30", "14:00", "20:00", "25.326", "AES-256-GCM"]) {
      expect(html, `el HTML server-rendered debe contener «${needle}»`).toContain(needle);
    }

    // Y en el DOM, cada dato vive dentro de su sección/ancla.
    await page.goto("/");
    const dia = page.locator("#dia");
    await expect(dia).toContainText("10:30");
    await expect(dia).toContainText("14:00");
    await expect(dia).toContainText("20:00");

    const vault = page.locator("#seguridad");
    await expect(vault).toContainText("25.326");
    await expect(vault).toContainText("AES-256");
    await expect(vault).toContainText("10 años");
  });
});

test.describe("Landing · mobile (375px)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("el toggle de nav abre el panel mobile y muestra Ingresar", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("#fl-mobile-nav");
    const ingresar = panel.getByRole("link", { name: "Ingresar" });
    await expect(ingresar).not.toBeVisible();

    await page.getByRole("button", { name: /abrir menú de navegación/i }).click();

    await expect(panel).toHaveClass(/is-open/);
    await expect(ingresar).toBeVisible();
  });
});
