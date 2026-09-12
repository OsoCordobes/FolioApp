/** Real confirmation panel, synthetic actions, fake clock and loopback only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeEnvironment } from './testing/isolation-policy.mjs';
import { installIsolation } from './testing/install-isolation.mjs';

installIsolation();
const clean = safeEnvironment(process.env);
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, clean);
const { build } = await import('esbuild');
const { chromium, expect } = await import('@playwright/test');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-email-cooldown-'));
const entry = `
import React,{StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';
import{CheckEmailPanel}from'@/components/auth/check-email-panel';
window.qa={calls:0};
function Fixture(){const[mounted,setMounted]=useState(false);return <><button onClick={()=>setMounted(true)}>Montar panel</button><button onClick={()=>setMounted(false)}>Desmontar panel</button>{mounted?<CheckEmailPanel email='synthetic@example.invalid'/>:null}</>}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture/></StrictMode>);
`;
for (const mode of ['development', 'production']) {
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true,
    outfile: path.join(dir, `${mode}.js`), platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) }, tsconfig: path.join(root, 'tsconfig.json'),
    plugins: [{ name: 'synthetic-resend', setup(b) {
      b.onResolve({ filter: /^@\/app\/\(public\)\/login\/actions$/ }, () => ({ path: 'resend', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: `export function resendSignupConfirmation(){qa.calls++;return new Promise(resolve=>{qa.resolveResend=resolve})}`,
        loader: 'js',
      }));
    } }] });
}
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (['/development.js', '/production.js'].includes(pathname)) {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.end(fs.readFileSync(path.join(dir, path.basename(pathname))));
  } else {
    const mode = pathname.includes('production') ? 'production' : 'development';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<html lang='es'><head><meta charset='utf-8'></head><body><div id='root'></div><script src='/${mode}.js'></script></body></html>`);
  }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.on('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];

async function instrument(page) {
  await page.evaluate(() => {
    const originalSet = window.setInterval;
    const originalClear = window.clearInterval;
    qa.activeIntervals = new Set(); qa.intervalTicks = 0;
    window.setInterval = (handler, delay, ...args) => {
      if (delay !== 1000 || typeof handler !== 'function') return originalSet(handler, delay, ...args);
      const id = originalSet(() => { qa.intervalTicks++; handler(...args); }, delay);
      qa.activeIntervals.add(id); return id;
    };
    window.clearInterval = id => { qa.activeIntervals.delete(id); originalClear(id); };
  });
}

try {
  for (const mode of ['development', 'production']) {
    const run = async (name, scenario) => {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
      const page = await context.newPage(); page.setDefaultTimeout(4000);
      const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
      try {
        await page.clock.install({ time: new Date('2026-09-12T12:00:00Z') });
        await page.clock.pauseAt(new Date('2026-09-12T12:00:01Z'));
        await page.goto(`${origin}/${mode}`); await page.getByRole('button', { name: 'Montar panel', exact: true }).waitFor();
        await instrument(page); await scenario(page); assert.deepEqual(pageErrors, []);
        results.push({ mode, case: name, pass: true });
      } catch (error) { results.push({ mode, case: name, pass: false, error: error.message, pageErrors }); }
      finally { console.log(JSON.stringify(results.at(-1))); await context.close(); }
    };

    await run('resend stays pending once, first wait ends at 60 seconds, subsequent wait is five minutes and clock becomes idle', async page => {
      await page.getByRole('button', { name: 'Montar panel', exact: true }).click();
      const resend = page.getByRole('button', { name: 'Reenviar enlace', exact: true });
      await resend.click(); await expect(page.getByRole('button', { name: 'Reenviando…' })).toBeDisabled();
      assert.equal(await page.evaluate(() => qa.calls), 1);
      await page.evaluate(() => qa.resolveResend({ ok: true })); await expect(page.getByRole('timer')).toBeVisible();
      assert.equal(await page.getByRole('timer').getAttribute('aria-live'), 'off');
      assert.equal(await page.getByRole('status').innerText(), 'Enlace reenviado.');
      await page.clock.runFor(59999); await expect(resend).toBeDisabled();
      await page.clock.runFor(2); await expect(resend).toBeEnabled();
      assert.equal(await page.evaluate(() => qa.activeIntervals.size), 0, 'expired cooldown must release its interval');
      const ticks = await page.evaluate(() => qa.intervalTicks); await page.clock.runFor(120000);
      assert.equal(await page.evaluate(() => qa.intervalTicks), ticks, 'expired panel must stay idle');
      await resend.click(); await page.evaluate(() => qa.resolveResend({ ok: true })); await expect(page.getByRole('timer')).toBeVisible();
      assert.equal(await page.evaluate(() => qa.calls), 2);
      await page.clock.runFor(299999); await expect(resend).toBeDisabled();
      await page.clock.runFor(2); await expect(resend).toBeEnabled();
      assert.equal(await page.evaluate(() => qa.activeIntervals.size), 0);
    });

    await run('failed resend leaves the error and allows a deliberate retry without starting a wait', async page => {
      await page.getByRole('button', { name: 'Montar panel', exact: true }).click();
      const resend = page.getByRole('button', { name: 'Reenviar enlace', exact: true });
      await resend.click(); await page.evaluate(() => qa.resolveResend({ ok: false, error: 'Esperá antes de reenviar.' }));
      await expect(page.getByRole('alert')).toHaveText('Esperá antes de reenviar.'); await expect(resend).toBeEnabled();
      assert.equal(await page.evaluate(() => qa.activeIntervals.size), 0);
      await resend.click(); await page.evaluate(() => qa.resolveResend({ ok: true })); await expect(resend).toBeDisabled();
      await expect(page.getByRole('timer')).toBeVisible(); assert.equal(await page.evaluate(() => qa.calls), 2);
    });

    await run('unmount stops callbacks and reload restores only the remaining wait', async page => {
      await page.getByRole('button', { name: 'Montar panel', exact: true }).click();
      await page.getByRole('button', { name: 'Reenviar enlace', exact: true }).click();
      await page.evaluate(() => qa.resolveResend({ ok: true })); await expect(page.getByRole('timer')).toBeVisible();
      await page.clock.runFor(10000);
      await page.getByRole('button', { name: 'Desmontar panel', exact: true }).click();
      assert.equal(await page.evaluate(() => qa.activeIntervals.size), 0);
      const ticks = await page.evaluate(() => qa.intervalTicks); await page.clock.runFor(10000);
      assert.equal(await page.evaluate(() => qa.intervalTicks), ticks);
      await page.reload(); await page.getByRole('button', { name: 'Montar panel', exact: true }).waitFor(); await instrument(page);
      await page.getByRole('button', { name: 'Montar panel', exact: true }).click();
      await expect(page.getByRole('timer')).toHaveText('Podés volver a reenviar en 40 segundos.');
      await expect(page.getByRole('button', { name: 'Reenviar enlace', exact: true })).toBeDisabled();
      assert.equal(await page.evaluate(() => qa.activeIntervals.size), 1);
      await page.clock.runFor(40001); await expect(page.getByRole('button', { name: 'Reenviar enlace', exact: true })).toBeEnabled();
      assert.equal(await page.evaluate(() => qa.activeIntervals.size), 0);
    });

    await run('an already expired stored wait does not create a timer or block resending', async page => {
      await page.evaluate(() => {
        sessionStorage.setItem('folio.check-email-panel.cooldown-until', String(Date.now() - 1));
        sessionStorage.setItem('folio.check-email-panel.resends', '1');
      });
      await page.getByRole('button', { name: 'Montar panel', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Reenviar enlace', exact: true })).toBeEnabled();
      assert.equal(await page.evaluate(() => qa.activeIntervals.size), 0);
      assert.equal(await page.getByRole('timer').count(), 0);
    });
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
const report = { passed: results.filter(item => item.pass).length, failed: results.filter(item => !item.pass).length, results };
fs.writeFileSync(path.join(root, 'docs/design/evidence/email-cooldown-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2)); if (report.failed) process.exitCode = 1;
