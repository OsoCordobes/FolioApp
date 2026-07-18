/**
 * Folio · E2E · booking público premium (/book/[slug]) — solo lectura.
 *
 * Complementa a los otros dos specs de booking sin pisarlos:
 *   - book-public.spec.ts        → integración de la landing con mocks (/dev/book-preview).
 *   - booking-submit.spec.ts     → submit REAL (✍️ escribe pedidos/turnos en la DB).
 *   - booking.spec.ts (este)     → landing + wizard REALES de /book/<slug>, sin submit.
 *
 * Recorre el link público real de una org (landing médico-first → CTA
 * "Reservar" → wizard de reserva → servicio → grilla de slots) verificando
 * estructura, accesibilidad de los slots y ausencia de errores de consola.
 * NO envía la reserva, así que NO crea filas — es seguro correrlo contra la
 * org de prueba sin dejar residuo.
 *
 * Gated por E2E_BOOKING_SLUG (mismo env que booking-submit) para apuntar a una
 * org con servicios + disponibilidad reales (ej. `lautaro-folio`). Sin la env
 * se skipea — no asumimos que un slug arbitrario exista. Ver tests/e2e/README.md.
 *
 * Pre-requisitos:
 *   1. Dev server en E2E_BASE_URL (default localhost:3010, `pnpm dev`).
 *   2. La org del slug publica servicios activos y tiene disponibilidad cargada.
 *
 * Run (PowerShell):
 *   $env:E2E_BOOKING_SLUG="lautaro-folio"
 *   pnpm exec playwright test tests/e2e/booking.spec.ts --project=e2e
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const SLUG = process.env.E2E_BOOKING_SLUG ?? "";

test.skip(!SLUG, "set E2E_BOOKING_SLUG para correr contra una org de prueba");

// Ruido conocido de dev que no es bug del producto (espejo de demo-path.spec.ts).
const CONSOLE_IGNORE: RegExp[] = [
  /Download the React DevTools/i,
  /favicon\.ico/i,
  /sentry/i,
];

// El accessible name de cada slot es el aria-label completo (PR a11y #45):
// "Viernes, 12 de junio, 03:00 p. m. hs". Anclamos al sufijo "hs" para no
// matchear "← Cambiar servicio" u otros botones. (Mismo regex que booking-submit.)
const HORA_RE = /\d{1,2}:\d{2}(\s*[ap]\.?\s*m\.?)?\s*hs$/i;

function slotButtons(page: Page): Locator {
  return page.locator("#bk-flow").getByRole("button", { name: HORA_RE });
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { window.localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* ignore */ }
  });
});

test.describe("/book/[slug] · landing + wizard (solo lectura)", () => {
  test("la landing pública renderiza el hero y el CTA de reserva", async ({ page }) => {
    test.setTimeout(120_000);

    const errores: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errores.push(msg.text());
    });
    page.on("pageerror", (err) => errores.push(String(err)));

    await page.goto(`/book/${SLUG}`);

    // El wizard de reserva vive en #bk-flow y arranca en "Elegí el servicio".
    // Es el ancla estable de la página pública (BookLanding lo envuelve en
    // #reservar; el hero + vitrine pueden variar por org).
    await expect(page.locator("#bk-flow")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator("#bk-flow").getByRole("heading", { name: /elegí el servicio/i }),
    ).toBeVisible({ timeout: 30_000 });

    // El footer "Hecho con Folio" es la marca sutil del producto en el link
    // público — parte del feel premium que X10 debe cubrir.
    await expect(page.locator(".bl-powered")).toContainText(/hecho con\s*folio/i);

    const reales = errores.filter((e) => !CONSOLE_IGNORE.some((rx) => rx.test(e)));
    expect(reales, `Errores de consola en /book/${SLUG}:\n${reales.join("\n")}`).toEqual([]);
  });

  test("wizard: servicio → grilla de slots con horarios accesibles", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(`/book/${SLUG}`);
    await expect(
      page.getByRole("heading", { name: /elegí el servicio/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Elegir el primer servicio publicado. En la vista "servicio" los únicos
    // botones dentro de #bk-flow son los servicios (el hero queda afuera).
    const servicios = page.locator("#bk-flow").getByRole("button");
    const count = await servicios.count();
    expect(count, `la org "${SLUG}" no publica servicios activos`).toBeGreaterThan(0);
    await servicios.first().click();

    // Paso siguiente: "Elegí un horario" (org Solo) o "Elegí profesional"
    // (multi-prof). Toleramos el paso intermedio eligiendo el primer profesional.
    const headingHorario = page.getByRole("heading", { name: /elegí un horario/i });
    const headingProfesional = page.getByRole("heading", { name: /elegí profesional/i });
    await expect(headingHorario.or(headingProfesional)).toBeVisible({ timeout: 30_000 });
    if (await headingProfesional.isVisible()) {
      await page.locator("#bk-flow button.bk-servicio").first().click();
      await expect(headingHorario).toBeVisible();
    }

    // La grilla ofrece al menos un slot y cada slot expone su horario como
    // accessible name (el aria-label del PR de a11y). NO reservamos.
    const primerSlot = slotButtons(page).first();
    await expect(
      primerSlot,
      `la org "${SLUG}" no ofrece slots en los próximos 14 días`,
    ).toBeVisible({ timeout: 30_000 });
    await expect(primerSlot).toHaveAccessibleName(HORA_RE);
  });

  test("wizard: 'Cambiar servicio' vuelve a la selección de servicio", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(`/book/${SLUG}`);
    await expect(
      page.getByRole("heading", { name: /elegí el servicio/i }),
    ).toBeVisible({ timeout: 30_000 });

    await page.locator("#bk-flow").getByRole("button").first().click();
    await expect(
      page.getByRole("heading", { name: /elegí un horario|elegí profesional/i }),
    ).toBeVisible({ timeout: 30_000 });

    // El wizard permite retroceder sin perder el contexto de la org (regresión
    // del flujo de navegación premium).
    await page.getByRole("button", { name: /cambiar servicio/i }).click();
    await expect(
      page.getByRole("heading", { name: /elegí el servicio/i }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
