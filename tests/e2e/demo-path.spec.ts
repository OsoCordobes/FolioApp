/**
 * Folio · E2E · smoke del camino del médico para la demo.
 *
 * Login con un usuario EXISTENTE (vía envs — NO crea cuentas: el patrón de
 * signup de auth.spec.ts crea usuarios reales en la DB apuntada y ya
 * contaminó prod con orgs de prueba; acá solo reutilizamos una sesión):
 *
 *   /login → /hoy carga → abrir modal de crear turno (FAB walk-in) →
 *   cerrar SIN crear → /calendario y /pacientes navegan sin errores
 *   de consola.
 *
 * Gateado por E2E_LOGIN_EMAIL / E2E_LOGIN_PASSWORD (usuario ya existente,
 * p. ej. el owner de la org de prueba `lautaro-folio`). Solo lee; no escribe
 * nada en la DB. Ver tests/e2e/README.md.
 *
 * Run (PowerShell):
 *   $env:E2E_LOGIN_EMAIL="lautaro-folio-test@folio.app"
 *   $env:E2E_LOGIN_PASSWORD="<password>"
 *   pnpm exec playwright test tests/e2e/demo-path.spec.ts --project=e2e
 */

import { expect, test } from "@playwright/test";

const EMAIL = process.env.E2E_LOGIN_EMAIL ?? "";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "";

test.skip(
  !EMAIL || !PASSWORD,
  "set E2E_LOGIN_EMAIL y E2E_LOGIN_PASSWORD (usuario EXISTENTE — este spec no crea cuentas)",
);

// Ruido conocido de dev que no es un bug del producto.
const CONSOLE_IGNORE: RegExp[] = [
  /Download the React DevTools/i,
  /favicon\.ico/i,
  // Sentry sin DSN en dev / transport bloqueado por la red local.
  /sentry/i,
];

// Pre-dismiss del banner de cookies (mismo patrón que auth.spec.ts): el FAB
// walk-in vive fijo abajo a la derecha y el banner lo taparía.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { window.localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* ignore */ }
  });
});

test.describe("Demo path · médico logueado", () => {
  test("/hoy → modal crear turno (abrir/cerrar) → /calendario → /pacientes sin errores de consola", async ({ page }) => {
    test.setTimeout(180_000);

    const errores: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errores.push(msg.text());
    });
    page.on("pageerror", (err) => errores.push(String(err)));

    // ── Login con usuario existente ─────────────────────────────────────
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /entrar/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /^entrar/i }).click();

    // ── /hoy carga ──────────────────────────────────────────────────────
    await page.waitForURL(/\/hoy/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: /tu agenda hoy/i }),
    ).toBeVisible({ timeout: 30_000 });

    // ── Modal de crear turno: abrir y cerrar SIN crear ──────────────────
    // /hoy tiene DOS botones que abren el modal: "Turno walk-in" (header) y
    // el FAB "Walk-in" (fi-fab, siempre visible). El regex anclado matchea
    // solo el FAB — /walk-in/i sin anclar viola strict mode.
    await page.getByRole("button", { name: /^walk-in$/i }).click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(
      modal.getByRole("heading", { name: /nuevo turno/i }),
    ).toBeVisible();
    // "Cancelar" (con servicios) o "Cerrar" (org sin servicios) aparecen
    // cuando la meta del modal termina de cargar.
    await modal
      .getByRole("button", { name: /^(cancelar|cerrar)$/i })
      .click({ timeout: 30_000 });
    await expect(modal).toBeHidden();

    // ── /calendario ─────────────────────────────────────────────────────
    await page.goto("/calendario");
    await expect(
      page.getByRole("heading", { name: /^calendario$/i }),
    ).toBeVisible({ timeout: 30_000 });

    // ── /pacientes ──────────────────────────────────────────────────────
    await page.goto("/pacientes");
    await expect(
      page.getByRole("heading", { name: /^pacientes$/i }),
    ).toBeVisible({ timeout: 30_000 });

    // ── Sin errores de consola en todo el camino ────────────────────────
    const reales = errores.filter((e) => !CONSOLE_IGNORE.some((rx) => rx.test(e)));
    expect(reales, `Errores de consola en el camino de la demo:\n${reales.join("\n")}`).toEqual([]);
  });
});
