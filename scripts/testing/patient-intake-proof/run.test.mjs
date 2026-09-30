import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,readdir,rmdir,unlink,writeFile,rename,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import contract from './incorporation-contract.ts';
const {proofMode,proofSpec,assertHosted,assertFixture,RESTORE_COLUMNS,MARKERS,FAILURE_PREFIX,browserReceipt,finiteFailure,addFailure,publishReceipt,isApplyPayload}=contract;
import {assistantScopeList,authDiagnostic,browserResult,servicesStatus} from './run.mjs';

test('browser diagnostics keep only closed intercept fields',()=>{
 const output='intake_proof_stage:initial_fence\n'
  +'intake_proof_issue_diagnostic:phase=fetch http=none rows=0 kind=terminal_timeout\n'
  +'intake_proof_submit_diagnostic:phase=db_done http=200 rows=1 kind=none\n'
  +'intake_proof_issue_diagnostic:phase=secret http=200 rows=1 kind=token=private\n';
 const parsed=browserResult(output);
 assert.deepEqual(parsed.markers,['initial_fence']);
 assert.deepEqual(parsed.intercepts,{issue:'phase=fetch http=none rows=0 kind=terminal_timeout',submit:'phase=db_done http=200 rows=1 kind=none'});
 assert.doesNotMatch(JSON.stringify(parsed),/secret|private/);
});

test('scoped assistant has a nonempty professional list excluding the visit owner',()=>{
 const assigned=randomUUID(),visitOwner=randomUUID();
 assert.deepEqual(assistantScopeList(assigned,visitOwner),[assigned]);
 assert.throws(()=>assistantScopeList(visitOwner,visitOwner));
 assert.throws(()=>assistantScopeList('not-a-member',visitOwner));
});

test('auth failures expose only fixed steps, bounded status and allowlisted SQLSTATE',()=>{
 const dbError=Object.assign(Error('password=private patient=private'),{code:'23514'});
 assert.equal(authDiagnostic('db_member_assistant',undefined,dbError),
  'step=db_member_assistant kind=database http=none sqlstate=23514');
 const authError=Object.assign(Error('token=private'),{code:'private',name:'AuthApiError'});
 assert.equal(authDiagnostic('owner-a_verify',422,authError),
  'step=owner-a_verify kind=auth_api http=422 sqlstate=other');
 const unknown=authDiagnostic('secret-step',999,Error('token=private'));
 assert.equal(unknown,'step=other kind=other http=none sqlstate=none');
});

test('reports only fixed services and bounded Compose fields',()=>{
 const output=[
  {Service:'db',State:'running',Health:'healthy',ExitCode:0,Name:'secret-container-name'},
  {Service:'minio-createbucket',State:'exited',Health:'',ExitCode:42,Publishers:'password=secret'},
  {Service:'injected-password',State:'running',Health:'healthy',ExitCode:0},
 ].map(row=>JSON.stringify(row)).join('\n');
 const status=servicesStatus(output);
 assert.match(status,/\bdb=running_healthy_exit0\b/);
 assert.match(status,/\bminio-createbucket=exited_none_exit42\b/);
 assert.match(status,/\bauth=missing\b/);
 assert.doesNotMatch(status,/secret|injected|container-name|password/);
});

test('rejects malformed rows and does not echo unknown status values',()=>{
 assert.equal(servicesStatus('password=secret'), 'ps=unavailable');
 const status=servicesStatus(JSON.stringify([{Service:'db',State:'secret',Health:'secret',ExitCode:'secret'},
  {Service:'auth',State:'exited',Health:null,ExitCode:null}]));
 assert.match(status,/\bdb=other_none_exitother\b/);
 assert.match(status,/\bauth=exited_none_exitother\b/);
 assert.doesNotMatch(status,/secret/);
});

test('accepts Compose JSON arrays as well as newline-delimited JSON',()=>{
 const rows=[{Service:'db',State:'running',Health:'starting',ExitCode:0}];
 assert.equal(servicesStatus(JSON.stringify(rows)),servicesStatus(rows.map(JSON.stringify).join('\n')));
});

test('incorporation mode is exclusive and requires exact hosted tag/SHA, legacy remains PR only',()=>{
 assert.equal(proofMode([]),'legacy');assert.equal(proofMode(['--incorporation']),'incorporation');
 assert.equal(proofSpec('legacy'),'tests/e2e/patient-intake-live.spec.ts');
 assert.equal(proofSpec('incorporation'),'tests/e2e/patient-intake-incorporation-live.spec.ts');
 for(const args of [['--portal-export'],['--incorporation','--incorporation'],['--incorporation','other']])assert.throws(()=>proofMode(args));
 const sha='a'.repeat(40),env={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/tags/m148-ui-cas-proof-1',GITHUB_SHA:sha,FOLIO_INTAKE_EXPECTED_SHA:sha};
 assert.doesNotThrow(()=>assertHosted(env,sha,'incorporation','linux'));
 for(const change of [{GITHUB_REF:'refs/heads/master'},{GITHUB_SHA:'b'.repeat(40)},{FOLIO_INTAKE_EXPECTED_SHA:undefined},
  {RUNNER_ENVIRONMENT:'self-hosted'},{GITHUB_EVENT_NAME:'pull_request'}])assert.throws(()=>assertHosted({...env,...change},sha,'incorporation','linux'));
 assert.throws(()=>assertHosted(env,sha,'incorporation','win32'));
 assert.throws(()=>assertHosted(env,sha,'legacy','linux'));
 assert.doesNotThrow(()=>assertHosted({...env,GITHUB_EVENT_NAME:'pull_request'},sha,'legacy','linux'));
});

function ownedFixture(){
 return {mode:'incorporation',organizationId:randomUUID(),memberId:randomUUID(),userId:randomUUID(),
  databaseUrl:'postgresql://postgres:synthetic@127.0.0.1:55422/postgres',browserCookies:[{name:'sb-local-auth-token',value:'synthetic',domain:'localhost',path:'/'}],
  cases:['selection','lost','conflict'].map((kind,index)=>({kind,label:`Paciente sintético integración ${index+1}`,patientId:randomUUID(),identityId:randomUUID(),turnoId:randomUUID(),
   baseline:Object.fromEntries(RESTORE_COLUMNS.map(column=>[column,null]))}))};
}
test('fixture rejects foreign endpoints, shared IDs, cookie drift and unsafe restoration fields',()=>{
 assert.doesNotThrow(()=>assertFixture(ownedFixture()));
 for(const mutate of [f=>f.databaseUrl=f.databaseUrl.replace('127.0.0.1','example.invalid'),f=>f.databaseUrl+='?sslmode=require',
  f=>f.cases[1].identityId=f.cases[0].identityId,f=>f.cases.pop(),f=>f.browserCookies[0].domain='example.invalid',
  f=>f.cases[0].baseline.admin_revision='0',f=>f.cases[0].baseline.nombre_cifrado='private-text']){
  const f=ownedFixture();mutate(f);assert.throws(()=>assertFixture(f));
 }
 assert.equal(RESTORE_COLUMNS.includes('admin_revision'),false);
});

test('response-loss interception selects only the target incorporation action and operation',()=>{
 const visit=randomUUID(),operation=randomUUID();
 assert.equal(isApplyPayload([{turnoId:visit,operationId:operation,selectedKeys:['nombre']}],visit),true);
 for(const payload of [[],[visit,'scope',operation],[{turnoId:randomUUID(),operationId:operation,selectedKeys:['nombre']}],
  [{turnoId:visit,operationId:'private',selectedKeys:['nombre']}],[{turnoId:visit,operationId:operation,selectedKeys:['apellido']}]]){
  assert.equal(isApplyPayload(payload,visit),false);
 }
});

test('three-case receipt requires real markers/counts and rejects failures, omissions and source frames',()=>{
 const good=[...MARKERS,'3 passed (2s)'].join('\n');assert.equal(browserReceipt(good,0).passed,true);
 for(const bad of [good.replace(MARKERS[2],''),good+'\n1 skipped',good+'\n1 failed',good.replace('3 passed','2 passed'),
  MARKERS.map(marker=>`> 2 | console.log('${marker}');`).join('\n')+'\n3 passed'])assert.equal(browserReceipt(bad,0).passed,false);
 assert.equal(browserReceipt(good,1).passed,false);
});

test('finite receipt preserves primary before secondary cleanup and excludes credentials/assertion data',()=>{
 const error=Object.assign(Error('private-token-cookie-DSN'),{code:'ERR_ASSERTION',actual:200,expected:409,
  stack:'private-token-cookie-DSN\n at patient-intake-incorporation-live.spec.ts:99:5'});
 const failure=finiteFailure(error,{case:'lost',phase:'lost_response'});
 let receipt=browserReceipt(FAILURE_PREFIX+JSON.stringify(failure)+'\n1 failed',1);
 receipt=addFailure(receipt,Error('private-cleanup'),{case:'runner',phase:'cleanup'});
 assert.deepEqual(receipt.primary,failure);assert.equal(receipt.secondary[0].phase,'cleanup');assert.equal(receipt.exitCode,1);
 assert.doesNotMatch(JSON.stringify(receipt),/private|token|cookie|DSN/);
 const unsafe=finiteFailure({actual:'private',expected:{token:'private'}},{case:'selection',phase:'readback'});
 assert.equal(unsafe.actual,undefined);assert.equal(unsafe.expected,undefined);
 const poisoned=browserReceipt(FAILURE_PREFIX+JSON.stringify({...failure,message:'private'})+'\n1 failed',1);
 assert.equal(poisoned.primary.case,'runner');
});

test('atomic receipt retains prior bytes on write/rename failure and never replaces an unowned destination',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'folio-incorporation-unit-')),file=path.join(folder,'receipt.json');
 const first=browserReceipt('1 failed',1),next=addFailure(first,Error('cleanup'),{case:'runner',phase:'cleanup'});
 try{
  await publishReceipt(file,first,false);const before=await readFile(file,'utf8');
  for(const io of [{link,rename,unlink,writeFile:async()=>{throw Error('write_failed');}},
   {link,writeFile,unlink,rename:async()=>{throw Error('rename_failed');}}]){
   await assert.rejects(publishReceipt(file,next,true,io));assert.equal(await readFile(file,'utf8'),before);
   assert.deepEqual(await readdir(folder),['receipt.json']);
  }
  await assert.rejects(publishReceipt(file,next,false));assert.equal(await readFile(file,'utf8'),before);
  await publishReceipt(file,next,true);assert.deepEqual(JSON.parse(await readFile(file,'utf8')).primary,first.primary);
 }finally{await unlink(file);await rmdir(folder);}
});
