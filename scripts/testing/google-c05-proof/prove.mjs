import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {installGoogleTransport,startGoogleHttp} from './transport.mjs';

/** Called only after the hosted runner has denied external I/O and seeded MFA. */
export async function proveGoogle({actor,service,scope,receipt,withDatabase,persist}){
 const http=await startGoogleHttp();let restore;
 try{
  Object.assign(process.env,{GOOGLE_OAUTH_CLIENT_ID:'c05-client.invalid',GOOGLE_OAUTH_CLIENT_SECRET:'c05-test-secret',GOOGLE_OAUTH_REDIRECT_URI:`${http.origin}/unused`});
  const {google}=await import('googleapis');restore=installGoogleTransport(google,http.origin);
  const outbound=await import('../../../lib/google/outbound.ts'),inbound=await import('../../../lib/google/inbound.ts');
  const dispatch=(outbound.default??outbound).dispatchGoogleOutbound,sync=(inbound.default??inbound).syncGoogleInbound;
  const {org,member,patient,servicio,integration}=scope;
  const read=async(query)=>{const r=await query;assert.equal(r.error,null);assert.notEqual(r.data,null);return r.data;};
  const rows=(table)=>service.from(table).select('*').eq('organization_id',org);
  const jobs=()=>read(rows('google_outbound_job'));
  const turns=()=>read(rows('turno').order('id'));
  const patients=()=>read(rows('paciente').order('id'));
  const integrationRow=()=>read(service.from('integration').select('*').eq('id',integration).single());
  const organizations=await read(service.from('organization').select('id,is_synthetic,is_internal_account'));
  assert.deepEqual(organizations,[{id:org,is_synthetic:false,is_internal_account:true}]);assert.equal((await patients()).length,1);
  const day=new Date(),base=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()+2,12),start=offset=>new Date(base+offset*3600000).toISOString();
  const reserve=async(offset)=>{
   const id=randomUUID();await read(actor.from('turno').insert({id,organization_id:org,paciente_id:patient,
    servicio_id:servicio,profesional_id:member,inicio:start(offset),duracion_min:30,precio_cents:1000,estado:'AGENDADO'}).select('id').single());
   const own=(await jobs()).filter(j=>j.turno_id===id);assert.equal(own.length,1);return {id,event:own[0].event_id};
  };
  const complete=async(id)=>{const stats=await dispatch(1,id);assert.equal(stats.complete,1);assert.equal(stats.retryable,0);assert.equal(stats.terminal,0);
   assert.equal((await jobs()).find(j=>j.turno_id===id).status,'complete');};
  const transition=async(id,estado)=>{await read(actor.from('turno').update({estado}).eq('id',id).select('id').single());await complete(id);};
  const occupied=async(offset)=>read(actor.rpc('slot_ocupado',{p_org:org,p_profesional:member,p_inicio:start(offset),
   p_fin:new Date(Date.parse(start(offset))+30*60000).toISOString(),p_exclude_pedido:null,p_exclude_turno:null}));
  const mark=async(name,data)=>{receipt.cases[name]={passed:true,...data};await persist();};
  // The actor is authenticated but has no authority to call the service worker RPC.
  const denied=await actor.rpc('google_claim_outbound',{p_limit:1,p_turno:null});assert.equal(denied.error?.code,'42501');
  const first=await reserve(0);await complete(first.id);
  assert.equal((await turns()).find(t=>t.id===first.id).gcal_event_id,first.event);
  assert.equal(http.events.get(first.event).start.dateTime,start(0));
  const operation=randomUUID(),args={p_org:org,p_operation:operation,p_turno:first.id,p_inicio:start(1),p_duracion:null};
  const moved=await read(actor.rpc('reschedule_turno_atomic',args)),replay=await read(actor.rpc('reschedule_turno_atomic',args));
  assert.equal(replay.nuevoTurnoId,moved.nuevoTurnoId);await complete(first.id);await complete(moved.nuevoTurnoId);
  const movedEvent=(await jobs()).find(j=>j.turno_id===moved.nuevoTurnoId).event_id;
  assert.equal(http.events.get(first.event).status,'cancelled');assert.equal(http.events.get(movedEvent).start.dateTime,start(1));
  await transition(moved.nuevoTurnoId,'CANCELADO');assert.equal(http.events.get(movedEvent).status,'cancelled');
  const noShow=await reserve(2);await complete(noShow.id);await transition(noShow.id,'NO_ASISTIO');assert.equal(http.events.get(noShow.event).status,'cancelled');
  await mark('outbound_lifecycle',{turnIds:[first.id,moved.nuevoTurnoId,noShow.id],eventIds:[first.event,movedEvent,noShow.event],operation});
  const uncertain=await reserve(3),beforeInsert=http.calls.insert;http.loseInsert();
  const failed=await dispatch(1,uncertain.id);assert.equal(failed.retryable,1);assert.equal(failed.complete,0);
  assert.ok(http.events.has(uncertain.event));assert.equal(http.calls.insert-beforeInsert,1);
  const failedJob=(await jobs()).find(j=>j.turno_id===uncertain.id);assert.equal(failedJob.status,'pending');assert.equal(failedJob.sanitized_error,'provider_unavailable');
  // Only scheduling of this failed fixture job is advanced; the durable retry path stays real.
  await withDatabase(db=>db.query("UPDATE public.google_outbound_job SET available_at=now() WHERE id=$1 AND organization_id=$2 AND status='pending'",[failedJob.id,org]));
  await complete(uncertain.id);assert.equal(http.calls.insert-beforeInsert,1);assert.equal((await turns()).length,4);
  assert.equal((await jobs()).filter(j=>j.turno_id===uncertain.id).length,1);
  await mark('uncertain_insert',{turnId:uncertain.id,eventId:uncertain.event,acceptedInserts:1,jobState:'complete'});
  const external='c05external';const externalAt=offset=>({id:external,status:'confirmed',summary:'Ensayo externo',
   start:{dateTime:start(offset)},end:{dateTime:new Date(Date.parse(start(offset))+30*60000).toISOString()},etag:'external'});
  assert.equal(await occupied(4),false);http.events.set(external,externalAt(4));await sync(service,await integrationRow());
  assert.equal(await occupied(4),true);await sync(service,await integrationRow());
  assert.equal((await read(rows('bloqueo'))).length,1);
  http.events.set(external,externalAt(5));await sync(service,await integrationRow());assert.equal(await occupied(4),false);assert.equal(await occupied(5),true);
  http.events.delete(external);await sync(service,await integrationRow());assert.equal(await occupied(5),false);assert.equal((await read(rows('bloqueo'))).length,0);
  await mark('external_availability',{eventId:external,slots:[false,true,false,true,false],duplicateBlocks:0});
  const beforeTurns=await turns(),beforePatients=await patients();
  const own=http.events.get(uncertain.event);http.events.set(uncertain.event,{...own,summary:'Título ficticio modificado',start:{dateTime:start(6)},end:{dateTime:new Date(Date.parse(start(6))+30*60000).toISOString()},etag:'edited'});
  await sync(service,await integrationRow());assert.deepEqual(await turns(),beforeTurns);assert.deepEqual(await patients(),beforePatients);
  assert.equal((await read(rows('bloqueo'))).length,0);assert.equal(await occupied(6),false);
  assert.ok(http.calls.token>0);await mark('owned_event_isolation',{eventId:uncertain.event,unchangedTurns:4,unchangedPatients:1,duplicateBlocks:0});
  receipt.http={...http.calls};
 }finally{restore?.();await http.close();}
}
