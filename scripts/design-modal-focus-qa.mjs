/** Real dialog components and focus hook; synthetic actions; loopback networking only. */
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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-modal-focus-qa-'));
const evidence = path.join(root, 'docs/design/evidence');
const before = process.argv.includes('--before');
const entry = `
import React,{StrictMode,useState}from'react';import{createRoot}from'react-dom/client';
import{ContactoModal}from'@/components/paciente/contacto-modal';
import{CoberturaModal}from'@/components/paciente/cobertura-modal';
import{EnmiendaModal}from'@/components/paciente/enmienda-modal';
import{BloqueoModal}from'@/components/calendario/bloqueo-modal';
window.qa={calls:[],refreshes:0,closes:0};
const kind=new URLSearchParams(location.search).get('kind');
function App(){const[open,setOpen]=useState(false);const onClose=()=>{qa.closes++;setOpen(false)};return <main style={{padding:24}}><h1>Muestra local de diálogos</h1><p>Datos sintéticos. Ninguna acción se envía a un servidor.</p><button id='opener' className='fi-btn fi-btn-primary' onClick={()=>setOpen(true)}>Abrir diálogo</button><button id='outside' className='fi-btn'>Otro control</button>{open&&(kind==='contacto'?<ContactoModal pacienteId='synthetic-patient' prefill={{nombre:'Paciente',apellido:'de muestra',telefono:'3510000000',email:'synthetic@example.invalid',ocupacion:'Muestra'}} onClose={onClose}/>:kind==='cobertura'?<CoberturaModal pacienteId='synthetic-patient' prefill={{coberturaNombre:'Cobertura de muestra',coberturaPlan:'Plan ficticio',coberturaNroAfiliado:'000000'}} onClose={onClose}/>:kind==='enmienda'?<EnmiendaModal pacienteId='synthetic-patient' sesionId='synthetic-session' fechaSesion='12/09/2026' onClose={onClose}/>:<BloqueoModal fechaInicial='2026-09-21' onClose={onClose}/>)}</main>}
createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);
`;
const action = name => `export function ${name}(...args){return new Promise(resolve=>{qa.calls.push({action:${JSON.stringify(name)},args});qa.resolve=resolve})}`;
const stubs = {
  'next/navigation': 'export const useRouter=()=>({refresh(){qa.refreshes++}});',
  '@/app/(app)/pacientes/actions': ['updateContactoPacienteAction','savePacienteCoberturaAction','addEnmiendaSesionAction'].map(action).join('\n'),
  '@/app/(app)/calendario/actions': action('crearBloqueoAction'),
};
for (const mode of ['development','production']) await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(temp,mode+'.js'),platform:'browser',jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':JSON.stringify(mode)},plugins:[{name:'synthetic-boundaries',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:root}));}}]});
const css = ['public/folio.css','styles/experience.css','styles/platform.css','styles/clinical-experience.css'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://127.0.0.1');
  if (['/development.js','/production.js'].includes(url.pathname)){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(temp,path.basename(url.pathname))));}
  else if(url.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end('@font-face{font-family:FolioQA;src:url(/font.woff2);font-weight:200 800}:root{--font-folio:FolioQA}'+css);}
  else if(url.pathname==='/font.woff2')res.end(fs.readFileSync(path.join(root,'public/fonts/plus-jakarta-sans-latin.woff2')));
  else{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/${url.pathname.includes('production')?'production':'development'}.js"></script></body></html>`);}
}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.on('listening',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true});
const results = [];
const kinds = ['contacto','cobertura','enmienda','bloqueo'];
const focused = locator => locator.evaluate(el=>el===document.activeElement);
const initial = (page,kind) => kind==='bloqueo'?page.locator('input[type=date]').first():page.getByRole('dialog').locator('input').first();
const values = page => page.getByRole('dialog').locator('input,textarea').evaluateAll(els=>els.map(el=>el.value));
async function fill(page,kind){
  if(kind==='contacto'){await page.getByLabel('Nombre',{exact:true}).fill('Paciente editado');await page.getByLabel('Email (opcional)',{exact:true}).fill('edited@example.invalid');}
  else if(kind==='cobertura'){await page.getByLabel(/Obra social \/ prepaga/).fill('Cobertura sintética');await page.getByLabel(/Plan \(opcional\)/).fill('Plan editado');}
  else if(kind==='enmienda'){await page.getByLabel(/Motivo de la corrección/).fill('Corrección sintética para verificar el diálogo.');await page.getByLabel('Corrección',{exact:true}).fill('Texto de muestra; no pertenece a una persona.');}
  else await page.getByLabel(/Motivo \(opcional\)/).fill('Ausencia sintética');
}
async function close(page,method){
  if(method==='Escape')await page.keyboard.press('Escape');
  else if(method==='Cancelar')await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  else await page.getByRole('dialog').click({position:{x:2,y:2}});
}
try{
  for(const mode of ['development','production'])for(const width of [1440,390])for(const kind of kinds){
    const context=await browser.newContext({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce',serviceWorkers:'block'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin&&route.request().method()==='GET'?route.continue():route.abort('blockedbyclient'));
    const page=await context.newPage();page.setDefaultTimeout(4000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const record={mode,width,kind,pass:false};
    try{
      await page.goto(`${origin}/${mode}?kind=${kind}`);await page.evaluate(()=>document.fonts.ready);
      const opener=page.locator('#opener');
      const closures=[];
      for(const method of ['Escape','Cancelar','fondo']){
        await opener.click();await page.getByRole('dialog').waitFor();assert.equal(await focused(initial(page,kind)),true,'initial field focus');
        const controls=page.getByRole('dialog').locator('button:not([disabled]),input:not([disabled]),textarea:not([disabled])');
        await controls.last().focus();await page.keyboard.press('Tab');assert.equal(await focused(controls.first()),true,'Tab wraps to first control');
        await page.keyboard.press('Shift+Tab');assert.equal(await focused(controls.last()),true,'Shift+Tab wraps to last control');
        await close(page,method);await page.getByRole('dialog').waitFor({state:'hidden'});
        const restored=await focused(opener);closures.push({method,restored});assert.equal(restored,!before,'return focus');
      }
      record.closures=closures;
      await opener.click();await fill(page,kind);
      if(kind==='bloqueo'){
        await page.getByRole('button',{name:'Franja horaria',exact:true}).click();
        assert.equal(await page.getByRole('button',{name:'Franja horaria',exact:true}).getAttribute('aria-pressed'),'true');
        if(!before)assert.equal(await focused(page.getByRole('button',{name:'Franja horaria',exact:true})),true,'mode change keeps user focus');
        await page.locator('input[type=time]').first().fill('10:30');await page.locator('input[type=time]').last().fill('12:00');
        assert.equal(await page.locator('input[type=date]').inputValue(),'2026-09-21');
      }
      const retained=await values(page);await page.getByRole('dialog').locator('button[type=submit]').click();
      await page.waitForFunction(()=>qa.calls.length===1);await page.getByRole('dialog').locator('button[aria-busy=true]').waitFor();
      assert.equal(await page.getByRole('button',{name:'Cancelar',exact:true}).isDisabled(),true);
      await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1,'pending Escape is blocked');
      await page.getByRole('dialog').click({position:{x:2,y:2}});
      if(before){await page.getByRole('dialog').waitFor({state:'hidden'});record.pendingBackdropCloses=true;}
      else{
        assert.equal(await page.getByRole('dialog').count(),1,'pending backdrop is blocked');record.pendingBackdropCloses=false;
        await page.evaluate(()=>qa.resolve({ok:false,error:{message:'Error sintético. Revisá e intentá nuevamente.'}}));await page.getByRole('alert').waitFor();assert.deepEqual(await values(page),retained,'failed save retains data');
        await page.getByRole('dialog').locator('button[type=submit]').click();await page.waitForFunction(()=>qa.calls.length===2);
        const calls=await page.evaluate(()=>qa.calls);assert.deepEqual(calls[1],calls[0],'retry preserves submitted payload');
        if(kind==='bloqueo')assert.deepEqual(calls[1].args,[{modo:'horas',desde:'2026-09-21T10:30:00',hasta:'2026-09-21T12:00:00',motivo:'Ausencia sintética'}]);
        await page.evaluate(()=>qa.resolve({ok:true,data:{turnosEnRango:0,dias:1}}));await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await focused(opener),true,'successful save restores opener');assert.equal(await page.evaluate(()=>qa.refreshes),1);
        record.failedSaveRetainsInput=true;record.retryPayloadIdentical=true;
        if(mode==='production'){
          await opener.click();await fill(page,kind);await initial(page,kind).focus();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          await page.screenshot({path:path.join(evidence,`polish-modal-${kind}-${width}.png`)});
        }
      }
      assert.deepEqual(errors,[]);record.pass=true;
    }catch(error){record.error=error.message;record.pageErrors=errors;}finally{results.push(record);console.log(JSON.stringify(record));await context.close();}
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const report={phase:before?'before':'after',scope:'Real modal components and hook; synthetic server actions; Chromium; development StrictMode and production; reduced motion; loopback only',passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
fs.writeFileSync(path.join(evidence,`polish-modal-focus-${before?'before':'after'}.json`),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failed:report.failed}));if(report.failed)process.exitCode=1;
