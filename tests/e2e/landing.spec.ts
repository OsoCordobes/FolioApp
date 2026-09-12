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

const HERO_H1 = /Tu consultorio\.\s*Todo a mano\./;

// El cookie banner sale en cada navegación — lo pre-dismisseamos para que
// las queries de página no choquen con su DOM (mismo approach que el resto
// de los specs e2e).
test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", (route) => {
    const request = route.request();
    return new URL(request.url()).origin === origin && ["GET", "HEAD"].includes(request.method())
      ? route.continue() : route.abort("blockedbyclient");
  });
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
    const hero = page.getByRole("region", { name: HERO_H1 });
    await expect(hero.getByRole("link", { name: "Crear mi consultorio", exact: true })).toHaveAttribute("href", "/onboarding");
    await expect(hero.getByRole("link", { name: "Recorrer Folio", exact: true })).toHaveAttribute("href", "#producto");
    await expect(
      page.locator(".fx-header-actions").getByRole("link", { name: "Ingresar" }),
    ).toHaveAttribute("href", "/login");
  });

  test("links legales del footer responden 200 (incluye /cookies, fix de middleware)", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    // Los tres links existen en el footer…
    const footer = page.locator(".fx-footer");
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
    await expect(first.locator("p")).toBeVisible();
  });

  test("las anclas del header navegan: Precios → #precios en viewport", async ({ page }) => {
    await page.goto("/");
    await page.locator(".fx-nav").getByRole("link", { name: "Precios" }).click();
    await expect(page).toHaveURL(/#precios$/);
    await expect(page.locator("#precios")).toBeInViewport();
  });

  test("las anclas del header navegan: Cómo funciona → #dia en viewport", async ({ page }) => {
    await page.goto("/");
    await page.locator(".fx-nav").getByRole("link", { name: "Cómo funciona" }).click();
    await expect(page).toHaveURL(/#dia$/);
    await expect(page.locator("#dia")).toBeInViewport();
  });

  test("las pestañas del producto cambian por flechas, Home y End, con selección y panel asociados", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByRole("tablist", { name: "Recorrer las funciones de Folio" });
    const history = tabs.getByRole("tab", { name: "La historia clínica", exact: true });
    await expect(history).toHaveAttribute("aria-selected", "true");
    await history.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "Los cobros" })).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "Los cobros" })).toContainText("Los números del día");
    await page.keyboard.press("Home");
    await expect(tabs.getByRole("tab", { name: "La agenda" })).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "La agenda" })).toContainText("Tu agenda hoy");
    await page.keyboard.press("End");
    await expect(tabs.getByRole("tab", { name: "Los cobros" })).toHaveAttribute("aria-selected", "true");
    await expect(tabs.locator('[tabindex="0"]')).toHaveCount(1);
    await expect(page.locator("#producto figcaption")).toContainText("Personas y datos ficticios");
  });
});

test.describe("Landing · contenido server-rendered", () => {
  test("recorrido y cuidado de los datos llegan con contenido en el HTML inicial", async ({
    page,
    request,
  }) => {
    // La información esencial permanece disponible sin JavaScript.
    const res = await request.get("/");
    const html = await res.text();
    for (const needle of ["Organizá la llegada", "Atendé con el contexto a mano", "Cerrá la consulta, seguí la historia", "permisos de acceso por rol", "registros de actividad"]) {
      expect(html, `el HTML server-rendered debe contener «${needle}»`).toContain(needle);
    }

    // Y en el DOM, cada dato vive dentro de su sección/ancla.
    await page.goto("/");
    const dia = page.locator("#dia");
    await expect(dia).toContainText("Organizá la llegada");
    await expect(dia).toContainText("Atendé con el contexto a mano");
    await expect(dia).toContainText("Cerrá la consulta, seguí la historia");

    const vault = page.locator("#seguridad");
    await expect(vault).toContainText("cifrado de información clínica");
    await expect(vault).toContainText("permisos de acceso por rol");
    await expect(vault.getByRole("link", { name: "Cómo tratamos los datos" })).toHaveAttribute("href", "/privacidad");
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
    await ingresar.focus();
    await page.keyboard.press("Escape");
    await expect(panel).not.toHaveClass(/is-open/);
    await expect(page.getByRole("button", { name: /abrir menú de navegación/i })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
});
