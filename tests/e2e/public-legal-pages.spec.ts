/**
 * Folio · E2E · /privacidad y /terminos son públicas.
 *
 * Estas dos rutas son linkeadas desde el checkbox de consent del signup
 * (Ley 25.326). Si están auth-gated, un visitante anónimo que clickea el
 * link "Aviso de Privacidad" termina en /login en vez de leer el texto.
 * Regresión histórica: estuvieron 307 hasta el commit 6cbd905.
 */

import { expect, test } from "@playwright/test";

// El cookie banner sale en cada navegación y matchea texto "Ley 25.326" —
// lo pre-dismisseamos para que las queries de página no choquen con su DOM.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { window.localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* ignore */ }
  });
});

test.describe("Public legal pages · sin auth", () => {
  test("/privacidad responde 200 sin sesión y muestra el aviso", async ({ page }) => {
    const response = await page.goto("/privacidad");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /pol[ií]tica de privacidad/i })).toBeVisible();
    // El contenido legal tiene la sección "Responsable del tratamiento" (Ley 25.326 art. 1).
    await expect(page.getByRole("heading", { name: /responsable del tratamiento/i })).toBeVisible();
  });

  test("/terminos responde 200 sin sesión y muestra los términos", async ({ page }) => {
    const response = await page.goto("/terminos");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /t[eé]rminos y condiciones/i })).toBeVisible();
  });

  test("desde /login el link al aviso de privacidad apunta a /privacidad (no redirect)", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /crear cuenta/i }).first().click();
    // En el form de signup el link al aviso es target="_blank" → buscamos el primero
    // (el del consent, no el del footer).
    const privacidadLink = page.getByRole("link", { name: /aviso de privacidad/i }).first();
    await expect(privacidadLink).toBeVisible();
    await expect(privacidadLink).toHaveAttribute("href", "/privacidad");
  });
});
