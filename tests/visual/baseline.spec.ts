import { test, expect, type Page } from "@playwright/test";

/**
 * Captura baselines del prototipo Claude Design (10 HTML originales en
 * C:\Users\amiun\Desktop\Folio\) en light + dark a 1440x900.
 *
 * Estos snapshots son la verdad pixel-perfect contra la que se compara
 * la app Next.js durante F1 y subsiguientes (cualquier diff > 0.1% bloquea merge).
 *
 * El prototipo usa Babel-in-browser, por lo tanto esperamos al render real
 * (#root con hijos) y a fonts.ready antes de cualquier screenshot.
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

  // Pequeño settle para CSS transitions de tema (240ms en folio.css)
  await page.waitForTimeout(350);
}

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
