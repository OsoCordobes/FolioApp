/** Local compiled-browser observations, not field Core Web Vitals or a device benchmark. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:4410';
if (process.env.FOLIO_TEST_ISOLATED !== '1' || process.env.E2E_BASE_URL !== origin) throw new Error('Use the isolated design bootstrap.');
const results = { timestamp: new Date().toISOString(), scope: 'Compiled loopback app. Cold browser contexts, synthetic throttling and fictional content; not real-user performance.', samples: [] };
const browser = await chromium.launch({ headless: true });
try {
  for (const setup of [{ width:1440, height:900, cpu:1, latency:0 }, { width:390, height:844, cpu:4, latency:150 }]) {
    const context = await browser.newContext({ viewport:{ width:setup.width, height:setup.height }, reducedMotion:'no-preference', serviceWorkers:'block' });
    const refused = [];
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin && ['GET','HEAD'].includes(route.request().method())) return route.continue();
      refused.push({ url:route.request().url(), method:route.request().method() });
      return route.abort('blockedbyclient');
    });
    await context.addInitScript(() => {
      localStorage.setItem('folio.cookieConsent','denied');
      window.__folioProfile = { shifts:[], largestPaints:[], longTasks:[] };
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__folioProfile.shifts.push({ value:entry.value, time:entry.startTime }); }).observe({ type:'layout-shift', buffered:true });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__folioProfile.largestPaints.push({ time:entry.startTime, element:entry.element?.tagName, text:entry.element?.textContent?.slice(0,80) }); }).observe({ type:'largest-contentful-paint', buffered:true });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__folioProfile.longTasks.push({ start:entry.startTime, duration:entry.duration }); }).observe({ type:'longtask', buffered:true });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled:true });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate:setup.cpu });
    if (setup.latency) await cdp.send('Network.emulateNetworkConditions', { offline:false, latency:setup.latency, downloadThroughput:200000, uploadThroughput:93750 });
    await page.goto(origin, { waitUntil:'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const load = await page.evaluate(() => ({
      ...window.__folioProfile,
      domElements:document.querySelectorAll('*').length,
      overflow:document.documentElement.scrollWidth - innerWidth,
      resources:performance.getEntriesByType('resource').map(entry => ({ path:new URL(entry.name).pathname, type:entry.initiatorType, duration:entry.duration, encodedBytes:entry.encodedBodySize, decodedBytes:entry.decodedBodySize, transferredBytes:entry.transferSize })),
      navigation:performance.getEntriesByType('navigation').map(entry => ({ duration:entry.duration, domContentLoaded:entry.domContentLoadedEventEnd, encodedBytes:entry.encodedBodySize, decodedBytes:entry.decodedBodySize })),
    }));
    const transitions = [];
    for (const label of ['La historia clínica','Los cobros','La agenda']) {
      const button = page.getByRole('tab', { name:label, exact:true });
      const before = await page.locator('#producto .fx-product-window').boundingBox();
      await button.click();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const after = await page.locator('#producto .fx-product-window').boundingBox();
      assert.equal(await button.getAttribute('aria-selected'), 'true');
      assert.ok(Math.abs(after.height - before.height) <= 1);
      transitions.push({ label, heightBefore:before.height, heightAfter:after.height });
    }
    assert.deepEqual(errors, []);
    assert.equal(load.overflow, 0);
    results.samples.push({ setup, load, transitions, errors, refused });
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile('docs/design/evidence/polish-runtime-profile.json', `${JSON.stringify(results,null,2)}\n`);
}
console.log(`${results.samples.length} compiled browser profiles captured; three stable transitions per profile and no errors.`);
