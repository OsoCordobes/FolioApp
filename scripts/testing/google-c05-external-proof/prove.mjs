import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assertGoogleSyncObserved} from '../google-c05-proof/contract.mjs';

// The same four worker cases as google-c05-proof/prove.mjs, with provider readback.
// OAuth UI/watch/webhook/cron are deliberately outside this proof contract.
export async function proveExternal({actor,service,scope,receipt,withDatabase,persist,transport}){
 const out=await import('../../../lib/google/outbound.ts'),inc=await import('../../../lib/google/inbound.ts');
 const dispatch=(out.default??out).dispatchGoogleOutbound,sync=(inc.default??inc).syncGoogleInbound;
 const {org,member,patient,servicio,integration}=scope;
 const read=async query=>{const r=await query;assert.equal(r.error,null,'proof_query');assert.notEqual(r.data,null,'proof_query');return r.data;};
 const rows=table=>service.from(table).select('*').eq('organization_id',org),jobs=()=>read(rows('google_outbound_job')),
  turns=()=>read(rows('turno').order('id')),patients=()=>read(rows('paciente').order('id'));
 const organizations=await read(service.from('organization').select('id,is_synthetic,is_internal_account'));
 assert.deepEqual(organizations,[{id:org,is_synthetic:false,is_internal_account:true}]);assert.equal((await patients()).length,1);assert.equal((await turns()).length,0);assert.equal((await jobs()).length,0);
 const day=new Date(),base=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()+2,12),start=n=>new Date(base+n*3600000).toISOString();
 const eventAt=(id,label,n)=>({id,summary:`Folio C05 prueba ${label}`,start:{dateTime:start(n),timeZone:'America/Argentina/Buenos_Aires'},end:{dateTime:new Date(Date.parse(start(n))+30*60000).toISOString(),timeZone:'America/Argentina/Buenos_Aires'},reminders:{useDefault:true},extendedProperties:{private:{folio_operation:id}}});
 const reserve=async(n,label)=>{
  const id=randomUUID();await read(actor.from('turno').insert({id,organization_id:org,paciente_id:patient,servicio_id:servicio,profesional_id:member,
   inicio:start(n),duracion_min:30,precio_cents:1000,estado:'AGENDADO'}).select('id').single());
  const own=(await jobs()).filter(j=>j.turno_id===id);assert.equal(own.length,1);transport.register(own[0].event_id,label);await persist();return {id,event:own[0].event_id};
 };
 const complete=async id=>{const stats=await dispatch(1,id);assert.equal(stats.complete,1);assert.equal(stats.retryable,0);assert.equal(stats.terminal,0);assert.equal((await jobs()).find(j=>j.turno_id===id).status,'complete');};
 const get=id=>transport.request('GET',id),transition=async(id,state)=>{await read(actor.from('turno').update({estado:state}).eq('id',id).select('id').single());await complete(id);};
 const syncObserved=async()=>{const before=receipt.requests,result=await sync(service,await read(service.from('integration').select('*').eq('id',integration).single()));assertGoogleSyncObserved(result,before,receipt.requests);};
 const occupied=async n=>read(actor.rpc('slot_ocupado',{p_org:org,p_profesional:member,p_inicio:start(n),p_fin:new Date(Date.parse(start(n))+30*60000).toISOString(),p_exclude_pedido:null,p_exclude_turno:null}));
 const mark=async name=>{receipt.cases[name]={passed:true};await persist();};
 const denied=await actor.rpc('google_claim_outbound',{p_limit:1,p_turno:null});assert.equal(denied.error?.code,'42501');
 const first=await reserve(0,'A');await complete(first.id);assert.equal(Date.parse((await get(first.event)).start.dateTime),Date.parse(start(0)));
 assert.equal((await turns()).find(t=>t.id===first.id).gcal_event_id,first.event);
 const args={p_org:org,p_operation:randomUUID(),p_turno:first.id,p_inicio:start(1),p_duracion:null};
 const moved=await read(actor.rpc('reschedule_turno_atomic',args)),replay=await read(actor.rpc('reschedule_turno_atomic',args));assert.equal(replay.nuevoTurnoId,moved.nuevoTurnoId);
 const movedEvent=(await jobs()).find(j=>j.turno_id===moved.nuevoTurnoId).event_id;transport.register(movedEvent,'B');await persist();
 await complete(first.id);await complete(moved.nuevoTurnoId);assert.equal((await get(first.event)).status,'cancelled');assert.equal(Date.parse((await get(movedEvent)).start.dateTime),Date.parse(start(1)));
 await transition(moved.nuevoTurnoId,'CANCELADO');assert.equal((await get(movedEvent)).status,'cancelled');
 const noShow=await reserve(2,'C');await complete(noShow.id);await transition(noShow.id,'NO_ASISTIO');assert.equal((await get(noShow.event)).status,'cancelled');await mark('outbound_lifecycle');
 const uncertain=await reserve(3,'D'),beforeMutations=receipt.mutations;transport.loseInsert(uncertain.event);
 const failed=await dispatch(1,uncertain.id);assert.equal(failed.retryable,1);assert.equal(failed.complete,0);assert.equal(transport.lost,true);assert.equal(receipt.mutations-beforeMutations,1);assert.equal(receipt.uncertain,uncertain.event);
 // Reconcile accepted insert by its stable ID before any other write; do not insert again.
 const reconciled=await get(uncertain.event);assert.equal(reconciled.id,uncertain.event);assert.equal(receipt.uncertain,null);
 const failedJob=(await jobs()).find(j=>j.turno_id===uncertain.id);assert.equal(failedJob.status,'pending');assert.equal(failedJob.sanitized_error,'provider_unavailable');
 await withDatabase(db=>db.query("UPDATE public.google_outbound_job SET available_at=now() WHERE id=$1 AND organization_id=$2 AND status='pending'",[failedJob.id,org]));
 await complete(uncertain.id);assert.equal((await turns()).length,4);assert.equal((await jobs()).filter(j=>j.turno_id===uncertain.id).length,1);await mark('uncertain_insert');
 const external=`c05${receipt.runId}`;transport.register(external,'E');await persist();assert.equal(await occupied(4),false);
 await transport.request('POST',null,eventAt(external,'E',4));await syncObserved();assert.equal(await occupied(4),true);await syncObserved();assert.equal((await read(rows('bloqueo'))).length,1);
 const externalBefore=await get(external);await transport.request('PATCH',external,{start:eventAt(external,'E',5).start,end:eventAt(external,'E',5).end},{},{'If-Match':externalBefore.etag});
 await syncObserved();assert.equal(await occupied(4),false);assert.equal(await occupied(5),true);
 await transport.request('DELETE',external);await syncObserved();assert.equal(await occupied(5),false);assert.equal((await read(rows('bloqueo'))).length,0);await mark('external_availability');
 const beforeTurns=await turns(),beforePatients=await patients(),own=await get(uncertain.event),edited=eventAt(uncertain.event,'D',6);
 await transport.request('PATCH',uncertain.event,{summary:'Folio C05 prueba D editado',start:edited.start,end:edited.end},{},{'If-Match':own.etag});
 await syncObserved();assert.deepEqual(await turns(),beforeTurns);assert.deepEqual(await patients(),beforePatients);assert.equal((await read(rows('bloqueo'))).length,0);assert.equal(await occupied(6),false);await mark('owned_event_isolation');
}
export async function cleanupKnownEvents({transport,receipt,persist}){
 assert.equal(receipt.uncertain,null,'cleanup_requires_reconciliation');
 for(const {id,state} of receipt.events){
  if(state==='deleted')continue;
  let event;try{event=await transport.request('GET',id);}catch(e){
   if([404,410].includes(e.code)&&['cancelled','registered','rejected'].includes(state))continue;throw e;
  }
  assert.equal(event.id,id,'cleanup_id');
  // Cancelled events are already absent from availability; Google can omit their private fields.
  if(event.status==='cancelled'){assert.equal(state,'cancelled','cleanup_state');continue;}
  assert.equal(event.extendedProperties?.private?.folio_operation,id,'cleanup_ownership');
  await transport.request('DELETE',id);
 }
 const snapshot=await transport.request('GET',null,undefined,{maxResults:1,fields:'kind,etag,items(id),nextPageToken,nextSyncToken,defaultReminders,accessRole'});
 assert.equal(snapshot.kind,'calendar#events');assert.deepEqual(snapshot.items??[],[]);assert.equal(snapshot.nextPageToken,undefined);
 receipt.googleCleanup=true;await persist();
}
