import assert from 'node:assert/strict';
import test from 'node:test';
import {attachBrowserFailure,browserAssertion,browserDiagnosticLine,browserFailureDiagnostic,safeAttachedBrowserFailure} from './browser-diagnostics.mjs';

test('browser diagnostics expose only closed phase, kind and assertion code',()=>{
 let failure;
 try{browserAssertion(false,'archive_mobile_overflow');}catch(error){failure=error;}
 const attached=attachBrowserFailure(failure,'mobile_width');
 assert.deepEqual(safeAttachedBrowserFailure(attached),{
  phase:'mobile_width',kind:'assertion',code:'archive_mobile_overflow',
 });
 assert.equal(browserDiagnosticLine(attached),
  'b06b3_browser_diagnostic phase=mobile_width kind=assertion code=archive_mobile_overflow');
});

test('browser diagnostics redact messages, URLs, cookies, responses and sources',()=>{
 const secret='https://example.test/patient?token=private; cookie=session-secret; source=clinical.pdf';
 const error=Object.assign(new Error(secret),{name:'Error',url:secret,cookies:[secret],response:secret,source:secret});
 const diagnostic=browserFailureDiagnostic(error,'mobile_capture');
 assert.deepEqual(diagnostic,{phase:'mobile_capture',kind:'other',code:'none'});
 assert.equal(JSON.stringify(diagnostic).includes(secret),false);
 assert.deepEqual(browserFailureDiagnostic({name:'TimeoutError',message:secret},'goto'),
  {phase:'goto',kind:'timeout',code:'none'});
 assert.deepEqual(browserFailureDiagnostic({name:'TargetClosedError',message:secret},'save'),
  {phase:'save',kind:'browser_closed',code:'none'});
});

test('forged or hostile diagnostics are reduced to safe defaults',()=>{
 const secret='private-token';
 assert.deepEqual(browserFailureDiagnostic({name:'B06BrowserAssertion',browserAssertionCode:secret},secret),
  {phase:'cleanup',kind:'assertion',code:'none'});
 const hostile={get b06BrowserDiagnostic(){throw Error(secret);}};
 assert.equal(safeAttachedBrowserFailure(hostile),null);
 assert.equal(browserDiagnosticLine(hostile),null);
 assert.equal(JSON.stringify(attachBrowserFailure(secret,'unknown')).includes(secret),false);
});
