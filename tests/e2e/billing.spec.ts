/**
 * Folio · E2E · activación de suscripción (/configuracion/billing) con MP mockeado.
 *
 * La activación real redirige a Mercado Pago (init_point externo) y el webhook
 * subscription_preapproval marca ACTIVA. Este spec NUNCA pega a MP real:
 *
 *   - Intercepta cualquier navegación a mercadopago.com / .com.ar con
 *     page.route → una página de éxito falsa, así el click "Activar
 *     suscripción" no abandona el dominio de prueba ni carga el checkout real.
 *   - Tolera el caso sin credenciales MP en dev: si MP_ACCESS_TOKEN falta,
 *     createOrRenewPendingSubscription devuelve un error y la UI muestra el
 *     banner inline — el spec acepta CUALQUIERA de los dos desenlaces
 *     (redirect interceptado ó error honesto), porque el "verde" real de la
 *     creación de preapproval necesita credenciales que no viven en CI.
 *
 * Dos niveles, igual que demo-path.spec.ts:
 *
 *   1. SMOKE (siempre, gated por login): la página de billing carga para el
 *      OWNER y ofrece "Activar suscripción" (o el estado de la sub existente).
 *      Solo lee — no crea ni cancela nada.
 *
 *   2. ACTIVAR (gated por E2E_BILLING_ACTIVATE=1): hace click en "Activar
 *      suscripción" con MP interceptado y verifica que el flujo termina en la
 *      URL mock (creds presentes) o en el banner de error (creds ausentes),
 *      SIN tocar MP real. No autoriza ningún cobro.
 *
 * Requiere un usuario OWNER existente (no crea cuentas) vía envs — típicamente
 * el owner de la org de prueba. Ver tests/e2e/README.md.
 *
 * Run (PowerShell):
 *   $env:E2E_LOGIN_EMAIL="lautaro-folio-test@folio.app"
 *   $env:E2E_LOGIN_PASSWORD="<password>"
 *   pnpm exec playwright test tests/e2e/billing.spec.ts --project=e2e
 *   # + ejercitar el click de activación con MP mockeado:
 *   $env:E2E_BILLING_ACTIVATE="1"
 *   pnpm exec playwright test tests/e2e/billing.spec.ts --project=e2e
 */

import { expect, test, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_LOGIN_EMAIL ?? "";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "";
const ACTIVAR = process.env.E2E_BILLING_ACTIVATE === "1";

test.skip(
  !EMAIL || !PASSWORD,
  "set E2E_LOGIN_EMAIL y E2E_LOGIN_PASSWORD (OWNER EXISTENTE — este spec no crea cuentas)",
);

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { window.localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* ignore */ }
  });
});

/** Login con usuario OWNER existente → /hoy. No escribe nada. */
async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /entrar/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /^entrar/i }).click();
  await page.waitForURL(/\/hoy/, { timeout: 30_000 });
}

/**
 * Intercepta TODO tráfico a Mercado Pago (checkout externo) devolviendo una
 * página de éxito falsa. Sin esto, el `window.location.href = initPoint` del
 * BillingPage llevaría el browser al checkout real de MP. Con esto, el flujo
 * de activación queda contenido en el dominio de prueba.
 */
async function mockMercadoPago(page: Page): Promise<void> {
  await page.route(/https?:\/\/([^/]*\.)?mercadopago\.com(\.ar)?\//, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><h1 id=\"mp-mock\">Mercado Pago (mock E2E)</h1></body></html>",
    });
  });
}

test.describe("Billing · activación con MP mockeado", () => {
  test("la página de billing carga para el OWNER y ofrece activar/gestionar la suscripción", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);

    await page.goto("/configuracion/billing");
    // Título de la página (BillingPage). Si el usuario no es OWNER la ruta
    // devuelve 404 — este spec asume el owner de la org de prueba.
    await expect(
      page.getByRole("heading", { name: /suscripción folio/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Según el estado de la org de prueba se ofrece "Activar suscripción"
    // (sin sub / cancelada), "Volver a activar" (pendiente), o la card de
    // suscripción activa con "Cancelar suscripción". Cualquiera es válido —
    // la aserción es que la superficie de gestión de billing está presente.
    const activar = page.getByRole("button", { name: /activar suscripción/i });
    const reactivar = page.getByRole("button", { name: /volver a activar/i });
    const cancelar = page.getByRole("button", { name: /cancelar suscripción/i });
    await expect(activar.or(reactivar).or(cancelar).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  /**
   * Ejercita el click de activación con MP interceptado. Gated por
   * E2E_BILLING_ACTIVATE=1 porque crea/renueva un preapproval PENDIENTE en la
   * suscripción de la org de prueba (fila local, sin cobro real; el checkout
   * de MP nunca se autoriza porque lo mockeamos).
   */
  test("click en 'Activar suscripción' con MP mockeado no pega a MP real", async ({ page }) => {
    test.skip(
      !ACTIVAR,
      "set E2E_BILLING_ACTIVATE=1 para ejercitar la activación (crea un preapproval PENDIENTE local)",
    );
    test.setTimeout(120_000);
    await mockMercadoPago(page);
    await login(page);

    await page.goto("/configuracion/billing");
    await expect(
      page.getByRole("heading", { name: /suscripción folio/i }),
    ).toBeVisible({ timeout: 30_000 });

    const activar = page.getByRole("button", { name: /activar suscripción|volver a activar/i }).first();
    // Si la org de prueba ya está ACTIVA no hay botón de activar — en ese caso
    // el sub-flujo no aplica y lo saltamos (no cancelamos una sub real).
    test.skip(
      (await activar.count()) === 0,
      "la org de prueba ya tiene una suscripción activa — no hay botón de activar que ejercitar",
    );

    await activar.click();

    // Dos desenlaces válidos, ambos SIN tocar MP real:
    //   (a) creds MP presentes → redirect al init_point, interceptado por el
    //       mock → aterrizamos en la página falsa (#mp-mock).
    //   (b) creds ausentes en dev → el action falla y BillingPage muestra el
    //       banner de error (role="alert") sin redirigir.
    const mpMock = page.locator("#mp-mock");
    const errorBanner = page.getByRole("alert");
    await expect(mpMock.or(errorBanner).first()).toBeVisible({ timeout: 30_000 });

    // Garantía dura del contrato del spec: nunca terminamos en un dominio real
    // de Mercado Pago (el mock intercepta antes de que cargue).
    expect(page.url()).not.toMatch(/mercadopago\.com/);
  });
});
