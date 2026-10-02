import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {guardBrowserContext,LOCAL_BROWSER_ARGS} from '../../scripts/testing/browser-network.mjs';
import {assertHoyPatientDestination,assertJoinedInputs,CALENDAR_HOY_STEPS,calendarHoyExceptionClass,captureCalendarHoyFailure,captureManualFailure,collectCalendarHoyDiagnostic,collectManualDiagnostic,JOINED_PROJECT,pedidoDialog,todayPlan} from '../../scripts/testing/public-booking-joined-proof/prove.mjs';

const calendarInput=()=>({staff:null,error:new Error('private stack'),step:'reload',navigationStatus:null,
 plan:{hora:'14:30'},serviceName:'synthetic service',pacienteId:'11111111-1111-4111-8111-111111111111',appUrl:'http://127.0.0.1:4410'});
function calendarStaff({url='http://127.0.0.1:4410/hoy?secret=private',cardCount=1,rowCount=1,linkCount=1,fail=false}={}){
 const value=(result)=>async()=>{if(fail)throw Error('private observation');return result;};
 const card={filter:()=>card,count:value(cardCount),getAttribute:value('Ensayo joined.invalid 14:30 synthetic service private')};
 const row={filter:()=>row,count:value(rowCount),getAttribute:value('14:30 private'),innerText:value('Ensayo joined.invalid synthetic service private')};
 const dialog={count:value(2),locator:()=>({count:value(linkCount)})};
 return {url:()=>{if(fail)throw Error('private URL');return url;},locator:selector=>selector==='.cal-turno'?card:row,getByRole:()=>dialog};
}

test('calendar diagnostic exception classes discard messages and leave unknown failures other',async()=>{
 const secret='private@example.invalid http://127.0.0.1:4410/private?token=private';
 for(const [message,expected] of [['locator.waitFor: strict mode violation: private resolved to 2 elements','strict-selector'],
  ['locator.count: Target page, context or browser has been closed','page-context-closed'],
  ['Execution context was destroyed, most likely because of a navigation.','execution-context'],
  ['private unknown error','other'],['Timeout 30000ms exceeded.','other'],['','other']]){
  const error=new Error(`${message} ${secret}`),original=error.message;
  Object.defineProperty(error,'stack',{get(){throw Error('stack must not be read');}});
  assert.equal(calendarHoyExceptionClass(error),expected);assert.equal(error.message,original);
  for(const step of ['row-visible-wait','row-count-check']){
   const result=await collectCalendarHoyDiagnostic({...calendarInput(),error,step});
   assert.equal(result.step,step);assert.equal(result.exceptionClass,expected);assert.ok(!JSON.stringify(result).includes(secret));
   assert.equal(result.message,undefined);assert.equal(result.stack,undefined);
  }
 }
 for(const error of [null,{},'private', {message:42}, {get message(){throw Error('private');}}])assert.equal(calendarHoyExceptionClass(error),'unavailable');
 const source=readFileSync(new URL('../../scripts/testing/public-booking-joined-proof/prove.mjs',import.meta.url),'utf8');
 assert.match(source,/calendarStep='row-visible-wait';\s*await today\.waitFor\(\);\s*calendarStep='row-count-check';\s*assert\.equal\(await today\.count\(\),1\);/);
});

test('calendar diagnostic closes substeps, error kinds, navigation and route categories',async()=>{
 assert.deepEqual(CALENDAR_HOY_STEPS,['reload','card-wait','label-check','detail-link','hoy-navigation','row-visible-wait','row-count-check','row-label','service-check','patient-navigation','receipt-write']);
 for(const step of [...CALENDAR_HOY_STEPS,'private']){
  const result=await collectCalendarHoyDiagnostic({...calendarInput(),step});
  assert.equal(result.step,step==='private'?'unavailable':step);
 }
 assert.equal((await collectCalendarHoyDiagnostic({...calendarInput(),step:'row-wait'})).step,'unavailable');
 for(const [name,code,kind] of [['Error','ERR_ASSERTION','assertion'],['TimeoutError',null,'timeout'],['TypeError',null,'type'],['Error',null,'error'],['toString',null,'other']]){
  const result=await collectCalendarHoyDiagnostic({...calendarInput(),error:{name,code,message:'private'}});assert.equal(result.errorKind,kind);
 }
 for(const [navigationStatus,navigation] of [[200,'success'],[302,'redirect'],[403,'client-error'],[503,'server-error'],[0,'other'],[null,'unavailable']]){
  assert.equal((await collectCalendarHoyDiagnostic({...calendarInput(),navigationStatus})).navigation,navigation);
 }
 const input=calendarInput();
 for(const [path,route] of [['/calendario','calendario'],['/hoy','hoy'],['/login','login'],[`/pacientes/${input.pacienteId}`,'patient'],['/other','other']]){
  const result=await collectCalendarHoyDiagnostic({...input,staff:calendarStaff({url:`${input.appUrl}${path}?secret=private`})});
  assert.equal(result.route,route);assert.equal(result.ui.patientDestination,false);assert.ok(!JSON.stringify(result).includes('private'));
 }
 assert.equal((await collectCalendarHoyDiagnostic({...input,staff:calendarStaff({url:`${input.appUrl}/pacientes/${input.pacienteId}`})})).ui.patientDestination,true);
 assert.equal((await collectCalendarHoyDiagnostic({...input,staff:calendarStaff({url:`http://127.0.0.1:4411/pacientes/${input.pacienteId}`})})).route,'other');
});

test('calendar diagnostic keeps counts and matches finite and failed observations unavailable',async()=>{
 const input=calendarInput(),result=await collectCalendarHoyDiagnostic({...input,staff:calendarStaff()});
 assert.equal(result.ui.card,'one');assert.equal(result.ui.dialog,'many');assert.equal(result.ui.detailLink,'one');assert.equal(result.ui.row,'one');
 for(const key of ['cardName','cardTime','cardService','rowName','rowTime','rowService','calendarPatientLink'])assert.equal(result.ui[key],true);
 assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes(input.serviceName));
 const absent=await collectCalendarHoyDiagnostic({...input,staff:calendarStaff({cardCount:0,rowCount:2,linkCount:0})});
 assert.equal(absent.ui.card,'zero');assert.equal(absent.ui.row,'many');assert.equal(absent.ui.calendarPatientLink,false);
 assert.equal(absent.ui.cardName,null);assert.equal(absent.ui.rowName,null);
 const failed=await collectCalendarHoyDiagnostic({...input,staff:calendarStaff({fail:true})});
 assert.equal(failed.route,'unavailable');
 for(const key of ['card','dialog','detailLink','row'])assert.equal(failed.ui[key],'unavailable');
 for(const key of ['cardName','cardTime','cardService','rowName','rowTime','rowService','calendarPatientLink','patientDestination'])assert.equal(failed.ui[key],null);
});

test('calendar diagnostic capture preserves first exception even when observation or persistence fails',async()=>{
 const original=new Error('first');
 for(const [collect,persist] of [[async()=>({phase:'calendar-hoy',step:'reload'}),async()=>{}],
  [async()=>{throw Error('capture failure');},async()=>{}],
  [async()=>({phase:'calendar-hoy',step:'reload'}),async()=>{throw Error('write failure');}]]){
  const receipt={modulePassed:false,stages:{}};
  await assert.rejects(()=>captureCalendarHoyFailure(original,collect,receipt,persist),error=>error===original);
  assert.equal(receipt.modulePassed,false);assert.deepEqual(receipt.stages,{});
 }
});

test('pedido modal selector: global RED and exact target GREEN with cookie dialog visible',async()=>{
 const source=readFileSync(new URL('../../components/calendario/pedido-modal.tsx',import.meta.url),'utf8');
 const cookieSource=readFileSync(new URL('../../components/cookie-banner.tsx',import.meta.url),'utf8');
 assert.match(source,/aria-labelledby="cal-pedido-modal-title"/);
 assert.match(source,/<h2 id="cal-pedido-modal-title"[^>]*>\s*\{pedido\.nombre\}/);
 assert.match(cookieSource,/aria-labelledby="cookie-banner-title"/);
 assert.match(cookieSource,/<strong id="cookie-banner-title"[^>]*>Cookies y privacidad<\/strong>/);
 const {chromium}=await import('@playwright/test');
 const browser=await chromium.launch({headless:true,args:LOCAL_BROWSER_ARGS});
 try{
  const context=await browser.newContext();await guardBrowserContext(context);const page=await context.newPage();
  await page.setContent(`<div id="pedido-dialog" role="dialog" aria-modal="true" aria-labelledby="cal-pedido-modal-title">
   <h2 id="cal-pedido-modal-title">Ensayo joined.invalid</h2>
   <button onclick="document.getElementById('pedido-dialog').remove()">Aceptar y crear turno</button></div>
   <div role="dialog" aria-labelledby="cookie-banner-title"><strong id="cookie-banner-title">Cookies y privacidad</strong>
   <button>Solo esenciales</button></div>`);
  assert.equal(await page.getByRole('dialog').count(),2);
  await assert.rejects(()=>page.getByRole('dialog').waitFor({state:'hidden',timeout:1000}),error=>error.message.includes('strict mode violation'));
  const target=pedidoDialog(page),cookie=page.getByRole('dialog',{name:'Cookies y privacidad',exact:true});
  assert.equal(await target.count(),1);assert.equal(await cookie.isVisible(),true);
  const snapshot=await collectManualDiagnostic({staff:page,pedidoModal:target,error:new Error('synthetic'),step:'accept-click',navigationStatus:null,
   scope:fixture().scope,pedidoId:fixture().scope.org,withDatabase:async()=>{throw Error('no database in this probe');}});
  assert.equal(snapshot.ui.dialog,'one');assert.equal(snapshot.ui.acceptEnabled,true);
  assert.equal(snapshot.readback.available,false);
  const accept=target.getByRole('button',{name:'Aceptar y crear turno',exact:true});assert.equal(await accept.count(),1);
  await accept.click();await target.waitFor({state:'hidden',timeout:1000});
  assert.equal(await cookie.isVisible(),true);assert.equal(await page.getByRole('dialog').count(),1);
  console.log('pedido_selector_probe:old=RED_strict target=GREEN_hidden cookie=visible target_diagnostic=one accepts=1 network=blocked app=none db=none');
 }finally{await browser.close();}
});

test('manual diagnostic reads only the existing pedido and keeps failures unavailable',async()=>{
 const scope=fixture().scope,pedidoId='22222222-2222-4222-8222-222222222222';
 const error=Object.assign(new Error('private message'),{name:'TimeoutError'});
 const input={staff:null,error,step:'dialog-hidden',navigationStatus:200,scope,pedidoId};
 const failed=await collectManualDiagnostic({...input,withDatabase:async()=>{throw Error('private DB error');}});
 assert.equal(failed.errorKind,'timeout');assert.equal(failed.readback.available,false);
 for(const key of ['pedido','conversion','turno','googleJob'])assert.equal(failed.readback[key],'unavailable');
 assert.equal(failed.readback.turnMatchesConversion,null);assert.equal(failed.ui.acceptEnabled,null);
 let reads=0;
 const observed=await collectManualDiagnostic({...input,withDatabase:async fn=>fn({query:async query=>{
  reads++;assert.deepEqual(query.values,[scope.org,pedidoId,scope.member,scope.servicio,scope.integration]);
  assert.equal(query.query_timeout,3000);assert.match(query.text,/WHERE organization_id=\$1 AND pedido_id=\$2/);
  return {rows:[{pedido_count:1,pedido_state:'CONFIRMADO',conversion_count:1,turn_count:1,job_count:1,
   conversion_match:true,turn_match:true,fixture_match:true,job_match:true}]};
 }})});
 assert.equal(reads,1);assert.equal(observed.readback.available,true);assert.equal(observed.readback.pedidoState,'CONFIRMADO');
 assert.equal(observed.readback.turno,'one');assert.equal(observed.readback.googleJob,'one');assert.equal(observed.readback.jobMatchesTurn,true);
 const absent=await collectManualDiagnostic({...input,withDatabase:async fn=>fn({query:async()=>({rows:[{
  pedido_count:1,pedido_state:'PENDIENTE',conversion_count:0,turn_count:0,job_count:0,
  conversion_match:null,turn_match:null,fixture_match:null,job_match:null}]})})});
 assert.equal(absent.readback.available,true);assert.equal(absent.readback.turno,'zero');
 assert.equal(absent.readback.googleJob,'zero');assert.equal(absent.readback.turnMatchesConversion,null);
});

test('manual UI diagnostics retain categories and booleans without text or full URL',async()=>{
 const button={count:async()=>1,isEnabled:async()=>false};
 const dialog={count:async()=>1,getByRole:role=>role==='button'?button:{count:async()=>1}};
 const staff={url:()=> 'http://127.0.0.1:4440/login?secret=private',locator:()=>({count:async()=>2}),getByRole:()=>dialog};
 const result=await collectManualDiagnostic({staff,error:new Error('private'),step:'accept-click',navigationStatus:403,
  scope:fixture().scope,pedidoId:fixture().scope.org,withDatabase:async()=>{throw Error('private');}});
 assert.equal(result.route,'login');assert.equal(result.navigation,'client-error');assert.equal(result.ui.card,'many');
 assert.equal(result.ui.dialog,'one');assert.equal(result.ui.acceptEnabled,false);assert.equal(result.ui.inlineAlert,true);
 assert.ok(!JSON.stringify(result).includes('private'));
 dialog.count=async()=>{throw Error('private');};button.isEnabled=async()=>{throw Error('private');};
 dialog.getByRole=role=>role==='button'?button:{count:async()=>{throw Error('private');}};
 const unavailable=await collectManualDiagnostic({staff,error:new Error('private'),step:'card-open',navigationStatus:null,
  scope:fixture().scope,pedidoId:fixture().scope.org,withDatabase:async()=>{throw Error('private');}});
 assert.equal(unavailable.ui.dialog,'unavailable');assert.equal(unavailable.ui.acceptEnabled,null);assert.equal(unavailable.ui.inlineAlert,null);
});

test('manual capture and persistence failures rethrow the original error by identity',async()=>{
 const original=new Error('first');
 for(const [collect,persist] of [[async()=>({step:'card-wait'}),async()=>{}],
  [async()=>{throw Error('capture failure');},async()=>{}],
  [async()=>({step:'card-wait'}),async()=>{throw Error('write failure');}]]){
  await assert.rejects(()=>captureManualFailure(original,collect,{},persist),error=>error===original);
 }
});

test('Hoy evidence requires navigation to the durable conversion patient on the same app',()=>{
 const app='http://127.0.0.1:4410',patient='11111111-1111-4111-8111-111111111111';
 assert.equal(assertHoyPatientDestination(`${app}/pacientes/${patient}`,app,patient),true);
 for(const destination of [`${app}/hoy`,`${app}/pacientes/22222222-2222-4222-8222-222222222222`,
  `http://127.0.0.1:4411/pacientes/${patient}`,`${app}/pacientes/${patient}?other=1`]){
  assert.throws(()=>assertHoyPatientDestination(destination,app,patient),/joined_hoy_patient_destination_mismatch/);
 }
});

test('plans today in the organization timezone when UTC is already tomorrow',()=>{
 const plan=todayPlan('2026-10-03T00:00:00Z');
 assert.equal(plan.day,'2026-10-02');assert.equal(plan.start,'2026-10-03T02:00:00.000Z');
 assert.equal(plan.end,'2026-10-03T02:30:00.000Z');assert.equal(plan.hora,'23:00');
 assert.equal(plan.horaFin,'23:30');assert.equal(plan.weekday,5);
});
test('fails when today cannot contain a future slot, without rolling to tomorrow',()=>{
 assert.throws(()=>todayPlan('2026-10-03T00:01:00Z'),/joined_no_future_slot_today/);
 assert.throws(()=>todayPlan('invalid'),/joined_clock_invalid/);
});
test('rounds to a complete 30 minute future slot across organization midnight',()=>{
 const plan=todayPlan('2026-10-03T03:01:59Z');
 assert.equal(plan.day,'2026-10-03');assert.equal(plan.hora,'02:30');
 assert.equal(plan.start,'2026-10-03T05:30:00.000Z');
 assert.equal(plan.weekday,6);
});
const key=role=>`x.${Buffer.from(JSON.stringify({iss:'supabase-local',role})).toString('base64url')}.x`;
function fixture(){
 return {isolation:{project:JOINED_PROJECT,githubActions:'true',runnerEnvironment:'github-hosted',platform:'linux',fresh:true,internalNetwork:true},
  config:{mode:'app',appUrl:'http://127.0.0.1:4410',supabaseUrl:'http://127.0.0.1:55421',anonKey:key('anon'),
   serviceKey:key('service_role'),databaseUrl:'postgresql://postgres:synthetic@127.0.0.1:55422/postgres',realSupabase:true,clinical:true},
  scope:Object.fromEntries(['org','member','patient','servicio','integration'].map(name=>[name,'11111111-1111-4111-8111-111111111111'])),
  browserCookies:[{name:'sb-local-auth-token',value:'synthetic',domain:'127.0.0.1',path:'/'}]};
}
test('preflight rejects local, reused, external or unguarded execution',()=>{
 for(const [name,value] of [['githubActions','false'],['runnerEnvironment','self-hosted'],['platform','win32'],['fresh',false],['internalNetwork',false],['project','folio_google_internal_proof']]){
  const input=fixture();input.isolation[name]=value;assert.throws(()=>assertJoinedInputs(input));
 }
 const symbol=Symbol.for('folio.test.isolation'),original=globalThis[symbol];
 try{globalThis[symbol]=false;assert.throws(()=>assertJoinedInputs(fixture()),/joined_io_guard_missing/);}
 finally{globalThis[symbol]=original;}
});
test('preflight uses the real app validator for hosted keys, external DB and ordinary server',()=>{
 assert.doesNotThrow(()=>assertJoinedInputs(fixture()));
 for(const [name,value] of [['databaseUrl','postgresql://postgres:x@db.example.invalid/postgres'],
  ['appUrl','http://127.0.0.1:3000'],['supabaseUrl','https://example.supabase.co'],
  ['serviceKey',`x.${Buffer.from(JSON.stringify({iss:'supabase-local',role:'service_role',ref:'hosted'})).toString('base64url')}.x`]]){
  const input=fixture();input.config[name]=value;assert.throws(()=>assertJoinedInputs(input));
 }
 const input=fixture();input.browserCookies[0].domain='localhost';assert.throws(()=>assertJoinedInputs(input));
});
