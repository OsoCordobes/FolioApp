/** Local synthetic evidence only; no submissions or external requests. */
import { chromium } from '@playwright/test';
if (process.env.FOLIO_TEST_ISOLATED !== '1' || process.env.E2E_BASE_URL !== 'http://127.0.0.1:4410') throw new Error('Use the isolated app bootstrap.');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(() => localStorage.setItem('folio.cookieConsent', 'denied'));
  await context.route('**/*', route => new URL(route.request().url()).origin === process.env.E2E_BASE_URL && route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'));
  const page = await context.newPage();
  for (const panel of ['hoy', 'calendario', 'pacientes', 'finanzas', 'configuracion']) {
    await page.goto(`${process.env.E2E_BASE_URL}/dev/experience?panel=${panel}`);
    const heading = { hoy: 'Tu día en Folio', calendario: 'Calendario', pacientes: 'Pacientes', finanzas: 'Ingresos del período', configuracion: 'Configuración' }[panel];
    await page.getByRole('heading', { name: heading, level: 1, exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `docs/design/evidence/polish-${panel}-mobile.png` });
    if (panel === 'pacientes' || panel === 'finanzas') {
      await page.locator(panel === 'pacientes' ? '.pd-table-wrap' : '.fn-table-wrap').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `docs/design/evidence/polish-${panel}-table-mobile.png` });
      if (panel === 'finanzas') {
        await page.locator('.fn-table-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth; });
        await page.screenshot({ path: 'docs/design/evidence/polish-finanzas-amounts-mobile.png' });
      }
    }
    console.log(JSON.stringify({ panel, horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), overflowElements: await page.evaluate(() => [...document.querySelectorAll('.fi-content *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(el => ({ tag: el.tagName, className: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right }))) }));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${process.env.E2E_BASE_URL}/dev/experience?panel=pacientes`);
  await page.getByRole('checkbox', { name: 'Seleccionar todos los pacientes visibles' }).waitFor();
  await page.getByRole('checkbox', { name: /Seleccionar a / }).first().check();
  await page.keyboard.press('Tab');
  await page.getByRole('checkbox', { name: 'Seleccionar todos los pacientes visibles' }).focus();
  await page.locator('.pd-table-wrap').screenshot({ path: 'docs/design/evidence/polish-pacientes-selection.png' });
  await context.close();
} finally { await browser.close(); }
