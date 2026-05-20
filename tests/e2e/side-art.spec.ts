/**
 * Folio · E2E · SideArt v2 smoke tests.
 *
 * Verifica las features premium del SideArt (carousel auto-rotation,
 * pause on hover, direction-aware nav, progress fill dots, reduced-motion,
 * background tints reactivos). NO depende de auth — solo carga /login.
 *
 * Pre-requisitos:
 *   1. Servidor en E2E_BASE_URL (default localhost:3010).
 *   2. .env.local configurado (Supabase URL/keys mínimos — el SideArt no
 *      hace fetch pero el wrapping de /login sí necesita supabase server client).
 *
 * Run:
 *   pnpm exec playwright test tests/e2e/side-art.spec.ts
 */

import { expect, test } from "@playwright/test";

test.describe("SideArt v2", () => {
  test("auto-rotate cycles through the 5 slides", async ({ page }) => {
    await page.goto("/login");

    // 5 dots renderizados, 1 activo
    await expect(page.locator(".au2-dot")).toHaveCount(5);
    await expect(page.locator(".au2-dot.is-active")).toHaveCount(1);

    const firstActive = await page.locator(".au2-dot.is-active").getAttribute("aria-label");
    // El slide más largo dura 7500ms (Finanzas). Después de 8s, otro slide debería estar activo.
    await page.waitForTimeout(8000);
    const secondActive = await page.locator(".au2-dot.is-active").getAttribute("aria-label");
    expect(firstActive).not.toBe(secondActive);
  });

  test("hover sostenido pausa auto-rotation y muestra pause indicator", async ({ page }) => {
    await page.goto("/login");

    // Hover sostenido — debounce 240ms para indicator
    await page.locator(".au2-art").hover();
    await expect(page.locator(".au2-pause-indicator")).toBeVisible({ timeout: 1000 });

    const dotBefore = await page.locator(".au2-dot.is-active").getAttribute("aria-label");
    // Esperamos más que cualquier slide-dur — si pausa funciona, no rota
    await page.waitForTimeout(8500);
    const dotAfter = await page.locator(".au2-dot.is-active").getAttribute("aria-label");
    expect(dotBefore).toBe(dotAfter);
  });

  test("arrow nav cambia de slide manualmente", async ({ page }) => {
    await page.goto("/login");

    // Hover para pausar auto-rotation (evitar race con el click)
    await page.locator(".au2-art").hover();
    const idx0 = await page.locator(".au2-dot.is-active").getAttribute("aria-label");

    await page.locator(".au2-nav--next").click();
    await page.waitForTimeout(600); // transition completa

    const idx1 = await page.locator(".au2-dot.is-active").getAttribute("aria-label");
    expect(idx1).not.toBe(idx0);
  });

  test("dots permiten click directo a cualquier slide", async ({ page }) => {
    await page.goto("/login");
    await page.locator(".au2-art").hover(); // pausar

    // Click al 5to dot (índice 4 = slide tercera con badge Plus)
    await page.locator(".au2-dot").nth(4).click();
    await page.waitForTimeout(500);

    const active = await page.locator(".au2-dot.is-active").getAttribute("aria-label");
    // El slide tercera tiene title "Tu propia memoria, en el momento justo."
    expect(active?.toLowerCase()).toContain("memoria");
  });

  test("reduced-motion → cronómetro slide 4 en estado final inmediato", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();

    await page.goto("/login");
    await page.locator(".au2-art").hover(); // pausar para forzar el slide actual
    await page.locator(".au2-dot").nth(3).click(); // ir a slide siete (cronómetro)

    // Si reduced-motion respetado, el cronómetro NO corre 7000ms — aparece full.
    await page.waitForTimeout(300);
    const fillTransform = await page.evaluate(() => {
      const el = document.querySelector(".au2-siete-meter-fill") as HTMLElement;
      if (!el) return null;
      return window.getComputedStyle(el).transform;
    });
    // scaleX(1) → matrix(1, 0, 0, 1, 0, 0)
    expect(fillTransform).toMatch(/matrix\(1,\s*0,\s*0,\s*1/);

    await context.close();
  });

  test("background tint cambia entre slides", async ({ page }) => {
    await page.goto("/login");
    await page.locator(".au2-art").hover(); // pausar

    // Slide 0 (Agenda) — leer background del glow
    await page.locator(".au2-dot").nth(0).click();
    await page.waitForTimeout(800); // dejar que la transition 720ms complete
    const bg0 = await page.evaluate(() => {
      const el = document.querySelector(".au2-art-glow") as HTMLElement;
      return window.getComputedStyle(el).background;
    });

    // Slide 3 (Reagenda) — tint slate diferente
    await page.locator(".au2-dot").nth(3).click();
    await page.waitForTimeout(800);
    const bg1 = await page.evaluate(() => {
      const el = document.querySelector(".au2-art-glow") as HTMLElement;
      return window.getComputedStyle(el).background;
    });

    expect(bg0).not.toBe(bg1);
  });

  test("tab visibility pausa el carousel", async ({ page }) => {
    await page.goto("/login");
    const dotBefore = await page.locator(".au2-dot.is-active").getAttribute("aria-label");

    // Emular tab hidden
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await page.waitForTimeout(8500); // más que cualquier slide-dur
    const dotAfter = await page.locator(".au2-dot.is-active").getAttribute("aria-label");
    expect(dotBefore).toBe(dotAfter);
  });
});
