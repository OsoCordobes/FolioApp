/* eslint-disable @typescript-eslint/no-require-imports -- Isolated real React/browser harness. */
const path=require('node:path'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const esbuild=require('esbuild'),{chromium}=require('@playwright/test');
const cwd=path.resolve(__dirname,'../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'folio-close-browser-'));
const entry=`import React,{StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';import{Dashboard}from'@/components/hoy/dashboard';import{ToastProvider}from'@/components/ui/toast';
const turno={id:'12000000-0000-4000-8000-000000000001',pacienteId:'patient',hora:'12:00',servicio:'Consulta sintética',estado:'atendiendo',precio:120,duracionMin:25,postVisita:{guardada:false}};
window.qa={calls:[],jobs:[],refreshes:0,navigations:0,status:{turnoId:turno.id,estado:'ATENDIENDO',origen:null,closedAt:null,clasificacion:null,pago:null,puedeRegistrar:true},finish(result){this.jobs.shift().resolve(result)},reject(){this.jobs.shift().reject(Error('synthetic network loss'))}};
qa.receipt=(patch={})=>{const input=qa.calls.find(c=>c.name==='CLOSE'||c.name==='RESOLVE').input;const decision=input.cobro;const pago=decision?.montoCents>0?{id:'12000000-0000-4000-8000-000000000050',montoCents:decision.montoCents,metodo:decision.metodo,estado:decision.pagado?'PAGADO':'PENDIENTE',pagadoTs:decision.pagado?'2026-09-12T12:00:00Z':null,updatedAt:'2026-09-12T12:00:00Z'}:null;return {turnoId:turno.id,operationId:input.operacionId,estado:'CERRADO',origen:'AGENDA',closedAt:'2026-09-12T12:00:00Z',clasificacion:pago?'REGISTRADO':decision?'SIN_CARGO':'REQUIERE_REGISTRO',pago,pagoOrigen:pago?'CREADO':decision?'SIN_CARGO':'SIN_DECISION',puedeRegistrar:true,...patch}};
function App(){const[rows,setRows]=useState([turno]),[cap,setCap]=useState(true);qa.refresh=(patch)=>setRows(Array.isArray(patch)?patch:[{...turno,...patch}]);qa.role=(value)=>{qa.status={...qa.status,puedeRegistrar:value};setCap(value)};return <ToastProvider><Dashboard initialTurnos={rows} pacientes={{patient:{id:'patient',nombre:'Paciente sintético',edad:30,tel:''}}} fechaIso='2026-09-12' fechaLarga='sábado' fechaAnio={2026} nowIso='2026-09-12T12:00:00Z' timezone='UTC' canRegistrarCobro={cap}/></ToastProvider>};createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);`;
const stubs={
 '@/components/hoy/turno-list': `import React from 'react';import{TurnoList as Actual}from ${JSON.stringify(path.join(cwd,'components/hoy/turno-list.tsx'))};export const TurnoList=props=>{qa.state=props.turnos;return <Actual {...props}/>}`,
 'next/navigation':`export const useRouter=()=>({push(){qa.navigations++},refresh(){qa.refreshes++}})`,
 '@/app/(app)/hoy/actions':`const write=(name,input)=>{qa.calls.push({name,input});return new Promise((resolve,reject)=>qa.jobs.push({resolve,reject}))};export const transitionTurnoAction=input=>write('CLOSE',input);export const resolveTurnoCloseAction=input=>write('RESOLVE',input);export const marcarPagoCobradoAgendaAction=input=>write('SETTLE',input);export const getTurnoCloseReceiptAction=input=>write('PROBE',input);export const getTurnoCloseStatusAction=async()=>{qa.statusReads=(qa.statusReads??0)+1;if(qa.holdStatus)return new Promise(resolve=>(qa.readJobs??=[]).push(resolve));return qa.statusError?{ok:false,error:{message:'No se pudo leer',mutationOutcome:'uncertain'}}:{ok:true,data:qa.status}};`,
 '@/app/(app)/hoy/caller-actions':`export const issueCallerCodeAction=()=>{throw Error('Unexpected caller code in close harness')};export const callWaitingCodeAction=()=>{throw Error('Unexpected caller call in close harness')};`,
 '@/lib/use-agenda-refresh':`export const useAgendaAutoRefresh=()=>({status:'active',retry(){}})`,
 '@/components/agenda/agenda-sync-notice':`export const AgendaSyncNotice=()=>null`,
 '@/components/hoy/turno-create-modal':`export const TurnoCreateModal=()=>null`,
 '@/components/hoy/turno-reagendar-modal':`export const TurnoReagendarModal=()=>null`,
 '@/components/agenda/prof-filter-chips':`export const ProfFilterChips=()=>null`,
};
(async()=>{
 for(const mode of ['development','production'])await esbuild.build({stdin:{contents:entry,resolveDir:cwd,loader:'tsx'},bundle:true,outfile:path.join(dir,mode+'.js'),platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':JSON.stringify(mode)},tsconfig:path.join(cwd,'tsconfig.json'),plugins:[{name:'boundaries',setup(build){build.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:null);build.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:cwd}));}}]});
 const server=http.createServer((req,res)=>{if(req.url.endsWith('.js')){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(dir,req.url.slice(1))));}else if(req.url==='/folio.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(cwd,'public/folio.css')));}else res.end(`<html><head><link rel="stylesheet" href="/folio.css"></head><body><div id="root"></div><script src="/${req.url.includes('production')?'production':'development'}.js"></script></body></html>`)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});const results=[];
 try{for(const mode of ['development','production']){
  async function run(name,fn){const page=await browser.newPage();page.setDefaultTimeout(5000);const errors=[];page.on("pageerror",error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${server.address().port}/${mode}`);try{await fn(page);assert.deepEqual(errors,[]);results.push({mode,name,pass:true});}catch(e){results.push({mode,name,pass:false,error:e.message});}finally{await page.close();}}
  await run('pending close retains fields and dialog across closed-row refresh',async page=>{
   await page.getByRole('button',{name:'Cerrar turno',exact:true}).click();await page.getByLabel('Monto en pesos').fill('175');await page.getByRole('button',{name:'Transferencia',exact:true}).click();await page.getByLabel('Quedó debiendo').check();
   await page.getByRole('button',{name:'Cerrar con deuda',exact:true}).click();
   assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.getByLabel('Monto en pesos').inputValue(),'175');
   await page.evaluate(()=>qa.refresh({estado:'cerrado'}));assert.equal(await page.getByRole('dialog').count(),1);
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.evaluate(()=>qa.calls.length),1);await page.screenshot({path:path.join(dir,mode+'-pending.png')});
  });

  await run('duplicate submits, backdrop and focus trap cannot abandon a pending write',async page=>{
   await page.getByRole('button',{name:'Cerrar turno',exact:true}).click();
   await page.getByRole('button',{name:'Cobrar y cerrar',exact:true}).evaluate(button=>{button.click();button.click();});
   assert.equal(await page.evaluate(()=>qa.calls.length),1);assert.equal(await page.evaluate(()=>qa.state[0].estado),'atendiendo');assert.equal(await page.evaluate(()=>qa.state[0].cobro?.montoCents??null),null);
   await page.getByRole('dialog').evaluate(dialog=>dialog.click());await page.keyboard.press('Escape');await page.keyboard.press('Tab');
   assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.evaluate(()=>document.querySelector('[role="dialog"]').contains(document.activeElement)),true);
   assert.equal(await page.getByLabel('Monto en pesos').isDisabled(),true);assert.equal(await page.getByLabel('Duración real (min)').isDisabled(),true);
  });
  await run('lost response and null probe retain an immutable request for deliberate retry',async page=>{
   await page.getByRole('button',{name:'Cerrar turno',exact:true}).click();await page.getByLabel('Monto en pesos').fill('175');await page.getByRole('button',{name:'Transferencia',exact:true}).click();await page.getByLabel('Quedó debiendo').check();await page.getByRole('button',{name:'Cerrar con deuda',exact:true}).click();
   await page.evaluate(()=>{qa.reject();const r=qa.receipt();qa.refresh({estado:'cerrado',cobro:{id:r.pago.id,estado:'pagado',montoCents:17500,metodo:'TRANSFERENCIA',ts:'2026-09-12T12:02:00Z',updatedAt:'2026-09-12T12:02:00Z'}})});await page.waitForFunction(()=>qa.state[0].cobro?.estado==='pagado');await page.getByRole('button',{name:'Comprobar resultado',exact:true}).click();
   assert.equal(await page.evaluate(()=>qa.calls[1].name),'PROBE');await page.evaluate(()=>qa.finish({ok:true,data:null}));
   await page.getByText('Aún no hay un recibo.',{exact:false}).waitFor();assert.equal(await page.getByLabel('Monto en pesos').inputValue(),'175');assert.equal(await page.getByLabel('Monto en pesos').isDisabled(),true);
   await page.getByRole('button',{name:'Reintentar misma solicitud',exact:true}).click();
   assert.equal(await page.evaluate(()=>JSON.stringify(qa.calls[0].input)===JSON.stringify(qa.calls[2].input)),true);
   assert.equal(await page.evaluate(()=>qa.calls[1].input.operacionId===qa.calls[0].input.operacionId),true);
   await page.evaluate(()=>{const r=qa.receipt();qa.status=Object.fromEntries(Object.entries(r).filter(([key])=>!['operationId','pagoOrigen'].includes(key)));qa.finish({ok:true,data:{cierre:r,pagoRegistrado:true}})});
   await page.getByRole('button',{name:'Listo',exact:true}).waitFor();assert.equal(await page.evaluate(()=>qa.state[0].cobro.montoCents),17500);assert.equal(await page.evaluate(()=>qa.state[0].cobro.estado),'pendiente');
  });
  await run('known rejection preserves fields and correction creates a new operation',async page=>{
   await page.getByRole('button',{name:'Cerrar turno',exact:true}).click();await page.getByRole('button',{name:'Cobrar y cerrar',exact:true}).click();
   await page.evaluate(()=>qa.finish({ok:false,error:{message:'Revisá el importe',mutationOutcome:'rejected'}}));await page.getByLabel('Monto en pesos').fill('190');await page.getByRole('button',{name:'Cobrar y cerrar',exact:true}).click();
   assert.equal(await page.evaluate(()=>qa.calls[0].input.operacionId!==qa.calls[1].input.operacionId),true);assert.equal(await page.evaluate(()=>qa.calls[1].input.cobro.montoCents),19000);
  });
  await run('assistant reviews and settles an existing debt with keyboard without clinical navigation',async page=>{
   await page.evaluate(()=>{qa.status={...qa.status,estado:'CERRADO',origen:'HISTORICO',clasificacion:'REGISTRADO',pago:{id:'12000000-0000-4000-8000-000000000050',montoCents:17500,metodo:'EFECTIVO',estado:'PENDIENTE',pagadoTs:null,updatedAt:'2026-09-12T12:00:00Z'}};qa.refresh({estado:'cerrado'})});
   const review=page.getByRole('button',{name:'Revisar cobro',exact:true});await review.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Marcar cobrado',exact:true}).click();
   assert.equal(await page.evaluate(()=>qa.navigations),0);assert.equal(await page.evaluate(()=>qa.calls[0].name),'SETTLE');assert.equal(await page.evaluate(()=>qa.calls[0].input.operacionId??null),null);
   await page.evaluate(()=>qa.reject());await page.getByRole('button',{name:'Comprobar resultado',exact:true}).click();await page.getByRole('button',{name:'Reintentar misma solicitud',exact:true}).click();
   assert.equal(await page.evaluate(()=>JSON.stringify(qa.calls[0].input)===JSON.stringify(qa.calls[1].input)),true);
   await page.evaluate(()=>{qa.status={...qa.status,pago:{...qa.status.pago,estado:'PAGADO',pagadoTs:'2026-09-12T12:02:00Z',updatedAt:'2026-09-12T12:02:00Z'}};qa.finish({ok:true,data:{turnoId:qa.status.turnoId,alreadyPaid:false,pago:qa.status.pago}})});
   await page.getByRole('button',{name:'Listo',exact:true}).waitFor();assert.equal(await page.evaluate(()=>qa.state[0].cobro.estado),'pagado');assert.equal(await page.evaluate(()=>qa.navigations),0);
  });
  await run('historical unregistered is conservative and resolves free care without duration',async page=>{
   await page.evaluate(()=>{qa.status={...qa.status,estado:'CERRADO',origen:'HISTORICO',clasificacion:'REQUIERE_REGISTRO'};qa.refresh({estado:'cerrado'})});
   await page.getByText('Registro por revisar',{exact:true}).waitFor();assert.equal(await page.getByText('Sin cargo',{exact:true}).count(),0);
   await page.getByRole('button',{name:'Revisar cobro',exact:true}).click();await page.getByLabel('Monto en pesos').fill('0');await page.screenshot({path:path.join(dir,mode+'-recovery.png')});await page.getByRole('button',{name:'Registrar decisión',exact:true}).click();
   assert.equal(await page.evaluate(()=>qa.calls[0].name),'RESOLVE');assert.equal(await page.evaluate(()=>qa.calls[0].input.duracionRealMin??null),null);
   await page.evaluate(()=>{const r=qa.receipt({origen:'HISTORICO',closedAt:null});qa.status=Object.fromEntries(Object.entries(r).filter(([key])=>!['operationId','pagoOrigen'].includes(key)));qa.finish({ok:true,data:r})});
   await page.getByRole('button',{name:'Listo',exact:true}).click();await page.getByText('Sin cargo',{exact:true}).waitFor();
  });
  await run('coordinator closes without financial controls or invented money',async page=>{
   await page.evaluate(()=>qa.role(false));await page.getByRole('button',{name:'Cerrar turno',exact:true}).click();
   await page.getByRole('button',{name:'Cerrar sin registrar cobro',exact:true}).click();assert.equal(await page.getByLabel('Monto en pesos').count(),0);assert.equal(await page.evaluate(()=>qa.calls[0].input.cobro??null),null);
   await page.evaluate(()=>{const r=qa.receipt({puedeRegistrar:false});qa.status=Object.fromEntries(Object.entries(r).filter(([key])=>!['operationId','pagoOrigen'].includes(key)));qa.finish({ok:true,data:{cierre:r,pagoRegistrado:false}})});
   await page.getByRole('button',{name:'Listo',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Revisar cobro',exact:true}).count(),0);assert.equal(await page.evaluate(()=>qa.state[0].cobro?.montoCents??null),null);
  });
  await run('long-open duration requires a correction and stays fixed across retries',async page=>{
   await page.evaluate(()=>qa.refresh({atendiendoDesde:new Date(Date.now()-600*60000).toISOString()}));await page.getByRole('button',{name:'Cerrar turno',exact:true}).click();
   await page.getByText('Revisá la duración:',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Cobrar y cerrar',exact:true}).isDisabled(),true);
   await page.getByLabel('Duración real (min)').fill('0');await page.getByRole('button',{name:'Cobrar y cerrar',exact:true}).click();await page.evaluate(()=>qa.reject());await page.getByRole('button',{name:'Reintentar misma solicitud',exact:true}).click();
   assert.equal(await page.evaluate(()=>qa.calls.every(c=>c.input.duracionRealMin===0)),true);
  });
  await run('status failure cannot grant free care or registration permission',async page=>{
   await page.evaluate(()=>{qa.statusError=true;qa.refresh({estado:'cerrado'})});await page.getByRole('button',{name:'Revisar cobro',exact:true}).click();
   await page.getByText('No pudimos leer el estado actual.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Registrar decisión',exact:true}).count(),0);assert.equal(await page.getByLabel('Monto en pesos').count(),0);assert.equal(await page.getByText('Sin cargo confirmado.',{exact:true}).count(),0);
  });

  await run('late immutable pending receipt cannot downgrade a refreshed paid row',async page=>{
   await page.getByRole('button',{name:'Cerrar turno',exact:true}).click();await page.getByLabel('Quedó debiendo').check();await page.getByRole('button',{name:'Cerrar con deuda',exact:true}).click();
   await page.evaluate(()=>{const r=qa.receipt();qa.status={turnoId:r.turnoId,estado:'CERRADO',origen:'AGENDA',closedAt:r.closedAt,clasificacion:'REGISTRADO',puedeRegistrar:true,pago:{...r.pago,estado:'PAGADO',pagadoTs:'2026-09-12T12:02:00Z',updatedAt:'2026-09-12T12:02:00Z'}};qa.refresh({estado:'cerrado',cobro:{id:r.pago.id,estado:'pagado',ts:qa.status.pago.pagadoTs,montoCents:12000,updatedAt:qa.status.pago.updatedAt,metodo:r.pago.metodo}})});
   await page.waitForFunction(()=>qa.state[0].cobro?.estado==='pagado');await page.evaluate(()=>qa.finish({ok:true,data:{cierre:qa.receipt(),pagoRegistrado:true}}));
   await page.getByRole('button',{name:'Listo',exact:true}).click();assert.equal(await page.evaluate(()=>qa.state[0].cobro.estado),'pagado');
   await page.waitForFunction(()=>document.activeElement?.getAttribute('data-cobro-turno')===qa.state[0].id);
  });
  await run('equal-state contradictory SSR retains last money with review, even a greater timestamp',async page=>{
   await page.evaluate(()=>qa.refresh({estado:'cerrado',cobro:{id:'12000000-0000-4000-8000-000000000050',estado:'pagado',montoCents:17500,ts:'2026-09-12T12:00:00Z',updatedAt:'2026-09-12T12:01:00Z',metodo:'EFECTIVO'}}));await page.waitForFunction(()=>qa.state[0].cobro?.montoCents===17500);
   await page.evaluate(()=>qa.refresh({estado:'cerrado',cobro:{id:'12000000-0000-4000-8000-000000000050',estado:'pendiente',montoCents:9900,ts:null,updatedAt:'2026-09-12T12:05:00Z',metodo:'EFECTIVO'}}));
   await page.getByText('Último importe confirmado · revisar',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>qa.state[0].cobro.estado),'pagado');assert.equal(await page.evaluate(()=>qa.statusReads??0),0);
   await page.evaluate(()=>{qa.status={...qa.status,estado:'CERRADO',origen:'HISTORICO',clasificacion:'REGISTRADO',pago:{id:'12000000-0000-4000-8000-000000000050',estado:'PENDIENTE',montoCents:9900,metodo:'EFECTIVO',pagadoTs:null,updatedAt:'2026-09-12T12:00:00Z'}}});await page.getByRole('button',{name:'Revisar cobro',exact:true}).click();
   await page.getByRole('button',{name:'Marcar cobrado',exact:true}).waitFor();assert.equal(await page.evaluate(()=>qa.state[0].cobro.estado),'pendiente');assert.equal(await page.evaluate(()=>qa.state[0].cobroPorRevisar),false);assert.equal(await page.evaluate(()=>qa.statusReads),1);
  });
  await run('promotion during a lost response uses fresh permission, not old receipt redaction',async page=>{
   await page.evaluate(()=>qa.role(false));await page.getByRole('button',{name:'Cerrar turno',exact:true}).click();await page.getByRole('button',{name:'Cerrar sin registrar cobro',exact:true}).click();await page.evaluate(()=>qa.reject());
   await page.evaluate(()=>{qa.role(true);qa.status={...qa.status,estado:'CERRADO',origen:'AGENDA',closedAt:'2026-09-12T12:00:00Z',clasificacion:'REQUIERE_REGISTRO'}});
   await page.getByRole('button',{name:'Comprobar resultado',exact:true}).click();await page.evaluate(()=>qa.finish({ok:true,data:qa.receipt({puedeRegistrar:false})}));
   await page.getByRole('button',{name:'Actualizar estado',exact:true}).click();await page.getByRole('button',{name:'Registrar decisión',exact:true}).waitFor();assert.equal(await page.getByLabel('Monto en pesos').isEnabled(),true);
  });
  await run('demotion cannot restore financial controls from a historical true receipt',async page=>{
   await page.evaluate(()=>qa.role(false));await page.getByRole('button',{name:'Cerrar turno',exact:true}).click();await page.getByRole('button',{name:'Cerrar sin registrar cobro',exact:true}).click();await page.evaluate(()=>qa.reject());
   await page.getByRole('button',{name:'Comprobar resultado',exact:true}).click();await page.evaluate(()=>{qa.status={...qa.status,estado:'CERRADO',origen:'AGENDA',closedAt:'2026-09-12T12:00:00Z',clasificacion:'REQUIERE_REGISTRO'};qa.finish({ok:true,data:qa.receipt({puedeRegistrar:true})})});
   await page.getByRole('button',{name:'Listo',exact:true}).waitFor();assert.equal(await page.getByLabel('Monto en pesos').count(),0);assert.equal(await page.getByRole('button',{name:'Registrar decisión',exact:true}).count(),0);
  });
  await run('demotion while financial close is uncertain blocks changed intent and monetary retry',async page=>{
   await page.getByRole('button',{name:'Cerrar turno',exact:true}).click();await page.getByRole('button',{name:'Cobrar y cerrar',exact:true}).click();await page.evaluate(()=>qa.reject());await page.evaluate(()=>qa.role(false));
   await page.getByRole('button',{name:'Reintentar misma solicitud',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Reintentar misma solicitud',exact:true}).isDisabled(),true);assert.equal(await page.getByLabel('Monto en pesos').count(),0);
   await page.getByRole('button',{name:'Comprobar resultado',exact:true}).click();await page.evaluate(()=>qa.finish({ok:false,error:{message:'Permiso revocado',mutationOutcome:'rejected'}}));
   await page.getByText('Permiso revocado',{exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.evaluate(()=>qa.calls.filter(c=>c.name==='CLOSE').length),1);
  });

  await run('a rejected retry cannot prove that the earlier uncertain close rolled back',async page=>{
   await page.getByRole('button',{name:'Cerrar turno',exact:true}).click();await page.getByRole('button',{name:'Cobrar y cerrar',exact:true}).click();await page.evaluate(()=>qa.reject());
   await page.getByRole('button',{name:'Reintentar misma solicitud',exact:true}).click();await page.evaluate(()=>qa.finish({ok:false,error:{message:'Permiso revocado en el reintento',mutationOutcome:'rejected'}}));
   await page.getByText('Permiso revocado en el reintento',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Volver',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'Comprobar resultado',exact:true}).count(),1);assert.equal(await page.getByLabel('Monto en pesos').isDisabled(),true);
  });

  await run('status overtaken by SSR cannot grant stale payment controls',async page=>{
   await page.evaluate(()=>{qa.holdStatus=true;qa.status={...qa.status,estado:'CERRADO',origen:'HISTORICO',clasificacion:'REGISTRADO',pago:{id:'12000000-0000-4000-8000-000000000050',estado:'PENDIENTE',montoCents:10000,metodo:'EFECTIVO',pagadoTs:null,updatedAt:'2026-09-12T12:00:00Z'}};qa.refresh({estado:'cerrado'})});
   await page.getByRole('button',{name:'Revisar cobro',exact:true}).click();await page.waitForFunction(()=>qa.readJobs?.length===1);
   await page.evaluate(()=>qa.refresh({estado:'cerrado',cobro:{id:'12000000-0000-4000-8000-000000000050',estado:'pagado',montoCents:10000,metodo:'EFECTIVO',ts:'2026-09-12T12:02:00Z',updatedAt:'2026-09-12T12:02:00Z'}}));await page.waitForFunction(()=>qa.state[0].cobro?.estado==='pagado');
   await page.evaluate(()=>qa.readJobs.shift()({ok:true,data:qa.status}));await page.waitForFunction(()=>!document.querySelector('[role="dialog"]').textContent.includes('Consultando el estado actual'));
   assert.equal(await page.getByRole('button',{name:'Marcar cobrado',exact:true}).count(),0);assert.equal(await page.evaluate(()=>qa.state[0].cobro.estado),'pagado');assert.equal(await page.evaluate(()=>qa.state[0].cobroPorRevisar),true);
  });
  await run('accepted status invalidates after a later contradictory SSR until explicit fresh read',async page=>{
   await page.evaluate(()=>{qa.status={...qa.status,estado:'CERRADO',origen:'HISTORICO',clasificacion:'REGISTRADO',pago:{id:'12000000-0000-4000-8000-000000000050',estado:'PENDIENTE',montoCents:10000,metodo:'EFECTIVO',pagadoTs:null,updatedAt:'2026-09-12T12:00:00Z'}};qa.refresh({estado:'cerrado'})});
   await page.getByRole('button',{name:'Revisar cobro',exact:true}).click();await page.getByRole('button',{name:'Marcar cobrado',exact:true}).waitFor();
   await page.evaluate(()=>qa.refresh([...qa.state,{...qa.state[0],id:'12000000-0000-4000-8000-000000000002',estado:'programado',cobro:undefined}]));
   await page.waitForFunction(()=>qa.state.length===2);assert.equal(await page.getByRole('button',{name:'Marcar cobrado',exact:true}).count(),1);assert.equal(await page.evaluate(()=>qa.statusReads),1);
   await page.evaluate(()=>qa.refresh({estado:'cerrado',cobro:{id:'12000000-0000-4000-8000-000000000050',estado:'pagado',montoCents:10000,metodo:'EFECTIVO',ts:'2026-09-12T12:02:00Z',updatedAt:'2026-09-12T12:02:00Z'}}));await page.waitForFunction(()=>qa.state[0].cobroPorRevisar===true);
   assert.equal(await page.getByRole('button',{name:'Marcar cobrado',exact:true}).count(),0);assert.equal(await page.evaluate(()=>qa.statusReads),1);
   await page.getByText('Hay información nueva del cobro.',{exact:false}).waitFor();assert.equal(await page.getByText('Se cerrará la atención sin registrar un cobro.',{exact:true}).count(),0);
   await page.evaluate(()=>{qa.status={...qa.status,pago:{...qa.status.pago,estado:'PAGADO',pagadoTs:'2026-09-12T12:02:00Z',updatedAt:'2026-09-12T12:02:00Z'}}});
   await page.getByRole('button',{name:'Actualizar estado',exact:true}).click();await page.waitForFunction(()=>qa.state[0].cobro.estado==='pagado'&&!qa.state[0].cobroPorRevisar);
   assert.equal(await page.evaluate(()=>qa.statusReads),2);assert.equal(await page.evaluate(()=>qa.calls.length),0);
  });
  await run('confirmed payment waits for its status read before Listo closes on the first click',async page=>{
   await page.evaluate(()=>{qa.status={...qa.status,estado:'CERRADO',origen:'HISTORICO',clasificacion:'REQUIERE_REGISTRO'};qa.refresh({estado:'cerrado'})});
   await page.getByRole('button',{name:'Revisar cobro',exact:true}).click();await page.getByLabel('Monto en pesos').fill('1');await page.getByLabel('Quedó debiendo').check();await page.getByRole('button',{name:'Registrar decisión',exact:true}).click();
   await page.evaluate(()=>{const receipt=qa.receipt({origen:'HISTORICO',closedAt:null});qa.status=Object.fromEntries(Object.entries(receipt).filter(([key])=>!['operationId','pagoOrigen'].includes(key)));qa.holdStatus=true;qa.finish({ok:true,data:receipt})});
   await page.waitForFunction(()=>qa.readJobs?.length===1);
   assert.equal(await page.getByRole('button',{name:'Listo',exact:true}).count(),0);assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');assert.equal(await page.getByRole('button',{name:'Volver',exact:true}).isDisabled(),true);
   assert.equal(await page.evaluate(()=>qa.calls.length),1);assert.equal(await page.evaluate(()=>qa.state[0].cobro.estado),'pendiente');
   await page.evaluate(()=>{qa.holdStatus=false;qa.readJobs.shift()({ok:true,data:qa.status})});
   await page.getByRole('button',{name:'Listo',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
   assert.equal(await page.evaluate(()=>qa.calls.length),1);assert.equal(await page.evaluate(()=>qa.calls[0].name),'RESOLVE');assert.equal(await page.evaluate(()=>qa.state[0].cobro.montoCents),100);
  });
  await run('malformed success keeps the request uncertain without projecting money',async page=>{
   await page.getByRole('button',{name:'Cerrar turno',exact:true}).click();await page.getByRole('button',{name:'Cobrar y cerrar',exact:true}).click();await page.evaluate(()=>qa.finish({ok:true,data:{pagoRegistrado:true}}));
   await page.getByRole('button',{name:'Comprobar resultado',exact:true}).waitFor();assert.equal(await page.evaluate(()=>qa.state[0].estado),'atendiendo');assert.equal(await page.evaluate(()=>qa.state[0].cobro?.montoCents??null),null);
  });
 }}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
 const artifact=path.join(dir,'results.json');fs.writeFileSync(artifact,JSON.stringify(results,null,2));console.log(JSON.stringify({results,artifact},null,2));if(results.some(r=>!r.pass))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});


