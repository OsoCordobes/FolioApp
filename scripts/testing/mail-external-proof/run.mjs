import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateManifest,assertHosted,messages,createReceipt,finishReceipt} from './contract.mjs';
import {openJournal} from './journal.mjs';
import {createBoundary} from './transport.mjs';
import {proveTransport} from './prove.mjs';
const repo=path.resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const cleanEnvironment=source=>Object.fromEntries(Object.entries(source).filter(([key])=>['PATH','HOME','TMPDIR','TEMP','TMP','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT'].includes(key.toUpperCase())));
function git(ref){const result=spawnSync('git',['rev-parse',ref],{cwd:repo,env:cleanEnvironment(process.env),encoding:'utf8',timeout:10000,windowsHide:true});assert.equal(result.status,0,'git_failed');return result.stdout.trim();}
export async function main(){
 assert.equal(process.argv.slice(2).join(' '),'--execute','execution_closed');assertHosted(process.env,process.platform);
 const m=validateManifest(JSON.parse(process.env.MAIL_PROOF_MANIFEST_JSON??'null'),{sha:process.env.MAIL_PROOF_CANDIDATE,environment:process.env.MAIL_PROOF_ENVIRONMENT,authorizationId:process.env.MAIL_PROOF_AUTHORIZATION_ID});
 assert.equal(m.runId,process.env.MAIL_PROOF_REVIEWED_NONCE,'reviewed_nonce_required');
 assert.equal(git('HEAD'),m.candidateSha,'candidate_mismatch');const tree=git('HEAD^{tree}');
 const apiKey=process.env.RESEND_API_KEY;assert.ok(typeof apiKey==='string'&&/^\S{12,4096}$/.test(apiKey),'api_key_missing');
 assert.ok(process.env.RUNNER_TEMP,'runner_temp');const filename=path.join(process.env.RUNNER_TEMP,'folio-mail-external-proof.json');
 const r=createReceipt(m,tree),persist=await openJournal(filename,r),inputs=messages(m);
 const boundary=createBoundary({manifest:m,inputs,apiKey,receipt:r,persist,fetchImpl:globalThis.fetch});
 const clean=cleanEnvironment(process.env);for(const key of Object.keys(process.env))delete process.env[key];
 Object.assign(process.env,clean,{NODE_ENV:'test',NEXT_TELEMETRY_DISABLED:'1',FOLIO_EMAIL_DELIVERY_ENABLED:'true',RESEND_API_KEY:apiKey,EMAIL_FROM:m.from});
 const restore=boundary.install();
 try{const client=await import('../../../lib/email/client.ts');await proveTransport({send:(client.default??client).sendEmail,inputs,boundary,receipt:r,persist});}
 catch{r.failure??='proof';}
 finally{boundary.stop();restore();await persist();}
 assert.equal(finishReceipt(r).transportPassed,true,'transport_proof_failed');await persist();
 console.log('mail_external_transport_pass:unique=2 posts=3 reception=not_observed joined=0 auth_smtp=0');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('mail_external_transport_rejected');process.exitCode=1;});
