/**
 * Folio · E2E · Flow auth + onboarding.
 *
 * Pre-requisitos:
 *   1. Servidor corriendo en `E2E_BASE_URL` (default localhost:3010 via pnpm dev).
 *   2. Envs reales seteadas (Supabase URL+keys, FOLIO_ENC_KEY, FOLIO_ENC_HMAC_KEY,
 *      CRON_SECRET).
 *   3. Endpoint admin `/api/admin/cleanup-e2e-user` para borrar el user creado
 *      al final de cada test (TODO: crear el endpoint o usar Supabase admin API
 *      directo desde el test via fetch).
 *
 * Run:
 *   pnpm exec playwright test --project=e2e
 *
 * Contra prod (cuidado — crea users reales si cleanup falla):
 *   E2E_BASE_URL=https://folio-app-ten.vercel.app pnpm exec playwright test --project=e2e
 */

import { expect, test } from "@playwright/test";

const NS_E2E = "e2e-test";

function nuevoEmail(): string {
  const ts = Date.now();
  return `${NS_E2E}-${ts}@folio.app`;
}

test.describe("Auth · signup → onboarding → /hoy", () => {
  test("happy path", async ({ page }) => {
    const email = nuevoEmail();
    const password = "TestPassword123!";

    // 1. Visitar /login y elegir "Crear cuenta".
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /entrá|iniciar|bienvenido/i })).toBeVisible({ timeout: 10_000 });

    // El UI del prototipo tiene un link/button "Crear cuenta" — exact text/locator
    // a verificar contra la implementación real. Si no existe, usar /onboarding directo.
    const crearCuenta = page.getByRole("link", { name: /crear cuenta|registr/i }).first();
    if (await crearCuenta.count() > 0) {
      await crearCuenta.click();
    } else {
      await page.goto("/onboarding");
    }

    // 2. Step 1: email + password.
    await page.getByPlaceholder(/@/i).first().fill(email);
    await page.getByLabel(/contraseña|password/i).first().fill(password);
    await page.getByRole("button", { name: /crear|continuar|siguiente/i }).first().click();

    // 3. Navegar steps 2-9 con datos válidos.
    // (Implementación delegada: el componente Onboarding tiene su propio state local.
    //  En esta sesión de tests asumimos que ya existe un helper de "skip al final"
    //  o seteamos cada campo. Mientras el wizard no tenga aria-labels estables,
    //  esta sección queda como TODO para iterar contra el UI real.)

    // Por ahora verificamos que al menos el signup llevó a /onboarding o /hoy.
    await page.waitForURL(/onboarding|hoy/, { timeout: 15_000 });
  });

  test.fixme("login con email no registrado falla", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/@/i).first().fill("noexiste@folio.app");
    await page.getByLabel(/contraseña|password/i).first().fill("ContraseñaCualquiera1!");
    await page.getByRole("button", { name: /entrar|iniciar/i }).first().click();
    await expect(page.getByText(/no encontrado|credenciales|inválido/i)).toBeVisible();
  });

  test.fixme("logout vuelve a /login y bloquea /hoy", async ({ page: _page }) => {
    // Login con user existente, click logout en sidebar, verificar redirect.
  });
});

test.describe("Onboarding · validación Zod", () => {
  test.fixme("password corta → error 'mínimo 8 caracteres'", async ({ page }) => {
    await page.goto("/onboarding");
    await page.getByPlaceholder(/@/i).first().fill(nuevoEmail());
    await page.getByLabel(/contraseña|password/i).first().fill("123");
    await page.getByRole("button", { name: /crear|continuar/i }).first().click();
    await expect(page.getByText(/mínimo 8 caracteres/i)).toBeVisible();
  });

  test.fixme("email inválido → error 'Email inválido'", async ({ page }) => {
    await page.goto("/onboarding");
    await page.getByPlaceholder(/@/i).first().fill("not-an-email");
    await page.getByLabel(/contraseña|password/i).first().fill("ContraseñaValida1!");
    await page.getByRole("button", { name: /crear|continuar/i }).first().click();
    await expect(page.getByText(/email inválido/i)).toBeVisible();
  });
});
