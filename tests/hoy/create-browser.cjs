/* eslint-disable @typescript-eslint/no-require-imports -- Isolated browser smoke. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const { chromium } = require('@playwright/test');
const cwd = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-create-smoke-'));
const entry = `import React,{StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';
import{TurnoCreateModal}from'@/components/hoy/turno-create-modal';import{ToastProvider}from'@/components/ui/toast';
window.qa={calls:[],jobs:[],created:[],closed:0,refreshes:0,settle(value){this.jobs.shift().resolve(value)},reject(){this.jobs.shift().reject(Error('synthetic transport failure'))}};
function App(){const[open,setOpen]=useState(true);return <ToastProvider>{open?<TurnoCreateModal origen='WALK_IN' defaultInicio='2026-09-09T15:00:00Z' onClose={()=>{qa.closed++;setOpen(false)}} onCreated={id=>{qa.created.push(id);setOpen(false)}}/>:<p>Agenda sintética</p>}</ToastProvider>};
createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);`;
const stubs = {
    'next/navigation': 'export const useRouter=()=>({refresh(){qa.refreshes++},push(url){qa.destination=url}});',
    '@/app/(app)/hoy/actions': `export async function loadCreateTurnoMeta(){if(location.search.includes('metadata-failure'))throw Error('synthetic metadata failure');return {ok:true,data:{servicios:[{id:'synthetic-service',nombre:'Consulta sintética',duracionMin:30}],pacientes:[],profesionales:[{id:'synthetic-member',displayName:'Profesional sintético'}],sessionMemberId:'synthetic-member'}}};export async function searchPacientesAction(){return {ok:true,data:[]}};export function createTurnoAction(input){qa.calls.push(input);return new Promise((resolve,reject)=>qa.jobs.push({resolve,reject}))}`,
};
(async () => {
    for (const mode of ['development', 'production']) await esbuild.build({stdin:{contents:entry,resolveDir:cwd,loader:'tsx'},bundle:true,outfile:path.join(dir,mode+'.js'),platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':JSON.stringify(mode)},tsconfig:path.join(cwd,'tsconfig.json'),plugins:[{name:'synthetic-server',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:cwd}));}}]});
    const server=http.createServer((req,res)=>{
        const url=new URL(req.url,'http://127.0.0.1');
        if(['/development.js','/production.js'].includes(url.pathname)){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(dir,path.basename(url.pathname))));}
        else if(url.pathname==='/folio.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(cwd,'public/folio.css')));}
        else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><head><meta charset="utf-8"><link rel="stylesheet" href="/folio.css"></head><body><div id="root"></div><script src="/${url.pathname.includes('production')?'production':'development'}.js"></script></body></html>`);}
    }).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.on('listening',resolve));
    const browser=await chromium.launch({headless:true});
    const context=await browser.newContext({timezoneId:'America/Argentina/Cordoba',serviceWorkers:'block'});
    await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'&&u.port===String(server.address().port)?route.continue():route.abort('blockedbyclient');});
    const results=[];
    try {
        for(const mode of ['development','production']){
            const run=async(name,scenario)=>{const page=await context.newPage();page.setDefaultTimeout(4000);const errors=[];page.on('pageerror',e=>errors.push(e.message));try{await scenario(page);assert.deepEqual(errors,[]);results.push({mode,case:name,pass:true});}catch(error){results.push({mode,case:name,pass:false,error:error.message.slice(0,700),pageErrors:errors});}finally{console.log(JSON.stringify(results.at(-1)));await page.close();}};
            const open=async(page,query='')=>{await page.goto(`http://127.0.0.1:${server.address().port}/${mode}${query}`);};
            const fill=async page=>{await open(page);await page.getByPlaceholder('Nombre',{exact:true}).fill('Paciente');await page.getByPlaceholder('Apellido',{exact:true}).fill('Sintético');await page.getByPlaceholder('Teléfono',{exact:true}).fill('3510000000');};
            await run('new walk-in: double click submits once, preserves Cordoba time and reports one success',async page=>{
                await fill(page);await page.getByRole('button',{name:'Crear turno',exact:true}).evaluate(el=>{el.click();el.click()});
                assert.equal(await page.evaluate(()=>qa.calls.length),1);
                assert.equal(await page.evaluate(()=>qa.calls[0].origen),'WALK_IN');assert.equal(await page.evaluate(()=>qa.calls[0].inicio),'2026-09-09T15:00:00.000Z');
                await page.evaluate(()=>qa.settle({ok:true,data:{turnoId:'synthetic-turno',pacienteId:'synthetic-patient'}}));
                await page.getByText('Agenda sintética',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>qa.created.length),1);assert.equal(await page.locator('.fi-toast').count(),1);
            });
            await run('pending creation cannot be dismissed through backdrop, Escape or Cancel',async page=>{
                await fill(page);await page.getByRole('button',{name:'Crear turno',exact:true}).evaluate(el=>{el.click();document.querySelector('[role="dialog"]').click();el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});
                assert.equal(await page.evaluate(()=>qa.closed),0);assert.equal(await page.evaluate(()=>qa.calls.length),1);
                await page.getByRole('dialog').evaluate(el=>el.click());assert.equal(await page.getByRole('dialog').count(),1);
                await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.getByRole('button',{name:'Cancelar',exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>qa.closed),0);
            });
            await run('metadata transport failure leaves loading and shows recoverable error',async page=>{
                await open(page,'?metadata-failure');await page.getByRole('alert').waitFor({timeout:4000});assert.equal(await page.getByText('Cargando datos…',{exact:true}).count(),0);
            });
            await run('metadata retry recovers the same modal after connection returns',async page=>{
                await open(page,'?metadata-failure');await page.getByRole('alert').waitFor();
                await page.evaluate(()=>history.replaceState(null,'',location.pathname));await page.getByRole('button',{name:'Reintentar',exact:true}).click();
                await page.getByPlaceholder('Nombre',{exact:true}).waitFor();assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.getByText('Cargando datos…',{exact:true}).count(),0);
                assert.equal(await page.evaluate(()=>qa.closed),0);assert.equal(await page.evaluate(()=>qa.calls.length),0);
            });
            await run('lost creation response keeps form, announces uncertainty and prevents a blind duplicate',async page=>{
                await fill(page);await page.getByRole('button',{name:'Crear turno',exact:true}).click();await page.evaluate(()=>qa.reject());
                await page.getByRole('alert').waitFor({timeout:4000});assert.match(await page.getByRole('alert').innerText(),/confirmar|agenda/i);
                assert.equal(await page.getByPlaceholder('Nombre',{exact:true}).inputValue(),'Paciente');assert.equal(await page.getByRole('button',{name:'Crear turno',exact:true}).isDisabled(),true);
                await page.getByRole('button',{name:'Crear turno',exact:true}).evaluate(el=>el.click());assert.equal(await page.evaluate(()=>qa.calls.length),1);assert.equal(await page.locator('.fi-toast').count(),0);
            });
            await run('reviewing agenda after lost response refreshes once without repeating creation',async page=>{
                await fill(page);await page.evaluate(()=>history.replaceState(null,'','/pacientes/synthetic-patient'));await page.getByRole('button',{name:'Crear turno',exact:true}).click();await page.evaluate(()=>qa.reject());
                // Later form edits must not redirect recovery to a different visit.
                await page.locator('input[type="datetime-local"]').fill('2026-10-01T12:00');
                await page.getByRole('button',{name:'Revisar agenda',exact:true}).click();await page.getByText('Agenda sintética',{exact:true}).waitFor();
                assert.equal(await page.evaluate(()=>qa.refreshes),1);assert.equal(await page.evaluate(()=>qa.closed),1);assert.equal(await page.evaluate(()=>qa.calls.length),1);assert.equal(await page.evaluate(()=>qa.created.length),0);assert.equal(await page.locator('.fi-toast').count(),0);
                assert.equal(await page.evaluate(()=>qa.destination),'/calendario?w=2026-09-09&mes=2026-09&prof=synthetic-member');
            });
            await run('a confirmed validation failure permits correction and a new attempt',async page=>{
                await fill(page);await page.getByRole('button',{name:'Crear turno',exact:true}).click();await page.evaluate(()=>qa.settle({ok:false,error:{code:'validation',message:'Revisá la duración sintética'}}));
                await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'Crear turno',exact:true}).click();assert.equal(await page.evaluate(()=>qa.calls.length),2);
                await page.evaluate(()=>qa.settle({ok:true,data:{turnoId:'synthetic-turno',pacienteId:'synthetic-patient'}}));await page.getByText('Agenda sintética',{exact:true}).waitFor();
            });
        }
    } finally {await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
    const artifact=path.join(dir,'results.json');fs.writeFileSync(artifact,JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,artifact},null,2));
    if(results.some(r=>!r.pass))process.exitCode=1;
})().catch(error=>{console.error(error);process.exit(1)});
