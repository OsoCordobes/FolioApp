import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {testAppConfig} from '../../scripts/testing/app-config.mjs';
import {assertAal1ProtectedRead,assertClinicalDatabase,assertClinicalPolicies,clinicalConfig,CLINICAL_POLICY_KEYS,totp} from '../../scripts/testing/clinical-config.mjs';

const jwt=(role:string)=>`header.${Buffer.from(JSON.stringify({iss:'supabase-demo',role})).toString('base64url')}.synthetic`;
const hostedJwt=(role:string)=>`header.${Buffer.from(JSON.stringify({iss:'supabase',role,ref:'hosted-project'})).toString('base64url')}.synthetic`;
const source={clinical:true,appUrl:'http://localhost:4420',supabaseUrl:'http://127.0.0.1:54321',anonKey:jwt('anon'),serviceKey:jwt('service_role'),databaseUrl:'postgres://postgres:synthetic@127.0.0.1:54322/postgres'};
const env=(patch:Record<string,unknown>={})=>({FOLIO_TEST_ISOLATED:'1',FOLIO_TEST_CLINICAL:'1',FOLIO_TEST_APP_CONFIG:JSON.stringify({...source,...patch})});

test('clinical fixtures require the exact dedicated 4420/54321/54322 profile',()=>{
 assert.equal(clinicalConfig(env()).clinical,true);
 for(const patch of [{appUrl:'http://127.0.0.1:4420'},{appUrl:'http://[::1]:4420'},{appUrl:'http://localhost:4410'},{appUrl:'http://localhost:4499'},{supabaseUrl:'http://localhost:54321'},{databaseUrl:'postgres://postgres:synthetic@localhost:54322/postgres'},{clinical:false},{supabaseUrl:'https://grkpayhxndztlfwxobnt.supabase.co'},{databaseUrl:'postgres://postgres:synthetic@127.0.0.1:55439/folio_test_stubs'},{supabaseUrl:'http://127.0.0.1:54321/auth'},{appUrl:'http://127.0.0.1:4410'},{appUrl:'http://127.0.0.1:3000'},{appUrl:'http://127.0.0.1:3010'},{appUrl:'http://127.0.0.1:4499'},{anonKey:hostedJwt('anon')},{anonKey:jwt('service_role')},{databaseUrl:undefined}])assert.throws(()=>clinicalConfig(env(patch)),{code:'FOLIO_TEST_ISOLATION'});
 assert.throws(()=>clinicalConfig({...env(),FOLIO_TEST_ISOLATED:'0'}));
 assert.throws(()=>clinicalConfig({...env(),FOLIO_TEST_APP_CONFIG:'not json'}));
});

test('clinical database preflight refuses stubs, missing migrations and any real data',()=>{
 const good={version:170006,real_auth:true,real_storage:true,migrations_ready:true,unsafe_organizations:0,unsafe_auth_users:0};
 assert.doesNotThrow(()=>assertClinicalDatabase(good));
 for(const patch of [{version:160015},{version:180001},{version:undefined},{real_auth:false},{real_storage:false},{migrations_ready:false},{unsafe_organizations:1},{unsafe_auth_users:1},{unsafe_organizations:undefined}])assert.throws(()=>assertClinicalDatabase({...good,...patch}));
});

test('every clinical enforcement gate is required, not just MFA UI enrollment',()=>{
 const good=Object.fromEntries(CLINICAL_POLICY_KEYS.map(key=>[key,true]));
 assert.doesNotThrow(()=>assertClinicalPolicies(good));
 for(const key of CLINICAL_POLICY_KEYS)for(const value of [false,null,undefined,'true'])assert.throws(()=>assertClinicalPolicies({...good,[key]:value}));
});

test('AAL1 protected reads accept only the two safe denial outcomes',()=>{
 for(const result of [{data:[],error:null},{data:null,error:{code:'42501',message:'mfa_required'}},{data:[],error:{code:'42501',message:'mfa_required'}}])assert.doesNotThrow(()=>assertAal1ProtectedRead(result));
 for(const result of [null,{}, {data:null,error:null},{data:[],error:undefined},{data:[{id:'visible'}],error:null},{data:[{id:'visible'}],error:{code:'42501'}},{data:null,error:{code:'42P01'}},{data:[],error:{code:'PGRST000'}}])assert.throws(()=>assertAal1ProtectedRead(result));
});

test('synthetic authenticator matches independent RFC 6238 SHA1 vectors',()=>{
 const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
 for(const [seconds,code] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']] as const)assert.equal(totp(secret,seconds*1000),code);
 assert.throws(()=>totp('not a TOTP secret'));assert.throws(()=>totp(secret,-1));
});

test('clinical command fails without local Supabase credentials before launching app or browser',()=>{
 const result=spawnSync(process.execPath,['scripts/testing/run-clinical.mjs'],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:''}});
 assert.notEqual(result.status,0);assert.match(result.stderr,/Clinical integration requires/);
});

test('clinical command rejects an explicit non-clinical app URL before Playwright',()=>{
 const result=spawnSync(process.execPath,['scripts/testing/run-clinical.mjs','--list'],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:'',E2E_BASE_URL:'http://127.0.0.1:4410',FOLIO_TEST_SUPABASE_URL:source.supabaseUrl,FOLIO_TEST_SUPABASE_ANON_KEY:source.anonKey,FOLIO_TEST_SUPABASE_SERVICE_KEY:source.serviceKey,FOLIO_TEST_DATABASE_URL:source.databaseUrl}});
 assert.notEqual(result.status,0);assert.match(result.stderr,/dedicated 4420\/54321\/54322 local profile/);assert.doesNotMatch(`${result.stdout}\n${result.stderr}`,/Running \d+ tests/);
});

test('real runner bootstrap carries the protected clinical opt-in but still strips provider credentials',()=>{
 const bootstrap=pathToFileURL(resolve('scripts/testing/app-bootstrap.mjs')).href;
 const config={...source,realSupabase:true,mode:'app'};
 const child=spawnSync(process.execPath,['--import',bootstrap,'--input-type=module','-e',`import assert from 'node:assert/strict';import {clinicalConfig} from './scripts/testing/clinical-config.mjs';assert.equal(clinicalConfig(process.env).clinical,true);assert.equal(process.env.MP_ACCESS_TOKEN,undefined);assert.equal(process.env.RESEND_API_KEY,undefined);assert.throws(()=>fetch('https://api.mercadopago.com/'),/disabled/);`],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:'',FOLIO_TEST_APP_CONFIG:JSON.stringify(config),MP_ACCESS_TOKEN:'must-be-removed',RESEND_API_KEY:'must-be-removed'}});
 assert.equal(child.status,0,child.stderr);
 const refused=spawnSync(process.execPath,['--import',bootstrap,'--input-type=module','-e','throw Error("should not execute")'],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:'',FOLIO_TEST_APP_CONFIG:JSON.stringify({...config,databaseUrl:undefined})}});
 assert.notEqual(refused.status,0);assert.match(refused.stderr,/Clinical integration requires/);assert.doesNotMatch(refused.stderr,/Error: should not execute/);
});

test('canonical clinical default reaches discovery while the ordinary app remains on 127.0.0.1:4410',()=>{
 assert.equal(testAppConfig({}).appUrl,'http://127.0.0.1:4410');
 const result=spawnSync(process.execPath,['scripts/testing/run-clinical.mjs','--list'],{encoding:'utf8',timeout:30000,env:{...process.env,NODE_OPTIONS:'',E2E_BASE_URL:undefined,FOLIO_TEST_SUPABASE_URL:source.supabaseUrl,FOLIO_TEST_SUPABASE_ANON_KEY:source.anonKey,FOLIO_TEST_SUPABASE_SERVICE_KEY:source.serviceKey,FOLIO_TEST_DATABASE_URL:source.databaseUrl}});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Total: 12 tests in 1 file/);
});

test('clinical command rejects alternate app origins before application or browser launch',()=>{
 for(const appUrl of ['http://127.0.0.1:4420','http://[::1]:4420','http://localhost:4410','http://localhost:4499']){
  const result=spawnSync(process.execPath,['scripts/testing/run-clinical.mjs','--list'],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:'',E2E_BASE_URL:appUrl,FOLIO_TEST_SUPABASE_URL:source.supabaseUrl,FOLIO_TEST_SUPABASE_ANON_KEY:source.anonKey,FOLIO_TEST_SUPABASE_SERVICE_KEY:source.serviceKey,FOLIO_TEST_DATABASE_URL:source.databaseUrl}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/dedicated 4420\/54321\/54322 local profile/);assert.doesNotMatch(result.stdout,/Listing tests|Running \d+ tests/);
 }
});

test('integrated safety: disabled or missing close/settlement gates cannot provision fixtures',async()=>{
 const {assertIntegratedPolicies}=await import('../fixtures/clinical-safety');
 const good={...Object.fromEntries(CLINICAL_POLICY_KEYS.map(key=>[key,true])),atomic_close:true,payment_settlement:true};
 assert.doesNotThrow(()=>assertIntegratedPolicies(good));
 for(const key of ['atomic_close','payment_settlement'])for(const value of [false,null,undefined,'true'])assert.throws(()=>assertIntegratedPolicies({...good,[key]:value}));
});

test('integrated safety: action binding rejects confused operations and external forwarding',async()=>{
 const {parseClinicalAction}=await import('../fixtures/clinical-safety');
 const turnoId='12000000-0000-4000-8000-000000000001',operacionId='12000000-0000-4000-8000-000000000002';
 const close={turnoId,operacionId,to:'cerrado',duracionRealMin:20,cobro:{montoCents:1200,metodo:'EFECTIVO',pagado:false}};
 const wire=(input:unknown,url='http://localhost:4420/hoy')=>({url,method:'POST',actionId:'40'+'a'.repeat(40),body:JSON.stringify([input]),contentType:'text/plain;charset=UTF-8'});
 assert.equal(parseClinicalAction(wire(close)).action,'CLOSE');
 for(const bad of [wire(close,'http://127.0.0.1:4420/hoy'),wire(close,'https://example.com/hoy'),wire({...close,action:'RESOLVE'}),wire({...close,cobro:{...close.cobro,pagado:'false'}}),wire({...close,to:'en_sala'}),wire({turnoId,pagoId:operacionId,operacionId}),{...wire(close),body:'["$1"]'}])assert.throws(()=>parseClinicalAction(bad));
});

test('integrated safety: Next 15 action IDs preserve the full CLOSE, RESOLVE and SETTLE input',async()=>{
 const {parseClinicalAction}=await import('../fixtures/clinical-safety');
 const turnoId='12000000-0000-4000-8000-000000000001',operacionId='12000000-0000-4000-8000-000000000002';
 const cobro={montoCents:1200,metodo:'EFECTIVO',pagado:false};
 const cases=[
  {input:{turnoId,operacionId,to:'cerrado',duracionRealMin:20,cobro},expected:{action:'CLOSE',turnoId,operacionId,duracionRealMin:20,cobro}},
  {input:{turnoId,operacionId,cobro},expected:{action:'RESOLVE',turnoId,operacionId,cobro}},
  {input:{turnoId,pagoId:operacionId},expected:{action:'SETTLE',turnoId,pagoId:operacionId}},
 ];
 for(const {input,expected} of cases)assert.deepEqual(parseClinicalAction({url:'http://localhost:4420/hoy',method:'POST',actionId:'40'+'a'.repeat(40),body:JSON.stringify([input]),contentType:'text/plain;charset=UTF-8'}),expected);
});

test('integrated safety: wrong-length or non-hex action IDs cannot enter the financial parser',async()=>{
 const {parseClinicalAction}=await import('../fixtures/clinical-safety');
 const wire={url:'http://localhost:4420/hoy',method:'POST',body:JSON.stringify([{turnoId:'12000000-0000-4000-8000-000000000001',pagoId:'12000000-0000-4000-8000-000000000002'}]),contentType:'text/plain;charset=UTF-8'};
 for(const actionId of ['a'.repeat(40),'a'.repeat(43),'40'+'a'.repeat(39)+'g'])assert.throws(()=>parseClinicalAction({...wire,actionId}));
});

test('integrated safety: failures settle the intercepted route and cannot look committed',async()=>{
 const {forwardThenLose}=await import('../fixtures/clinical-safety');
 for(const failure of ['fetch','commit'] as const){
  const events:string[]=[];
  await assert.rejects(forwardThenLose({fetch:async()=>{events.push('fetch');if(failure==='fetch')throw Error('transport');return {};},commit:async()=>{events.push('commit');throw Error('no matching committed receipt');},abort:async()=>{events.push('abort');}}));
  assert.deepEqual(events,failure==='fetch'?['fetch','abort']:['fetch','commit','abort']);
 }
 const events:string[]=[];
 await forwardThenLose({fetch:async()=>{events.push('fetch');return {};},commit:async()=>{events.push('committed');},abort:async()=>{events.push('abort');}});
 assert.deepEqual(events,['fetch','committed','abort']);
});

test('integrated safety: enrollment failure revokes the first login and cleanup failures stay visible',async()=>{
 const {CleanupRegistry,authenticateRegistered}=await import('../fixtures/clinical-safety');
 const cleanup=new CleanupRegistry(),events:string[]=[];
 await assert.rejects(authenticateRegistered(cleanup,{login:async()=>{events.push('login');},enroll:async()=>{events.push('enroll');throw Error('challenge lost');},revoke:async()=>{events.push('revoke');}}));
 await cleanup.close();assert.deepEqual(events,['login','enroll','revoke']);
 const failed=new CleanupRegistry();failed.add('auth session',async()=>{throw Error('sensitive detail');});failed.add('database',async()=>{events.push('db closed');});
 await assert.rejects(failed.close(),error=>error instanceof Error&&/auth session/.test(error.message)&&!/sensitive detail/.test(error.message));assert.equal(events.at(-1),'db closed');
});

test('integrated safety: only a real successful Flight action result can confirm a write',async()=>{
 const {actionResult,bindExpected}=await import('../fixtures/clinical-response-loss');
 assert.deepEqual(actionResult('0:{"a":"$@2","f":[]}\n2:{"ok":true,"data":{"persisted":true}}\n'),{ok:true,data:{persisted:true}});
 for(const body of ['0:{"a":"$@2"}\n2:{"ok":false,"error":"denied"}', '0:{"a":"$@2"}', '0:{"a":"$@2"}\n2:{"ok":true}', '0:{"a":"$@2"}\n2:["unrelated UI"]'])assert.throws(()=>actionResult(body));
 const turnoId='12000000-0000-4000-8000-000000000001',operacionId='12000000-0000-4000-8000-000000000002';
 const request={action:'CLOSE' as const,turnoId,operacionId,duracionRealMin:20,cobro:{montoCents:1200,metodo:'EFECTIVO' as const,pagado:false}};
 const expected={action:'CLOSE' as const,turnoId,duracionRealMin:20,cobro:request.cobro};
 assert.doesNotThrow(()=>bindExpected(request,expected));
 for(const patch of [{turnoId:operacionId},{action:'RESOLVE' as const},{duracionRealMin:21},{cobro:{...request.cobro,pagado:true}}])assert.throws(()=>bindExpected(request,{...expected,...patch}));
 assert.throws(()=>bindExpected({action:'SETTLE',turnoId,pagoId:operacionId},{action:'SETTLE',turnoId,pagoId:turnoId}));
});

test('integrated safety: interceptor exceptions reject observed and remove the route',async()=>{
 const {observeClinicalAction}=await import('../fixtures/clinical-response-loss');
 const {CleanupRegistry}=await import('../fixtures/clinical-safety');
 type Route=import('@playwright/test').Route;
 let handler:((route:Route)=>Promise<void>)|undefined;const events:string[]=[];
 const page={route:async(_pattern:string,callback:(route:Route)=>Promise<void>)=>{handler=callback;},unroute:async()=>{events.push('unroute');}} as unknown as import('@playwright/test').Page;
 const cleanup=new CleanupRegistry(),fixture={cleanup} as import('../fixtures/clinical-local').ClinicalFixture;
 const observer=await observeClinicalAction(fixture,page,{} as import('../fixtures/clinical-local').ClinicalAccount,{action:'CLOSE',turnoId:'12000000-0000-4000-8000-000000000001'});
 const route={request:()=>({allHeaders:async()=>{throw Error('secret cookie details');}}),abort:async()=>{events.push('abort');}} as unknown as Route;
 assert.ok(handler);await handler(route);
 await assert.rejects(observer.observed,error=>error instanceof Error&&/failed at request/.test(error.message)&&!/secret/.test(error.message));
 assert.deepEqual(events,['abort','unroute']);await cleanup.close();
});

test('integrated safety: fixture cleanup rejects an unobserved action instead of leaving it pending',async()=>{
 const {observeClinicalAction}=await import('../fixtures/clinical-response-loss');
 const {CleanupRegistry}=await import('../fixtures/clinical-safety');
 let removed=0;const page={route:async()=>{},unroute:async()=>{removed++;}} as unknown as import('@playwright/test').Page;
 const cleanup=new CleanupRegistry(),fixture={cleanup} as import('../fixtures/clinical-local').ClinicalFixture;
 const observer=await observeClinicalAction(fixture,page,{} as import('../fixtures/clinical-local').ClinicalAccount,{action:'CLOSE',turnoId:'12000000-0000-4000-8000-000000000001'});
 await cleanup.close();await assert.rejects(observer.observed,/not observed/);assert.equal(removed,1);
});

test('integrated safety: an idempotent writer with the same operation cannot satisfy the browser receipt probe',async()=>{
 const {bindReceiptProbe}=await import('../fixtures/clinical-safety');
 const turnoId='12000000-0000-4000-8000-000000000001',operacionId='12000000-0000-4000-8000-000000000002';
 const original={action:'CLOSE' as const,turnoId,operacionId,duracionRealMin:20,cobro:{montoCents:1200,metodo:'EFECTIVO' as const,pagado:true}};
 const wire={url:'http://localhost:4420/hoy',method:'POST',actionId:'40'+'a'.repeat(40),contentType:'text/plain;charset=UTF-8',body:JSON.stringify([original])};
 assert.deepEqual(bindReceiptProbe(wire,'getTurnoCloseReceiptAction',original),original);
 const {action:_action,...sameWrite}=original;
 for(const name of ['transitionTurnoAction','resolveTurnoCloseAction','marcarPagoCobradoAgendaAction'])assert.throws(()=>bindReceiptProbe({...wire,body:JSON.stringify([{...sameWrite,to:'cerrado'}])},name,original),/Writer invoked during receipt recovery/);
 for(const patch of [{operacionId:turnoId},{turnoId:operacionId},{duracionRealMin:21},{cobro:{...original.cobro,pagado:false}}])assert.throws(()=>bindReceiptProbe({...wire,body:JSON.stringify([{...original,...patch}])},'getTurnoCloseReceiptAction',original));
 assert.equal(bindReceiptProbe(wire,'getTurnoCloseStatusAction',original),null);
});
