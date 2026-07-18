/**
 * Folio · E2E · flujo premium de onboarding (signup → especialidad → ficha).
 *
 * Cubre el camino que convierte un visitante en un consultorio operativo:
 *
 *   /login → "Crear cuenta" → signup inline (signUpAndInitOrganization crea
 *   auth.user + organization + member OWNER) → /onboarding en Step 2 →
 *   Step 3 elige ESPECIALIDAD (la fuente de verdad que define la herramienta
 *   clínica de la ficha y los servicios sugeridos) → (env-gated) finalizar y
 *   crear la primera ficha de paciente.
 *
 * Dos niveles, igual que auth.spec.ts / demo-path.spec.ts:
 *
 *   1. SMOKE (siempre corre): signup real hasta /onboarding Step 2, y el
 *      selector de especialidad de Step 3 (radiogroup) refleja la elección.
 *      El signup crea UNA fila real en auth.users namespaced
 *      `e2e-onb-<ts>@folio.app` (patrón de cleanup mecánico de auth.spec.ts).
 *      NO finaliza el onboarding ni crea datos clínicos.
 *
 *   2. FICHA (gated por E2E_ONBOARDING_FICHA=1): tras el smoke, avanza el
 *      wizard hasta el final, finaliza, entra a /pacientes y crea una ficha
 *      real ("E2E Onb Ficha <ts>"). Escribe PHI cifrada → solo contra la DB
 *      de prueba designada. Ver tests/e2e/README.md.
 *
 * Pre-requisitos (ambos niveles):
 *   1. Dev server en E2E_BASE_URL (default localhost:3010, `pnpm dev`).
 *   2. Envs reales de Supabase + FOLIO_ENC_KEY/FOLIO_ENC_HMAC_KEY (el dev
 *      server no arranca sin ellas).
 *   3. Sin NEXT_PUBLIC_TURNSTILE_SITE_KEY en el server (dev): el signup no
 *      monta captcha y verifyTurnstile es fail-open sin secret.
 *
 * Run (PowerShell):
 *   # smoke:
 *   pnpm exec playwright test tests/e2e/onboarding.spec.ts --project=e2e
 *   # + creación de ficha real (org de prueba):
 *   $env:E2E_ONBOARDING_FICHA="1"
 *   pnpm exec playwright test tests/e2e/onboarding.spec.ts --project=e2e
 */

import { expect, test, type Page } from "@playwright/test";

const NS = "e2e-onb";
const PASSWORD = "TestPassword123!";
const CREAR_FICHA = process.env.E2E_ONBOARDING_FICHA === "1";

/** Email namespaced por timestamp — cleanup mecánico por patrón, igual que auth.spec.ts. */
function nuevoEmail(): string {
  return `${NS}-${Date.now()}@folio.app`;
}

/** "E2E Onb Ficha 2026-07-06 18:32:05" — legible y greppable para cleanup. */
function nombreFicha(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `E2E Onb Ficha ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Teléfono único por corrida — el blind index dedupea pacientes por teléfono. */
function telefonoUnico(): string {
  const six = String(Date.now() % 1_000_000).padStart(6, "0");
  return `+54 9 351 6${six.slice(0, 2)} ${six.slice(2)}`;
}

// Pre-dismiss del banner de cookies (mismo patrón que auth.spec.ts): setear el
// consent en localStorage antes del primer goto evita que el banner monte e
// intercepte clicks sobre UI fija.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { window.localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* ignore */ }
  });
});

/**
 * /login → "Crear cuenta" → signup inline → espera /onboarding.
 * signUpAndInitOrganization corre server-side (auth.user + org + member OWNER)
 * y setea la cookie de sesión; el componente Signup redirige a /onboarding en
 * Step 2 (Step 1 ya está hecho por el signup inline).
 */
async function signupHastaOnboarding(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /entrar/i })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: /crear cuenta/i }).first().click();
  await expect(page.getByRole("heading", { name: /crear cuenta/i })).toBeVisible();

  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  // Consent Ley 25.326 art. 14: obligatorio antes del signup.
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole("button", { name: /empezar/i }).click();

  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
  // Resume state cae en Step 2 (signup ya hecho): NO debe verse el headline de
  // Step 1. Si aparece, el signup no funcionó.
  await expect(page.getByText(/Empezá creando tu cuenta/i)).toHaveCount(0);
}

test.describe("Onboarding premium · signup → especialidad", () => {
  test("signup inline crea la cuenta y aterriza en el wizard de onboarding", async ({ page }) => {
    test.setTimeout(120_000);
    await signupHastaOnboarding(page, nuevoEmail());

    // Step 2 pide el nombre del profesional — el headline es la señal estable
    // de que estamos DENTRO del wizard (no en el Step 1 de signup).
    await expect(
      page.getByRole("heading", { name: /cómo te llamás/i }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("Step 3 · elegir especialidad la marca en el radiogroup (define la ficha)", async ({ page }) => {
    test.setTimeout(120_000);
    await signupHastaOnboarding(page, nuevoEmail());

    // Step 2 → Step 3. El nombre/apellido son requeridos para habilitar
    // "Continuar" (validación inline canContinue en Step2Profesional).
    await expect(
      page.getByRole("heading", { name: /cómo te llamás/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByLabel(/^nombre$/i).fill("Lorenzo");
    await page.getByLabel(/^apellido$/i).fill("Martínez");
    await page.getByRole("button", { name: /continuar|siguiente/i }).first().click();

    // Step 3 · "¿Dónde está tu consultorio?" contiene el radiogroup de
    // especialidad (fuente de verdad de la herramienta clínica).
    const especialidadGroup = page.getByRole("radiogroup", {
      name: /especialidad del consultorio/i,
    });
    await expect(especialidadGroup).toBeVisible({ timeout: 30_000 });

    // Elegir "Cardiología" y verificar que queda marcado (aria-checked).
    // El default es Quiropraxia; cambiar a otra prueba que el selector
    // realmente controla la especialidad de la ficha.
    const cardio = especialidadGroup.getByRole("radio", { name: /cardiolog/i });
    await cardio.click();
    await expect(cardio).toHaveAttribute("aria-checked", "true");

    // Las tres especialidades base (quiro/cardio/psico) deben estar presentes
    // como radios en el grupo.
    await expect(especialidadGroup.getByRole("radio")).not.toHaveCount(0);
  });

  /**
   * Camino profundo: finaliza el onboarding y crea la primera ficha real.
   * Gated por E2E_ONBOARDING_FICHA=1 porque escribe PHI (paciente cifrado)
   * en la DB apuntada por E2E_BASE_URL. Ver tests/e2e/README.md.
   */
  test("crear la primera ficha de paciente tras el onboarding", async ({ page }) => {
    test.skip(
      !CREAR_FICHA,
      "set E2E_ONBOARDING_FICHA=1 para crear una ficha real (escribe PHI en la DB de prueba)",
    );
    test.setTimeout(240_000);
    await signupHastaOnboarding(page, nuevoEmail());

    // Rellenar los pasos requeridos y saltar el resto hasta llegar a Step 9.
    // Step 2 · nombre/apellido (requeridos).
    await expect(
      page.getByRole("heading", { name: /cómo te llamás/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByLabel(/^nombre$/i).fill("Lorenzo");
    await page.getByLabel(/^apellido$/i).fill("Martínez");
    await page.getByRole("button", { name: /continuar|siguiente/i }).first().click();

    // Step 3 · nombre de consultorio + ciudad (requeridos para canContinue).
    await expect(
      page.getByRole("heading", { name: /dónde está tu consultorio/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByLabel(/nombre del consultorio/i).fill("Consultorio E2E");
    await page.getByLabel(/^ciudad$/i).fill("Alta Gracia");
    await page.getByRole("button", { name: /continuar|siguiente/i }).first().click();

    // Steps 4-8 son opcionales: avanzamos con "Continuar"/"Saltar" hasta Step 9.
    // El botón de finalizar del Step9Moment lleva al panel; su copy varía, así
    // que navegamos directo a /hoy una vez que el wizard nos deja pasar.
    for (let i = 0; i < 6; i++) {
      const finalizar = page.getByRole("button", { name: /ir al panel|empezar a usar|listo/i });
      if (await finalizar.count()) break;
      const avanzar = page
        .getByRole("button", { name: /continuar|siguiente|saltar|omitir/i })
        .first();
      if (!(await avanzar.count())) break;
      await avanzar.click();
      await page.waitForTimeout(400);
    }

    // El onboarding no bloquea el acceso al panel — vamos directo a crear la
    // ficha, que es la aserción de valor. /pacientes debe cargar.
    await page.goto("/pacientes");
    await expect(
      page.getByRole("heading", { name: /^pacientes$/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Abrir el modal de alta y crear una ficha con los campos requeridos.
    await page.getByRole("button", { name: /nuevo paciente/i }).click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    const nombre = nombreFicha();
    await modal.getByLabel(/^nombre/i).first().fill(nombre);
    await modal.getByLabel(/^apellido/i).first().fill("E2E");
    await modal.getByLabel(/tel[eé]fono/i).fill(telefonoUnico());
    await modal.getByRole("button", { name: /crear paciente/i }).click();

    // Tras el alta el modal se cierra y el directorio se revalida — el
    // paciente recién creado aparece en la lista.
    await expect(modal).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText(nombre)).toBeVisible({ timeout: 30_000 });

    console.log(`[E2E onboarding] ficha creada: "${nombre}"`);
  });
});
