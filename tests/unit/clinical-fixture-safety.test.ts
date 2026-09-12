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
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Total: 7 tests in 1 file/);
});

test('clinical command rejects alternate app origins before application or browser launch',()=>{
 for(const appUrl of ['http://127.0.0.1:4420','http://[::1]:4420','http://localhost:4410','http://localhost:4499']){
  const result=spawnSync(process.execPath,['scripts/testing/run-clinical.mjs','--list'],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:'',E2E_BASE_URL:appUrl,FOLIO_TEST_SUPABASE_URL:source.supabaseUrl,FOLIO_TEST_SUPABASE_ANON_KEY:source.anonKey,FOLIO_TEST_SUPABASE_SERVICE_KEY:source.serviceKey,FOLIO_TEST_DATABASE_URL:source.databaseUrl}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/dedicated 4420\/54321\/54322 local profile/);assert.doesNotMatch(result.stdout,/Listing tests|Running \d+ tests/);
 }
});
