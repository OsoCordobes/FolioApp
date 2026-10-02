import assert from 'node:assert/strict';
import test from 'node:test';
import {assertHoyPatientDestination,assertJoinedInputs,captureManualFailure,collectManualDiagnostic,JOINED_PROJECT,todayPlan} from '../../scripts/testing/public-booking-joined-proof/prove.mjs';

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
