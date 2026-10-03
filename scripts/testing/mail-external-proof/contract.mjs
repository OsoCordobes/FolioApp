import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
export const LIMITS=Object.freeze({unique:2,posts:3,milliseconds:15*60*1000});
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
export function validateManifest(m,{sha,environment,authorizationId,now=Date.now()}={}){
 assert.equal(m?.version,1,'manifest_version');assert.match(m.runId??'',/^[a-f0-9]{32}$/,'run_id');
 assert.match(m.candidateSha??'',/^[a-f0-9]{40}$/,'candidate_sha');assert.equal(m.candidateSha,sha,'candidate_mismatch');
 assert.match(m.environment??'',/^[a-zA-Z0-9_-]{1,80}$/,'environment');assert.equal(m.environment,environment,'environment_mismatch');
 assert.equal(typeof m.to,'string','recipient');assert.match(m.to,/^[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+$/,'single_recipient');assert.ok(m.to.length<=254,'recipient');
 assert.equal(typeof m.from,'string','sender');assert.ok(m.from.length<=320&&!/[\r\n,;]/.test(m.from),'single_sender');
 assert.match(m.from,/^(?:[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+|[^<>]+ <[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>)$/,'sender');
 const a=m.authorization;assert.match(a?.reference??'',/^[a-zA-Z0-9_-]{8,128}$/,'authorization');assert.equal(a.reference,authorizationId,'authorization_mismatch');
 assert.equal(a.allowTwoMessagesThreePosts,true,'authorization');assert.equal(a.allowControlledResponseLossReplay,true,'authorization');
 const approved=Date.parse(a.approvedAt),expires=Date.parse(a.expiresAt);
 assert.ok(Number.isFinite(approved)&&approved<=now&&Number.isFinite(expires)&&expires>now&&expires-approved<=86400000,'authorization_expired');return m;
}
export function assertHosted(env,platform){
 assert.equal(env.GITHUB_ACTIONS,'true','github_required');assert.equal(env.RUNNER_ENVIRONMENT,'github-hosted','hosted_required');
 assert.equal(env.RUNNER_OS,'Linux','linux_required');assert.equal(platform,'linux','linux_required');assert.equal(env.MAIL_PROOF_EXECUTE,'authorized','execution_closed');
 assert.equal(env.GITHUB_RUN_ATTEMPT,'1','rerun_forbidden');assert.match(env.GITHUB_RUN_ID??'',/^\d+$/,'run_id');assert.equal(env.MAIL_PROOF_REVIEWED_RUN_ID,env.GITHUB_RUN_ID,'reviewed_run_required');
}
export function envelope(m,label){return {from:m.from,to:m.to,subject:`Folio prueba ${label} ${m.runId}`,
 html:`<p>Folio prueba ${label} ${m.runId}. Mensaje ficticio para verificar correo.</p>`};}
export function messages(m){
 return Object.fromEntries(['A','B'].map(label=>{const {to,subject,html}=envelope(m,label);return [label,Object.freeze({to,subject,html,idempotencyKey:`folio-email/${randomUUID()}`})];}));
}
export function createReceipt(m,tree){return {version:1,sha:m.candidateSha,tree,runId:m.runId,provider:'resend-real',environment:'github-hosted-node',
 posts:0,attempts:[],messageIds:{A:null,B:null},controlledLoss:false,replaySameId:false,failure:null,transportPassed:false,
 reception:'not_observed',joined:false,authSmtp:false};}
export function sanitizedReceipt(r){
 return {version:1,sha:r.sha,tree:r.tree,runId:r.runId,provider:r.provider,environment:r.environment,posts:r.posts,
  attempts:r.attempts.map(a=>({label:a.label,attempt:a.attempt,keyHash:a.keyHash,envelopeHash:a.envelopeHash,state:a.state,providerId:a.providerId??null})),
  messageIds:{A:r.messageIds.A,B:r.messageIds.B},controlledLoss:r.controlledLoss===true,replaySameId:r.replaySameId===true,
  failure:r.failure,transportPassed:r.transportPassed===true,reception:'not_observed',joined:false,authSmtp:false};
}
export function finishReceipt(r){r.transportPassed=r.failure===null&&r.posts===3&&r.controlledLoss===true&&r.replaySameId===true&&validId(r.messageIds.A)&&validId(r.messageIds.B)&&r.messageIds.A!==r.messageIds.B;return r;}
