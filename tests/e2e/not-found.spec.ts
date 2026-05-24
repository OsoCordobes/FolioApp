/**
 * Folio · E2E · 404 pages styled (Sprint 1 T1.2).
 *
 * Verifica que las 404 propias respondan 404 + tengan el copy + botones
 * correctos. Cubre dos paths:
 *   - global: cualquier ruta inválida → app/not-found.tsx.
 *   - booking público: /book/<slug-inexistente> → app/(public)/book/[slug]/not-found.tsx
 *     con copy específico para pacientes (sin nav interna).
 */

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { window.localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* ignore */ }
  });
});

test.describe("404 pages styled", () => {
  test("ruta inválida arbitraria → 404 global con CTA volver al inicio", async ({ page }) => {
    const response = await page.goto("/esta-ruta-no-existe-zxqwerty-2026");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /esta página no existe/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /volver al inicio/i })).toHaveAttribute("href", "/hoy");
    await expect(page.getByRole("link", { name: /escribir a soporte/i })).toHaveAttribute(
      "href",
      /^mailto:soporte@folio\.app/,
    );
  });

  test("/book/<slug-inexistente> → 404 específico de booking sin nav interna", async ({ page }) => {
    const response = await page.goto("/book/slug-que-no-existe-zxqwerty-2026");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: /este consultorio no está disponible/i }),
    ).toBeVisible();
    // El 404 de booking NO debe tener links de navegación interna — los
    // pacientes no son nuestros users authenticated, no querés empujarlos
    // a /login.
    await expect(page.getByRole("link", { name: /volver al inicio/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /iniciar sesión/i })).toHaveCount(0);
  });
});
