/** Public access experience. No account creation, credentials, or server mutations.
 * Run through the isolated local runner; never read .env.local. */
import { expect, test } from "../fixtures/local-test";

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", (route) => {
    const request = route.request();
    return new URL(request.url()).origin === origin && ["GET", "HEAD"].includes(request.method())
      ? route.continue() : route.abort("blockedbyclient");
  });
  await context.addInitScript(() => {
    try { localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* storage unavailable */ }
  });
});

test.describe("Acceso · ilustración estable y formulario", () => {
  test("recuperar acceso hidrata sin errores al abrir y recargar", async ({ page }) => {
    const hydrationErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (/hydrat|server rendered|didn't match|did not match/i.test(message.text())) hydrationErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/forgot", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Recuperá tu acceso." })).toBeVisible();
    await page.getByRole("textbox", { name: "Email de tu cuenta" }).fill("apertura@example.invalid");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "Email de tu cuenta" }).fill("recarga@example.invalid");
    await expect(page.getByRole("textbox", { name: "Email de tu cuenta" })).toHaveValue("recarga@example.invalid");
    expect(hydrationErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("la agenda ilustrativa mantiene su contenido mientras se escribe", async ({ page }) => {
    await page.clock.install();
    await page.goto("/login");
    const illustration = page.getByRole("figure", { name: "Agenda ilustrativa con personas y datos ficticios" });
    await expect(illustration).toBeVisible();
    await expect(illustration).toContainText("Vista ilustrativa. Personas y datos ficticios.");
    const original = await illustration.innerText();
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("profesional@example.invalid");
    await page.clock.runFor(16000);
    expect(await illustration.innerText()).toBe(original);
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveValue("profesional@example.invalid");
    await expect(page.locator(".fx-auth-art button")).toHaveCount(0);
  });

  test("la contraseña se muestra y oculta por teclado sin perder el valor", async ({ page }) => {
    await page.goto("/login");
    const password = page.getByLabel("Contraseña", { exact: true });
    await password.fill("ClaveSintetica1!");
    await page.getByRole("button", { name: "Mostrar contraseña", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("ClaveSintetica1!");
    await page.keyboard.press("Enter");
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveValue("ClaveSintetica1!");
  });

  test("se puede cambiar a crear cuenta y recuperar el acceso sin enviar datos", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tu práctica empieza acá." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Crear cuenta", exact: true })).toBeDisabled();
    await page.goto("/forgot");
    await expect(page.getByRole("heading", { level: 1, name: "Recuperá tu acceso." })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email de tu cuenta" })).toBeEditable();
  });

  test("la marca devuelve al inicio sin confundirla con una acción de acceso", async ({ page }) => {
    await page.goto("/login");
    await page.locator(".fx-auth-art").getByRole("link", { name: "Folio, volver al inicio" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: /Tu consultorio\.\s*Todo a mano\./ })).toBeVisible();
  });

  test("el portal identifica la consulta ilustrativa y presenta el email del paciente", async ({ page }) => {
    await page.goto("/portal/login");
    await expect(page.getByRole("figure", { name: "Consulta ilustrativa con personas y datos ficticios" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Tu portal de paciente." })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeEditable();
  });

  test("movimiento reducido conserva el formulario y la ilustración visibles", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    await expect(page.getByRole("figure", { name: "Agenda ilustrativa con personas y datos ficticios" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ingresar a Folio", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeEditable();
  });
});

test.describe("Acceso · móvil", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("el formulario cabe sin la ilustración y mantiene acceso a recuperar contraseña", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator(".fx-auth-art")).not.toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Volvé a tu consultorio." })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeEditable();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "¿La olvidaste?" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Recuperá tu acceso." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar enlace de recuperación" })).toBeVisible();
  });
});
