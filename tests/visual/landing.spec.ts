import { test, expect, type Page } from "@playwright/test";

/**
 * Visual regression del landing de marketing (`/`) — project `app` (:3010).
 *
 * A diferencia de app.spec.ts (que compara contra baselines del prototipo),
 * acá los baselines son self-generated (--update-snapshots) y viven en el
 * mismo snapshotPathTemplate compartido (tests/snapshots/landing-*.png).
 *
 * Determinismo:
 *   - Mismo Date mock + clock + settle window que app.spec.ts.
 *   - `reducedMotion: reduce` — el landing tiene entradas scroll-driven
 *     (.fl-reveal con animation-timeline: view()), la entrada cinemática del
 *     hero y un carousel framer-motion con auto-advance; el media query los
 *     apaga todos (folio.css los anula con animation: none y MotionConfig
 *     reducedMotion="user" hace lo propio en framer-motion).
 *   - El carousel del showcase monta vía next/dynamic({ssr:false}) +
 *     IntersectionObserver: para el full-page screenshot lo scrolleamos al
 *     viewport y esperamos el tabpanel real antes de capturar (si no, el
 *     fullPage de Chromium — captureBeyondViewport, sin scroll — congelaría
 *     el skeleton vacío).
 *   - Cookie banner pre-dismisseado vía localStorage `folio.cookieConsent`.
 */

const FIXED_TIME = new Date("2026-05-13T08:30:00-03:00");
const SETTLE_MS = 2500;

type Theme = "light" | "dark";

async function loadLanding(page: Page, theme: Theme) {
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Theme ANTES de navegar (TweaksProvider hidrata de localStorage) +
  // cookie banner fuera del DOM para screenshots estables.
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("folio.tweaks.v1", JSON.stringify({ theme: t }));
      localStorage.setItem("folio.cookieConsent", "denied");
    } catch {
      // ignora si localStorage no está disponible en el contexto
    }
  }, theme);

  // Esconder el dev-tools indicator de Next.js (mismo approach que app.spec.ts)
  // + el botón flotante de TanStack Query Devtools (.tsqd-parent-container),
  // que solo existe en dev y flota bottom-left sobre el footer.
  await page.addInitScript(() => {
    const css =
      "nextjs-portal,[data-nextjs-toast],[data-next-mark],[data-nextjs-dev-tools-button],.tsqd-parent-container{display:none !important}";
    const inject = () => {
      if (document.getElementById("__folio-hide-devtools")) return;
      const style = document.createElement("style");
      style.id = "__folio-hide-devtools";
      style.textContent = css;
      document.documentElement.appendChild(style);
    };
    inject();
    document.addEventListener("DOMContentLoaded", inject);
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.waitForFunction(
    () => {
      const body = document.body;
      return !!body && body.childElementCount > 0 && document.readyState === "complete";
    },
    { timeout: 30_000 },
  );

  await page.evaluate(() => document.fonts.ready);

  // Montar el carousel real del showcase: el IO con rootMargin 600px dispara
  // al scrollear la sección al viewport; el chunk dynamic reemplaza el
  // skeleton por el tablist/tabpanel (misma geometría → cero shift).
  await page.locator("#showcase").scrollIntoViewIfNeeded();
  await expect(page.locator('#showcase [role="tabpanel"]')).toBeVisible({ timeout: 20_000 });

  // Avanzar los timers mockeados (phase machines de los slides au2) hasta el
  // estado determinístico. 2500ms < auto-advance (~6s) → queda el slide 0.
  await page.clock.runFor(SETTLE_MS);

  await page.evaluate(() => window.scrollTo(0, 0));

  // Forzar data-theme AL FINAL, después de los useEffect del TweaksProvider
  // (mismo racional que app.spec.ts).
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);

  // Remover el portal del Next.js DevTools indicator (shadow DOM) y el botón
  // flotante de TanStack Query Devtools — el CSS inyectado por addInitScript
  // no alcanza: React 19 hidrata <html> y puede descartar el <style>, así que
  // los sacamos del DOM justo antes del screenshot.
  await page.evaluate(() => {
    document
      .querySelectorAll("nextjs-portal, .tsqd-parent-container")
      .forEach((n) => n.remove());
  });

  await page.waitForTimeout(120);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: FIXED_TIME });
});

for (const theme of ["light", "dark"] as const) {
  test(`landing · hero (above the fold) · ${theme}`, async ({ page }) => {
    await loadLanding(page, theme);
    // Viewport 1440×900 del project `app` → above the fold.
    await expect(page).toHaveScreenshot(`landing-hero-${theme}.png`);
  });

  test(`landing · full page · ${theme}`, async ({ page }) => {
    await loadLanding(page, theme);
    await expect(page).toHaveScreenshot(`landing-full-${theme}.png`, {
      fullPage: true,
    });
  });
}
