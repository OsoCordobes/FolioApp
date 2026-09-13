/** Short and landscape review. Gallery is read-only; success callbacks stay in synthetic fixtures. */
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-short-viewport-'));
const evidence = path.join(root, 'docs/design/evidence');
const phase = process.argv.includes('--before') ? 'before' : 'after';
const mode = process.argv.includes('--production') ? 'production' : 'development';
const entry = `
import React,{StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';
import{TurnoCreateModal}from'@/components/hoy/turno-create-modal';
import{CobroCierreDialog}from'@/components/hoy/cobro-cierre-dialog';
import{PlanTratamientoModal}from'@/components/paciente/plan-tratamiento-modal';
import{ConfirmDialog}from'@/components/ui/confirm-dialog';import{ToastProvider}from'@/components/ui/toast';
window.qa={writes:0,closed:0,confirmed:0,confirmationValues:[],planInputs:[],resolvePlan:null};
const fixture=new URLSearchParams(location.search).get('fixture');
const patient='Paciente de ejemplo con nombre y apellido completos';
function App(){const[open,setOpen]=useState(false);const close=()=>{qa.closed++;setOpen(false)};return <ToastProvider><div className='fi-app'><main style={{padding:24}}><h1>Prueba local</h1><button className='fi-btn' onClick={()=>setOpen(true)}>Abrir ejemplo</button></main>{open?(fixture==='create'?<TurnoCreateModal defaultInicio='2026-09-12T15:00:00Z' onClose={close} onCreated={()=>{qa.confirmed++}}/>:fixture==='charge'?<CobroCierreDialog pacienteNombre={patient} precioPesos={25000} onClose={close} onConfirm={value=>{qa.confirmed++;qa.confirmationValues.push(value)}}/>:fixture==='plan'?<PlanTratamientoModal pacienteId='synthetic-patient' prefill={{sesionesObjetivo:8,frecuencia:'Semanal',proximoControl:null,diagnostico:null,notas:'Texto ficticio conservado'}} onClose={close}/>:<ConfirmDialog titulo={'¿Cancelar el turno de '+patient+'?'} mensaje='Esta acción queda en el audit log y no se puede borrar.' confirmLabel='Cancelar turno' cancelLabel='Volver' variant='danger' onClose={close} onConfirm={()=>{qa.confirmed++}}/>):null}</div></ToastProvider>}
createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);
`;
const stubs = {
  'next/navigation': `export const useRouter=()=>({push(){throw new Error('Unexpected navigation')},refresh(){}});`,
  '@/app/(app)/pacientes/actions': `export function savePlanTratamientoAction(input){qa.writes++;if(!location.search.includes('synthetic-success'))throw new Error('Mutations forbidden in visual fixture');qa.planInputs.push(input);return new Promise(resolve=>{qa.resolvePlan=resolve})}`,
  '@/app/(app)/hoy/actions': `export async function loadCreateTurnoMeta(){return {ok:true,data:{timezone:'America/Argentina/Cordoba',servicios:[{id:'synthetic-service',nombre:'Consulta de ejemplo',duracionMin:45}],pacientes:[],profesionales:[{id:'synthetic-prof-1',displayName:'Profesional de ejemplo'},{id:'synthetic-prof-2',displayName:'Segundo profesional de ejemplo'}],sessionMemberId:'synthetic-prof-1'}}};export async function searchPacientesAction(){return {ok:true,data:[]}};export function createTurnoAction(){qa.writes++;throw new Error('Mutations forbidden in visual fixture')}`,
};
await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true,
  outfile: path.join(dir, 'fixture.js'), platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': JSON.stringify(mode) }, tsconfig: path.join(root, 'tsconfig.json'),
  plugins: [{ name: 'isolated-boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, a => a.path in stubs ? { path: a.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: root }));
  } }] });
const styles = ['public/folio.css', 'styles/experience.css', 'styles/platform.css', 'styles/clinical-experience.css', 'styles/states-experience.css'];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(fs.readFileSync(path.join(dir, 'fixture.js'))); }
  else if (url.pathname === '/fixture.css') {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.end('@font-face{font-family:"Folio fixture";src:url(/folio-font.woff2) format("woff2");font-weight:200 800;font-display:swap}:root{--font-folio:"Folio fixture"}\n' + styles.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'));
  } else if (url.pathname === '/folio-font.woff2') { res.setHeader('Content-Type', 'font/woff2'); res.end(fs.readFileSync(path.join(root, 'public/fonts/plus-jakarta-sans-latin.woff2'))); }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.on('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
const viewports = [{ width: 844, height: 390 }, { width: 1024, height: 600 }, { width: 390, height: 500 }];
async function exposed(locator) {
  return locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { visible: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && (top === el || el.contains(top)), top: r.top, bottom: r.bottom, left: r.left, right: r.right, covering: top?.className ?? null };
  });
}
async function focusChartControl(page, control) {
  // The gallery can announce an asynchronously blocked read. Dismiss only its
  // fixture notice, then validate the actual screen with every barrier intact.
  const notice = page.getByRole('button', { name:'Entendido', exact:true });
  if (await notice.isVisible()) await notice.click();
  await control.focus(); await control.scrollIntoViewIfNeeded();
  if (await notice.isVisible()) {
    await notice.click(); await control.focus(); await control.scrollIntoViewIfNeeded();
  }
}
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin && route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'));
    for (const fixture of ['create', 'charge', 'plan', 'confirm']) {
      const page = await context.newPage(); page.setDefaultTimeout(6000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      let geometry = null;
      try {
        await page.goto(`${origin}/?fixture=${fixture}`);
        const opener = page.getByRole('button', { name: 'Abrir ejemplo' }); await opener.click();
        const dialog = page.locator('[role="dialog"],[role="alertdialog"]'); await expect(dialog).toBeVisible();
        if (fixture === 'create') { await page.getByPlaceholder('Nombre', { exact: true }).fill('Paciente'); await page.getByPlaceholder('Apellido', { exact: true }).fill('Ejemplo'); await page.getByPlaceholder('Teléfono', { exact: true }).fill('3510000000'); }
        await page.evaluate(() => document.fonts.ready);
        const panel = dialog.locator(':scope > :first-child');
        geometry = await panel.evaluate(el => { const r=el.getBoundingClientRect(); return { top:r.top,bottom:r.bottom,height:r.height,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,overflow:getComputedStyle(el).overflowY }; });
        await page.screenshot({ path: path.join(evidence, `short-${phase}-${fixture}-${viewport.width}x${viewport.height}.png`) });
        assert.ok(geometry.top >= 0 && geometry.bottom <= viewport.height, `Dialog panel extends outside viewport: ${JSON.stringify(geometry)}`);
        const controls = dialog.locator('input:not([type="hidden"]),select,textarea,button:not(:disabled)');
        for (let i = 0; i < await controls.count(); i++) {
          const control = controls.nth(i); await control.focus(); await control.scrollIntoViewIfNeeded();
          const position = await exposed(control); assert.ok(position.visible, `Control ${i} is blocked: ${JSON.stringify(position)}`);
          assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
        }
        if (fixture === 'charge') await expect(page.getByRole('textbox', { name: 'Monto en pesos' })).toHaveValue('25000');
        if (fixture === 'plan') await expect(dialog.locator('textarea').last()).toHaveValue('Texto ficticio conservado');
        await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(opener).toBeFocused();
        await opener.click(); await expect(dialog).toBeVisible();
        const cancelName = fixture === 'charge' || fixture === 'confirm' ? 'Volver' : 'Cancelar';
        await dialog.getByRole('button', { name: cancelName, exact: true }).click();
        await expect(dialog).not.toBeVisible(); await expect(opener).toBeFocused();
        assert.deepEqual(await page.evaluate(() => ({ writes:qa.writes,confirmed:qa.confirmed })), { writes:0,confirmed:0 });
        assert.deepEqual(errors, []);
        results.push({ viewport, fixture, pass:true, geometry });
      } catch (error) { results.push({ viewport, fixture, pass:false, geometry, error:error.message, pageErrors:errors }); }
      finally { console.log(JSON.stringify(results.at(-1))); await page.close(); }
    }
    if (phase !== 'before') {
      for (const fixture of ['charge', 'plan']) {
        const page = await context.newPage();
        try {
          await page.goto(`${origin}/?fixture=${fixture}&synthetic-success`);
          const opener = page.getByRole('button', { name: 'Abrir ejemplo' }); await opener.click();
          const dialog = page.getByRole('dialog');
          if (fixture === 'charge') {
            await expect(dialog.getByRole('button', { name: 'Cobrar y cerrar' })).toBeFocused();
            await page.keyboard.press('Enter');
            assert.deepEqual(await page.evaluate(() => qa.confirmationValues), [{ montoCents:2500000,metodo:'EFECTIVO',pagado:true }]);
          } else {
            await expect(dialog.locator('input').first()).toBeFocused();
            await dialog.getByRole('button', { name: 'Guardar plan', exact: true }).click();
            await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
            await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
            await dialog.click({ position:{ x:2, y:2 } }); await expect(dialog).toBeVisible();
            assert.equal(await page.evaluate(() => qa.writes), 1);
            assert.equal(await page.evaluate(() => qa.planInputs[0].notas), 'Texto ficticio conservado');
            await page.evaluate(() => qa.resolvePlan({ ok:false, error:{ message:'Error confirmado de prueba' } }));
            await expect(dialog.getByRole('alert')).toContainText('Error confirmado de prueba');
            await expect(dialog.locator('textarea').last()).toHaveValue('Texto ficticio conservado');
            await dialog.locator('textarea').last().fill('Texto ficticio corregido');
            await dialog.getByRole('button', { name:'Guardar plan', exact:true }).click();
            assert.equal(await page.evaluate(() => qa.writes), 2);
            assert.equal(await page.evaluate(() => qa.planInputs[1].notas), 'Texto ficticio corregido');
            await page.evaluate(() => qa.resolvePlan({ ok:true, data:null }));
          }
          await expect(dialog).not.toBeVisible(); await expect(opener).toBeFocused();
          results.push({ viewport, fixture:`${fixture}-synthetic-success`, pass:true });
        } catch (error) { results.push({ viewport, fixture:`${fixture}-synthetic-success`, pass:false, error:error.message }); }
        finally { console.log(JSON.stringify(results.at(-1))); await page.close(); }
      }
    }
    await context.close();
  }
  if (phase !== 'before' && mode === 'development') {
    const gallery = 'http://127.0.0.1:4410';
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport, reducedMotion:'reduce', serviceWorkers:'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === gallery && route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'));
      await context.addInitScript(() => localStorage.setItem('folio.cookieConsent', 'denied'));
      for (const specialty of ['cardiologia', 'psicologia', 'kinesiologia', 'nutricion', 'quiropraxia']) {
        const page = await context.newPage();
        let positions = [];
        try {
          await page.goto(`${gallery}/dev/experience?panel=ficha&esp=${specialty}&editing=1`);
          await expect(page.getByRole('tab', { name:'Plan', exact:true })).toHaveAttribute('aria-selected', 'true');
          const notice = page.getByRole('button', { name:'Entendido', exact:true }); if (await notice.isVisible()) await notice.click();
          await page.evaluate(() => document.fonts.ready);
          const controls = page.locator('.pc-content input:not(:disabled):visible,.pc-content select:not(:disabled):visible,.pc-content textarea:not(:disabled):visible,.pc-content button:not(:disabled):visible');
          const count = await controls.count(); assert.ok(count > 0);
          for (const index of [...new Set([0, Math.floor(count / 2), count - 1])]) {
            const control = controls.nth(index); await focusChartControl(page, control);
            const position = await exposed(control); positions.push({ index, text:await control.getAttribute('aria-label') ?? await control.innerText(), ...position });
            assert.ok(position.visible, `Clinical control ${index} blocked: ${JSON.stringify(position)}`);
          }
          const fields = page.locator('.pc-content input:not(:disabled):visible,.pc-content select:not(:disabled):visible,.pc-content textarea:not(:disabled):visible');
          for (let index = 0; index < await fields.count(); index++) {
            const field = fields.nth(index); await focusChartControl(page, field);
            const position = await exposed(field);
            assert.ok(position.visible, `Clinical field ${index} blocked: ${JSON.stringify(position)}`);
          }
          const sessionActions = page.locator('.pc-session-actions button:not(:disabled):visible');
          assert.ok(await sessionActions.count() > 0);
          for (let index = 0; index < await sessionActions.count(); index++) {
            const action = sessionActions.nth(index); await focusChartControl(page, action);
            const position = await exposed(action); positions.push({ sessionAction:await action.innerText(), ...position });
            assert.ok(position.visible, `Session action blocked: ${JSON.stringify(position)}`);
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await page.screenshot({ path:path.join(evidence, `short-chart-${specialty}-${viewport.width}x${viewport.height}.png`) });
          results.push({ viewport, fixture:`chart-${specialty}`, pass:true, positions });
        } catch (error) {
          await page.screenshot({ path:path.join(evidence, `short-chart-${specialty}-${viewport.width}x${viewport.height}.png`) });
          results.push({ viewport, fixture:`chart-${specialty}`, pass:false, positions, error:error.message });
        } finally { console.log(JSON.stringify(results.at(-1))); await page.close(); }
      }
      await context.close();
    }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
const report = { date: new Date().toISOString(), phase, mode, passed:results.filter(r => r.pass).length, failed:results.filter(r => !r.pass).length, results };
fs.writeFileSync(path.join(evidence, `short-viewport-${phase}${mode === 'production' ? '-production' : ''}-results.json`), JSON.stringify(report, null, 2) + '\n');
if (report.failed) process.exitCode = 1;
