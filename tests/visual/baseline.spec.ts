import { test, expect, type Page } from "@playwright/test";

/**
 * Captura baselines del prototipo Claude Design (10 HTML originales en
 * C:\Users\amiun\Desktop\Folio\) en light + dark a 1440x900.
 *
 * Estos snapshots son la verdad pixel-perfect contra la que se compara
 * la app Next.js (cualquier diff > 0.1% bloquea merge).
 *
 * El prototipo usa Babel-in-browser, por lo tanto esperamos al render real
 * (#root con hijos) y a fonts.ready antes de cualquier screenshot.
 *
 * Determinismo: mockeamos `Date` y `Date.now` para que el reloj que aparece
 * en pantalla (Login, Hoy, ...) sea estable entre corridas. NO mockeamos
 * setTimeout/setInterval/requestAnimationFrame: los hooks de animación del
 * prototipo siguen corriendo en tiempo real y el `waitForTimeout(350)`
 * captura un estado consistente (ej. SlideAgenda en step=4).
 */

type Screen = { name: string; file: string };

const SCREENS: Screen[] = [
  { name: "hoy", file: "Folio · Hoy.html" },
  { name: "calendario", file: "Folio · Calendario.html" },
  { name: "pacientes", file: "Folio · Pacientes.html" },
  { name: "paciente", file: "Folio · Paciente.html" },
  { name: "finanzas", file: "Folio · Finanzas.html" },
  { name: "configuracion", file: "Folio · Configuración.html" },
  { name: "focus", file: "Folio · Focus.html" },
  { name: "brand", file: "Folio · Brand.html" },
  { name: "login", file: "Folio · Login.html" },
  { name: "onboarding", file: "Folio · Onboarding.html" },
];

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/**
 * Hora fija para todos los snapshots: 2026-05-13 08:30:00 (Argentina).
 * Coincide con `FOLIO_DATA.fechaLarga = "miércoles 13 de mayo"` y con
 * la narrativa del prototipo (`08:30 · antes del primer turno`).
 */
const FIXED_TIME = new Date("2026-05-13T08:30:00-03:00");

/**
 * Avanzamos 2500ms del reloj simulado para dejar que las animaciones
 * con narrativa breve (Login → SlideAgenda step 4 ≈ +1800ms) lleguen
 * a su estado estable, sin entrar en el carrusel auto-rotation (que
 * arranca recién a SLIDE_MS_LONG = 6500ms).
 */
const SETTLE_MS = 2500;

async function loadScreen(page: Page, file: string, theme: Theme) {
  const url = `/${encodeURI(file)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Aplicar tema antes que React renderice (algunas pantallas leen data-theme en mount)
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);

  // Esperar a que Babel compile + React monte componentes
  await page.waitForFunction(
    () => {
      const root = document.querySelector("#root");
      return !!root && root.childElementCount > 0;
    },
    { timeout: 30_000 },
  );

  // Esperar fonts (Geist / Geist Mono via Google Fonts)
  await page.evaluate(() => document.fonts.ready);

  // Avanzar el reloj mockeado para que las animaciones con timeline
  // finita (count-ups, step machines de los slides) lleguen a estado
  // estable. NO entramos en el carrusel auto-rotation (>= 6500ms).
  await page.clock.runFor(SETTLE_MS);
}

test.beforeEach(async ({ page }) => {
  // Mockear reloj antes de cualquier navegación. `install` congela el
  // tiempo y reemplaza Date/Date.now/setTimeout/setInterval/rAF para
  // que los snapshots sean determinísticos sin importar la hora real.
  await page.clock.install({ time: FIXED_TIME });
});

for (const screen of SCREENS) {
  for (const theme of THEMES) {
    test(`prototype · ${screen.name} · ${theme}`, async ({ page }) => {
      await loadScreen(page, screen.file, theme);
      await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`, {
        fullPage: true,
      });
    });
  }
}
