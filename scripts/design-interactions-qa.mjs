/** Isolated interaction audit. Real UI components; synthetic data and navigation. */
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
const { chromium } = await import('@playwright/test');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-design-interactions-'));
const entry = `
import React,{StrictMode} from 'react';import{createRoot}from'react-dom/client';
import{PacientesDir}from'@/components/pacientes/pacientes-dir';
import{StepShell}from'@/components/onboarding/step-shell';
import{MobileNav}from'@/components/mobile-nav';import{ToastProvider}from'@/components/ui/toast';
window.qa={destinations:[],next:0,back:0};
const patient={id:'synthetic-patient',nombre:'Paciente Sintético',tel:'3510000000',email:'synthetic@example.invalid',tipo:'nuevo',sesiones:0,ultima:null,proximo:null,tags:[],estado:'activo',cobertura:null,coberturaPlan:null};
const fixture=new URLSearchParams(location.search).get('fixture');
createRoot(document.getElementById('root')).render(<StrictMode><ToastProvider>{fixture==='onboarding'?<div className='onb-app fx-onboarding'><StepShell stepIdx={3} headline='Consultorio sintético' next={()=>qa.next++} back={()=>qa.back++} previewData={{nombre:'Profesional sintético',consultorioNombre:'Consultorio sintético',rubro:'Kinesiología',ciudad:'Córdoba',slug:'synthetic'}} appUrl='127.0.0.1'><label>Ciudad<input type='text' defaultValue='Córdoba'/></label></StepShell></div>:fixture==='mobile'?<MobileNav organization={{nombre:'Consultorio sintético',slug:'synthetic'}} role={new URLSearchParams(location.search).get('role')||'ADMIN'}/>:<PacientesDir pacientes={[patient]}/>}</ToastProvider></StrictMode>);
`;
const stubs = {
  'next/navigation': `export const useRouter=()=>({push(url){qa.destinations.push(url)},refresh(){}});export const usePathname=()=>'/hoy';`,
  'next/link': `export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
  'next/image': `export default function Image({src,alt,width,height,className}){return <img src={typeof src==='string'?src:src.src} alt={alt} width={width} height={height} className={className}/>} `,
  '@/components/hoy/turno-create-modal': `export function TurnoCreateModal(){return <div role='dialog' aria-label='Agendar fixture'>Formulario sintético</div>}`,
  '@/components/pacientes/paciente-create-modal': `export function PacienteCreateModal(){return <div role='dialog' aria-label='Paciente fixture'>Formulario sintético</div>}`,
  '@/components/org-switcher': `export function OrgSwitcher(){return null}`,
  '@/components/especialidad-switcher': `export function EspecialidadSwitcher(){return null}`,
  '@/components/sidebar': `export function InternalAccountBadge(){return <span>Cuenta interna</span>}export function TrialChip(){return null}`,
};
for (const mode of ['development', 'production']) {
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true,
    outfile: path.join(dir, `${mode}.js`), platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': JSON.stringify(mode), 'process.env.NEXT_PUBLIC_APP_URL': JSON.stringify('http://127.0.0.1:4410') },
    tsconfig: path.join(root, 'tsconfig.json'), plugins: [{ name: 'isolated-boundaries', setup(b) {
      b.onResolve({ filter: /.*/ }, a => a.path in stubs ? { path: a.path, namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: root }));
    } }] });
}
const styleFiles = ['public/folio.css', 'styles/experience.css', 'styles/auth-experience.css', 'styles/platform.css'].filter(file => fs.existsSync(path.join(root,file)));
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (['/development.js', '/production.js'].includes(url.pathname)) {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(dir,path.basename(url.pathname))));
  } else if (url.pathname === '/fixture.css') {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');res.end(styleFiles.map(file => fs.readFileSync(path.join(root,file),'utf8')).join('\n'));
  } else if (url.pathname.startsWith('/fonts/')) {
    res.statusCode=204;res.end();
  } else {
    const mode = url.pathname.includes('production') ? 'production' : 'development';
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'><link rel='stylesheet' href='/fixture.css'></head><body><div id='root'></div><script src='/${mode}.js'></script></body></html>`);
  }
}).listen(0,'127.0.0.1');
await new Promise(resolve => server.on('listening',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
const results = [];
try {
  for (const mode of ['development','production']) {
    const run = async (name,fixture,scenario) => {
      const page = await context.newPage();page.setDefaultTimeout(4000);
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      try {
        await page.goto(`${origin}/${mode}?fixture=${fixture}`);
        await scenario(page);assert.deepEqual(errors,[]);results.push({mode,case:name,pass:true});
      } catch(error) {results.push({mode,case:name,pass:false,error:error.message,pageErrors:errors});}
      finally {console.log(JSON.stringify(results.at(-1)));await page.close();}
    };
    await run('patient name opens once by Enter without bubbling into row','patients',async page=>{
      await page.getByRole('button',{name:'Abrir ficha de Paciente Sintético'}).focus();await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(()=>qa.destinations),['/pacientes/synthetic-patient']);
    });
    await run('patient checkbox toggles by keyboard and never opens chart','patients',async page=>{
      const box=page.getByRole('checkbox',{name:'Seleccionar a Paciente Sintético'});await box.focus();await page.keyboard.press('Space');
      assert.equal(await box.isChecked(),true);await page.keyboard.press('Space');assert.equal(await box.isChecked(),false);
      assert.deepEqual(await page.evaluate(()=>qa.destinations),[]);
    });
    await run('patient checkbox label selects once and never opens chart','patients',async page=>{
      const box=page.getByRole('checkbox',{name:'Seleccionar a Paciente Sintético'});
      await box.evaluate(input=>input.closest('label').click());assert.equal(await box.isChecked(),true);
      assert.deepEqual(await page.evaluate(()=>qa.destinations),[]);
    });
    await run('scheduling action opens only its modal','patients',async page=>{
      await page.getByRole('button',{name:'Agendar',exact:true}).click();await page.getByRole('dialog',{name:'Agendar fixture'}).waitFor();
      assert.deepEqual(await page.evaluate(()=>qa.destinations),[]);
    });
    await run('onboarding preview traps focus, closes with Escape and restores trigger without advancing','onboarding',async page=>{
      const trigger=page.getByRole('button',{name:'Ver mi perfil público',exact:true});await trigger.click();
      const dialog=page.getByRole('dialog',{name:'Tu perfil público'});await dialog.waitFor();
      assert.equal(await dialog.evaluate(el=>el.open&&el.contains(document.activeElement)),true);
      await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);
      await page.keyboard.press('Shift+Tab');assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
      assert.deepEqual(await page.evaluate(()=>({next:qa.next,back:qa.back})),{next:0,back:0});
    });
    await run('mobile more sheet closes with button and Escape, restoring focus','mobile',async page=>{
      const trigger=page.getByRole('button',{name:'Más',exact:true});await trigger.click();
      const dialog=page.getByRole('dialog',{name:'Más opciones'});await dialog.waitFor();
      await page.getByRole('button',{name:'Cerrar más opciones'}).click();await dialog.waitFor({state:'hidden'});
      assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
      await trigger.click();await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
    });
    await run('assistant role does not gain finance navigation','mobile&role=ASISTENTE',async page=>{
      await page.getByRole('button',{name:'Más',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Finanzas',exact:true}).count(),0);
    });
  }
} finally {await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
const report={passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
fs.writeFileSync(path.join(root,'docs/design/evidence/interaction-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
