/** Read-only smoke against the compiled, isolated local design server. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:4410';
const suffix = process.argv.includes('--final') ? '-final' : '';
if (process.env.FOLIO_TEST_ISOLATED !== '1' || process.env.E2E_BASE_URL !== origin) {
  throw new Error('Run through the isolated app bootstrap on port 4410.');
}
const results = { timestamp: new Date().toISOString(), scope: 'Compiled local app, synthetic environment, same-origin GET/HEAD only.', routes: [], pageErrors: [], consoleErrors: [], screenshots: [] };
for (const [path, expected] of [
  ['/', 200], ['/login', 200], ['/forgot', 200], ['/cookies', 200],
  ['/dev/experience', 404], ['/dev/directory-preview', 404],
  ['/dev/design-directions.html', 404], ['/dev/brand-studies', 404],
  ['/dev/invitation-preview', 404], ['/favicon.ico', 200], ['/icon.svg', 200],
]) {
  const response = await fetch(`${origin}${path}`, { redirect: 'manual' });
  const body = Buffer.from(await response.arrayBuffer());
  results.routes.push({ path, status: response.status, contentType: response.headers.get('content-type'), bytes: body.length });
  assert.equal(response.status, expected, path);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort('blockedbyclient'));
  await context.addInitScript(() => localStorage.setItem('folio.cookieConsent', 'denied'));
  const page = await context.newPage();
  page.on('pageerror', error => results.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') results.consoleErrors.push(message.text()); });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
  if (ogImage) {
    const imagePath = new URL(ogImage, origin).pathname;
    const response = await fetch(`${origin}${imagePath}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    results.routes.push({ path: imagePath, status: response.status, contentType: response.headers.get('content-type'), bytes: bytes.length });
  }
  for (const label of ['La agenda', 'La historia clínica', 'Los cobros']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: label, exact: true }).getAttribute('aria-selected'), 'true');
  }
  for (const width of [1440, 1920, 2560, 3440]) {
    await page.setViewportSize({ width, height: width >= 2560 ? 1440 : 1080 });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const path = `docs/design/evidence/polish-compiled-${width}${suffix}.png`;
    await page.screenshot({ path });
    const measurements = await page.evaluate(() => ({
      heroWidth: document.querySelector('.fx-hero-inner').getBoundingClientRect().width,
      sectionWidth: document.querySelector('#ficha').getBoundingClientRect().width,
      productWidth: document.querySelector('#producto').getBoundingClientRect().width,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    assert.equal(measurements.horizontalOverflow, 0, `Page overflow at ${width}px`);
    results.screenshots.push({ width, path, measurements });
  }
  assert.deepEqual(results.pageErrors, []);
  assert.deepEqual(results.consoleErrors, []);
  await context.close();
} finally {
  await browser.close();
  await fs.writeFile(`docs/design/evidence/polish-production-smoke${suffix}.json`, `${JSON.stringify(results, null, 2)}\n`);
}
console.log(`${results.routes.length} HTTP routes and 4 viewport captures passed; no page errors.`);
