/** Exceptional states and toast timers. Real components, synthetic local fixtures only. */
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-design-states-'));
const evidence = path.join(root, 'docs/design/evidence');
const entry = `
import React,{StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';
import{ToastProvider,useToast}from'@/components/ui/toast';
import ErrorBoundary from '@/app/error';import GlobalError from '@/app/global-error';
import NotFound from '@/app/not-found';import Cookies from '@/app/(public)/cookies/page';
import Privacy from '@/app/(public)/privacidad/page';import Terms from '@/app/(public)/terminos/page';
import Loading from '@/app/(app)/pacientes/[id]/loading';
window.qa={resets:0,captures:0};
function Triggers(){const toast=useToast();return <main style={{padding:24}}><h1>Avisos de prueba</h1><button className='fi-btn' onClick={()=>toast.show({titulo:'Sesión ficticia registrada'})}>Mostrar aviso</button><button className='fi-btn' onClick={()=>toast.show({titulo:'No pudimos completar esta acción de ejemplo.',tono:'error'})}>Mostrar error</button><label>Campo de prueba<input aria-label='Campo de prueba'/></label></main>}
function ToastFixture(){const[mounted,setMounted]=useState(true);return <><button className='fi-btn' onClick={()=>setMounted(false)}>Desmontar avisos</button>{mounted?<ToastProvider><Triggers/></ToastProvider>:<p>Avisos desmontados</p>}</>}
const fixture=new URLSearchParams(location.search).get('fixture');
const error=Object.assign(new Error('private technical detail'),{digest:'synthetic-support-reference'});
const reset=()=>qa.resets++;
if(fixture==='global')createRoot(document).render(<StrictMode><GlobalError error={error} reset={reset}/></StrictMode>);
else createRoot(document.getElementById('root')).render(<StrictMode>{fixture==='error'?<ErrorBoundary error={error} reset={reset}/>:fixture==='404'?<NotFound/>:fixture==='cookies'?<Cookies/>:fixture==='privacy'?<Privacy/>:fixture==='terms'?<Terms/>:fixture==='loading'?<Loading/>:<ToastFixture/>}</StrictMode>);
`;
const stubs = {
  'next/link': `export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
  '@sentry/nextjs': `export const captureException=()=>{qa.captures++};`,
};
for (const mode of ['development', 'production']) {
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true,
    outfile: path.join(dir, `${mode}.js`), platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) }, tsconfig: path.join(root, 'tsconfig.json'),
    plugins: [{ name: 'isolated-boundaries', setup(b) {
      b.onResolve({ filter: /.*/ }, a => a.path in stubs ? { path: a.path, namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: root }));
    } }] });
}
const styles = ['public/folio.css', 'styles/experience.css', 'styles/clinical-experience.css', 'styles/states-experience.css'];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (['/development.js', '/production.js'].includes(url.pathname)) {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.end(fs.readFileSync(path.join(dir, path.basename(url.pathname))));
  } else if (url.pathname === '/fixture.css') {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.end('@font-face{font-family:"Folio fixture";src:url(/folio-font.woff2) format("woff2");font-weight:200 800;font-display:swap}:root{--font-folio:"Folio fixture"}\n' + styles.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'));
  } else if (url.pathname === '/folio-font.woff2') {
    res.setHeader('Content-Type', 'font/woff2');
    res.end(fs.readFileSync(path.join(root, 'public/fonts/plus-jakarta-sans-latin.woff2')));
  } else {
    const mode = url.pathname.includes('production') ? 'production' : 'development';
    const css = url.searchParams.get('fixture') === 'global' ? '' : '<link rel="stylesheet" href="/fixture.css">';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><div id="root"></div><script src="/${mode}.js"></script></body></html>`);
  }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.on('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
await context.route('**/*', route => new URL(route.request().url()).origin === origin && route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'));
const results = [];
try {
  for (const mode of ['development', 'production']) {
    const run = async (name, fixture, scenario) => {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(8000);
      page.setDefaultNavigationTimeout(15000);
      try {
        await page.clock.install({ time: new Date('2026-09-12T12:00:00Z') });
        await page.clock.pauseAt(new Date('2026-09-12T12:00:01Z'));
        await page.goto(`${origin}/${mode}?fixture=${fixture}`);
        await page.evaluate(() => document.fonts.ready);
        await scenario(page);
        assert.deepEqual(errors, []);
        results.push({ mode, case: name, pass: true });
      } catch (error) {
        results.push({ mode, case: name, pass: false, error: error.message, pageErrors: errors });
        await page.screenshot({ path: path.join(evidence, `states-failure-${mode}-${results.length}.png`) }).catch(() => undefined);
      } finally { console.log(JSON.stringify(results.at(-1))); await page.close(); }
    };

    await run('toast stays while focused and resumes only remaining reading time', 'toast', async page => {
      await page.getByRole('button', { name: 'Mostrar aviso', exact: true }).click();
      await page.clock.runFor(1500);
      const close = page.getByRole('button', { name: 'Cerrar aviso', exact: true });
      await close.focus();
      await page.clock.runFor(10000);
      assert.equal(await close.isVisible(), true, 'notice remains after ten seconds with focus');
      assert.equal(await close.evaluate(el => el === document.activeElement), true, 'focus stays on close');
      await page.getByRole('textbox', { name: 'Campo de prueba' }).focus();
      await page.clock.runFor(2499);
      assert.equal(await close.isVisible(), true, 'remaining time is preserved after blur');
      await page.clock.runFor(2);
      assert.equal(await close.count(), 0);
    });

    await run('pointer and focus pauses overlap without prematurely restarting timer', 'toast', async page => {
      await page.getByRole('button', { name: 'Mostrar aviso', exact: true }).click();
      await page.clock.runFor(1000);
      const toast = page.locator('.fi-toast');
      const close = page.getByRole('button', { name: 'Cerrar aviso', exact: true });
      await toast.hover();
      await close.focus();
      await page.clock.runFor(6000);
      await page.mouse.move(0, 0);
      await page.clock.runFor(6000);
      assert.equal(await toast.count(), 1);
      await page.getByRole('textbox', { name: 'Campo de prueba' }).focus();
      await page.clock.runFor(2999);
      assert.equal(await toast.count(), 1);
      await page.clock.runFor(2);
      assert.equal(await toast.count(), 0);
    });

    await run('unmount clears pending toast timeouts', 'toast', async page => {
      await page.evaluate(() => {
        const nativeSet = window.setTimeout;
        const nativeClear = window.clearTimeout;
        window.qa.pendingToastTimers = new Set(); window.qa.firedToastTimers = 0;
        window.setTimeout = (handler, timeout, ...args) => {
          if (timeout !== 4000 || typeof handler !== 'function') return nativeSet(handler, timeout, ...args);
          const id = nativeSet(() => { window.qa.pendingToastTimers.delete(id); window.qa.firedToastTimers++; handler(...args); }, timeout);
          window.qa.pendingToastTimers.add(id); return id;
        };
        window.clearTimeout = id => { window.qa.pendingToastTimers.delete(id); nativeClear(id); };
      });
      await page.getByRole('button', { name: 'Mostrar aviso', exact: true }).click();
      assert.equal(await page.evaluate(() => qa.pendingToastTimers.size), 1);
      await page.getByRole('button', { name: 'Desmontar avisos', exact: true }).click();
      assert.equal(await page.evaluate(() => qa.pendingToastTimers.size), 0);
      await page.clock.runFor(10000);
      assert.equal(await page.evaluate(() => qa.firedToastTimers), 0);
    });

    await run('pausing one notice does not pause another notice', 'toast', async page => {
      await page.getByRole('button', { name: 'Mostrar aviso', exact: true }).click();
      await page.clock.runFor(1000);
      await page.getByRole('button', { name: 'Mostrar error', exact: true }).click();
      await page.clock.runFor(1000);
      const first = page.locator('.fi-toast').filter({ hasText: 'Sesión ficticia registrada' });
      await first.getByRole('button', { name: 'Cerrar aviso', exact: true }).focus();
      await page.clock.runFor(3001);
      assert.equal(await first.count(), 1);
      assert.equal(await page.locator('.fi-toast--error').count(), 0);
    });

    await run('error toast keeps severity, accessible dismissal and reduced motion', 'toast', async page => {
      await page.getByRole('button', { name: 'Mostrar error', exact: true }).click();
      const toast = page.locator('.fi-toast--error');
      assert.equal(await toast.innerText(), 'No pudimos completar esta acción de ejemplo.');
      assert.equal(await toast.evaluate(el => getComputedStyle(el).animationName), 'none');
      const close = toast.getByRole('button', { name: 'Cerrar aviso', exact: true });
      assert.ok((await close.boundingBox()).height >= 44);
      await close.focus(); await page.keyboard.press('Enter');
      assert.equal(await toast.count(), 0);
    });

    for (const fixture of ['error', 'global']) {
      await run(`${fixture} gives neutral recovery copy and preserves reset action`, fixture, async page => {
        await page.getByRole('heading', { level: 1 }).waitFor();
        const body = await page.locator('body').innerText();
        assert.equal(body.includes('Sentry'), false); assert.equal(body.includes('private technical detail'), false);
        assert.equal(body.includes('synthetic-support-reference'), true);
        const retry = page.getByRole('button', { name: 'Reintentar', exact: true });
        assert.ok((await retry.boundingBox()).height >= 44);
        await retry.focus(); await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => qa.resets), 1);
        assert.ok(await page.evaluate(() => qa.captures >= 1));
        if (fixture === 'global') assert.equal(await page.locator('meta[name="viewport"]').getAttribute('content'), 'width=device-width, initial-scale=1');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (mode === 'production') await page.screenshot({ path: path.join(evidence, `polish-states-${fixture}-mobile.png`) });
      });
    }

    await run('cookie table scrolls inside a named keyboard region without page overflow', 'cookies', async page => {
      const region = page.getByRole('region', { name: 'Detalle de cookies', exact: true });
      await region.waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await region.locator('th[scope="col"]').count(), 4);
      await region.focus(); await page.keyboard.press('ArrowRight'); await page.clock.runFor(200);
      await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      if (mode === 'production') await page.screenshot({ path: path.join(evidence, 'polish-states-cookies-mobile.png') });
    });

    for (const fixture of ['404', 'privacy', 'terms', 'loading']) {
      await run(`${fixture} fits a mobile viewport and keeps reduced motion`, fixture, async page => {
        await page.locator(fixture === 'loading' ? '.pc-content' : 'main').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (fixture === 'loading') assert.equal(await page.locator('.fi-skeleton').first().evaluate(el => getComputedStyle(el).animationName), 'none');
      });
    }
  }
} finally {
  await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve));
}
const report = { passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results };
fs.writeFileSync(path.join(evidence, 'states-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
