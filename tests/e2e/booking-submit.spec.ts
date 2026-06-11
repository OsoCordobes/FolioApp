/**
 * Folio · E2E · booking público REAL con submit (/book/[slug]).
 *
 * A diferencia de book-public.spec.ts (que usa /dev/book-preview con mocks),
 * este spec ejecuta el flujo completo contra la DB del entorno apuntado:
 * crea pedidos/turnos REALES vía createPedidoPublico.
 *
 * ⚠️ ESCRIBE EN LA BASE DE DATOS del entorno que sirve E2E_BASE_URL.
 *    Por eso está gateado por E2E_BOOKING_SLUG: solo corre si se apunta
 *    explícitamente a una org de prueba (ej. `lautaro-folio`, org de datos
 *    de muestra designada para esto). Ver tests/e2e/README.md.
 *
 * Datos que crea por corrida completa (3 reservas):
 *   - nombre  : "E2E Spec Booking <YYYY-MM-DD HH:mm:ss>" (+ sufijo A/B)
 *   - teléfono: +54 9 351 5xx xxxx único por corrida (derivado del timestamp).
 *     El blind index de teléfono dedupea pacientes: un teléfono repetido
 *     REUTILIZA el paciente, por eso cada corrida usa uno nuevo.
 *   - email   : nunca (evita disparar notificaciones reales).
 *
 * TODO(cleanup): createPedidoPublico devuelve el id del pedido pero el wizard
 * no lo expone en el DOM, y desde la UI pública no hay forma de cancelar.
 * Cuando haya acceso SQL de mantenimiento, borrar por patrón de nombre
 * "E2E Spec Booking %" (pedido + turno + paciente asociados).
 *
 * Pre-requisitos:
 *   1. Dev server en E2E_BASE_URL (default localhost:3010, `pnpm dev`).
 *   2. Sin NEXT_PUBLIC_TURNSTILE_SITE_KEY en el entorno del server (dev):
 *      el wizard no monta captcha y verifyTurnstile es fail-open sin secret.
 *   3. La org del slug tiene servicios activos y disponibilidad cargada.
 *
 * Run (PowerShell):
 *   $env:E2E_BOOKING_SLUG="lautaro-folio"
 *   pnpm exec playwright test tests/e2e/booking-submit.spec.ts --project=e2e
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const SLUG = process.env.E2E_BOOKING_SLUG ?? "";

test.skip(!SLUG, "set E2E_BOOKING_SLUG para correr contra una org de prueba");

// Pre-dismiss del banner de cookies (mismo patrón que auth.spec.ts) para que
// no intercepte clicks sobre UI fija al fondo.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { window.localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* ignore */ }
  });
});

/** "E2E Spec Booking 2026-06-11 18:32:05" — legible y greppable para cleanup. */
function nombreDePrueba(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `E2E Spec Booking ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Teléfono único por corrida: +54 9 351 5XX XXXX con 6 dígitos derivados del
 * timestamp. El blind index de teléfono dedupea pacientes — un teléfono
 * repetido reutiliza el paciente existente, así que cada submit usa uno nuevo.
 */
function telefonoUnico(offsetMs = 0): string {
  const six = String((Date.now() + offsetMs) % 1_000_000).padStart(6, "0");
  return `+54 9 351 5${six.slice(0, 2)} ${six.slice(2)}`;
}

/**
 * Botones de slot: muestran solo la hora vía fmtHora (toLocaleTimeString
 * es-AR, 2-digit). Según el ICU del browser, es-AR resuelve a 24h ("17:15")
 * o a 12h ("05:15 p. m." — el Chromium de Playwright hace esto), por eso el
 * regex acepta ambos. El sufijo anclado evita matchear "← Cambiar servicio".
 */
const HORA_RE = /^\d{1,2}:\d{2}(\s*[ap]\.?\s*m\.?)?$/i;

function slotButtons(page: Page): Locator {
  return page.locator("#bk-flow").getByRole("button", { name: HORA_RE });
}

/** La hora capturada del botón se reinyecta en RegExps — escapamos metachars
 *  ("05:15 p. m." trae puntos). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * /book/<slug> → click en el segundo servicio de la lista (o el primero si
 * hay uno solo) → espera la grilla de slots (server action contra la DB).
 */
async function irHastaSlots(page: Page): Promise<void> {
  await page.goto(`/book/${SLUG}`);
  await expect(
    page.getByRole("heading", { name: /elegí el servicio/i }),
  ).toBeVisible({ timeout: 30_000 });

  // En la vista "servicio", los únicos botones dentro de #bk-flow son los
  // servicios (el hero PublicCard queda afuera del contenedor).
  const servicios = page.locator("#bk-flow").getByRole("button");
  const count = await servicios.count();
  expect(count, `la org "${SLUG}" no publica servicios activos`).toBeGreaterThan(0);
  await servicios.nth(Math.min(1, count - 1)).click();

  await expect(
    page.getByRole("heading", { name: /elegí un horario/i }),
  ).toBeVisible();
  await expect(
    slotButtons(page).first(),
    `la org "${SLUG}" no ofrece slots en los próximos 14 días`,
  ).toBeVisible({ timeout: 30_000 });
}

/** Completa "Tus datos" (sin email — evita notificaciones reales) y envía. */
async function completarDatosYEnviar(
  page: Page,
  nombre: string,
  telefono: string,
): Promise<void> {
  await expect(page.getByRole("heading", { name: /tus datos/i })).toBeVisible();
  await page.getByLabel(/nombre y apellido/i).fill(nombre);
  await page.getByLabel(/tel[eé]fono/i).fill(telefono);
  await page.locator("#bk-flow").getByRole("checkbox").check();
  await page.getByRole("button", { name: /solicitar turno/i }).click();
}

/** Pantalla de éxito: «¡Turno confirmado!» (auto_confirm) o «¡Solicitud enviada!». */
function expectExito(page: Page) {
  return expect(
    page.getByRole("heading", { name: /turno confirmado|solicitud enviada/i }),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("/book/[slug] · submit real", () => {
  test("reserva pública: servicio → slot → datos → pantalla de éxito", async ({ page }) => {
    test.setTimeout(180_000);
    const nombre = nombreDePrueba();
    const telefono = telefonoUnico();

    await irHastaSlots(page);

    const dia = (await page.locator("#bk-flow h3").first().innerText()).trim();
    const hora = (await slotButtons(page).first().innerText()).trim();
    await slotButtons(page).first().click();

    await completarDatosYEnviar(page, nombre, telefono);
    await expectExito(page);

    // La pantalla de éxito repite el horario elegido ("· HH:MM hs"). Con
    // auto-confirm el horario aparece DOS veces (resumen + "Te esperamos…"),
    // por eso .first() — sin él, strict mode rebota el doble match.
    await expect(page.getByText(new RegExp(`${escapeRe(hora)}\\s*hs`)).first()).toBeVisible();

    // Reporte del dato real creado (para limpieza manual posterior).
    console.log(`[E2E booking] creado: "${nombre}" · tel ${telefono} · ${dia} ${hora}`);
  });

  test("doble reserva del mismo slot → conflicto y retry con otro slot", async ({ page, context }) => {
    test.setTimeout(240_000);
    const nombre = nombreDePrueba();

    // Dos pestañas cargan la MISMA grilla de slots antes de reservar: la de B
    // queda "vieja" cuando A reserva, reproduciendo la carrera real de dos
    // pacientes mirando el mismo horario.
    const pageB = await context.newPage();
    await irHastaSlots(page);
    await irHastaSlots(pageB);

    const horaElegida = (await slotButtons(page).first().innerText()).trim();
    const horaEnB = (await slotButtons(pageB).first().innerText()).trim();
    expect(horaEnB, "ambas pestañas deben ver el mismo primer slot").toBe(horaElegida);

    // A reserva el primer slot → éxito.
    await slotButtons(page).first().click();
    const telefonoA = telefonoUnico();
    await completarDatosYEnviar(page, `${nombre} A`, telefonoA);
    await expectExito(page);

    // B (lista desactualizada) intenta el MISMO slot → el server tiene que
    // rechazar con el mensaje de conflicto, sin pantalla de éxito.
    await slotButtons(pageB).first().click();
    const telefonoB = telefonoUnico(7);
    await completarDatosYEnviar(pageB, `${nombre} B`, telefonoB);
    await expect(pageB.getByText(/ya no está disponible/i)).toBeVisible({ timeout: 30_000 });
    await expect(
      pageB.getByRole("heading", { name: /turno confirmado|solicitud enviada/i }),
    ).toHaveCount(0);

    // Regresión del flujo de error: el wizard debe permitir reintentar.
    // "← Cambiar horario" vuelve a la grilla y dispara un refetch, PERO la
    // lista vieja queda renderizada mientras carga (solo se suma un
    // "Cargando slots…" arriba). Clickear el PRIMER slot acá re-elige el
    // horario recién tomado si el refetch no llegó (carrera observada en el
    // run real). El SEGUNDO slot está libre en ambas listas: en la vieja el
    // tomado es el primero, y en la refrescada ya no aparece.
    await pageB.getByRole("button", { name: /cambiar horario/i }).click();
    await expect(
      pageB.getByRole("heading", { name: /elegí un horario/i }),
    ).toBeVisible();
    await expect(slotButtons(pageB).nth(1)).toBeVisible({ timeout: 30_000 });
    const horaRetry = (await slotButtons(pageB).nth(1).innerText()).trim();
    await slotButtons(pageB).nth(1).click();
    // Mismos datos de B (paciente reintentando): el estado del form persiste,
    // re-llenamos igual para no depender de eso.
    await completarDatosYEnviar(pageB, `${nombre} B`, telefonoB);
    await expectExito(pageB);

    console.log(
      `[E2E booking] creados: "${nombre} A" tel ${telefonoA} (${horaElegida}) · ` +
        `"${nombre} B" tel ${telefonoB} (retry ${horaRetry})`,
    );
  });
});
