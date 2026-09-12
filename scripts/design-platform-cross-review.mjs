/** Independent calendar accessibility review. Synthetic props, real card and detail modal. */
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-platform-review-'));
const evidence = path.join(root, 'docs/design/evidence');
const entry = `
import React,{StrictMode} from 'react';import{createRoot}from'react-dom/client';
import{Calendario}from'@/components/calendario/calendario';
import{calendar,PREVIEW_DATE}from'@/app/dev/experience/fixtures';
window.qa={destinations:[]};
const variant=new URLSearchParams(location.search).get('variant');
const rich={...calendar.turnos[0],id:'synthetic-review-rich',fecha:PREVIEW_DATE,hora:'09:00',servicio:'Consulta inicial',origen:'google',profesionalNombre:'Dra. Profesional Sintética'};
const basic={...rich,id:'synthetic-review-basic',origen:'manual',profesionalNombre:null};
const second={...rich,id:'synthetic-review-second',profesionalNombre:'Dr. Segundo Profesional'};
const turnos=variant==='narrow'?[rich,second]:[variant==='basic'?basic:rich];
createRoot(document.getElementById('root')).render(<StrictMode><Calendario {...calendar} turnos={turnos} mesTurnos={turnos} bloqueos={[]}/></StrictMode>);
`;
const stubs = {
  '@/lib/use-agenda-refresh': `export function useAgendaAutoRefresh(){}`,
  'next/navigation': `export const useRouter=()=>({push(url){qa.destinations.push(url)},refresh(){}});`,
  'next/link': `export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
  '@/components/calendario/bloqueo-modal': `export function BloqueoModal(){throw new Error('Out of scope mutation modal')}`,
  '@/components/calendario/pedido-modal': `export function PedidoModal(){throw new Error('Out of scope mutation modal')}`,
  '@/components/hoy/turno-create-modal': `export function TurnoCreateModal(){throw new Error('Out of scope mutation modal')}`,
};
for (const mode of ['development', 'production']) {
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true,
    outfile: path.join(dir, `${mode}.js`), platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) }, tsconfig: path.join(root, 'tsconfig.json'),
    plugins: [{ name: 'isolated-boundaries', setup(b) {
      b.onResolve({ filter: /.*/ }, a => a.path in stubs ? { path: a.path, namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: root }));
    } }] });
}
const styles = ['public/folio.css', 'styles/experience.css', 'styles/platform.css'];
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
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/${mode}.js"></script></body></html>`);
  }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.on('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
await context.route('**/*', route => new URL(route.request().url()).origin === origin && route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'));
const results = [];
try {
  for (const mode of ['development', 'production']) {
    for (const variant of ['basic', 'rich', 'narrow']) {
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        if (variant === 'narrow') await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${origin}/${mode}?variant=${variant}`);
        const card = page.locator('.cal-turno').first();
        const base = 'Elena Torres · 09:00 · Consulta inicial';
        const richName = `${base} · Dra. Profesional Sintética · Sincronizado de Google`;
        await expect(card).toHaveAccessibleName(variant === 'basic' ? base : richName);
        if (variant === 'narrow') {
          await expect(page.locator('.cal-turno').nth(1)).toHaveAccessibleName(`${base} · Dr. Segundo Profesional · Sincronizado de Google`);
          await expect(card).toHaveClass(/is-narrow/);
        }
        const accessibleTree = await card.ariaSnapshot();
        await card.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('Elena Torres');
        await expect(dialog).toContainText('Consulta inicial');
        if (variant !== 'basic') await expect(dialog).toContainText('Dra. Profesional Sintética');
        for (let i = 0; i < 5; i++) {
          await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
          assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
        }
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await expect(card).toBeFocused();
        assert.deepEqual(await page.evaluate(() => qa.destinations), []);
        assert.deepEqual(errors, []);
        if (mode === 'production' && variant !== 'basic') {
          await page.evaluate(() => document.fonts.ready);
          await card.screenshot({ path: path.join(evidence, `polish-platform-review-${variant}-card.png`) });
        }
        results.push({ mode, variant, passed: true, accessibleTree });
      } catch (error) { results.push({ mode, variant, passed: false, error: error.message, pageErrors: errors }); }
      finally { console.log(JSON.stringify(results.at(-1))); await page.close(); }
    }
  }
} finally { await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
const report = { passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
fs.writeFileSync(path.join(evidence, 'platform-cross-review-results.json'), JSON.stringify(report, null, 2) + '\n');
if (report.failed) process.exitCode = 1;
