import assert from 'node:assert/strict';
export const PROJECT='folio_google_external_proof';
export const SCOPE='https://www.googleapis.com/auth/calendar.events';
export const LIMITS=Object.freeze({ids:5,requests:60,mutations:20,milliseconds:30*60*1000});
export const CASES=['outbound_lifecycle','uncertain_insert','external_availability','owned_event_isolation'];
export const fail=code=>{throw Error(code);};
const required=(value,pattern,code)=>{if(typeof value!=='string'||!pattern.test(value))fail(code);return value;};
export function validateManifest(m,{sha,environment,authorizationId,now=Date.now()}={}){
 assert.equal(m?.version,1,'manifest_version');
 required(m.runId,/^[a-f0-9]{32}$/,'run_id');
 required(m.candidateSha,/^[a-f0-9]{40}$/,'candidate_sha');assert.equal(m.candidateSha,sha,'candidate_mismatch');
 required(m.environment,/^[a-zA-Z0-9_-]{1,80}$/,'environment_missing');assert.equal(m.environment,environment,'environment_mismatch');
 required(m.accountEmail,/^[^\s+@]+@[^\s@]+\.[^\s@]+$/,'dedicated_account_missing');
 const [local,domain]=m.accountEmail.toLowerCase().split('@');
 if(['gmail.com','googlemail.com'].includes(domain)&&local.replaceAll('.','')==='amiunelautaro')fail('personal_account_forbidden');
 assert.equal(m.calendarId,m.accountEmail,'explicit_primary_id_required');
 required(m.clientId,/^[a-zA-Z0-9.-]+\.apps\.googleusercontent\.com$/,'client_missing');
 const redirect=new URL(required(m.redirectUri,/^https?:\/\//,'redirect_missing'));
 if(redirect.username||redirect.password||redirect.search||redirect.hash)fail('redirect_invalid');
 if(redirect.protocol!=='https:'&&!(redirect.protocol==='http:'&&redirect.hostname==='127.0.0.1'))fail('redirect_invalid');
 const a=m.authorization;required(a?.reference,/^[a-zA-Z0-9_-]{8,128}$/,'authorization_missing');
 assert.equal(a.reference,authorizationId,'authorization_mismatch');
 for(const flag of ['dedicatedAccount','noSharedCalendars','allowConsent','allowCreateMoveDeleteFiveEvents'])assert.equal(a[flag],true,'authorization_incomplete');
 const approved=Date.parse(a.approvedAt),expires=Date.parse(a.expiresAt);
 assert.ok(Number.isFinite(approved)&&approved<=now&&Number.isFinite(expires)&&expires>now&&expires-approved<=86400000,'authorization_expired');
 return m;
}
export function validateGrant(g,m,now=Date.now()){
 assert.equal(g?.version,1,'grant_version');assert.equal(g.clientId,m.clientId,'grant_client');
 assert.equal(g.accountEmail,m.accountEmail,'grant_account');assert.equal(g.calendarId,m.calendarId,'grant_calendar');
 assert.deepEqual(g.scopes,[SCOPE],'grant_scope');required(g.refreshToken,/^\S{20,4096}$/,'grant_refresh_missing');
 assert.equal(g.custodianConfirmedDedicatedAccount,true,'grant_custody');
 const consent=Date.parse(g.consentAt);assert.ok(Number.isFinite(consent)&&consent<=now&&consent>=Date.parse(m.authorization.approvedAt),'grant_consent');
 return g;
}
export function assertHosted(env,platform){
 assert.equal(env.GITHUB_ACTIONS,'true','github_required');assert.equal(env.RUNNER_ENVIRONMENT,'github-hosted','hosted_required');
 assert.equal(env.RUNNER_OS,'Linux','linux_required');assert.equal(platform,'linux','linux_required');
 assert.equal(env.C05_EXECUTE,'authorized','execution_closed');
 assert.equal(env.GITHUB_RUN_ATTEMPT,'1','trial_rerun_forbidden');
 required(env.GITHUB_RUN_ID,/^\d+$/,'workflow_run_missing');assert.equal(env.C05_REVIEWED_RUN_ID,env.GITHUB_RUN_ID,'single_reviewed_run_required');
}
export function assertEmptySnapshot(data){
 assert.equal(data?.kind,'calendar#events','snapshot_invalid');assert.equal(typeof data.etag,'string','snapshot_invalid');assert.ok(data.etag,'snapshot_invalid');
 assert.equal(data.accessRole,'owner','calendar_owner_required');assert.deepEqual(data.defaultReminders,[],'default_reminders_not_empty');
 assert.deepEqual(data.items??[],[],'calendar_not_empty');assert.equal(data.nextPageToken,undefined,'calendar_not_empty');
 assert.equal(typeof data.nextSyncToken,'string','snapshot_incomplete');assert.ok(data.nextSyncToken,'snapshot_incomplete');
}
export function receipt(m,tree){return {version:1,sha:m.candidateSha,tree,runId:m.runId,provider:'google-real',environment:'github-ephemeral-supabase',
 accountHash:null,calendarHash:null,cases:{},events:[],requests:0,mutations:0,uncertain:null,failure:null,cleanup:false,passed:false};}
export function finishReceipt(r){r.passed=r.failure===null&&r.cleanup===true&&r.uncertain===null&&CASES.every(k=>r.cases[k]?.passed===true);return r;}
export function sanitizedReceipt(r){
 // Deliberately enumerate fields. Never serialize exceptions, grants, HTTP bodies or environment.
 return {version:r.version,sha:r.sha,tree:r.tree,runId:r.runId,provider:r.provider,environment:r.environment,accountHash:r.accountHash,calendarHash:r.calendarHash,
 cases:Object.fromEntries(CASES.filter(k=>r.cases[k]).map(k=>[k,{passed:r.cases[k].passed===true}])),
 database:r.database?{organizationId:r.database.organizationId,memberId:r.database.memberId,patientId:r.database.patientId,integrationId:r.database.integrationId,
  turns:r.database.turns.map(t=>({id:t.id,estado:t.estado,gcal_event_id:t.gcal_event_id})),
  jobs:r.database.jobs.map(j=>({id:j.id,turno_id:j.turno_id,event_id:j.event_id,status:j.status,sanitized_error:j.sanitized_error})),blocks:r.database.blocks}:null,
 events:r.events.map(e=>({id:e.id,label:e.label,state:e.state})),requests:r.requests,mutations:r.mutations,uncertain:r.uncertain,
 failure:r.failure,cleanup:r.cleanup===true,passed:r.passed===true};
}
