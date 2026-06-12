/* Capturas del landing para análisis/entrega — uso puntual, no es parte del build.
 * node scripts/landing-shots.mjs <outdir> [--label antes|despues]
 * Recorre la página scrolleando para disparar las animaciones view() y captura
 * cada sección + full page, en light y dark, desktop y mobile.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] ?? "/tmp/landing-shots";
mkdirSync(OUT, { recursive: true });

const BASE = "http://localhost:3010";

async function shoot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

async function acceptCookies(page) {
  try {
    const btn = page.locator("button", { hasText: /aceptar/i }).first();
    await btn.click({ timeout: 3000 });
  } catch {
    /* sin banner */
  }
}

async function run(theme, viewport, tag) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport,
    colorScheme: theme,
    reducedMotion: "no-preference",
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await acceptCookies(page);
  await page.waitForTimeout(900);
  // El dark del app va por data-theme (no por prefers-color-scheme) — se
  // fuerza AL FINAL, después de los useEffect del TweaksProvider y del click
  // de consent (mismo racional que tests/visual/landing.spec.ts).
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  await page.waitForTimeout(300);

  // hero arriba de todo
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await shoot(page, `${tag}-1-hero`);

  // timeline: 3 puntos del pin (25% / 55% / 85% del bloque #dia)
  const day = await page.evaluate(() => {
    const el = document.getElementById("dia");
    if (!el) return null;
    return { top: el.offsetTop, h: el.offsetHeight };
  });
  if (day && viewport.width > 800) {
    for (const [i, f] of [[2, 0.18], [3, 0.45], [4, 0.78]].map((x) => x)) {
      await page.evaluate(
        ({ top, h, f }) => window.scrollTo(0, top + h * f - 80),
        { ...day, f }
      );
      await page.waitForTimeout(700);
      await shoot(page, `${tag}-${i}-dia-${String(f).replace(".", "")}`);
    }
  }

  for (const [i, sel] of [
    [5, "#seguridad"],
    [6, "#producto"],
    [7, "#precios"],
    [8, "#faq"],
  ]) {
    await page.evaluate((s) => {
      document.querySelector(s)?.scrollIntoView({ block: "start" });
    }, sel);
    await page.waitForTimeout(800);
    await shoot(page, `${tag}-${i}-${sel.slice(1)}`);
  }

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await shoot(page, `${tag}-9-final`);

  await page.screenshot({
    path: `${OUT}/${tag}-0-full.png`,
    fullPage: true,
    
  });

  await browser.close();
}

await run("light", { width: 1440, height: 900 }, "desktop-light");
await run("dark", { width: 1440, height: 900 }, "desktop-dark");
await run("light", { width: 390, height: 844 }, "mobile-light");
console.log("OK →", OUT);
