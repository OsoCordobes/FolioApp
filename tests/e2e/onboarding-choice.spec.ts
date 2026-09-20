import { expect, test } from "../fixtures/local-test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* private browsing */ }
  });
});

test("la primera pantalla exige modalidad y rol clínico antes del registro", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "¿Cómo vas a usar Folio?" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Profesional independiente/ })).not.toBeChecked();
  await expect(page.getByRole("radio", { name: /^Clínica/ })).not.toBeChecked();
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveCount(0);
  const proceed = page.getByRole("button", { name: "Seguir con esta opción" });
  await expect(proceed).toBeDisabled();
  await page.getByRole("radio", { name: /^Clínica/ }).check();
  await expect(proceed).toBeDisabled();
  await page.getByRole("radio", { name: "No, administro la clínica" }).check();
  await expect(proceed).toBeEnabled();
  await proceed.click();
  await expect(page.getByRole("heading", { name: "Empezá creando tu cuenta." })).toBeVisible();
  await expect(page.getByText(/miembro adicional/i).first()).toBeVisible();
  await page.getByRole("button", { name: /Atrás/ }).click();
  await expect(page.getByRole("radio", { name: "No, administro la clínica" })).toBeChecked();
});

test("un profesional elige, sale al inicio y retoma sin guardar contraseña", async ({ page }) => {
  await page.goto("/onboarding");
  await page.getByRole("radio", { name: /Profesional independiente/ }).check();
  await page.getByRole("button", { name: "Seguir con esta opción" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill("synthetic@example.test");
  await page.getByPlaceholder("Mínimo 8 caracteres").fill("synthetic-password-only");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("folio:onboarding") ?? "")).toContain("synthetic@example.test");
  expect(await page.evaluate(() => localStorage.getItem("folio:onboarding") ?? "")).not.toContain("synthetic-password-only");
  await page.getByRole("link", { name: /^← Volver al inicio$/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "¿Cómo vas a usar Folio?" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Profesional independiente/ })).toBeChecked();
});

test("el ingreso antiguo conduce a elegir modalidad", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /crear cuenta/i }).first().click();
  await expect(page.getByRole("heading", { name: "Primero, elegí tu modalidad." })).toBeVisible();
  await page.getByRole("link", { name: /Elegir modalidad/ }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("radio", { name: /Profesional independiente/ })).not.toBeChecked();
});

test("la elección y la salida siguen visibles en móvil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/onboarding");
  await expect(page.getByRole("radio", { name: /^Clínica/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^← Volver al inicio$/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});
