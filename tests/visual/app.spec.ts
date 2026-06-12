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
  { name: "pacientes", route: "/pacientes" },
  { name: "paciente", route: "/pacientes/2" },
  { name: "focus", route: "/focus/3" },
  { name: "finanzas", route: "/finanzas" },
  { name: "configuracion", route: "/configuracion" },
  { name: "calendario", route: "/calendario" },
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

  // Esconder el dev-tools indicator de Next.js (DOM webcomponent
  // `nextjs-portal`) para que no rompa el diff pixel-perfect. En
  // producción el indicator no existe.
  await page.addInitScript(() => {
    const css =
      "nextjs-portal,[data-nextjs-toast],[data-next-mark],[data-nextjs-dev-tools-button]{display:none !important}" +
      // El nudge de GCal (CLINICA-7) depende del estado de integración de la
      // org y del dismiss per-member en localStorage (clave con memberId, no
      // pre-seedeable) — se oculta por CSS para que el baseline no dependa de
      // si la org de captura tiene Google conectado.
      ".fi-gcal-nudge-banner{display:none !important}";
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

  await page.goto(route, { waitUntil: "domcontentloaded" });

  await page.waitForFunction(
    () => {
      const body = document.body;
      return !!body && body.childElementCount > 0 && document.readyState === "complete";
    },
    { timeout: 30_000 },
  );

  await page.evaluate(() => document.fonts.ready);

  await page.clock.runFor(SETTLE_MS);

  // Forzamos `data-theme` AL FINAL, después de que TweaksProvider haya
  // corrido sus useEffect (mounting + localStorage read). Es la defensa
  // para que rutas dinámicas (ssr:false como /focus) y rutas SSR'd
  // converjan al mismo theme antes del screenshot.
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);

  // Remover el portal del Next.js DevTools indicator (vive como web component
  // <nextjs-portal> con shadow DOM — CSS inyectado al document no aplica).
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((n) => n.remove());
  });

  // Un settle final para que el CSS del tema aplique completamente
  await page.waitForTimeout(120);
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
