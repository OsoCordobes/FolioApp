import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

export const MAIL_PROJECT='folio_mail_internal_proof';
export const MAIL_API='http://127.0.0.1:55421';
export const MAIL_CASES=['active','revoked','email_changed','lookup_failure','retry_identity'];
const expected={active:[1,'accepted'],revoked:[0,'terminal'],email_changed:[0,'terminal'],lookup_failure:[0,'retryable'],retry_identity:[2,'accepted']};
const phases=new Set(['preflight','pull','services','migrations','schema','auth','fixture','cleanup','unclassified']);
export function assertMailFixtureIsolation(state){
 assert.equal(state.project,MAIL_PROJECT);assert.equal(state.githubActions,'true');
 assert.equal(state.runnerEnvironment,'github-hosted');assert.equal(state.platform,'linux');
 assert.equal(state.fresh,true);assert.equal(state.internalNetwork,true);assert.equal(state.apiUrl,MAIL_API);
}
/** @returns {{sha:string,cases:Record<string,{passed:boolean,sends:number,state:string,invariant:boolean}>,failure:string|null,cleanup:boolean,migrations:number}} */
export function mailReceipt(sha){
 assert.match(sha,/^[a-f0-9]{40}$/);
 return {sha,cases:{},failure:null,cleanup:false,migrations:0};
}
/** Return an allowlisted receipt: never serialize input identities, messages or secrets. */
export function finishMailReceipt(receipt){
 assert.match(receipt.sha,/^[a-f0-9]{40}$/);
 /** @type {Record<string,{passed:boolean,sends:number|null,state:string,invariant:boolean}>} */
 const cases={};
 for(const name of MAIL_CASES){
  const value=receipt.cases?.[name];if(!value)continue;
  const [sends,state]=expected[name];
  cases[name]={passed:value.passed===true&&value.sends===sends&&value.state===state&&value.invariant===true,
   sends:Number.isInteger(value.sends)&&value.sends>=0&&value.sends<=2?value.sends:null,
   state:['accepted','terminal','retryable'].includes(value.state)?value.state:'unknown',invariant:value.invariant===true};
 }
 const failure=receipt.failure===null?null:phases.has(receipt.failure)?receipt.failure:'unclassified';
 const migrations=Number.isInteger(receipt.migrations)&&receipt.migrations>0?receipt.migrations:0;
 const passed=receipt.cleanup===true&&failure===null&&migrations>0&&Object.keys(receipt.cases??{}).length===MAIL_CASES.length&&MAIL_CASES.every(name=>cases[name]?.passed===true);
 return {version:1,sha:receipt.sha,environment:'github-ephemeral-supabase',provider:'function-stub',lookupFailure:'injected-http-read',
  cases,failure,cleanup:receipt.cleanup===true,migrations,passed};
}

/** Inject one non-retried HTTP 403 on the matching member GET; other I/O stays real. */
export function mailReadFailureFetch(baseFetch,{org,member}){
 let injections=0;
 return {get injections(){return injections;},fetch:async(input,options)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  assert.equal(url.origin,MAIL_API,'mail_http_scope_escape');
  const method=options?.method??(typeof input==='object'&&'method' in input?input.method:'GET');
  if(injections===0&&method.toUpperCase()==='GET'&&url.pathname==='/rest/v1/member'
   &&url.searchParams.get('id')===`eq.${member}`&&url.searchParams.get('organization_id')===`eq.${org}`){
   injections++;return new Response(JSON.stringify({code:'MAIL_INTERNAL_INJECTED_READ_FAILURE',message:'Synthetic HTTP read failure'}),
    {status:403,headers:{'Content-Type':'application/json'}});
  }
  return baseFetch(input,options);
 }};
}

/** Hosted entry only: real producer/DB/RPC; explicit function stub, never sendEmail. */
export async function proveMail({service,scope,isolation,receipt,withDatabase,persist}){
 assertMailFixtureIsolation(isolation);
 assert.equal(process.env.FOLIO_TEST_ISOLATED,'1');assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,MAIL_API);
 assert.notEqual(process.env.FOLIO_EMAIL_DELIVERY_ENABLED,'true');
 assert.equal(process.env.RESEND_API_KEY,undefined);assert.equal(process.env.EMAIL_FROM,undefined);
 const notifyModule=await import('../../../lib/email/notify.ts'),durableModule=await import('../../../lib/email/durable.ts');
 const cryptoModule=await import('../../../lib/crypto.ts'),clientModule=await import('../../../lib/email/client.ts');
 const {notifyPedidoNuevo}=notifyModule.default??notifyModule;
 const {processEmailDelivery,emailDedupeKey}=durableModule.default??durableModule;
 const {encryptColumn,decryptColumn}=cryptoModule.default??cryptoModule;
 const {emailDeliveryConfiguration}=clientModule.default??clientModule;
 assert.equal(emailDeliveryConfiguration().enabled,false);assert.equal(emailDeliveryConfiguration().providerConfigured,false);
 const {org,member,profile,email,patient,servicio}=scope;
 assert.match(email,/^mail-internal-[a-f0-9-]+@example\.test$/);
 const read=async(query)=>{const result=await query;assert.equal(result.error,null,'mail_database_call_failed');assert.notEqual(result.data,null,'mail_database_data_missing');return result.data;};
 assert.deepEqual(await read(service.from('organization').select('id,is_synthetic,is_internal_account,deleted_at')),
  [{id:org,is_synthetic:false,is_internal_account:true,deleted_at:null}]);
 const membership=await read(service.from('member').select('id,organization_id,profile_id,role,deleted_at,accepted_at').eq('id',member).eq('organization_id',org).single());
 assert.equal(membership.profile_id,profile);assert.equal(membership.role,'PROFESIONAL');assert.equal(membership.deleted_at,null);assert.ok(membership.accepted_at);
 const row=async(id)=>read(service.from('email_delivery').select('*').eq('id',id).eq('organization_id',org).single());
 const claim=async(id)=>{
  const rows=await read(service.rpc('email_claim',{p_limit:1,p_id:id}));assert.equal(rows.length,1,'mail_claim_missing');
  assert.equal(rows[0].organization_id,org);assert.equal(rows[0].status,'leased');assert.ok(rows[0].lease_token);return rows[0];
 };
 const enqueue=async()=>{
  const pedido=randomUUID();
  await read(service.from('pedido').insert({id:pedido,organization_id:org,canal:'WEB',estado:'PENDIENTE',
   nombre_cifrado:encryptColumn('Solicitante ficticio'),paciente_id:patient,profesional_id:member,servicio_id:servicio,duracion_min:30,precio_cents:1000}).select('id').single());
  const input={client:service,organizationId:org,pedidoId:pedido,profesionalId:member,pacienteNombre:'Solicitante ficticio',canal:'WEB',fechaPropuestaIso:null};
  assert.deepEqual(await notifyPedidoNuevo(input),{status:'queued',detail:'delivery_configuration_pending'});
  const queued=await read(service.from('email_delivery').select('*').eq('organization_id',org).eq('dedupe_key',emailDedupeKey(org,`pedido:${pedido}`)).single());
  assert.equal(queued.status,'pending');assert.equal(queued.kind,'booking_request');assert.ok(queued.payload_cifrado);
  const plaintext=JSON.parse(decryptColumn(queued.payload_cifrado));
  assert.equal(plaintext.to,email);assert.deepEqual(plaintext.recipientAuthority,{version:1,organizationId:org,pedidoId:pedido,
   memberId:member,profileId:profile,selection:'assigned_member',assignedMemberId:member,roleAtEnqueue:'PROFESIONAL'});
  return {queued,input};
 };
 const stub=(calls,uncertainFirst=false)=>async(input)=>{
  assert.equal(input.to,email);assert.deepEqual(Object.keys(input).sort(),['html','idempotencyKey','replyTo','subject','to']);
  calls.push({...input});
  return uncertainFirst&&calls.length===1?{status:'uncertain',detail:'provider_response_unknown'}:{status:'sent',providerId:'mail-proof-receipt'};
 };
 const mark=async(name,sends,state)=>{receipt.cases[name]={passed:true,sends,state,invariant:true};await persist();};
 const terminal=async(job,client)=>{
  const calls=[];const result=await processEmailDelivery(client,await claim(job.id),stub(calls));
  assert.deepEqual(result,{status:'failed',detail:'email_recipient_authority_lost',retryable:false});assert.equal(calls.length,0);
  const closed=await row(job.id);assert.equal(closed.status,'terminal');assert.equal(closed.payload_cifrado,null);
  assert.equal(closed.created_at,job.created_at);assert.equal(closed.dedupe_key,job.dedupe_key);assert.equal(closed.provider_id,null);
  assert.equal(closed.sanitized_error,'email_recipient_authority_lost');assert.equal(closed.lease_token,null);
 };

 const active=await enqueue(),activeCalls=[];
 assert.deepEqual(await processEmailDelivery(service,await claim(active.queued.id),stub(activeCalls)),{status:'sent',providerId:'mail-proof-receipt'});
 const accepted=await row(active.queued.id);assert.equal(activeCalls.length,1);assert.equal(accepted.status,'accepted');assert.equal(accepted.provider_id,'mail-proof-receipt');
 assert.equal(accepted.payload_cifrado,null);assert.equal(accepted.delivered_at,null);
 assert.deepEqual(await notifyPedidoNuevo(active.input),{status:'sent',providerId:'mail-proof-receipt'});
 assert.equal(activeCalls.length,1);await mark('active',1,'accepted');

 const revoked=await enqueue();
 await withDatabase(async db=>{const changed=await db.query("UPDATE public.member SET deleted_at=now() WHERE id=$1 AND organization_id=$2 AND profile_id=$3 AND role='PROFESIONAL' AND deleted_at IS NULL RETURNING id",[member,org,profile]);assert.equal(changed.rowCount,1);});
 try{await terminal(revoked.queued,service);}finally{
  await withDatabase(async db=>{const restored=await db.query("UPDATE public.member SET deleted_at=NULL WHERE id=$1 AND organization_id=$2 AND profile_id=$3 AND role='PROFESIONAL' AND deleted_at IS NOT NULL RETURNING id",[member,org,profile]);assert.equal(restored.rowCount,1);});
 }
 await mark('revoked',0,'terminal');

 const changedEmail=await enqueue(),replacement=`mail-changed-${randomUUID()}@example.test`;
 await withDatabase(async db=>{const changed=await db.query('UPDATE public.profile SET email=$2 WHERE id=$1 AND email=$3 RETURNING id',[profile,replacement,email]);assert.equal(changed.rowCount,1);});
 try{await terminal(changedEmail.queued,service);}finally{
  await withDatabase(async db=>{const restored=await db.query('UPDATE public.profile SET email=$2 WHERE id=$1 AND email=$3 RETURNING id',[profile,email,replacement]);assert.equal(restored.rowCount,1);});
 }
 await mark('email_changed',0,'terminal');

 const lookup=await enqueue(),lookupCalls=[],fault=mailReadFailureFetch(globalThis.fetch,{org,member});
 const faulty=createClient(MAIL_API,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fault.fetch}});
 assert.deepEqual(await processEmailDelivery(faulty,await claim(lookup.queued.id),stub(lookupCalls)),{status:'failed',detail:'email_recipient_lookup_failed',retryable:true});
 const waiting=await row(lookup.queued.id);assert.equal(fault.injections,1);assert.equal(lookupCalls.length,0);assert.equal(waiting.status,'retryable');
 assert.equal(waiting.payload_cifrado,lookup.queued.payload_cifrado);assert.equal(waiting.created_at,lookup.queued.created_at);assert.equal(waiting.dedupe_key,lookup.queued.dedupe_key);
 assert.equal(waiting.sanitized_error,'email_recipient_lookup_failed');await mark('lookup_failure',0,'retryable');

 const retry=await enqueue(),stale=await claim(retry.queued.id);
 await withDatabase(async db=>{const changed=await db.query("UPDATE public.email_delivery SET lease_until=now()-interval '1 second' WHERE id=$1 AND organization_id=$2 AND status='leased' AND lease_token=$3 RETURNING id",[stale.id,org,stale.lease_token]);assert.equal(changed.rowCount,1);});
 const current=await claim(retry.queued.id);assert.notEqual(current.lease_token,stale.lease_token);
 assert.equal(await read(service.rpc('email_finish',{p_id:stale.id,p_token:stale.lease_token,p_status:'accepted',p_provider_id:'stale-proof-receipt'})),false);
 assert.equal((await row(stale.id)).status,'leased');
 const retryCalls=[],retryStub=stub(retryCalls,true);
 assert.deepEqual(await processEmailDelivery(service,current,retryStub),{status:'uncertain',detail:'provider_response_unknown'});
 const pending=await row(current.id);assert.equal(pending.status,'retryable');assert.equal(pending.payload_cifrado,retry.queued.payload_cifrado);
 assert.deepEqual(await notifyPedidoNuevo(retry.input),{status:'queued',detail:'delivery_configuration_pending'});
 const duplicate=await row(current.id);assert.equal(duplicate.payload_cifrado,retry.queued.payload_cifrado);assert.equal(duplicate.created_at,retry.queued.created_at);
 await withDatabase(async db=>{const changed=await db.query("UPDATE public.email_delivery SET available_at=now() WHERE id=$1 AND organization_id=$2 AND status='retryable' AND lease_token IS NULL RETURNING id",[current.id,org]);assert.equal(changed.rowCount,1);});
 assert.deepEqual(await processEmailDelivery(service,await claim(current.id),retryStub),{status:'sent',providerId:'mail-proof-receipt'});
 assert.deepEqual(retryCalls[0],retryCalls[1]);assert.equal(retryCalls[0].idempotencyKey,`folio-email/${current.id}`);
 const final=await row(current.id);assert.equal(final.status,'accepted');assert.equal(final.payload_cifrado,null);assert.equal(final.created_at,retry.queued.created_at);
 assert.equal((await read(service.from('email_delivery').select('id').eq('organization_id',org))).length,5);
 await mark('retry_identity',2,'accepted');
}
