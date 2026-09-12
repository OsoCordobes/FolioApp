import { expect, test } from "../fixtures/local-test";

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", route => new URL(route.request().url()).origin === origin && route.request().method() === "GET" ? route.continue() : route.abort("blockedbyclient"));
  await context.addInitScript(() => localStorage.setItem("folio.cookieConsent", "denied"));
});

for (const width of [1440, 1024, 768, 720, 390, 320]) {
  test(`teclado, píldora y panel coinciden a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/#producto");
    const tabs = page.getByRole("tablist", { name: "Recorrer las funciones de Folio" });
    await tabs.getByRole("tab", { selected: true }).focus();
    for (const [key, label, title] of [
      ["Home", "La agenda", "Tu agenda hoy"],
      ["ArrowRight", "La historia clínica", "Martina Ríos"],
      ["End", "Los cobros", "Los números del día"],
      ["ArrowRight", "La agenda", "Tu agenda hoy"],
    ]) {
      await page.keyboard.press(key);
      const chosen = tabs.getByRole("tab", { name: label, exact: true });
      await expect(chosen).toBeFocused();
      await expect(chosen).toHaveAttribute("aria-selected", "true");
      await expect(tabs.locator('[tabindex="0"]')).toHaveCount(1);
      const panel = page.getByRole("tabpanel", { name: label, exact: true });
      await expect(panel.getByRole("heading", { level: 3 })).toHaveCount(1);
      await expect(panel.getByRole("heading", { name: title, exact: true })).toBeVisible();
      const pill = await tabs.evaluate(el => {
        const selected = el.querySelector('[aria-selected="true"]')!.getBoundingClientRect();
        const before = getComputedStyle(el, "::before");
        const offset = new DOMMatrixReadOnly(before.transform).m41;
        return { x: el.getBoundingClientRect().left + parseFloat(before.left) + offset - selected.left, width: parseFloat(before.width) - selected.width };
      });
      expect(Math.abs(pill.x)).toBeLessThan(1);
      expect(Math.abs(pill.width)).toBeLessThan(1);
    }
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tabpanel", { name: "La agenda", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

test("el SVG público y la marca de cabecera conservan los mismos trazados", async ({ page }) => {
  await page.goto("/");
  const paths = await page.locator(".fx-header .fx-brand svg path").evaluateAll(nodes => nodes.map(node => node.getAttribute("d")));
  const icon = await page.request.get("/icon.svg");
  expect(icon.ok()).toBe(true);
  const iconPaths = [...(await icon.text()).matchAll(/<path[^>]*\sd="([^"]*)"/g)].map(match => match[1]);
  expect(paths).toHaveLength(3);
  expect(iconPaths).toEqual(paths);
  await expect(page.getByRole("banner").getByRole("link", { name: "Folio — inicio", exact: true })).toBeVisible();
});

for (const width of [390, 320]) {
  test(`controles de cabecera alcanzables con texto al 200% a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      const elements = [...document.querySelectorAll<HTMLElement>(".fx-header *")].filter(el => !(el instanceof SVGElement));
      const values = elements.map(el => ({ el, size: parseFloat(getComputedStyle(el).fontSize), line: parseFloat(getComputedStyle(el).lineHeight) }));
      for (const { el, size, line } of values) {
        el.style.setProperty("font-size", `${size * 2}px`, "important");
        if (Number.isFinite(line)) el.style.setProperty("line-height", `${line * 2}px`, "important");
      }
    });
    for (const control of await page.locator(".fx-header-inner").locator("a, button").all()) {
      if (!await control.isVisible()) continue;
      const rect = await control.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(1000);
    }
    const open = page.getByRole("button", { name: "Abrir menú de navegación" });
    await open.click();
    await expect(page.locator("#fl-mobile-nav")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
    await expect(page.locator("#fl-mobile-nav")).not.toBeVisible();
  });
}
