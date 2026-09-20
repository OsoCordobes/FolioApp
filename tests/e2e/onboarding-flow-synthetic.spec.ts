import { expect, test, type Page } from "../fixtures/local-test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* private browsing */ }
  });
});

async function fillIdentity(page: Page, treating: boolean) {
  await expect(page.getByRole("heading", { name: "¿Cómo te llamás?" })).toBeVisible();
  await expect(page.getByLabel(/^Matrícula/)).toHaveCount(treating ? 1 : 0);
  await page.getByLabel("Nombre", { exact: true }).fill("Valentina");
  await page.getByLabel("Apellido", { exact: true }).fill("Costa");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Dónde está tu/ })).toBeVisible();
  const save = await page.evaluate(() => sessionStorage.getItem("folio:onboarding:synthetic-save"));
  expect(save).toContain('"step":2');
}

async function fillOrganization(page: Page, clinic: boolean) {
  await page.getByLabel(clinic ? "Nombre de la clínica" : "Nombre del consultorio").fill(clinic ? "Clínica Ficticia" : "Consultorio Ficticio");
  await page.getByRole("radio", { name: "Cardiología" }).click();
  await page.getByLabel("Ciudad", { exact: true }).fill("Córdoba");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tu identidad visual" })).toBeVisible();
}

test("Solo recorre perfil, horarios y Google; el cierre muestra página sólo tras datos sintéticos completos", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/dev/onboarding-flow?mode=solo");
  await fillIdentity(page, true);
  await fillOrganization(page, false);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "¿Cuándo atendés?" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "¿Qué servicios ofrecés?" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "¿Conectamos tu Google Calendar?" })).toBeVisible();
  await page.getByRole("button", { name: "Configurar después", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tu espacio quedó creado." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver mi página" })).toBeVisible();
});

test("Clínica con titular tratante conserva perfil, horarios y opción de Google y muestra su página lista", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/dev/onboarding-flow?mode=clinic-treating");
  await fillIdentity(page, true);
  await fillOrganization(page, true);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "¿Cuándo atendés?" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "¿Conectamos tu Google Calendar?" })).toBeVisible();
  await page.getByRole("button", { name: "Configurar después", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tu espacio quedó creado." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver mi página" })).toBeVisible();
  await expect(page.getByText("Valentina Costa").first()).toBeVisible();
});

test("Clínica administrativa omite matrícula, horarios y Google; Atrás y reanudación respetan seis pasos", async ({ page }) => {
  await page.goto("/dev/onboarding-flow?mode=clinic-admin");
  await fillIdentity(page, false);
  await fillOrganization(page, true);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "¿Qué servicios ofrecés?" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Paso 5 de 6" })).toBeVisible();
  await page.getByRole("button", { name: "Atrás" }).click();
  await expect(page.getByRole("heading", { name: "Tu identidad visual" })).toBeVisible();
  await page.goto("/dev/onboarding-flow?mode=clinic-admin&step=6");
  await expect(page.getByText(/Hay cambios locales de esta organización sin confirmar/)).toBeVisible();
  await page.getByRole("button", { name: "Usar la versión guardada" }).click();
  await expect(page.getByRole("progressbar", { name: "Paso 5 de 6" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tu espacio quedó creado." })).toBeVisible();
  await expect(page.getByText(/todavía necesita profesionales aceptados y agenda configurada/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver mi página" })).toHaveCount(0);
  await expect(page.getByText("Valentina Costa")).toHaveCount(0);
});

test("al reanudar en el cierre conserva el borrador hasta elegir y obliga a revisar lo restaurado", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("folio:onboarding", JSON.stringify({
    v: 2,
    organizationId: "12600000-0000-4000-8000-000000000126",
    identity: "titular@example.test",
    data: { nombre: "Cambio Local", consultorioNombre: "Clínica Local", tipo: "INDEPENDIENTE", ownerTratante: true, password: "never-use" },
  })));
  await page.goto("/dev/onboarding-flow?mode=clinic-admin&step=8");
  await expect(page.getByText(/Hay cambios locales de esta organización sin confirmar/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tu espacio quedó creado." })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("folio:onboarding"))).toContain("Cambio Local");
  await page.getByRole("button", { name: "Restaurar y revisar mis cambios" }).click();
  await expect(page.getByRole("heading", { name: "¿Cómo te llamás?" })).toBeVisible();
  await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Cambio Local");
  await expect(page.getByLabel(/^Matrícula/)).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByLabel("Nombre de la clínica")).toHaveValue("Clínica Local");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tu espacio quedó creado." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver mi página" })).toHaveCount(0);
});

test("al elegir la versión guardada descarta explícitamente el borrador y finaliza", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("folio:onboarding", JSON.stringify({
    v: 2,
    organizationId: "12600000-0000-4000-8000-000000000126",
    identity: "titular@example.test",
    data: { nombre: "Cambio Local" },
  })));
  await page.goto("/dev/onboarding-flow?mode=clinic-admin&step=8");
  await page.getByRole("button", { name: "Usar la versión guardada" }).click();
  await expect(page.getByRole("heading", { name: "Tu espacio quedó creado." })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("folio:onboarding"))).toBeNull();
});
