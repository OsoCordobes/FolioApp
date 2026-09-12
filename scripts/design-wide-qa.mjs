/** Responsive measurements and review captures, isolated local Folio only. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:4410';
if (process.env.FOLIO_TEST_ISOLATED !== '1' || process.env.E2E_BASE_URL !== origin) throw new Error('Use the isolated design bootstrap.');
const result = { time: new Date().toISOString(), scope: 'CSS viewport sizes, local synthetic content; no external requests or submissions.', samples: [] };
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 390, 768, 1440, 1600, 1799, 1800, 1920, 2560, 3440]) {
    const context = await browser.newContext({ viewport: { width, height: width >= 2560 ? 1440 : 1080 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort('blockedbyclient'));
    await context.addInitScript(() => localStorage.setItem('folio.cookieConsent', 'denied'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const measurements = await page.evaluate(() => {
      const box = selector => {
        const node = document.querySelector(selector);
        const rect = node.getBoundingClientRect();
        return { width: rect.width, left: rect.left, right: rect.right, fontSize: getComputedStyle(node).fontSize };
      };
      return { viewport: innerWidth, hero: box('.fx-hero-inner'), title: box('.fx-hero h1'), paragraph: box('.fx-hero-description'), product: box('#producto'), productWindow: box('#producto .fx-product-window'), specialty: box('#ficha'), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    assert.ok(measurements.overflow <= 1, `${width}px has horizontal overflow`);
    if (width >= 1920) {
      assert.ok(measurements.hero.width / width >= .68, `Hero is too narrow at ${width}`);
      assert.ok(measurements.specialty.width / width >= .64, `Content is too narrow at ${width}`);
      assert.ok(measurements.paragraph.width <= 600, 'Reading measure is unbounded');
    }
    const panelHeights = [];
    for (const label of ['La agenda', 'La historia clínica', 'Los cobros']) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      panelHeights.push(await page.getByRole('tabpanel', { name: label, exact: true }).evaluate(node => node.getBoundingClientRect().height));
    }
    assert.ok(Math.max(...panelHeights) - Math.min(...panelHeights) <= 1, `${width}: product height jumps`);
    assert.deepEqual(errors, []);
    if ([390, 1440, 1920, 2560, 3440].includes(width)) {
      await page.goto(origin, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      await page.screenshot({ path: `docs/design/evidence/wide-${width}-after.png` });
      // Section-only review captures keep the header in normal flow.
      await page.addStyleTag({ content: '.fx-header{position:static!important}' });
      for (const section of ['producto', 'ficha']) await page.locator(`#${section}`).screenshot({ path: `docs/design/evidence/wide-${width}-${section}-after.png` });
    }
    result.samples.push({ width, ...measurements, panelHeights, errors });
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile('docs/design/evidence/wide-responsive-results.json', `${JSON.stringify(result, null, 2)}\n`);
}
console.log(`${result.samples.length} responsive viewports passed; stable product panels, no page overflow or errors.`);
