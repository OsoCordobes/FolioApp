/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS browser harness. */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const esbuild = require('../../node_modules/.pnpm/node_modules/esbuild');
const { chromium } = require('@playwright/test');
const cwd = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-walkin-browser-'));
const entry = `import React,{StrictMode,useState} from 'react';
import{createRoot}from'react-dom/client';
import{Dashboard}from'@/components/hoy/dashboard';
import{ToastProvider}from'@/components/ui/toast';
const initial={id:'synthetic-walk-in',pacienteId:'synthetic-patient',hora:'17:30',servicio:'Consulta sintética',estado:'agendado',origen:'walk_in',precio:30000,duracionMin:30,postVisita:{guardada:false},transiciones:[],cobro:{estado:'pendiente',ts:null}};
window.qa={calls:[],jobs:[],refreshes:0,state:[],server:initial,settle(result){this.jobs.shift().resolve(result)},reject(){this.jobs.shift().reject(new Error('synthetic network interruption'))}};
function App(){const[turnos,setTurnos]=useState([initial]);window.qa.refresh=(updates={})=>setTurnos(Array.isArray(updates)?updates.map(t=>({...initial,...t})):[{...initial,...updates}]);return <ToastProvider><Dashboard initialTurnos={turnos} pacientes={{'synthetic-patient':{id:'synthetic-patient',nombre:'Paciente de prueba',edad:30,tel:'',notasImportantes:''}}} fechaIso='2026-09-08' fechaLarga='martes 8 de septiembre' fechaAnio={2026} nowIso='2026-09-08T15:00:00Z' timezone='America/Argentina/Cordoba'/></ToastProvider>};
createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);`;
const stubs = {
    'next/navigation': `export const useRouter=()=>({push(){},refresh(){window.qa.refreshes++}});`,
    '@/app/(app)/hoy/actions': `export const transitionTurnoAction=(input)=>{window.qa.calls.push(input);return new Promise((resolve,reject)=>window.qa.jobs.push({resolve,reject}))};`,
    '@/lib/use-agenda-refresh': `export function useAgendaAutoRefresh(){}`,
    '@/components/hoy/turno-create-modal': `export const TurnoCreateModal=()=>null;`,
    '@/components/hoy/turno-reagendar-modal': `export const TurnoReagendarModal=()=>null;`,
    '@/components/agenda/prof-filter-chips': `export const ProfFilterChips=()=>null;`,
    '@/components/hoy/turno-list': `import React from 'react';import{TurnoList as Actual}from ${JSON.stringify(path.join(cwd, 'components/hoy/turno-list.tsx'))};export const TurnoList=(props)=>{window.qa.state=props.turnos;window.qa.transition=props.onTransition;return <Actual {...props}/>};`
};
(async () => {
    for (const mode of ['development', 'production'])
        await esbuild.build({ stdin: { contents: entry, resolveDir: cwd, loader: 'tsx' }, bundle: true, outfile: path.join(dir, mode + '.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': JSON.stringify(mode) }, tsconfig: path.join(cwd, 'tsconfig.json'), plugins: [{ name: 'synthetic-boundaries', setup(b) { b.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: 'stub' } : undefined); b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: cwd })); } }] });
    const server = http.createServer((req, res) => { if (req.url.endsWith('.js')) {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(fs.readFileSync(path.join(dir, path.basename(req.url))));
    }
    else if (req.url === '/folio.css') {
        res.setHeader('Content-Type', 'text/css');
        res.end(fs.readFileSync(path.join(cwd, 'public/folio.css')));
    }
    else {
        res.end(`<html><head><link rel="stylesheet" href="/folio.css"></head><body><div id="root"></div><script src="/${req.url.includes('production') ? 'production' : 'development'}.js"></script></body></html>`);
    } }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const browser = await chromium.launch({ headless: true });
    const result = [];
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => { const url = new URL(route.request().url()); return url.hostname === '127.0.0.1' && url.port === String(server.address().port) ? route.continue() : route.abort('blockedbyclient'); });
    try {
        for (const mode of ['development', 'production']) {
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            const reset = async () => { await page.goto(`http://127.0.0.1:${server.address().port}/${mode}`); await page.getByRole('button', { name: 'Marcar llegada', exact: true }).waitFor(); };
            await reset();
            await page.evaluate(() => { window.toastPeak = 0; new MutationObserver(() => { window.toastPeak = Math.max(window.toastPeak, document.querySelectorAll('.fi-toast').length); }).observe(document.body, { childList: true, subtree: true }); });
            await page.getByRole('button', { name: 'Marcar llegada', exact: true }).evaluate(el => { el.click(); el.click(); });
            await page.waitForFunction(() => qa.state[0].estado === 'en_sala');
            assert.equal(await page.evaluate(() => qa.calls.length), 1);
            await page.evaluate(() => qa.refresh());
            await page.waitForTimeout(40);
            assert.equal(await page.evaluate(() => qa.state[0].estado), 'en_sala');
            await page.evaluate(() => qa.transition('synthetic-walk-in', 'en_sala'));
            assert.equal(await page.evaluate(() => qa.calls.length), 1);
            await page.evaluate(() => qa.settle({ ok: true, data: {} }));
            await page.waitForFunction(() => document.querySelectorAll('.fi-toast').length === 1);
            assert.equal(await page.locator('.fi-toast').count(), 1);
            await page.waitForTimeout(12500);
            assert.equal(await page.evaluate(() => qa.calls.length), 1);
            assert.equal(await page.evaluate(() => window.toastPeak), 1);
            result.push({ mode, case: 'double click + refresh pending + 12.5 seconds, one request and peak one toast', pass: true });
            await reset();
            await page.getByRole('button', { name: 'Marcar llegada', exact: true }).click();
            await page.evaluate(() => qa.reject());
            await page.getByText(/Se interrumpió la conexión/).waitFor();
            assert.equal(await page.evaluate(() => qa.state[0].estado), 'agendado');
            assert.equal(await page.locator('.fi-toast').count(), 0);
            assert.equal(await page.evaluate(() => qa.refreshes), 1);
            result.push({ mode, case: 'network failure rollback + reconciliation refresh + no success', pass: true });
            await reset();
            await page.evaluate(() => qa.refresh({ estado: 'atendiendo' }));
            await page.waitForFunction(() => qa.state[0].estado === 'atendiendo');
            await page.getByRole('button', { name: 'Cerrar turno', exact: true }).click();
            await page.getByRole('button', { name: 'Cobrar y cerrar', exact: true }).click();
            await page.waitForFunction(() => qa.state[0].estado === 'cerrado');
            assert.equal(await page.evaluate(() => qa.state[0].cobro.montoCents), 3000000);
            assert.equal(await page.evaluate(() => qa.calls.length), 1);
            await page.evaluate(() => qa.settle({ ok: true, data: { pagoRegistrado: false } }));
            await page.locator('.fi-toast--error').waitFor();
            assert.equal(await page.evaluate(() => qa.state[0].estado), 'cerrado');
            assert.equal(await page.evaluate(() => qa.state[0].cobro.estado), 'pendiente');
            assert.equal(await page.locator('.fi-toast').count(), 1);
            result.push({ mode, case: 'close succeeds but failed payment rolls back only money + one error notice', pass: true });
            await reset();
            await page.evaluate(() => qa.refresh({ estado: 'atendiendo' }));
            await page.waitForFunction(() => qa.state[0].estado === 'atendiendo');
            await page.evaluate(() => qa.transition('synthetic-walk-in', 'cerrado', {}, { montoCents: 3000000, pagado: false }));
            await page.evaluate(() => qa.refresh({ estado: 'cerrado', servicio: 'Servicio actualizado', cobro: { estado: 'pagado', montoCents: 1234567, ts: null } }));
            await page.waitForFunction(() => qa.state[0].cobro.montoCents === 1234567 && qa.state[0].servicio === 'Servicio actualizado');
            assert.equal(await page.locator('.fi-toast').count(), 0);
            await page.evaluate(() => qa.settle({ ok: true, data: { pagoRegistrado: true } }));
            await page.locator('.fi-toast').waitFor();
            assert.equal(await page.evaluate(() => qa.state[0].cobro.montoCents), 1234567);
            assert.ok(!(await page.locator('.fi-toast').innerText()).includes('deuda registrada'));
            result.push({ mode, case: 'equal-state SSR payment visible while pending and no false debt toast after ACK', pass: true });
            await reset();
            await page.getByRole('button', { name: 'Marcar llegada', exact: true }).click();
            await page.evaluate(() => qa.settle({ ok: true, data: {} }));
            await page.locator('.fi-toast').waitFor();
            await page.evaluate(() => qa.refresh());
            await page.waitForTimeout(50);
            const staleState = await page.evaluate(() => qa.state[0].estado);
            assert.equal(staleState, 'en_sala');
            assert.equal(await page.evaluate(() => qa.calls.length), 1);
            await page.evaluate(() => qa.refresh({ estado: 'en_sala', servicio: 'Datos actualizados' }));
            await page.waitForFunction(() => qa.state[0].servicio === 'Datos actualizados');
            await page.evaluate(() => qa.refresh());
            await page.waitForTimeout(40);
            assert.equal(await page.evaluate(() => qa.state[0].estado), 'en_sala');
            await page.getByRole('button', { name: 'Abrir ficha', exact: true }).click();
            await page.waitForFunction(() => qa.calls.length === 2);
            await page.evaluate(() => qa.settle({ ok: true, data: {} }));
            await page.waitForFunction(() => qa.state[0].estado === 'atendiendo');
            await page.evaluate(() => qa.refresh({ estado: 'en_sala' }));
            await page.waitForTimeout(40);
            assert.equal(await page.evaluate(() => qa.state[0].estado), 'atendiendo');
            await page.getByRole('button', { name: 'Cerrar turno', exact: true }).click();
            await page.getByRole('button', { name: 'Cobrar y cerrar', exact: true }).click();
            await page.evaluate(() => qa.settle({ ok: true, data: { pagoRegistrado: true } }));
            await page.waitForFunction(() => qa.state[0].estado === 'cerrado');
            await page.evaluate(() => qa.refresh());
            await page.waitForTimeout(40);
            assert.equal(await page.evaluate(() => qa.state[0].estado), 'cerrado');
            assert.equal(await page.evaluate(() => qa.calls.length), 3);
            result.push({ mode, case: 'stale after ACK and equal snapshot blocked; real UI arrival -> attending -> closed remains enabled', pass: true });
            await reset();
            await page.getByRole('button', { name: 'Marcar llegada', exact: true }).click();
            await page.evaluate(() => qa.refresh({ estado: 'cancelado' }));
            await page.waitForFunction(() => qa.state[0].estado === 'cancelado');
            await page.evaluate(() => qa.settle({ ok: true, data: {} }));
            await page.waitForTimeout(40);
            assert.equal(await page.evaluate(() => qa.state[0].estado), 'cancelado');
            assert.equal(await page.locator('.fi-toast').count(), 0);
            result.push({ mode, case: 'server cancellation during pending request preserved after late ACK', pass: true });
            await reset();
            await page.evaluate(() => qa.refresh([{ id: 'synthetic-walk-in' }, { id: 'second-synthetic' }]));
            await page.waitForFunction(() => qa.state.length === 2);
            await page.getByRole('button', { name: 'Marcar llegada', exact: true }).evaluateAll(els => els.forEach(el => el.click()));
            assert.equal(await page.evaluate(() => qa.calls.length), 2);
            await page.evaluate(() => { qa.settle({ ok: true, data: {} }); qa.reject(); });
            await page.waitForFunction(() => qa.state.find(t => t.id === 'synthetic-walk-in').estado === 'en_sala' && qa.state.find(t => t.id === 'second-synthetic').estado === 'agendado');
            await page.evaluate(() => qa.refresh([{ id: 'synthetic-walk-in' }, { id: 'second-synthetic' }]));
            await page.waitForTimeout(40);
            assert.equal(await page.getByRole('button', { name: 'Marcar llegada', exact: true }).count(), 1);
            assert.equal(await page.locator('.fi-toast').count(), 1);
            await page.getByRole('button', { name: 'Marcar llegada', exact: true }).click();
            assert.equal(await page.evaluate(() => qa.calls.length), 3);
            await page.evaluate(() => qa.settle({ ok: true, data: {} }));
            await page.waitForFunction(() => qa.state.every(t => t.estado === 'en_sala'));
            result.push({ mode, case: 'two concurrent arrivals settle independently; failed appointment can retry', pass: true });
            assert.deepEqual(errors, []);
            await page.close();
        }
    }
    finally {
        await context.close();
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ passed: result.length, results: result, artifact: path.join(dir, 'results.json') }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
