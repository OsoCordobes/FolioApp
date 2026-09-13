import { expect, test } from "../fixtures/local-test";

const specialties = [
  ["Psicología", "psicologia", "Registro de sesión"],
  ["Cardiología", "cardiologia", "Registro cardiovascular"],
  ["Kinesiología", "kinesiologia", "Evolución funcional"],
  ["Nutrición", "nutricion", "Seguimiento nutricional"],
  ["Quiropraxia", "quiropraxia", "Registro por segmento"],
] as const;

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin && ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort("blockedbyclient"));
  await context.addInitScript(() => localStorage.setItem("folio.cookieConsent", "denied"));
});

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`cinco fichas distintas y marco estable a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height:1000 });
    await page.goto("/#ficha");
    await page.evaluate(() => document.fonts.ready);
    const record = page.locator("#specialty-record");
    const sizes: { height:number; documentTop:number }[] = [];
    for (const [name,id,title] of specialties) {
      if (width <= 600) await page.getByLabel("Explorá una especialidad").selectOption(id);
      else if (await page.getByRole("button", {name,exact:true}).getAttribute("aria-expanded") !== "true") await page.getByRole("button", {name,exact:true}).click();
      await expect(record).toHaveAttribute("aria-label", `Ficha de ejemplo de ${name}`);
      await expect(record.getByRole("heading",{name:title,exact:true})).toBeVisible();
      await expect(record.getByRole("heading",{level:3})).toHaveCount(1);
      sizes.push(await record.evaluate((el) => ({height:el.getBoundingClientRect().height,documentTop:el.getBoundingClientRect().top + window.scrollY})));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name} no debe desbordar la página`).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...sizes.map((s)=>s.height))-Math.min(...sizes.map((s)=>s.height)), "El marco mantiene su altura al elegir otra ficha").toBeLessThanOrEqual(1);
    expect(Math.max(...sizes.map((s)=>s.documentTop))-Math.min(...sizes.map((s)=>s.documentTop)), "La ilustración permanece anclada en la página").toBeLessThanOrEqual(1);
  });
}

test("acordeón por teclado: una descripción abierta y cierre sin perder la ficha", async ({ page }) => {
  await page.goto("/#ficha");
  const first = page.getByRole("button", { name:"Psicología", exact:true });
  await first.focus();
  await page.keyboard.press("End");
  const last = page.getByRole("button", { name:"Quiropraxia", exact:true });
  await expect(last).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(last).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('.fx-specialty-accordion button[aria-expanded="true"]')).toHaveCount(1);
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name:"Registro por segmento", exact:true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(last).toHaveAttribute("aria-expanded", "false");
  await expect(last).toBeFocused();
  await expect(page.getByRole("heading", { name:"Registro por segmento", exact:true })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
});

test("sin movimiento reducido no hay animación continua ni cambio automático", async ({ page }) => {
  await page.emulateMedia({ reducedMotion:"no-preference" });
  await page.goto("/#ficha");
  await page.getByRole("button",{name:"Nutrición",exact:true}).click();
  const content=page.locator('.fx-specialty-record-content[data-visible="true"]');
  const motion=await content.evaluate((el)=>({name:getComputedStyle(el).animationName,iterations:getComputedStyle(el).animationIterationCount}));
  expect(motion.name).toBe("fx-specialty-change");
  expect(motion.iterations).toBe("1");
  await page.emulateMedia({ reducedMotion:"reduce" });
  await expect.poll(()=>content.evaluate((el)=>getComputedStyle(el).animationName)).toBe("none");
  await expect(page.getByRole("region",{name:"Ficha de ejemplo de Nutrición"})).toBeVisible();
});
