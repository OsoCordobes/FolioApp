/* eslint-disable @typescript-eslint/no-require-imports -- Real React UI with isolated server boundaries. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const { chromium } = require('@playwright/test');
const cwd = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-archive-smoke-'));
const patientId = '00000000-0000-4000-8000-000000000123';
const entry = `import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import{ClinicalArchive}from'@/components/clinical-archive/archive';
window.qa={calls:[],jobs:[],settle(value){this.jobs.shift().resolve(value)},reject(){this.jobs.shift().reject(Error('synthetic interruption'))}};
createRoot(document.getElementById('root')).render(<StrictMode><main style={{maxWidth:960,margin:'0 auto',padding:24}}><h1>Archivo clínico</h1><ClinicalArchive initialPage={{patients:[{id:'${patientId}',name:'Paciente Sintético'}],total:70,nextCursor:'first-cursor'}}/></main></StrictMode>);`;
(async () => {
  for (const mode of ['development', 'production']) await esbuild.build({ stdin: { contents: entry, resolveDir: cwd, loader: 'tsx' }, bundle: true,
    outfile: path.join(dir, mode+'.js'), platform: 'browser', jsx: 'automatic', define: {'process.env.NODE_ENV':JSON.stringify(mode)}, tsconfig:path.join(cwd,'tsconfig.json'),
    plugins:[{name:'archive-server-boundary',setup(b){b.onResolve({filter:/^@\/app\/archivo-clinico\/actions$/},a=>({path:a.path,namespace:'stub'}));
      b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export function searchClinicalArchive(input){qa.calls.push(input);return new Promise((resolve,reject)=>qa.jobs.push({resolve,reject}))}',loader:'js'}));}}] });
  const server = http.createServer((req,res) => {
    const pathname = new URL(req.url,'http://127.0.0.1').pathname;
    if (/^\/(development|production)\.(js|css)$/.test(pathname)) { res.setHeader('Content-Type',pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/css'); res.end(fs.readFileSync(path.join(dir,path.basename(pathname)))); }
    else if (pathname==='/folio.css') { res.setHeader('Content-Type','text/css'); res.end(fs.readFileSync(path.join(cwd,'public/folio.css'))); }
    else { const mode=pathname.includes('production')?'production':'development'; res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/folio.css"><link rel="stylesheet" href="/${mode}.css"></head><body><div id="root"></div><script src="/${mode}.js"></script></body></html>`); }
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.on('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true});
  const results=[];
  try {
    for(const mode of ['development','production']) {
      async function run(name,scenario) {
        const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
        await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
        const page=await context.newPage(); page.setDefaultTimeout(5000); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
        try { await page.goto(`${origin}/${mode}`); await scenario(page); assert.deepEqual(errors,[]); results.push({mode,case:name,pass:true}); }
        catch(error){results.push({mode,case:name,pass:false,error:error.message.slice(0,700)});}
        finally{console.log(JSON.stringify(results.at(-1)));await context.close();}
      }
      await run('search submits once and keeps patient identifiers out of browser URL',async page=>{
        await page.getByLabel('Buscar paciente').fill('Documento sintético');
        await page.getByRole('button',{name:'Buscar',exact:true}).evaluate(button=>{button.click();button.click();});
        assert.equal(await page.evaluate(()=>qa.calls.length),1); assert.equal(page.url(),`${origin}/${mode}`);
        await page.evaluate(()=>qa.settle({ok:true,data:{patients:[],total:0,nextCursor:null}}));
        await page.getByRole('heading',{name:'0 pacientes en la búsqueda'}).waitFor();
        assert.equal(await page.getByLabel('Buscar paciente').inputValue(),'Documento sintético');
      });
      await run('interrupted search preserves previous patients and typed input',async page=>{
        await page.getByLabel('Buscar paciente').fill('Otra búsqueda');await page.getByRole('button',{name:'Buscar',exact:true}).click();
        await page.evaluate(()=>qa.reject());await page.getByRole('status').filter({hasText:'resultados anteriores'}).waitFor();
        await page.getByText('Paciente Sintético',{exact:true}).waitFor();assert.equal(await page.getByLabel('Buscar paciente').inputValue(),'Otra búsqueda');
      });
      await run('pagination remains bound to submitted search despite later input edits',async page=>{
        await page.getByLabel('Buscar paciente').fill('Nombre original');await page.getByRole('button',{name:'Buscar',exact:true}).click();
        await page.evaluate(()=>qa.settle({ok:true,data:{patients:[],total:70,nextCursor:'next-signed'}}));
        await page.getByRole('heading',{name:'70 pacientes en la búsqueda'}).waitFor();
        await page.getByLabel('Buscar paciente').fill('Nombre editado');await page.getByRole('button',{name:'Siguiente página'}).click();
        assert.deepEqual(await page.evaluate(()=>qa.calls[1]),{query:'Nombre original',cursor:'next-signed'});
      });
      await run('a complete PDF response creates exactly one download',async page=>{
        let requests=0;await page.route('**/api/pacientes/**/ficha-pdf',route=>{requests++;return route.fulfill({status:200,contentType:'application/pdf',body:'%PDF-1.4\nSynthetic UI fixture\n%%EOF'});});
        const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar PDF de Paciente Sintético',exact:true}).click();
        assert.equal((await downloaded).suggestedFilename(),'folio-historia-00000000.pdf');assert.equal(requests,1);
        await page.getByRole('status').filter({hasText:'Archivo preparado'}).waitFor();
      });
      for(const [status,type,message] of [[403,'application/json','permiso'],[413,'application/json','excede'],[200,'text/html','interrumpió'],[302,'text/html','sesión necesita']]) {
        await run(`HTTP ${status} ${type} never downloads a false clinical document`,async page=>{
          const downloads=[];page.on('download',value=>downloads.push(value));
          await page.route('**/api/pacientes/**/ficha-pdf',route=>route.fulfill({status,contentType:type,headers:status===302?{location:'/login'}:{},body:'synthetic'}));
          await page.getByRole('button',{name:'Descargar PDF de Paciente Sintético',exact:true}).click();
          await page.getByRole('status').filter({hasText:message}).waitFor();assert.equal(downloads.length,0);
        });
      }
      await run('mobile layout fits and download controls remain keyboard-accessible',async page=>{
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        for(const button of await page.getByRole('button').all())assert.ok((await button.boundingBox()).height>=44);
        await page.getByLabel('Buscar paciente').focus();await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Buscar',exact:true}).evaluate(el=>el===document.activeElement),true);
        await page.screenshot({path:path.join(dir,mode+'-mobile.png'),fullPage:true});
      });
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({artifacts:dir,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length}));}
  if(results.some(result=>!result.pass))process.exitCode=1;
})().catch(()=>{console.error('isolated_archive_smoke_failed');process.exitCode=1;});
