import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {assertClinicalDatabase,assertClinicalPolicies,clinicalConfig,CLINICAL_POLICY_KEYS,totp} from '../../scripts/testing/clinical-config.mjs';

const jwt=(role:string)=>`header.${Buffer.from(JSON.stringify({iss:'supabase-demo',role})).toString('base64url')}.synthetic`;
const source={clinical:true,appUrl:'http://127.0.0.1:4410',supabaseUrl:'http://127.0.0.1:54321',anonKey:jwt('anon'),serviceKey:jwt('service_role'),databaseUrl:'postgres://postgres:synthetic@127.0.0.1:54322/postgres'};
const env=(patch:Record<string,unknown>={})=>({FOLIO_TEST_ISOLATED:'1',FOLIO_TEST_CLINICAL:'1',FOLIO_TEST_APP_CONFIG:JSON.stringify({...source,...patch})});

test('clinical fixtures revalidate local credentials and require an explicit protected suite',()=>{
 assert.equal(clinicalConfig(env()).clinical,true);
 for(const patch of [{clinical:false},{supabaseUrl:'https://grkpayhxndztlfwxobnt.supabase.co'},{databaseUrl:'postgres://postgres:synthetic@127.0.0.1:55439/folio_test_stubs'},{supabaseUrl:'http://127.0.0.1:54321/auth'},{appUrl:'http://127.0.0.1:3010'},{anonKey:jwt('service_role')},{databaseUrl:undefined}])assert.throws(()=>clinicalConfig(env(patch)),{code:'FOLIO_TEST_ISOLATION'});
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

test('synthetic authenticator matches independent RFC 6238 SHA1 vectors',()=>{
 const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
 for(const [seconds,code] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']] as const)assert.equal(totp(secret,seconds*1000),code);
 assert.throws(()=>totp('not a TOTP secret'));assert.throws(()=>totp(secret,-1));
});

test('clinical command fails without local Supabase credentials before launching app or browser',()=>{
 const result=spawnSync(process.execPath,['scripts/testing/run-clinical.mjs'],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:''}});
 assert.notEqual(result.status,0);assert.match(result.stderr,/Clinical integration requires/);
});

test('real runner bootstrap carries the protected clinical opt-in but still strips provider credentials',()=>{
 const bootstrap=pathToFileURL(resolve('scripts/testing/app-bootstrap.mjs')).href;
 const config={...source,realSupabase:true,mode:'app'};
 const child=spawnSync(process.execPath,['--import',bootstrap,'--input-type=module','-e',`import assert from 'node:assert/strict';import {clinicalConfig} from './scripts/testing/clinical-config.mjs';assert.equal(clinicalConfig(process.env).clinical,true);assert.equal(process.env.MP_ACCESS_TOKEN,undefined);assert.equal(process.env.RESEND_API_KEY,undefined);assert.throws(()=>fetch('https://api.mercadopago.com/'),/disabled/);`],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:'',FOLIO_TEST_APP_CONFIG:JSON.stringify(config),MP_ACCESS_TOKEN:'must-be-removed',RESEND_API_KEY:'must-be-removed'}});
 assert.equal(child.status,0,child.stderr);
 const refused=spawnSync(process.execPath,['--import',bootstrap,'--input-type=module','-e','throw Error("should not execute")'],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:'',FOLIO_TEST_APP_CONFIG:JSON.stringify({...config,databaseUrl:undefined})}});
 assert.notEqual(refused.status,0);assert.match(refused.stderr,/Clinical integration requires/);assert.doesNotMatch(refused.stderr,/Error: should not execute/);
});
