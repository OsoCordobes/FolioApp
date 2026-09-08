/**
 * Folio · E2E · 404 pages styled (Sprint 1 T1.2).
 *
 * Verifica que las 404 propias respondan 404 + tengan el copy + botones
 * correctos. Cubre dos paths:
 *   - global: especialidad pública inválida → app/not-found.tsx.
 *   - ruta privada desconocida sin sesión → login, según el middleware.
 *   - booking público: /book/<slug-inexistente> → app/(public)/book/[slug]/not-found.tsx
 *     con copy específico para pacientes (sin nav interna).
 */

import { expect, test } from "../fixtures/local-test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { window.localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* ignore */ }
  });
});

test.describe("404 pages styled", () => {
  test("ruta privada desconocida sin sesión conserva el acceso por login", async ({ page }) => {
    await page.goto("/esta-ruta-no-existe-zxqwerty-2026");
    await expect(page).toHaveURL(/\/login\?redirect=/);
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
  });

  test("especialidad pública inválida → 404 global con CTA volver al inicio", async ({ page }) => {
    // Rejected before a DB read; a dead local Supabase cannot manufacture this 404.
    const response = await page.goto("/profesionales/especialidad-inexistente-zxqwerty");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /esta página no existe/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /volver al inicio/i })).toHaveAttribute("href", "/hoy");
    await expect(page.getByRole("link", { name: /escribir a soporte/i })).toHaveAttribute(
      "href",
      /^mailto:folioasistencia@gmail\.com/,
    );
  });

  test("/book/<slug-inexistente> → 404 específico de booking sin nav interna", async ({ page }) => {
    test.skip(process.env.FOLIO_TEST_REAL_SUPABASE !== "1", "Requires a healthy isolated Supabase to distinguish absent slug from a failed read.");
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
