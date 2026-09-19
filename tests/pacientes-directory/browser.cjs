/* eslint-disable @typescript-eslint/no-require-imports -- Standalone synthetic browser harness. */
const esbuild = require('esbuild');
const { chromium } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-directory-browser-'));
const row = (n) => ({ id: `11400000-0000-4000-8000-${String(n).padStart(12,'0')}`, nombre: `Paciente sintético ${n}`, tel: '3515550100', email: '', tipo: 'nuevo', sesiones: 0, ultima: null, proximo: null, tags: [], estado: 'activo', cobertura: null, coberturaPlan: null });
const makePage = (start = 1, count = 50, total = 1205, nextCursor = 'cursor-50') => ({ rows: Array.from({length:count}, (_,i)=>row(start+i)), total, counts: {todos:1205,activos:1205,nuevos:1205,reactivar:0,inactivos:0,alta:0}, coberturas:['Cobertura sintética'], nextCursor, revision:'a'.repeat(32), cutoff:'2026-09-08T00:00:00.123456Z' });
const stubs = {
  'next/navigation': `export const useRouter=()=>({push(){},refresh(){}});`,
  '@/components/ui/toast': `export const useToast=()=>({show(message){window.qa.toasts.push(message)}});`,
  '@/components/hoy/turno-create-modal': `export const TurnoCreateModal=()=>null;`,
  '@/components/pacientes/paciente-create-modal': `export const PacienteCreateModal=()=>null;`,
  '@/components/ui/confirm-dialog': `export const ConfirmDialog=()=>null;`,
  '@/app/(app)/pacientes/directorio-actions': `export function loadDirectoryPage(input){window.qa.calls.push(input);if(!window.qa.hold)return Promise.resolve({ok:true,data:window.qa.server});return new Promise((resolve,reject)=>window.qa.jobs.push({input,resolve,reject}));}`,
};
(async () => {
  for (const mode of ['development','production']) {
    await esbuild.build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{PacientesDir}from'@/components/pacientes/pacientes-dir';window.qa={calls:[],jobs:[],toasts:[],hold:false,server:${JSON.stringify(makePage())}};function App(){const[p,setP]=useState(window.qa.server);window.qa.refresh=next=>{window.qa.server=next;setP(next)};return <PacientesDir initialPage={p}/>};createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`,loader:'tsx',resolveDir:root},bundle:true,platform:'browser',jsx:'automatic',outfile:path.join(output,mode+'.js'),define:{'process.env.NODE_ENV':JSON.stringify(mode)},plugins:[{name:'synthetic-io',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:root}));}}]});
  }
  const server=http.createServer((req,res)=>{
    if(req.url.endsWith('.js')){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(output,path.basename(req.url))));}
    else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/${req.url.includes('production')?'production':'development'}.js"></script></body></html>`);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'&&u.port===String(server.address().port)?route.continue():route.abort();});
  let passed=0;
  try {
    for(const mode of ['development','production']){
      const tab=await context.newPage();
      const errors=[];tab.on('pageerror',e=>errors.push(e.message));
      const reset=async()=>{await tab.goto(`http://127.0.0.1:${server.address().port}/${mode}`);await tab.getByText('Paciente sintético 1',{exact:true}).waitFor();await tab.waitForTimeout(400);await tab.evaluate(()=>{qa.hold=true;qa.calls=[];qa.jobs=[];});};
      const settle=async(page,index=0)=>tab.evaluate(({page,index})=>qa.jobs.splice(index,1)[0].resolve({ok:true,data:page}),{page,index});
      await reset();
      assert.equal(await tab.getByText(/Búsqueda exacta en todos/).count(),1);
      assert.equal(await tab.getByText('1–50 de 1205 · más recientes primero').count(),1);
      await tab.getByRole('button',{name:'Siguiente',exact:true}).click();
      await tab.waitForFunction(()=>qa.jobs.length===1);
      assert.equal(await tab.evaluate(()=>qa.jobs[0].input.cursor),'cursor-50');
      await settle(makePage(51,50,1205,'cursor-100'));
      await tab.getByText('51–100 de 1205 · más recientes primero').waitFor();passed++;

      await reset();
      const input=tab.getByRole('textbox',{name:'Buscar paciente (atajo: /)'});
      await input.fill('Primer nombre completo');await tab.waitForFunction(()=>qa.jobs.length===1);
      await input.fill('Segundo nombre completo');await tab.waitForFunction(()=>qa.jobs.length===2);
      await settle(makePage(1205,1,1,null),1);await tab.getByText('Paciente sintético 1205',{exact:true}).waitFor();
      await settle(makePage(999,1,1,null));await tab.waitForTimeout(50);
      assert.equal(await tab.getByText('Paciente sintético 999',{exact:true}).count(),0);passed++;

      await reset();await input.fill('Falla sintética');await tab.waitForFunction(()=>qa.jobs.length===1);
      await tab.evaluate(()=>qa.jobs.shift().reject(new Error('SYNTHETIC PRIVATE ERROR')));
      await tab.getByRole('button',{name:'Reintentar',exact:true}).waitFor();
      assert.equal(await tab.getByText('Paciente sintético 1',{exact:true}).count(),0);
      assert.equal((await tab.locator('body').innerText()).includes('PRIVATE ERROR'),false);
      await tab.getByRole('button',{name:'Reintentar',exact:true}).click();await tab.waitForFunction(()=>qa.jobs.length===1);
      await settle(makePage(1205,1,1,null));await tab.getByText('Paciente sintético 1205',{exact:true}).waitFor();passed++;

      await reset();await tab.getByRole('combobox',{name:'Filtrar por cobertura'}).selectOption('Cobertura sintética');
      await tab.waitForFunction(()=>qa.jobs.length===1);
      assert.equal(await tab.evaluate(()=>qa.jobs[0].input.coverage),'Cobertura sintética');
      assert.equal(await tab.evaluate(()=>qa.jobs[0].input.cursor),null);
      await settle(makePage(1204,2,2,null));await tab.getByText('Paciente sintético 1204',{exact:true}).waitFor();
      assert.equal(await tab.getByText('Paciente sintético 1205',{exact:true}).count(),1);passed++;

      await reset();await input.fill('Filtro conservado');await tab.waitForFunction(()=>qa.jobs.length===1);await settle(makePage(1205,1,1,null));
      await tab.getByText('Paciente sintético 1205',{exact:true}).waitFor();
      await tab.evaluate(p=>qa.refresh(p),makePage(300,50,1205,'different-ssr'));
      await tab.waitForFunction(()=>qa.jobs.length===1);
      assert.equal(await tab.evaluate(()=>qa.jobs[0].input.query),'Filtro conservado');
      assert.equal(await tab.getByText('Paciente sintético 300',{exact:true}).count(),0);
      await settle(makePage(1204,1,1,null));await tab.getByText('Paciente sintético 1204',{exact:true}).waitFor();passed++;
      assert.deepEqual(errors,[]);await tab.close();
    }
    console.log(`Directory browser: ${passed} PASS (development + production React, synthetic loopback only)`);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
