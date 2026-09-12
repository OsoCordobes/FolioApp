/** Read-only local fixture audit. Run with scripts/testing/app-bootstrap.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

if (process.env.FOLIO_TEST_ISOLATED !== '1' || process.env.E2E_BASE_URL !== 'http://127.0.0.1:4410') {
  throw new Error('Use the isolated app bootstrap against the design server on port 4410.');
}
const browser = await chromium.launch({ headless: true });
const report = { date: new Date().toISOString(), kind: 'synthetic gallery, local development; not production route bundles', panels: [] };
try {
  for (const panel of ['hoy', 'calendario', 'pacientes', 'finanzas', 'configuracion']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === process.env.E2E_BASE_URL && route.request().method() === 'GET'
        ? route.continue() : route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.E2E_BASE_URL}/dev/experience?panel=${panel}`);
    const heading = { hoy: 'Tu día en Folio', calendario: 'Calendario', pacientes: 'Pacientes', finanzas: 'Ingresos del período', configuracion: 'Configuración' }[panel];
    await page.getByRole('heading', { name: heading, level: 1, exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(v => [v.name, v.value]));
    const before = await metrics();
    await page.waitForTimeout(4000);
    const after = await metrics();
    const dom = await page.evaluate(() => ({
      heading: document.querySelector('.fi-content h1')?.textContent,
      elements: document.querySelectorAll('*').length,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      animations: document.getAnimations().map(animation => ({
        target: animation.effect?.target?.className?.baseVal ?? animation.effect?.target?.className,
        playState: animation.playState,
        duration: animation.effect?.getTiming().duration,
        iterations: animation.effect?.getTiming().iterations === Infinity ? 'infinite' : animation.effect?.getTiming().iterations,
      })),
      resources: performance.getEntriesByType('resource').filter(r => /\.(css|js|woff2)(\?|$)/.test(r.name)).map(r => ({
        path: new URL(r.name).pathname, type: r.initiatorType, durationMs: r.duration,
        decodedBytes: r.decodedBodySize, transferBytes: r.transferSize,
      })),
    }));
    if (dom.heading !== heading) throw new Error(`Panel ${panel} changed during the sample (possible development hot reload); rerun when stable.`);
    const idle = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'].map(key => [key, after[key] - before[key]]));
    report.panels.push({ panel, dom, idleSeconds: 4, idle, errors });
    console.log(JSON.stringify({ panel, idle, animations: dom.animations, errors }));
    await context.close();
  }
} finally { await browser.close(); }
fs.writeFileSync(path.resolve('docs/design/evidence/platform-performance.json'), JSON.stringify(report, null, 2) + '\n');
