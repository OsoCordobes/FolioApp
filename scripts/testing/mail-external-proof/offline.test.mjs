import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import * as client from '../../../lib/email/client.ts';
const {sendEmail}=client.default??client;
import {validateManifest,assertHosted,messages,createReceipt,sanitizedReceipt,finishReceipt,LIMITS} from './contract.mjs';
import {createBoundary} from './transport.mjs';
import {openJournal} from './journal.mjs';
import {proveTransport} from './prove.mjs';
const epoch=Date.parse('2026-10-03T14:00:00Z'),sha='a'.repeat(40),ids={A:'11111111-1111-4111-8111-111111111111',B:'22222222-2222-4222-8222-222222222222'},apiKey='synthetic-resend-key-only';
const manifest=()=>({version:1,runId:'b'.repeat(32),candidateSha:sha,environment:'synthetic-environment',from:'Folio <sender@example.test>',to:'controlled@example.test',
 authorization:{reference:'synthetic-authorization',approvedAt:new Date(epoch-1000).toISOString(),expiresAt:new Date(epoch+3600000).toISOString(),allowTwoMessagesThreePosts:true,allowControlledResponseLossReplay:true}});
const context={sha,environment:'synthetic-environment',authorizationId:'synthetic-authorization',now:epoch};
function harness({provider,persistFailure}={}){
 const m=manifest(),inputs=messages(m),r=createReceipt(m,'c'.repeat(40)),calls=[],journal=[];let now=epoch;
 const persist=async()=>{if(persistFailure?.(r))throw Error('synthetic journal unavailable');journal.push(JSON.parse(JSON.stringify(sanitizedReceipt(r))));};
 const boundary=createBoundary({manifest:m,inputs,apiKey,receipt:r,persist,now:()=>now,fetchImpl:async(url,options)=>{
  calls.push({url,options});assert.equal(journal.at(-1).posts,calls.length,'journal_must_precede_http');
  return provider?provider(calls.length,url,options):new Response(JSON.stringify({id:calls.length===1?ids.A:ids.B}));
 }});
 const options=(label,delta={})=>({method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':inputs[label].idempotencyKey},
  body:JSON.stringify({from:m.from,to:inputs[label].to,subject:inputs[label].subject,html:inputs[label].html}),...delta});
 return {m,inputs,r,calls,journal,boundary,persist,options,advance:ms=>{now+=ms;}};
}
async function withRealClient(h,fn){
 const original=Object.fromEntries(['FOLIO_EMAIL_DELIVERY_ENABLED','RESEND_API_KEY','EMAIL_FROM'].map(k=>[k,process.env[k]]));
 Object.assign(process.env,{FOLIO_EMAIL_DELIVERY_ENABLED:'true',RESEND_API_KEY:apiKey,EMAIL_FROM:h.m.from});
 const restore=h.boundary.install();try{return await fn(sendEmail);}finally{restore();for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
test('manifest and runtime reject missing authorization/identities, expirations and reruns',()=>{
 validateManifest(manifest(),context);for(const key of ['from','to','candidateSha','environment','authorization']){const m=manifest();delete m[key];assert.throws(()=>validateManifest(m,context));}
 const m=manifest();m.to='one@example.test,two@example.test';assert.throws(()=>validateManifest(m,context));assert.throws(()=>validateManifest(manifest(),{...context,now:epoch+86400000}));
 for(const from of ['sender@example.test>','Folio <sender@example.test','sender@example.test\r\nBcc:foreign@example.test'])assert.throws(()=>validateManifest({...manifest(),from},context));
 const env={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1',MAIL_PROOF_REVIEWED_RUN_ID:'1',MAIL_PROOF_EXECUTE:'authorized'};
 assertHosted(env,'linux');assert.throws(()=>assertHosted(env,'win32'));assert.throws(()=>assertHosted({...env,GITHUB_RUN_ATTEMPT:'2'},'linux'));assert.throws(()=>assertHosted({...env,MAIL_PROOF_REVIEWED_RUN_ID:'2'},'linux'));
});
test('installed real client acceptance, controlled B loss and identical replay use three POSTs only',async()=>{
 const h=harness();await withRealClient(h,send=>proveTransport({send,...h,receipt:h.r}));
 assert.equal(h.calls.length,3);assert.equal(h.boundary.phase,'complete');assert.equal(finishReceipt(h.r).transportPassed,true);
 assert.equal(h.calls[1].options.body,h.calls[2].options.body);assert.equal(h.calls[1].options.headers.get('Idempotency-Key'),h.calls[2].options.headers.get('Idempotency-Key'));
 assert.equal(h.calls.every(c=>c.url==='https://api.resend.com/emails'&&c.options.redirect==='error'),true);
 assert.equal(h.r.messageIds.B,ids.B);assert.equal(h.r.reception,'not_observed');
 await assert.rejects(h.boundary.fetch('https://api.resend.com/emails',h.options('B')));assert.equal(h.calls.length,3);
});
test('other hosts, endpoints, GET, redirects, recipients/from/body/keys are rejected before HTTP',async()=>{
 for(const [url,delta] of [['https://evil.test/emails',{}],['https://api.resend.com/emails/abc',{}],['https://api.resend.com/emails?x=y',{}],['https://api.resend.com/emails',{method:'GET'}],['https://api.resend.com/emails',{redirect:'follow'}],['https://api.resend.com/emails',{dispatcher:{}}]]){
  const h=harness();await assert.rejects(h.boundary.fetch(url,h.options('A',delta)));assert.equal(h.calls.length,0);
 }
 for(const field of ['from','to','html','subject']){const h=harness(),o=h.options('A'),body=JSON.parse(o.body);body[field]='foreign@example.test';await assert.rejects(h.boundary.fetch('https://api.resend.com/emails',{...o,body:JSON.stringify(body)}));assert.equal(h.calls.length,0);}
 const h=harness(),o=h.options('A');o.headers['Idempotency-Key']='wrong-key';await assert.rejects(h.boundary.fetch('https://api.resend.com/emails',o));assert.equal(h.calls.length,0);
});

test('authorization/deadline elapsed during pre-request journal prevents HTTP',async()=>{
 for(const duration of [LIMITS.milliseconds,3600000]){
  let h;h=harness({persistFailure:()=>{h.advance(duration);return false;}});
  await assert.rejects(h.boundary.fetch('https://api.resend.com/emails',h.options('A')));
  assert.equal(h.calls.length,0);assert.equal(h.boundary.phase,'stopped');
 }
});
test('B cannot precede A, A cannot repeat, POST budget and deadline cannot add traffic',async()=>{
 const early=harness();await assert.rejects(early.boundary.fetch('https://api.resend.com/emails',early.options('B')));assert.equal(early.calls.length,0);
 const repeated=harness();await repeated.boundary.fetch('https://api.resend.com/emails',repeated.options('A'));await assert.rejects(repeated.boundary.fetch('https://api.resend.com/emails',repeated.options('A')));assert.equal(repeated.calls.length,1);
 const budget=harness();budget.r.posts=LIMITS.posts;await assert.rejects(budget.boundary.fetch('https://api.resend.com/emails',budget.options('A')));assert.equal(budget.calls.length,0);
 const late=harness();late.advance(LIMITS.milliseconds);await assert.rejects(late.boundary.fetch('https://api.resend.com/emails',late.options('A')));assert.equal(late.calls.length,0);
});
test('journal failure before HTTP emits no request; accepted B persistence failure never enables replay',async()=>{
 const before=harness({persistFailure:()=>true});await assert.rejects(before.boundary.fetch('https://api.resend.com/emails',before.options('A')));assert.equal(before.calls.length,0);
 for(const lostFlag of [false,true]){
  const h=harness({persistFailure:r=>r.messageIds.B!==null&&r.controlledLoss===lostFlag});
  await withRealClient(h,async send=>{assert.equal((await send(h.inputs.A)).status,'sent');assert.equal((await send(h.inputs.B)).status,'uncertain');});
  assert.equal(h.boundary.controlledLossDurable,false);assert.equal(h.boundary.phase,'stopped');assert.equal(h.r.controlledLoss,false);
  await assert.rejects(h.boundary.fetch('https://api.resend.com/emails',h.options('B')));assert.equal(h.calls.length,2);
 }
});
test('genuine timeout and missing/malformed/inconsistent receipts never authorize third POST',async()=>{
 for(const kind of ['timeout','missing','malformed','sameAsA']){
  const h=harness({provider:async n=>{if(n===1)return new Response(JSON.stringify({id:ids.A}));if(kind==='timeout')throw Error('synthetic timeout');return new Response(kind==='malformed'?'not json':JSON.stringify(kind==='missing'?{}:{id:ids.A}));}});
  await withRealClient(h,async send=>{assert.equal((await send(h.inputs.A)).status,'sent');assert.equal((await send(h.inputs.B)).status,'uncertain');});
  assert.equal(h.boundary.controlledLossDurable,false);assert.equal(h.boundary.phase,'stopped');await assert.rejects(h.boundary.fetch('https://api.resend.com/emails',h.options('B')));assert.equal(h.calls.length,2);
 }
});
test('changed receipt on B replay stops as inconsistent rather than reporting dedupe',async()=>{
 const h=harness({provider:n=>new Response(JSON.stringify({id:n===1?ids.A:n===2?ids.B:'33333333-3333-4333-8333-333333333333'}))});
 await withRealClient(h,send=>assert.rejects(proveTransport({send,...h,receipt:h.r})));
 assert.equal(h.calls.length,3);assert.equal(h.boundary.phase,'stopped');assert.equal(h.r.replaySameId,false);assert.equal(finishReceipt(h.r).transportPassed,false);
});
test('non-2xx stops campaign without fabricating provider acceptance or automatic retry',async()=>{
 for(const status of [403,409,422,429,503]){const h=harness({provider:()=>new Response(JSON.stringify({error:'SECRET provider error'}),{status})});
  await withRealClient(h,async send=>{assert.equal((await send(h.inputs.A)).status,'uncertain');});assert.equal(h.boundary.phase,'stopped');assert.equal(h.r.messageIds.A,null);
  await assert.rejects(h.boundary.fetch('https://api.resend.com/emails',h.options('A')));assert.equal(h.calls.length,1);assert.equal(JSON.stringify(sanitizedReceipt(h.r)).includes('SECRET'),false);
 }
});
test('atomic journal contains only fingerprints and sane receipts, refuses foreign existing file',async()=>{
 const h=harness(),dir=await mkdtemp(path.join(tmpdir(),'folio-mail-offline-')),file=path.join(dir,'receipt.json');const persist=await openJournal(file,h.r);
 h.r.attempts.push({label:'A',attempt:1,keyHash:'d'.repeat(64),envelopeHash:'e'.repeat(64),state:'attempting',providerId:null,rawKey:h.inputs.A.idempotencyKey,html:h.inputs.A.html,recipient:h.m.to});await persist();
 const text=await readFile(file,'utf8');for(const forbidden of [h.inputs.A.idempotencyKey,h.m.to,h.m.from,h.inputs.A.html,apiKey])assert.equal(text.includes(forbidden),false);
 await assert.rejects(openJournal(file,h.r));assert.equal(await readFile(file,'utf8'),text);
});
test('concurrent escape stops in-flight request without reviving a later phase',async()=>{
 let release;const blocked=new Promise(resolve=>{release=resolve;});const h=harness({provider:async()=>{await blocked;return new Response(JSON.stringify({id:ids.A}));}});
 const first=h.boundary.fetch('https://api.resend.com/emails',h.options('A'));await Promise.resolve();await Promise.resolve();
 await assert.rejects(h.boundary.fetch('https://api.resend.com/emails',h.options('A')));release();await assert.rejects(first);
 assert.equal(h.boundary.phase,'stopped');assert.equal(h.calls.length,1);
});
