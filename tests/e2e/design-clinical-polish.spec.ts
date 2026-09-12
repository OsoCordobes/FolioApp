import { expect, test, type Locator, type Page } from "@playwright/test";

declare global { interface Window { __clinicalScrolls: ScrollIntoViewOptions[]; } }

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", route => {
    const request = route.request();
    return new URL(request.url()).origin === origin && ["GET", "HEAD"].includes(request.method())
      ? route.continue() : route.abort("blockedbyclient");
  });
  await context.addInitScript(() => localStorage.setItem("folio.cookieConsent", "denied"));
});

async function openChart(page: Page, specialty: string) {
  await page.goto(`/dev/experience?panel=ficha&esp=${specialty}&editing=1`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tab", { name: "Plan", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => document.fonts.ready);
  const notice = page.getByRole("button", { name: "Entendido", exact: true });
  if (await notice.isVisible()) await notice.click();
}

const scales = [
  { name: "PHQ-9", specialty: "psicologia", remove: "Quitar la escala PHQ-9 de esta sesión", field: 'input[type="radio"]' },
  { name: "GAD-7", specialty: "psicologia", remove: "Quitar la escala GAD-7 de esta sesión", field: 'input[type="radio"]' },
  { name: "NDI", specialty: "kinesiologia", remove: "Quitar NDI de esta sesión", field: 'input[type="radio"]' },
  { name: "ODI", specialty: "kinesiologia", remove: "Quitar ODI de esta sesión", field: 'input[type="radio"]' },
  { name: "Borg RPE", specialty: "kinesiologia", remove: "Quitar Borg RPE de esta sesión", field: 'select[aria-label="Esfuerzo percibido"]' },
];

const disclosures = [
  ...scales.map(scale => ({ ...scale, load: `Cargar ${scale.name}` })),
  { name: "MSE", specialty: "psicologia", load: "+ MSE completo (dominios adicionales)", field: ".pc-clinical-disclosure select", remove: null },
];

/** Focus alone is insufficient when a fixed navigation bar covers the answer. */
async function expectExposed(control: Locator) {
  await expect(control).toBeFocused();
  await expect.poll(async () => {
    // Blocked fixture reads may announce asynchronously. Dismiss only that
    // overlay without moving focus or weakening the network/write fences.
    const notice = control.page().getByRole("button", { name: "Entendido", exact: true });
    if (await notice.isVisible()) await notice.evaluate(button => {
      if (!(button instanceof HTMLButtonElement)) throw new Error("La vista previa debe ofrecer un botón Entendido.");
      button.click();
    });
    return control.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
        && (hit === element || (hit !== null && element.contains(hit)));
    });
  }).toBe(true);
}

for (const scale of scales) {
  test(`${scale.name}: abrir con teclado enfoca sin responder y quitar devuelve el foco`, async ({ page }) => {
    await openChart(page, scale.specialty);
    const load = page.getByRole("button", { name: `Cargar ${scale.name}`, exact: true });
    await load.focus();
    await page.keyboard.press("Enter");
    await expectExposed(page.locator(scale.field).first());
    await expect(page.locator('input[type="radio"]:checked')).toHaveCount(0);
    if (scale.name === "Borg RPE") await expect(page.locator(scale.field)).toHaveValue("");
    await page.getByRole("button", { name: scale.remove, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expectExposed(load);
    await expect(page.getByRole("radio")).toHaveCount(0);
  });
}

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  for (const viewport of [{ width: 390, height: 500 }, { width: 844, height: 390 }]) {
    test(`disclosures visibles a ${viewport.width}×${viewport.height}, movimiento ${reducedMotion}`, async ({ page }) => {
      test.setTimeout(60000);
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize(viewport);
      for (const disclosure of disclosures) {
        await openChart(page, disclosure.specialty);
        const load = page.getByRole("button", { name: disclosure.load, exact: true });
        await load.focus();
        await page.keyboard.press("Enter");
        const control = page.locator(disclosure.field).first();
        await expectExposed(control);
        await expect(page.locator('input[type="radio"]:checked')).toHaveCount(0);
        if (disclosure.name === "MSE" || disclosure.name === "Borg RPE") await expect(control).toHaveValue("");
        if (reducedMotion === "reduce" && viewport.width === 390 && ["NDI", "ODI", "MSE"].includes(disclosure.name)) {
          await page.screenshot({ path: `docs/design/evidence/polish-disclosure-${disclosure.name.toLowerCase()}-390x500.png` });
        }
        if (disclosure.remove) {
          await page.getByRole("button", { name: disclosure.remove, exact: true }).focus();
          await page.keyboard.press("Enter");
          await expectExposed(load);
        }
      }
    });
  }
}

test("una apertura sin activar el botón conserva el campo y la posición de lectura", async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 500 });
  for (const disclosure of disclosures) {
    await openChart(page, disclosure.specialty);
    const note = page.locator(".pc-content textarea").first();
    await note.focus();
    const topBefore = await note.evaluate(element => element.getBoundingClientRect().top);
    // A programmatic expansion changes state without taking focus from the user's field.
    await page.getByRole("button", { name: disclosure.load, exact: true }).evaluate(button => {
      if (!(button instanceof HTMLButtonElement)) throw new Error("El control de apertura clínica debe ser un botón.");
      button.click();
    });
    await expect(page.locator(disclosure.field).first()).toBeAttached();
    await expect(note).toBeFocused();
    // Browser scroll anchoring can change scrollY when content above expands;
    // the user's current field should retain its position within the viewport.
    expect(Math.abs(await note.evaluate(element => element.getBoundingClientRect().top) - topBefore)).toBeLessThanOrEqual(1);
  }
});

test("el protocolo que aparece al cambiar Riesgo no toma el foco al montar su escala", async ({ page }) => {
  await openChart(page, "psicologia");
  const risk = page.getByRole("combobox", { name: "Riesgo", exact: true });
  await risk.focus();
  await risk.selectOption("ideacion");
  await expect(page.locator(".pc-card").filter({ hasText: "C-SSRS" }).first()).toBeVisible();
  await expect(risk).toBeFocused();
});

test("el examen mental ampliado conserva el recorrido de teclado", async ({ page }) => {
  await openChart(page, "psicologia");
  const load = page.getByRole("button", { name: "+ MSE completo (dominios adicionales)", exact: true });
  await load.focus();
  await page.keyboard.press("Enter");
  await expectExposed(page.locator(".pc-clinical-disclosure select").first());
  await expect(page.locator(".pc-clinical-disclosure select").first()).toHaveValue("");
});

test("cambiar pestañas conserva campos todavía sin agregar al borrador clínico", async ({ page }) => {
  await openChart(page, "kinesiologia");
  const note = page.getByRole("textbox", { name: "Nota (opcional)", exact: true }).first();
  await note.fill("Nota ficticia, aún sin agregar");
  const plan = page.getByRole("tab", { name: "Plan", exact: true });
  await plan.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Información", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(plan).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect(note).toHaveValue("Nota ficticia, aún sin agregar");
  // A single historical visit is already fully visible; no dead expansion action.
  await expect(page.locator(".pc-historial .pc-link")).toHaveCount(0);
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`las cinco fichas respetan movimiento ${reducedMotion} y el mapa mantiene su nota`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.__clinicalScrolls = [];
      const scrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(options?: boolean | ScrollIntoViewOptions) {
        if (typeof options === "object") window.__clinicalScrolls.push(options);
        scrollIntoView.call(this, options);
      };
    });
    for (const specialty of ["cardiologia", "psicologia", "kinesiologia", "nutricion", "quiropraxia"]) {
      await openChart(page, specialty);
      await expect(page.locator(".pc-content")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const plan = page.getByRole("tab", { name: "Plan", exact: true });
      await expect(plan).toHaveCSS("transition-duration", reducedMotion === "reduce" ? "0s" : "0.12s, 0.12s, 0.12s");
      if (reducedMotion === "reduce") {
        await page.screenshot({ path: `docs/design/evidence/polish-clinical-${specialty}-reduced-motion.png` });
      }
    }
    await page.getByRole("combobox", { name: "Ubicar vértebra o ilíaco", exact: true }).selectOption("C4");
    await expect(page.locator(".pc-quiro-spine").getByRole("textbox", { name: "Técnica de ajuste", exact: true })).toHaveValue("diversificada");
    await expect.poll(() => page.evaluate(() => window.__clinicalScrolls.map(options => options.behavior)))
      .toContain(reducedMotion === "reduce" ? "auto" : "smooth");
  });
}
