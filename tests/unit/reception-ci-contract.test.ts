import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {assertFreshReceptionDatabase,assertReceptionPolicies,receptionCiEnvironment,summarizeReceptionReport} from '../../scripts/testing/reception-ci-contract.mjs';

const jwt=(role:string)=>`header.${Buffer.from(JSON.stringify({iss:'supabase-demo',role})).toString('base64url')}.signature`;
const localStatus={API_URL:'http://127.0.0.1:54321',DB_URL:'postgresql://postgres:synthetic@127.0.0.1:54322/postgres',ANON_KEY:jwt('anon'),SERVICE_ROLE_KEY:jwt('service_role')};
const source={CI:'true'};
const policy={mfa_ready:true,mfa_enforced:true,attachments:true,population:true,sessions:true,availability:true,representatives:true,atomic_close:true,payment_settlement:true};
const database={version:170000,real_auth:true,real_storage:true,migrations_ready:true,unsafe_organizations:0,unsafe_auth_users:0};
const title=(role:string)=>`${role} sees the scoped week and month, without clinical fields or a foreign tenant`;
const spec=(role:string,status='passed',message='sensitive@example.test')=>({
 title:title(role),file:'e2e/calendario-reception.spec.ts',tests:[{results:[{status,errors:[{message,location:{file:'tests/e2e/calendario-reception.spec.ts',line:42}}]}]}],
});
const report=(first=spec('ASISTENTE'),second=spec('COORDINADOR'))=>({config:{rootDir:path.resolve('tests')},suites:[{specs:[first,second]}]});

test('hosted reception accepts only the dedicated local Supabase profile',()=>{
 const env=receptionCiEnvironment(localStatus,source);
 assert.equal(env.E2E_BASE_URL,'http://localhost:4420');
 assert.equal(env.FOLIO_TEST_CLINICAL,'1');
 for(const status of [{...localStatus,API_URL:'https://hosted.supabase.co'},
  {...localStatus,DB_URL:'postgresql://postgres:x@db.example.com:5432/postgres'},
  {...localStatus,ANON_KEY:jwt('service_role')}])assert.throws(()=>receptionCiEnvironment(status,source),{code:'FOLIO_TEST_ISOLATION'});
});

test('fresh database requires the exact migration ledger and nine enforced controls',()=>{
 assert.doesNotThrow(()=>assertFreshReceptionDatabase(database,['1','2'],['1','2']));
 assert.throws(()=>assertFreshReceptionDatabase(database,['1','2'],['1']),{code:'FOLIO_TEST_ISOLATION'});
 assert.throws(()=>assertFreshReceptionDatabase({...database,unsafe_auth_users:1},['1'],['1']),{code:'FOLIO_TEST_ISOLATION'});
 assert.doesNotThrow(()=>assertReceptionPolicies(policy));
 assert.throws(()=>assertReceptionPolicies({...policy,payment_settlement:false}),{code:'FOLIO_TEST_ISOLATION'});
});

test('browser proof requires both executed roles and never includes arbitrary error details',()=>{
 const passed=summarizeReceptionReport(report());
 assert.equal(passed.passed,true);assert.equal(passed.executed,2);
 assert.equal(JSON.stringify(passed).includes('sensitive@example.test'),false);
 const skipped=summarizeReceptionReport(report(spec('ASISTENTE','skipped')));
 assert.equal(skipped.passed,false);assert.equal(skipped.executed,1);
 assert.throws(()=>summarizeReceptionReport(report({...spec('ASISTENTE'),tests:[{results:[]}]})),{code:'FOLIO_TEST_ISOLATION'});
 const failed=summarizeReceptionReport(report(spec('ASISTENTE','failed','secret bucket and patient')));
 assert.equal(failed.passed,false);
 assert.equal(JSON.stringify(failed).includes('secret bucket and patient'),false);
 assert.throws(()=>summarizeReceptionReport(report(spec('ASISTENTE'),spec('ASISTENTE'))),{code:'FOLIO_TEST_ISOLATION'});
 assert.throws(()=>summarizeReceptionReport(report({...spec('ASISTENTE'),file:'../other/calendario-reception.spec.ts'})),{code:'FOLIO_TEST_ISOLATION'});
 assert.throws(()=>summarizeReceptionReport({...report(),config:{rootDir:path.resolve('other')}}),{code:'FOLIO_TEST_ISOLATION'});
});
