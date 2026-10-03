import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateManifest,validateGrant,assertHosted,assertEmptySnapshot,receipt,finishReceipt,sanitizedReceipt} from './contract.mjs';
import {createTransport,installTransport,installLoopbackFetch} from './transport.mjs';

export async function main(){
 assert.equal(process.argv.slice(2).join(' '),'--execute','execution_closed');assertHosted(process.env,process.platform);
 const config={candidate:process.env.C05_CANDIDATE,environment:process.env.C05_ENVIRONMENT,authorizationId:process.env.C05_AUTHORIZATION_ID};
 const m=validateManifest(JSON.parse(process.env.C05_MANIFEST_JSON??'null'),{sha:config.candidate,environment:config.environment,authorizationId:config.authorizationId});
 const grant=validateGrant(JSON.parse(process.env.C05_GRANT_JSON??'null'),m),secret=process.env.C05_CLIENT_SECRET;
 assert.ok(typeof secret==='string'&&secret.length>=12,'client_secret_missing');assert.ok(process.env.RUNNER_TEMP,'runner_temp_missing');
 const {openHosted,gitValue}=await import('./hosted.mjs');assert.equal(await gitValue('HEAD'),m.candidateSha,'candidate_mismatch');
 const r=receipt(m,await gitValue('HEAD^{tree}')),filename=path.join(process.env.RUNNER_TEMP,'folio-google-external-proof.json');
 r.accountHash=createHash('sha256').update(m.accountEmail).digest('hex');r.calendarHash=createHash('sha256').update(m.calendarId).digest('hex');
 await writeFile(filename,JSON.stringify(sanitizedReceipt(r)),{mode:0o600,flag:'wx'});
 const persist=async()=>{const temp=filename+'.'+randomUUID();await writeFile(temp,JSON.stringify(sanitizedReceipt(finishReceipt(r))),{mode:0o600,flag:'wx'});await rename(temp,filename);};
 const nativeFetch=globalThis.fetch,transport=createTransport({manifest:m,grant,clientSecret:secret,receipt:r,persist,fetchImpl:nativeFetch});
 let backend,restoreGoogle,restoreFetch,stage='preflight';
 try{
  // One minimum-field page, no date filter. Any event/default reminder/pagination stops before DB or writes.
  const empty=await transport.request('GET',null,undefined,{maxResults:1,fields:'kind,etag,items(id),nextPageToken,nextSyncToken,defaultReminders,accessRole'});assertEmptySnapshot(empty);
  stage='backend';backend=await openHosted({manifest:m,grant,receipt:r,persist});
  Object.assign(process.env,{GOOGLE_OAUTH_CLIENT_ID:m.clientId,GOOGLE_OAUTH_CLIENT_SECRET:secret,GOOGLE_OAUTH_REDIRECT_URI:m.redirectUri});
  restoreFetch=installLoopbackFetch();const {google}=await import('googleapis');restoreGoogle=installTransport(google,transport);
  transport.allowMutations();stage='workers';const {proveExternal}=await import('./prove.mjs');
  await proveExternal({...backend,transport,receipt:r,persist});
 }catch{r.failure=stage;}
 finally{
  // No retry or cleanup when a network write remains uncertain. IDs and journal remain in sanitized receipt.
  if(backend&&r.uncertain===null)try{const {cleanupKnownEvents}=await import('./prove.mjs');await cleanupKnownEvents({transport,receipt:r,persist});}catch{r.failure??='google_cleanup';}
  if(backend)try{r.database=await backend.snapshot();await persist();}catch{r.failure??='database_readback';}
  try{await backend?.close();}catch{r.failure??='backend_cleanup';}
  restoreGoogle?.();restoreFetch?.();transport.stop();
  r.cleanup=r.googleCleanup===true&&r.backendCleanup===true;r.uncertain??=null;await persist();
 }
 assert.equal(finishReceipt(r).passed,true,'external_proof_failed');console.log('google_external_proof_pass:cases=4 provider=google-real cleanup=1');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('google_external_proof_rejected');process.exitCode=1;});
