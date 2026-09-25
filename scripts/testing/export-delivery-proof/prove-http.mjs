import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServerClient} from '@supabase/ssr';
import {proveBrowser} from './prove-browser.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function cookieHeader(api,anon,seed){
 let cookies=[];
 const client=createServerClient(api,anon,{cookies:{getAll:()=>cookies,
  setAll:values=>{cookies=values.map(({name,value})=>({name,value}));}}});
 const {error}=await client.auth.setSession({access_token:seed.accessToken,
  refresh_token:seed.refreshToken});
 assert.equal(error,null,'session_cookie_unavailable');
 assert.ok(cookies.length>0,'session_cookie_missing');
 return {header:cookies.map(({name,value})=>`${name}=${encodeURIComponent(value)}`).join('; '),cookies};
}

/** Seven real Next routes, including middleware, cookies, MFA and Storage.
 * No raw response body, token, source path or patient data is logged. */
export async function proveHttp({state,seed,mark,app,api}){
 mark('session');
 const session=await cookieHeader(api,state.anonKey,seed);
 async function request(method,path,body){
  const response=await fetch(`${app}${path}`,{method,redirect:'manual',cache:'no-store',
   headers:{Cookie:session.header,...(body?{Origin:app,'Content-Type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90_000)});
  assert.equal(response.status>=300&&response.status<400,false,'unexpected_auth_redirect');
  if(!response.ok)throw Error(`http_status_${[400,401,403,404,409,429,503].includes(response.status)?response.status:'other'}`);
  if(path.includes('/fragments/')){
   assert.equal(response.headers.get('content-type'),'application/octet-stream','fragment_type');
   return {bytes:new Uint8Array(await response.arrayBuffer()),headers:response.headers};
  }
  assert.match(response.headers.get('content-type')??'',/^application\/json/,'json_type');
  const data=await response.json();
  assert.equal(data?.ok,true,'route_response_unconfirmed');
  return data;
 }
 const patientId=seed.patient,operationId=randomUUID();
 mark('begin');
 const first=await request('POST','/api/patient/export-package',{patientId,operationId});
 const jobId=first.operation?.job_id;
 assert.match(jobId,UUID,'job_id_missing');
 const lookup=await request('GET',`/api/patient/export-package/operations/${operationId}?patientId=${patientId}`);
 assert.equal(lookup.operation?.job_id,jobId,'lost_begin_identity_changed');
 const replay=await request('POST','/api/patient/export-package',{patientId,operationId});
 assert.equal(replay.operation?.job_id,jobId,'begin_replay_changed');
 const expected=lookup.operation.expected_entries;
 assert.equal(expected,4,'source_count_changed');
 mark('claim');
 const claim=await request('POST',`/api/patient/export-package/${jobId}/claim`,
  {patientId,operationId,revision:lookup.operation.revision});
 const lease=claim.lease;
 assert.match(lease?.leaseToken,UUID,'lease_missing');
 assert.equal(lease.revision,1,'lease_revision');
 mark('entry_fragment');
 const measurements=[];
 for(let sourceOrdinal=0;sourceOrdinal<expected;sourceOrdinal++){
  let complete=false,calls=0;
  while(!complete){
   const started=Date.now();
   const result=await request('POST',`/api/patient/export-package/${jobId}/progress`,
    {patientId,operationId,leaseToken:lease.leaseToken,revision:lease.revision,sourceOrdinal});
   complete=result.progress?.complete===true;
   calls++;measurements.push(Date.now()-started);
   assert.ok(calls<=17,'entry_progress_unbounded');
   if(!complete)assert.ok(Number.isSafeInteger(result.progress?.remainingFragments)&&
    result.progress.remainingFragments>0,'entry_progress_malformed');
  }
 }
 mark('finish');
 const finished=await request('POST',`/api/patient/export-package/${jobId}/finish`,
  {patientId,operationId,leaseToken:lease.leaseToken,revision:lease.revision});
 assert.equal(finished.state,'ready','finish_unconfirmed');
 mark('manifest');
 const listed=await request('GET',`/api/patient/export-package/${jobId}/manifest?patientId=${patientId}&operationId=${operationId}&offset=0&limit=50`);
 const manifest=listed.manifest;
 assert.equal(manifest?.expectedEntries,4,'manifest_count');
 assert.equal(manifest.entries.length,4,'manifest_partial');
 const document=manifest.entries.find(row=>row.kind==='document');
 const signature=manifest.entries.find(row=>row.kind==='signature');
 const withdrawn=manifest.entries.find(row=>row.kind==='withdrawn_document');
 const json=manifest.entries.find(row=>row.kind==='json');
 assert.equal(document?.expected_fragments,17,'actual_50mib_not_17_fragments');
 assert.equal(document?.total_bytes,seed.file.byteLength,'actual_50mib_size');
 assert.equal(document?.source_hash_kind,'not_recorded','legacy_document_hash_kind');
 assert.equal(document?.source_sha256,null,'legacy_document_source_hash_unexpected');
 assert.equal(document?.computed_sha256,sha(seed.file),'legacy_document_computed_hash');
 assert.equal(withdrawn?.expected_fragments,0,'withdrawn_bytes_present');
 assert.ok(json&&signature&&document&&withdrawn,'manifest_kinds');
 mark('reconstruction');
 for(const entry of [json,document,signature]){
  const hash=createHash('sha256'),parts=[];
  for(let ordinal=0;ordinal<entry.expected_fragments;ordinal++){
   const received=await request('GET',`/api/patient/export-package/${jobId}/entries/${entry.entry_id}/fragments/${ordinal}?patientId=${patientId}&operationId=${operationId}`);
   assert.ok(received.bytes.byteLength>0&&received.bytes.byteLength<=3*1024*1024,'fragment_size');
   assert.equal(sha(received.bytes),received.headers.get('x-folio-fragment-sha256'),'fragment_sha');
   assert.equal(received.headers.get('x-folio-file-sha256'),entry.computed_sha256,'file_header_sha');
   assert.equal(Number(received.headers.get('x-folio-fragment-count')),entry.expected_fragments,'fragment_count');
   hash.update(received.bytes);parts.push(received.bytes);
  }
  assert.equal(hash.digest('hex'),entry.computed_sha256,'whole_file_sha');
  const bytes=Buffer.concat(parts);
  if(entry.kind==='document')assert.deepEqual(bytes,seed.file,'document_bytes');
  if(entry.kind==='signature')assert.deepEqual(bytes,seed.signature,'signature_bytes');
  if(entry.kind==='json')assert.ok(JSON.parse(bytes.toString('utf8')).historia_clinica,'json_bytes');
 }
 const noOriginal=await seed.service.storage.from('documentos-clinicos')
  .download(seed.withdrawnPath.slice('documentos-clinicos/'.length));
 assert.notEqual(noOriginal.error,null,'withdrawn_original_unexpectedly_present');
 mark('browser');
 const browser=await proveBrowser({app,seed,operationId,cookies:session.cookies});
 mark('revocation');
 const changed=await seed.service.from('documento_clinico').update({deleted_at:new Date().toISOString()})
  .eq('id',seed.document);
 assert.equal(changed.error,null,'source_revocation_unconfirmed');
 const revoked=await fetch(`${app}/api/patient/export-package/${jobId}/entries/${document.entry_id}/fragments/0?patientId=${patientId}&operationId=${operationId}`,
  {headers:{Cookie:session.header},redirect:'manual',cache:'no-store'});
 assert.equal(revoked.status,409,'revoked_source_not_conflict');
 assert.match(revoked.headers.get('content-type')??'',/^application\/json/,'revoked_response_not_json');
 for(const header of ['x-folio-fragment-sha256','x-folio-file-sha256','x-folio-fragment-count']){
  assert.equal(revoked.headers.get(header),null,'revoked_fragment_header_present');
 }
 const deniedBytes=new Uint8Array(await revoked.arrayBuffer());
 assert.ok(deniedBytes.byteLength>0&&deniedBytes.byteLength<4096,'revoked_response_not_bounded');
 const denial=JSON.parse(new TextDecoder().decode(deniedBytes));
 assert.equal(denial?.ok,false,'revoked_response_malformed');
 assert.equal(denial?.error?.code,'conflict','revoked_response_unclassified');
 console.log(`b06b3_http_verified entries=4 document_fragments=17 max_progress_ms=${Math.max(...measurements)}`);
 console.log('b06b3_http_replay_and_source_revocation_verified');
 console.log(`b06b3_tar_verified bytes=${browser.archiveBytes} sha256=${browser.archiveSha256} seconds=${browser.elapsedSeconds} picker=opfs_adapter`);
 return {maxProgressMs:Math.max(...measurements),...browser};
}
