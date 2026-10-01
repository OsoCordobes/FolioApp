import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {interceptDiagnostic,interceptErrorKind,isIssueActionPayload,waitForIntercept} from './browser-diagnostics.mjs';

test('only an issue action with the exact six arguments is intercepted',()=>{
 const turno=randomUUID(),operation=randomUUID(),hash='a'.repeat(64);
 const issue=[turno,hash,operation,'1',hash,hash];
 assert.equal(isIssueActionPayload(issue,turno),true);
 assert.equal(isIssueActionPayload([turno],turno),false); // readState
 assert.equal(isIssueActionPayload(issue.slice(0,5),turno),false); // revoke
 assert.equal(isIssueActionPayload([randomUUID(),...issue.slice(1)],turno),false);
 assert.equal(isIssueActionPayload([turno,hash,operation,'1',hash,'token=secret'],turno),false);
});

test('intercept diagnostics discard arbitrary request and error content',()=>{
 assert.equal(interceptDiagnostic('fetch',200,1,'none'),'phase=fetch http=200 rows=1 kind=none');
 assert.equal(interceptDiagnostic('token=secret',999,'patient=secret','password=secret'),
  'phase=other http=none rows=none kind=other');
 const timeout=Error('request timed out token=private');
 const network=Error('socket hang up patient=private');
 assert.equal(interceptErrorKind(timeout),'timeout');
 assert.equal(interceptErrorKind(network),'network');
 assert.equal(interceptErrorKind(Error('token=private')),'other');
 assert.doesNotMatch(interceptDiagnostic('fetch',0,0,interceptErrorKind(timeout)),/private|token/);
});

test('terminal wait observes completion and has a bounded fallback',async()=>{
 assert.equal(await waitForIntercept(Promise.resolve('done'),20,()=> 'late'),'done');
 assert.equal(await waitForIntercept(new Promise(()=>{}),10,()=> 'late'),'late');
});
