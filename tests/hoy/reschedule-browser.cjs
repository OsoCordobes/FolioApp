/* eslint-disable @typescript-eslint/no-require-imports -- Isolated browser smoke. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const { chromium } = require('@playwright/test');
const cwd = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-reschedule-smoke-'));
const entry = `import React,{StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';
import{TurnoReagendarModal}from'@/components/hoy/turno-reagendar-modal';import{PedidoModal}from'@/components/calendario/pedido-modal';import{ToastProvider}from'@/components/ui/toast';
window.qa={calls:[],jobs:[],done:[],closed:0,refreshes:0,settle(v){this.jobs.shift().resolve(v)},reject(){this.jobs.shift().reject(Error('synthetic transport'))}};
const params=new URLSearchParams(location.search),timezone=params.get('tz')||'America/Argentina/Cordoba';
const pedido={id:'11900000-0000-4000-8000-000000000300',nombre:'Pedido sintético',tel:'0000000000',canal:'web',estado:'pendiente',nuevo:true,profesionalId:'11900000-0000-4000-8000-000000000011',servicioId:'11900000-0000-4000-8000-000000000021',fecha:null,hora:null,dur:30,servicio:'Consulta sintética',precio:0,motivo:'',recibidoHace:'ahora'};
function App(){const[open,setOpen]=useState(true);const close=()=>{qa.closed++;setOpen(false)};return <ToastProvider>{open?(params.has('pedido')?<PedidoModal pedido={pedido} timezone={timezone} onClose={close} onResolved={()=>{qa.done.push(pedido.id);setOpen(false)}}/>:<TurnoReagendarModal timezone={timezone} turnoId='11900000-0000-4000-8000-000000000100' profesionalId='11900000-0000-4000-8000-000000000011' pacienteNombre='Paciente Sintético' servicioNombre='Consulta sintética' inicioIso={params.get('inicio')||'2026-10-11T12:00:00Z'} duracionMin={30} onClose={close} onDone={id=>{qa.done.push(id);setOpen(false)}}/>):<p>Agenda sintética</p>}</ToastProvider>};
createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);`;
const stubs = {
  'next/navigation': 'export const useRouter=()=>({refresh(){qa.refreshes++},push(url){qa.destination=url}});',
  '@/app/(app)/hoy/actions': 'export function reagendarTurnoAction(input){qa.calls.push(input);return new Promise((resolve,reject)=>qa.jobs.push({resolve,reject}))}',
  '@/app/(app)/calendario/actions': 'export function aceptarPedidoConHorarioAction(pedidoId,input){qa.calls.push({pedidoId,...input});return new Promise((resolve,reject)=>qa.jobs.push({resolve,reject}))} export function aceptarPedidoAction(){throw Error("Unexpected direct accept")} export function rechazarPedidoAction(){throw Error("Unexpected rejection")} export function listServiciosActivosAction(){throw Error("Unexpected service read")}',
};
(async () => {
  for (const mode of ['development', 'production']) await esbuild.build({stdin:{contents:entry,resolveDir:cwd,loader:'tsx'},bundle:true,outfile:path.join(dir,`${mode}.js`),platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':JSON.stringify(mode)},plugins:[{name:'synthetic-boundaries',setup(build){build.onResolve({filter:/^(next\/navigation|@\/app\/\(app\)\/(hoy|calendario)\/actions)$/},args=>({path:args.path,namespace:'stub'}));build.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(['/development.js','/production.js'].includes(url.pathname)){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(dir,path.basename(url.pathname))));}
    else if(url.pathname==='/folio.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(cwd,'public/folio.css')));}
    else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><head><meta charset="utf-8"><link rel="stylesheet" href="/folio.css"></head><body><div id="root"></div><script src="/${url.pathname.includes('production')?'production':'development'}.js"></script></body></html>`);}
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.on('listening',resolve));
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({timezoneId:'Pacific/Auckland',serviceWorkers:'block'});
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'&&u.port===String(server.address().port)?route.continue():route.abort('blockedbyclient');});
  const results=[];
  try {
    for(const mode of ['development','production']){
      const run=async(name,scenario,query='')=>{const page=await context.newPage();page.setDefaultTimeout(4000);const errors=[];page.on('pageerror',e=>errors.push(e.message));try{await page.clock.setFixedTime(new Date('2026-09-13T02:46:00Z'));await page.goto(`http://127.0.0.1:${server.address().port}/${mode}${query}`);await page.getByRole('dialog').waitFor();await scenario(page);assert.deepEqual(errors,[]);results.push({mode,case:name,pass:true});}catch(error){results.push({mode,case:name,pass:false,error:error.message.slice(0,700),pageErrors:errors});}finally{console.log(JSON.stringify(results.at(-1)));await page.close();}};
      const submit=page=>page.getByRole('button',{name:'Reagendar turno',exact:true}).click();
      await run('double click commits one attempt and pending input cannot be changed or dismissed',async page=>{
        await page.getByLabel('Nueva fecha y hora').fill('2026-10-12T14:30');
        await page.getByRole('button',{name:'Reagendar turno',exact:true}).evaluate(el=>{el.click();el.click();document.querySelector('[role="dialog"]').click();});
        assert.equal(await page.evaluate(()=>qa.calls.length),1);assert.equal(await page.evaluate(()=>qa.closed),0);
        assert.equal(await page.getByLabel('Nueva fecha y hora').isDisabled(),true);assert.equal(await page.getByLabel('Duración (min)').isDisabled(),true);
        await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);
        assert.equal(await page.getByRole('button',{name:'Cancelar',exact:true}).isDisabled(),true);
        assert.equal(await page.evaluate(()=>qa.calls[0].nuevoInicio),'2026-10-12T17:30:00.000Z');
        await page.evaluate(()=>qa.settle({ok:true,data:{nuevoTurnoId:'11900000-0000-4000-8000-000000000201'}}));
        await page.getByText('Agenda sintética',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>qa.done.length),1);
        assert.equal(await page.locator('.fi-toast').count(),1);assert.match(await page.locator('.fi-toast').innerText(),/12\/10 14:30/);
      });
      await run('known transaction rejection preserves input and correction uses a new operation',async page=>{
        await submit(page);await page.evaluate(()=>qa.settle({ok:false,error:{code:'conflict',message:'Ese horario ya está ocupado.'}}));
        await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Nueva fecha y hora').inputValue(),'2026-10-11T09:00');
        await page.getByLabel('Nueva fecha y hora').fill('2026-10-12T11:00');await submit(page);
        assert.equal(await page.evaluate(()=>qa.calls.length),2);assert.equal(await page.evaluate(()=>qa.calls[0].operacionId!==qa.calls[1].operacionId),true);
      });
      await run('lost response and denied recovery retain exactly the same operation and freeze inputs',async page=>{
        await submit(page);await page.evaluate(()=>qa.reject());await page.getByRole('alert').waitFor();
        assert.equal(await page.getByLabel('Nueva fecha y hora').isDisabled(),true);
        assert.equal(await page.getByRole('button',{name:'Reagendar turno',exact:true}).count(),0);
        await page.getByRole('button',{name:'Comprobar cambio',exact:true}).click();
        await page.evaluate(()=>qa.settle({ok:false,error:{code:'forbidden',message:'Revoked'}}));
        await page.getByRole('button',{name:'Comprobar cambio',exact:true}).click();
        assert.equal(await page.evaluate(()=>qa.calls.every(call=>JSON.stringify(call)===JSON.stringify(qa.calls[0]))),true);
        await page.evaluate(()=>qa.settle({ok:true,data:{nuevoTurnoId:'11900000-0000-4000-8000-000000000201'}}));
        await page.getByText('Agenda sintética',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>qa.done.length),1);
      });
      await run('uncertain result can return to the requested date in the agenda with a refresh',async page=>{
        await page.getByLabel('Nueva fecha y hora').fill('2026-11-05T16:30');await submit(page);
        await page.evaluate(()=>qa.settle({ok:false,error:{code:'network',message:'Unknown'}}));
        await page.getByRole('button',{name:'Ver agenda',exact:true}).click();
        await page.getByText('Agenda sintética',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>qa.destination),'/calendario?w=2026-11-05&mes=2026-11&prof=11900000-0000-4000-8000-000000000011');assert.equal(await page.evaluate(()=>qa.refreshes),1);
      });
      await run('agenda wall-clock default stays exact without the browser offset or rounding',async page=>{
        assert.equal(await page.getByLabel('Nueva fecha y hora').inputValue(),'2026-09-12T23:47');await submit(page);
        assert.equal(await page.evaluate(()=>qa.calls[0].nuevoInicio),'2026-09-13T02:47:00.000Z');
      },'?inicio=2026-09-12T23%3A47');
      await run('midnight uncertainty preserves UTC payload and organization-day toast',async page=>{
        await page.getByLabel('Nueva fecha y hora').fill('2026-09-12T23:50');await submit(page);
        assert.equal(await page.evaluate(()=>qa.calls[0].nuevoInicio),'2026-09-13T02:50:00.000Z');
        await page.evaluate(()=>qa.reject());await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'Comprobar cambio',exact:true}).click();
        assert.equal(await page.evaluate(()=>JSON.stringify(qa.calls[0])===JSON.stringify(qa.calls[1])),true);
        await page.evaluate(()=>qa.settle({ok:true,data:{nuevoTurnoId:'11900000-0000-4000-8000-000000000201'}}));
        await page.getByText('Agenda sintética',{exact:true}).waitFor();assert.equal(await page.locator('.fi-toast').innerText(),'Turno reagendado · 23:50 · Paciente Sintético');
      });
      await run('uncertain midnight recovery links to the organization date',async page=>{
        await page.getByLabel('Nueva fecha y hora').fill('2026-09-12T23:50');await submit(page);await page.evaluate(()=>qa.reject());
        await page.getByRole('button',{name:'Ver agenda',exact:true}).click();
        assert.equal(await page.evaluate(()=>qa.destination),'/calendario?w=2026-09-12&mes=2026-09&prof=11900000-0000-4000-8000-000000000011');
      });
      for(const [name,value] of [['gap','2026-03-08T02:30'],['fold','2026-11-01T01:30']]){
        await run(`reschedule rejects organization DST ${name} without invoking the action`,async page=>{
          await page.getByLabel('Nueva fecha y hora').fill(value);await submit(page);await page.getByRole('alert').waitFor();
          assert.equal(await page.evaluate(()=>qa.calls.length),0);assert.equal(await page.getByLabel('Nueva fecha y hora').inputValue(),value);
        },'?tz=America%2FNew_York');
      }
      await run('request alternative time uses organization now and preserves a draft across view changes',async page=>{
        await page.getByRole('button',{name:'Elegir horario y aceptar',exact:true}).click();
        assert.equal(await page.getByLabel('Fecha y hora del turno').inputValue(),'2026-09-12T23:50');
        await page.getByLabel('Fecha y hora del turno').fill('2026-09-12T09:00');await page.getByRole('button',{name:'Volver',exact:true}).click();
        await page.getByRole('button',{name:'Elegir horario y aceptar',exact:true}).click();assert.equal(await page.getByLabel('Fecha y hora del turno').inputValue(),'2026-09-12T09:00');
        await page.getByRole('button',{name:'Aceptar y crear turno',exact:true}).click();assert.equal(await page.evaluate(()=>qa.calls[0].fechaHora),'2026-09-12T12:00:00.000Z');
        await page.evaluate(()=>qa.settle({ok:true,data:{turnoId:'11900000-0000-4000-8000-000000000201'}}));await page.getByText('Agenda sintética',{exact:true}).waitFor();
      },'?pedido=1');
      for(const [name,value] of [['gap','2026-03-08T02:30'],['fold','2026-11-01T01:30']]){
        await run(`request rejects organization DST ${name} as an editable form error`,async page=>{
          await page.getByRole('button',{name:'Elegir horario y aceptar',exact:true}).click();await page.getByLabel('Fecha y hora del turno').fill(value);
          await page.getByRole('button',{name:'Aceptar y crear turno',exact:true}).click();await page.getByRole('alert').waitFor();
          assert.equal(await page.evaluate(()=>qa.calls.length),0);assert.equal(await page.getByLabel('Fecha y hora del turno').inputValue(),value);
          await page.getByLabel('Fecha y hora del turno').fill('2026-07-01T09:00');await page.getByRole('button',{name:'Aceptar y crear turno',exact:true}).click();
          assert.equal(await page.evaluate(()=>qa.calls[0].fechaHora),'2026-07-01T13:00:00.000Z');
        },'?pedido=1&tz=America%2FNew_York');
      }
    }
  } finally {await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
  const artifact=path.join(dir,'results.json');fs.writeFileSync(artifact,JSON.stringify(results,null,2));
  console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,artifact},null,2));
  if(results.some(r=>!r.pass))process.exitCode=1;
})().catch(error=>{console.error(error);process.exit(1)});
