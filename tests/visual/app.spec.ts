import { test, expect, type Page } from "@playwright/test";

/**
 * Visual regression de la app Next.js contra los baselines del prototipo
 * (capturados por baseline.spec.ts en tests/visual/snapshots/).
 *
 * Cada pantalla migrada se agrega acá: ruta de la app + theme. El test
 * comparte el snapshot file con el prototype (sin sufijo de project), así
 * cualquier diff > 0.1% bloquea el merge.
 *
 * Mismo Date mock y settle window que baseline.spec.ts para que las
 * animaciones del cliente (count-ups, step machines de slides) lleguen
 * al estado determinístico que el baseline capturó.
 */

const FIXED_TIME = new Date("2026-05-13T08:30:00-03:00");
const SETTLE_MS = 2500;

type Theme = "light" | "dark";
type Screen = { name: string; route: string };

/**
 * Pantallas ya migradas en F1. Se agregan a medida que cada sub-fase
 * (F1.4 Login, F1.5 Onboarding, ...) entra al verde.
 */
const SCREENS: Screen[] = [
  { name: "login", route: "/login" },
  { name: "onboarding", route: "/onboarding" },
  { name: "hoy", route: "/hoy" },
];

async function loadAppScreen(page: Page, route: string, theme: Theme) {
  // El TweaksProvider lee localStorage al mount para hidratar el theme.
  // Seteamos la clave ANTES de la navegación para que la app renderice
  // directamente en el theme pedido y evitar un re-paint post-hydration.
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("folio.tweaks.v1", JSON.stringify({ theme: t }));
    } catch {
      // ignora si localStorage no está disponible en el contexto
    }
  }, theme);

  await page.goto(route, { waitUntil: "domcontentloaded" });

  // Forzamos el atributo por si el read de localStorage en useEffect llega
  // tarde respecto al primer paint (defensa adicional para SSR).
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);

  await page.waitForFunction(
    () => {
      const body = document.body;
      return !!body && body.childElementCount > 0 && document.readyState === "complete";
    },
    { timeout: 30_000 },
  );

  await page.evaluate(() => document.fonts.ready);

  await page.clock.runFor(SETTLE_MS);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: FIXED_TIME });
});

for (const screen of SCREENS) {
  for (const theme of ["light", "dark"] as const) {
    test(`app · ${screen.name} · ${theme}`, async ({ page }) => {
      await loadAppScreen(page, screen.route, theme);
      await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`, {
        fullPage: true,
      });
    });
  }
}
