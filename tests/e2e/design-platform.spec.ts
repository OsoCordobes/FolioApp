import { expect, test } from "../fixtures/local-test";

declare global { interface Window { __calendarScrolls: ScrollToOptions[]; } }

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", route => {
    const request = route.request();
    return new URL(request.url()).origin === origin && request.method() === "GET"
      ? route.continue() : route.abort("blockedbyclient");
  });
  await context.addInitScript(() => localStorage.setItem("folio.cookieConsent", "denied"));
});

test("calendario anuncia la vista activa y conserva el control por teclado", async ({ page }) => {
  await page.goto("/dev/experience?panel=calendario");
  const views = page.getByRole("group", { name: "Vista del calendario" });
  const week = views.getByRole("button", { name: "Semana", exact: true });
  const month = views.getByRole("button", { name: "Mes", exact: true });
  const inbox = views.getByRole("button", { name: /Bandeja/ });
  await expect(week).toHaveAttribute("aria-pressed", "true");
  await month.focus();
  await page.keyboard.press("Enter");
  await expect(month).toHaveAttribute("aria-pressed", "true");
  await expect(week).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".cal-mes")).toBeVisible();
  await inbox.focus();
  await page.keyboard.press("Space");
  await expect(inbox).toHaveAttribute("aria-pressed", "true");
  await expect(month).toHaveAttribute("aria-pressed", "false");
  await week.click();
  await expect(page.locator(".cal-semana")).toBeVisible();
});

test("los filtros del calendario caben en móvil y anuncian la selección", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dev/experience?panel=calendario");
  const filters = page.getByRole("group", { name: "Filtrar turnos por estado" });
  const unconfirmed = filters.getByRole("button", { name: "Sin confirmar" });
  await expect(unconfirmed).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await unconfirmed.focus();
  await page.keyboard.press("Space");
  await expect(unconfirmed).toHaveAttribute("aria-pressed", "true");
  await expect(filters.getByRole("button", { name: "Todos", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("turno semanal tiene nombre completo accesible y el detalle devuelve el foco", async ({ page }) => {
  await page.goto("/dev/experience?panel=calendario");
  const appointment = page.locator(".cal-turno").first();
  await expect(appointment).toBeVisible();
  const fullLabel = await appointment.getAttribute("title");
  expect(fullLabel).toBeTruthy();
  const service = (await appointment.locator(".cal-turno-meta").innerText())
    .replace(/^\s*\d{2}:\d{2}\s*·\s*/, "").trim();
  expect(service).toBeTruthy();
  await expect(appointment).toHaveAccessibleName(`${fullLabel} · ${service}`);
  await appointment.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(fullLabel!.split(" · ")[0]);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(appointment).toBeFocused();
});

test("buscar un nombre sin tildes conserva los filtros de cobro", async ({ page }) => {
  await page.goto("/dev/experience?panel=finanzas");
  const search = page.getByRole("textbox", { name: "Buscar transacciones por paciente o monto" });
  await search.fill("  TOMAS  ");
  await expect(page.locator(".fn-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".fn-table tbody")).toContainText("Tomás Acosta");
  await page.getByRole("button", { name: "Pendientes", exact: true }).click();
  await expect(page.locator(".fn-table tbody tr")).toHaveCount(0);
  await search.fill("julian");
  await expect(page.locator(".fn-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".fn-table tbody")).toContainText("Julián Ríos");
  await expect(page.locator(".fn-table tbody")).toContainText("Pendiente");
});

for (const [panel, label] of [["pacientes", "Tabla de pacientes"], ["finanzas", "Tabla de transacciones"]]) {
  test(`la tabla móvil de ${panel} indica y permite desplazarse con teclado`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/dev/experience?panel=${panel}`);
    const table = page.getByRole("region", { name: label });
    await expect(page.getByText("Deslizá la tabla para ver todos los datos →")).toBeVisible();
    await expect(table).toBeVisible();
    expect(await table.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await table.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`el desplazamiento automático respeta movimiento ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => {
      window.__calendarScrolls = [];
      window.scrollTo = ((options: ScrollToOptions) => {
        window.__calendarScrolls.push(options);
      }) as typeof window.scrollTo;
    });
    await page.goto("/dev/experience?panel=calendario", { waitUntil: "networkidle" });
    await expect(page.locator(".cal-ahora")).toBeVisible();
    const behavior = reducedMotion === "reduce" ? "instant" : "smooth";
    await expect.poll(() => page.evaluate(() => window.__calendarScrolls.map(options => options.behavior))).toContain(behavior);
    if (reducedMotion === "reduce") await expect(page.locator(".cal-turno-pulse")).toHaveCSS("animation-name", "none");
  });
}
