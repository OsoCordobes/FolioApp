/** Wide-screen audit of local synthetic gallery. No submissions or external requests. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
if (process.env.FOLIO_TEST_ISOLATED !== '1' || process.env.E2E_BASE_URL !== 'http://127.0.0.1:4410') throw new Error('Use isolated app bootstrap.');
const browser = await chromium.launch({ headless: true });
const samples = [];
const suffix = process.argv.includes('--after') ? '-after' : '';
const dialogOnly = process.argv.includes('--dialog-only');
try {
  for (const width of dialogOnly ? [] : [1920, 2560, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1080 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('folio.cookieConsent', 'denied'));
    await context.route('**/*', route => new URL(route.request().url()).origin === process.env.E2E_BASE_URL && route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'));
    const page = await context.newPage();
    for (const [panel, heading] of [['hoy', 'Tu día en Folio'], ['calendario', 'Calendario'], ['pacientes', 'Pacientes'], ['finanzas', 'Ingresos del período'], ['configuracion', 'Configuración']]) {
      const pageErrors = []; const onError = error => pageErrors.push(error.message); page.on('pageerror', onError);
      await page.goto(`${process.env.E2E_BASE_URL}/dev/experience?panel=${panel}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: heading, level: 1, exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      const sample = await page.evaluate(() => {
        const rect = node => {
          if (!node) return null;
          const r = node.getBoundingClientRect(); const css = getComputedStyle(node);
          return { left: r.left, right: r.right, width: r.width, height: r.height, maxWidth: css.maxWidth, padding: css.padding, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
        };
        const main = document.querySelector('.fi-main'); const content = main.querySelector('.fi-content');
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d');
        const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
        const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const blend = (top, bottom) => top.slice(0, 3).map((v, i) => v * top[3] / 255 + bottom[i] * (1 - top[3] / 255));
        const controls = [...main.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a.fi-btn, [role="button"]')].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
        const contrast = controls.filter(node => node.textContent.trim() || node.value).map(node => {
          const ancestors = []; for (let current = node; current; current = current.parentElement) ancestors.push(current);
          let background = [255, 255, 255];
          for (const ancestor of ancestors.reverse()) background = blend(rgba(getComputedStyle(ancestor).backgroundColor), background);
          const css = getComputedStyle(node); const foreground = blend(rgba(css.color), background);
          const a = luminance(foreground), b = luminance(background); const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          return { element: node.className, text: (node.textContent.trim() || node.value).slice(0, 70), ratio: Math.round(ratio * 100) / 100, foreground: css.color, background: background.map(Math.round), fontSize: css.fontSize, fontWeight: css.fontWeight };
        });
        const dimensions = { main: rect(main), content: rect(content), table: rect(main.querySelector('.pd-table,.fn-table')), grid: rect(main.querySelector('.cal-grid,.cfg-grid,.fi-kpis')), horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
        return {
          ...dimensions, controls: controls.length, lowContrast: contrast.filter(c => c.ratio < 4.5),
          clippedAmounts: [...main.querySelectorAll('.fn-monto,.fn-kpi-val,.fi-t-price-num,.fi-kpi-val')].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => ({ text: node.textContent.trim(), ...rect(node) })),
          tableColumns: [...main.querySelectorAll('.pd-table thead th,.fn-table thead th')].map(node => ({ text: node.textContent.trim(), ...rect(node) })),
        };
      });
      await page.screenshot({ path: `docs/design/evidence/wide-${panel}-${width}${suffix}.png` });
      if (panel === 'pacientes' || panel === 'finanzas') {
        const table = page.locator(panel === 'pacientes' ? '.pd-table-wrap' : '.fn-table-scroll');
        await table.scrollIntoViewIfNeeded();
        if (width === 390) { await table.focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(120); }
        sample.tableKeyboardScroll = await table.evaluate(node => node.scrollLeft);
        if (width === 390) await table.evaluate(node => { node.scrollLeft = node.scrollWidth; });
        await page.screenshot({ path: `docs/design/evidence/wide-${panel}-table-${width}${suffix}.png` });
        if (panel === 'pacientes') {
          await page.getByRole('combobox', { name: 'Filtrar por cobertura' }).selectOption('Cobertura de ejemplo');
          await expect(page.locator('.pd-table tbody tr')).toHaveCount(3);
          await expect(page.locator('.pd-table tbody')).toContainText('Tomás Acosta');
          await page.getByRole('combobox', { name: 'Filtrar por cobertura' }).selectOption('__particular');
          await expect(page.locator('.pd-table tbody tr')).toHaveCount(3);
          await expect(page.locator('.pd-table tbody')).toContainText('Elena Torres');
          await page.getByRole('combobox', { name: 'Filtrar por cobertura' }).selectOption('todas');
          await page.locator('.pd-filtros').getByRole('button', { name: /^Alta/ }).click();
          await expect(page.locator('.pd-table tbody tr')).toHaveCount(1);
          await expect(page.locator('.pd-table tbody')).toContainText('Mateo Vidal');
          await page.locator('.pd-filtros').getByRole('button', { name: /^Todos/ }).click();
          const all = page.getByRole('checkbox', { name: 'Seleccionar todos los pacientes visibles' });
          await all.focus(); await page.keyboard.press('Space'); await expect(all).toBeChecked();
          await expect(page.getByRole('checkbox', { name: /^Seleccionar a / })).toHaveCount(6);
          assert.equal(await page.getByRole('checkbox', { name: /^Seleccionar a / }).evaluateAll(nodes => nodes.every(node => node.checked)), true);
          await page.keyboard.press('Space'); await expect(all).not.toBeChecked(); sample.filterCheck = 'coverage3, particular3, state1, all-visible selection6';
        } else {
          await page.getByRole('button', { name: 'Pendientes', exact: true }).click();
          await expect(page.locator('.fn-table tbody tr')).toHaveCount(2);
          await page.getByRole('textbox', { name: 'Buscar transacciones por paciente o monto' }).fill('julian');
          await expect(page.locator('.fn-table tbody tr')).toHaveCount(1);
          await expect(page.locator('.fn-table tbody')).toContainText('Julián Ríos');
          await expect(page.locator('.fn-table tbody')).toContainText('$ 25.000');
          sample.filterCheck = 'pending2, accent-insensitive search1, amount25000';
        }
      }
      if (panel === 'calendario') {
        const card = page.locator('.cal-turno').first(); await card.focus(); await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog'); await dialog.waitFor();
        sample.dialog = await dialog.evaluate(node => {
          const r = node.firstElementChild.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
        });
        await page.screenshot({ path: `docs/design/evidence/wide-calendar-dialog-${width}${suffix}.png` });
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        sample.focusReturned = await card.evaluate(node => node === document.activeElement);
      }
      samples.push({ panel, width, ...sample, pageErrors });
      console.log(JSON.stringify(samples.at(-1))); page.off('pageerror', onError);
    }
    await context.close();
  }
  if (process.argv.includes('--with-dialog')) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-wide-dialog-'));
    const source = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{PacienteCreateModal}from'@/components/pacientes/paciente-create-modal';
window.qa={submitted:0};
function Fixture(){const[open,setOpen]=useState(false);return <div className='fi-app'><aside className='fi-sidebar'>Consultorio de ejemplo</aside><main className='fi-main'><div className='fi-content pd-content'><h1>Directorio de ejemplo</h1><button className='fi-btn fi-btn-primary' onClick={()=>setOpen(true)}>Nuevo paciente</button></div>{open?<PacienteCreateModal especialidad='kinesiologia' onClose={()=>setOpen(false)}/>:null}</main></div>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
    const stubs = {
      'next/navigation': 'export const useRouter=()=>({refresh(){},push(){}});',
      '@/app/(app)/pacientes/actions': "export function createPacienteAction(){qa.submitted++;return new Promise(resolve=>qa.resolveCreate=resolve)}const forbidden=()=>{throw Error('Unexpected action in wide-screen fixture')};export {forbidden as refreshRadiografiaUrlAction,forbidden as uploadRadiografiaAction,forbidden as uploadEstudioCardioAction,forbidden as listOutcomeSeriesAction,forbidden as registrarCssrsAction};",
    };
    await build({ stdin: { contents: source, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: path.join(temporary, 'fixture.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, tsconfig: path.join(root, 'tsconfig.json'), plugins: [{ name: 'synthetic-actions', setup(b) {
      b.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }] });
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(temporary, 'fixture.js'))); }
      else if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end('@font-face{font-family:FolioQA;src:url(/font.woff2) format("woff2");font-weight:200 800}:root{--font-folio:FolioQA}\n' + ['public/folio.css', 'styles/experience.css', 'styles/platform.css'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')); }
      else if (url.pathname === '/font.woff2') { res.end(fs.readFileSync(path.join(root, 'public/fonts/plus-jakarta-sans-latin.woff2'))); }
      else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const width of [1920, 2560, 390]) {
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1080 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
        await context.route('**/*', route => new URL(route.request().url()).origin === origin && route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'));
        const page = await context.newPage(); await page.goto(origin); await page.evaluate(() => document.fonts.ready);
        const trigger = page.getByRole('button', { name: 'Nuevo paciente', exact: true }); await trigger.click();
        const dialog = page.getByRole('dialog', { name: 'Agregar al directorio' }); await expect(dialog).toBeVisible();
        const form = dialog.locator('form');
        const box = await form.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= (width === 390 ? 844 : 1080));
        await expect(dialog.getByRole('textbox', { name: /^Nombre/ })).toBeFocused();
        await page.screenshot({ path: `docs/design/evidence/wide-patient-dialog-${width}${suffix}.png` });
        const cancel = dialog.getByRole('button', { name: 'Cancelar', exact: true }); await cancel.focus(); await expect(cancel).toBeInViewport();
        await page.screenshot({ path: `docs/design/evidence/wide-patient-dialog-actions-${width}${suffix}.png` });
        await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
        assert.equal(await page.evaluate(() => qa.submitted), 0);
        await trigger.click(); await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click(); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
        await trigger.click(); await dialog.click({ position: { x: 4, y: 4 } }); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
        await trigger.click();
        for (const [label, value] of [['Nombre', 'Paciente sintético'], ['Apellido', 'Prueba'], ['Teléfono', '3510000000'], ['Email', 'synthetic@example.invalid'], ['Lugar de residencia', 'Córdoba'], ['Ocupación', 'Ejemplo'], ['Recomendado por', 'Ejemplo'], ['Motivo de consulta', 'Revisión de ejemplo']]) {
          await dialog.getByRole('textbox', { name: new RegExp(`^${label}`) }).fill(value);
        }
        await dialog.getByLabel(/^Fecha de nacimiento/).fill('1990-01-01');
        await dialog.getByRole('button', { name: 'Crear paciente', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Creando…', exact: true })).toBeDisabled();
        await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
        await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
        await dialog.click({ position: { x: 4, y: 4 } }); await expect(dialog).toBeVisible();
        assert.equal(await page.evaluate(() => qa.submitted), 1);
        await page.evaluate(() => qa.resolveCreate({ ok: false, error: { message: 'No se pudo crear el ejemplo.' } }));
        await expect(dialog.getByRole('alert')).toHaveText('No se pudo crear el ejemplo.');
        await expect(dialog.getByRole('textbox', { name: /^Nombre/ })).toHaveValue('Paciente sintético');
        await dialog.getByRole('textbox', { name: /^Nombre/ }).fill('Paciente corregido');
        await dialog.getByRole('button', { name: 'Crear paciente', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Creando…', exact: true })).toBeDisabled();
        assert.equal(await page.evaluate(() => qa.submitted), 2);
        await page.evaluate(() => qa.resolveCreate({ ok: true, data: { id: 'synthetic-created' } }));
        await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
        assert.equal(await page.evaluate(() => qa.submitted), 2);
        if (width === 1920) {
          const breakpoint = [];
          for (const w of [1799, 1800, 1801]) {
            await page.setViewportSize({ width: w, height: 1080 });
            await expect.poll(() => page.evaluate(() => innerWidth)).toBe(w);
            await expect.poll(() => page.locator('.pd-content').evaluate(node => node.getBoundingClientRect().width)).toBeCloseTo(w > 1800 ? 1392.5 : 1392, 1);
            breakpoint.push({ width: w, contentWidth: await page.locator('.pd-content').evaluate(node => node.getBoundingClientRect().width) });
          }
          samples.push({ panel: 'wide-breakpoint', breakpoint });
          assert.ok(breakpoint[2].contentWidth - breakpoint[0].contentWidth < 1);
        }
        samples.push({ panel: 'patient-create-dialog', width, form: box, cancelReachable: true, focusReturned: true, pendingProtected: true, explicitRetry: true, syntheticCalls: 2, realSubmissions: 0 });
        await context.close();
      }
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
} finally { await browser.close(); }
fs.writeFileSync(`docs/design/evidence/wide-platform${dialogOnly ? '-dialogs' : ''}-results${suffix}.json`, JSON.stringify({ date: new Date().toISOString(), kind: 'local synthetic gallery, no services or real submissions', samples }, null, 2) + '\n');
