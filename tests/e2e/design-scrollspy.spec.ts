import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

type ObserverRecord = {
  margin: string;
  targets: string[];
  disconnected: boolean;
  callbacks: number;
  bounds: { top: number; height: number } | null;
};

declare global {
  interface Window {
    __scrollspyIo: ObserverRecord[];
    __scrollspyHarness: { mount: () => void; unmount: () => void };
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", route => new URL(route.request().url()).origin === origin && route.request().method() === "GET" ? route.continue() : route.abort("blockedbyclient"));
  await context.addInitScript(() => {
    localStorage.setItem("folio.cookieConsent", "denied");
    window.__scrollspyIo = [];
    const NativeObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeObserver {
      record: ObserverRecord;
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        const record: ObserverRecord = { margin: options?.rootMargin ?? "", targets: [], disconnected: false, callbacks: 0, bounds: null };
        super((entries, observer) => {
          record.callbacks++;
          const bounds = entries[0]?.rootBounds;
          if (bounds) record.bounds = { top: bounds.top, height: bounds.height };
          callback(entries, observer);
        }, options);
        this.record = record;
        window.__scrollspyIo.push(record);
      }
      observe(target: Element) {
        this.record.targets.push(target.id);
        super.observe(target);
      }
      disconnect() {
        this.record.disconnected = true;
        super.disconnect();
      }
    };
  });
});

async function scrollToSection(page: Page, id: string) {
  await page.evaluate(sectionId => document.getElementById(sectionId)!.scrollIntoView({ behavior: "instant", block: "start" }), id);
}

async function expectCurrent(page: Page, id: string) {
  for (const selector of [".fl-nav-link", ".fl-mobile-link"]) {
    const links = page.locator(`${selector}[aria-current]`);
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute("href", `#${id}`);
    await expect(links).toHaveAttribute("aria-current", "location");
    await expect(links).toHaveClass(/\bis-active\b/);
  }
}

for (const [width, height] of [[1920, 1080], [2560, 1440], [390, 844]]) {
  test(`sección actual y regreso al inicio a ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    for (const id of ["producto", "dia", "precios"]) {
      await scrollToSection(page, id);
      await expectCurrent(page, id);
      const state = await page.evaluate(() => window.__scrollspyIo.findLast(item => !item.disconnected && item.targets.join(",") === "producto,dia,precios"));
      expect(state?.margin).not.toContain("%");
      expect(state?.bounds?.height).toBeGreaterThan(0);
      expect(Math.abs(state!.bounds!.height - height * .05)).toBeLessThanOrEqual(2);
      if (width < 800) {
        await page.getByRole("button", { name: "Abrir menú de navegación" }).click();
        const current = page.locator(`#fl-mobile-nav a[href="#${id}"]`);
        await expect(current).toBeVisible();
        await expect(current).toHaveAttribute("aria-current", "location");
        await page.keyboard.press("Escape");
      }
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(page.locator(".fl-nav-link[aria-current], .fl-mobile-link[aria-current], .fl-nav-link.is-active, .fl-mobile-link.is-active")).toHaveCount(0);
  });
}

test("reconstruye la banda al pasar de escritorio a móvil y vuelve a detectar cada sección", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await scrollToSection(page, "precios");
  await expectCurrent(page, "precios");
  for (const viewport of [{ width: 390, height: 844 }, { width: 2560, height: 1440 }]) {
    await page.setViewportSize(viewport);
    await scrollToSection(page, "producto");
    await expectCurrent(page, "producto");
    await expect.poll(() => page.evaluate(() => window.__scrollspyIo.filter(item => !item.disconnected && item.targets.join(",") === "producto,dia,precios").length)).toBe(1);
    const state = await page.evaluate(() => window.__scrollspyIo.findLast(item => !item.disconnected && item.targets.join(",") === "producto,dia,precios"));
    expect(Math.abs(state!.bounds!.height - viewport.height * .05)).toBeLessThanOrEqual(2);
    await scrollToSection(page, "dia");
    await expectCurrent(page, "dia");
  }
});

test("StrictMode limpia enlaces y observadores al desmontar y admite un montaje nuevo", async ({ page }) => {
  const built = await build({
    stdin: {
      contents: `import React, { StrictMode } from 'react'; import { createRoot } from 'react-dom/client'; import { LandingScrollspy } from ${JSON.stringify(path.resolve("components/landing/landing-scrollspy.tsx"))}; let root; window.__scrollspyHarness = { mount() { root = createRoot(document.getElementById('root')); root.render(<StrictMode><LandingScrollspy /></StrictMode>); }, unmount() { root.unmount(); } }; window.__scrollspyHarness.mount();`,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  });
  // A fresh same-origin synthetic document has no app actions or other effects.
  const fixture = `<html><head><style>html{scroll-behavior:auto}body{margin:0}nav{position:fixed;top:0;background:white;z-index:1}section{height:900px}</style></head><body><nav>${["fl-nav-link", "fl-mobile-link"].map(className => ["producto", "dia", "precios"].map(id => `<a class="${className}" href="#${id}">${id}</a>`).join("")).join("")}</nav><section id="hero">Inicio ficticio</section><section id="producto">Producto ficticio</section><section id="dia">Día ficticio</section><section id="precios">Precios ficticios</section><div id="root"></div></body></html>`;
  await page.route("**/__scrollspy-fixture", route => route.fulfill({ status: 200, contentType: "text/html", body: fixture }));
  await page.goto("/__scrollspy-fixture");
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await scrollToSection(page, "precios");
  await expectCurrent(page, "precios");
  await page.evaluate(() => window.__scrollspyHarness.unmount());
  await expect(page.locator("[aria-current], .is-active")).toHaveCount(0);
  expect(await page.evaluate(() => window.__scrollspyIo.every(item => item.disconnected))).toBe(true);
  const count = await page.evaluate(() => window.__scrollspyIo.length);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => window.__scrollspyIo.length)).toBe(count);
  await page.evaluate(() => window.__scrollspyHarness.mount());
  await scrollToSection(page, "producto");
  await expectCurrent(page, "producto");
  await page.evaluate(() => window.__scrollspyHarness.unmount());
  expect(await page.evaluate(() => window.__scrollspyIo.every(item => item.disconnected))).toBe(true);
});
