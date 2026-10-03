import assert from 'node:assert/strict';
import {LIMITS,SCOPE,fail} from './contract.mjs';
import {assertLocalUrl} from '../isolation-policy.mjs';

// This module is used only by the external runner. Internal tests keep their existing isolation.
export function createTransport({manifest,grant,clientSecret,receipt,persist,fetchImpl,now=Date.now}){
 const began=now(),ids=new Map();let accessToken=null,loseId=null,lost=false,stopped=false,preflight=true;
 const base=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(manifest.calendarId)}/events`;
 const check=()=>{if(stopped||now()-began>=LIMITS.milliseconds||now()>=Date.parse(manifest.authorization.expiresAt))fail('trial_stopped');};
 const register=(id,label)=>{check();assert.match(id,/^[a-v0-9]{5,1024}$/);assert.match(label,/^[A-E]$/);
  if(ids.has(id)){assert.equal(ids.get(id),label);return;}
  assert.ok(ids.size<LIMITS.ids&&!Array.from(ids.values()).includes(label),'event_budget');ids.set(id,label);
  receipt.events.push({id,label,state:'registered'});
 };
 const eventRecord=id=>receipt.events.find(e=>e.id===id);
 const send=async(url,options={})=>{
  check();assert.equal(receipt.requests<LIMITS.requests,true,'request_budget');receipt.requests++;await persist();
  const res=await fetchImpl(url,{...options,redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  const text=await res.text();assert.ok(text.length<=262144,'response_limit');let data;
  try{data=text?JSON.parse(text):{};}catch{fail('provider_response_invalid');}
  if(!res.ok){const e=Error('provider_rejected');e.code=res.status;e.response={status:res.status};throw e;}return data;
 };
 const token=async()=>{
  check();if(accessToken)return accessToken;
  const data=await send('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:manifest.clientId,client_secret:clientSecret,refresh_token:grant.refreshToken,grant_type:'refresh_token'})});
  assert.ok(typeof data.access_token==='string'&&data.access_token.length>10,'token_invalid');
  if(data.scope!==undefined)assert.deepEqual(data.scope.split(' ').sort(),[SCOPE],'token_scope');
  assert.equal(data.token_type?.toLowerCase(),'bearer','token_invalid');accessToken=data.access_token;return accessToken;
 };
 const request=async(method,id,body,query={},headers={},signal)=>{
  check();assert.ok(['GET','POST','PATCH','DELETE'].includes(method),'method_forbidden');
  if(id!==null)assert.ok(ids.has(id),'event_id_forbidden');
  if(!id&&method!=='GET'&&method!=='POST')fail('method_forbidden');
  const mutation=method!=='GET',eventId=id??body?.id;
  if(receipt.uncertain&&(method!=='GET'||id!==receipt.uncertain))fail('uncertain_requires_readback');
  if(mutation){assert.equal(preflight,false,'preflight_required');assert.ok(ids.has(eventId),'event_id_forbidden');assert.ok(receipt.mutations<LIMITS.mutations,'mutation_budget');}
  if(method==='POST')assert.ok(['registered','rejected'].includes(eventRecord(eventId).state),'confirmed_insert_replay_forbidden');
  const url=new URL(base+(id?`/${id}`:''));
  const allowed=method==='GET'?['timeMin','timeMax','singleEvents','orderBy','maxResults','pageToken','showDeleted','fields']:['sendUpdates'];
  for(const [key,value] of Object.entries(query)){assert.ok(allowed.includes(key),'query_forbidden');if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));}
  if(mutation)url.searchParams.set('sendUpdates','none');
  let safe;
  if(body){
   body=Object.fromEntries(Object.entries(body).filter(([,value])=>value!==undefined));
   for(const key of Object.keys(body))assert.ok(['id','summary','description','start','end','status','reminders','extendedProperties'].includes(key),'payload_forbidden');
   if(body.description!==undefined)assert.equal(body.description,'Reserva gestionada por Folio.','payload_forbidden');
   if(body.summary!==undefined)assert.ok(['Turno reservado',`Folio C05 prueba ${ids.get(eventId)}`,`Folio C05 prueba ${ids.get(eventId)} editado`].includes(body.summary),'payload_forbidden');
   safe={...body};delete safe.description;if(body.summary!==undefined)safe.summary=body.summary==='Turno reservado'?`Folio C05 prueba ${ids.get(eventId)}`:body.summary;
   for(const k of ['start','end'])if(body[k]){
    assert.deepEqual(Object.keys(body[k]).sort(),['dateTime','timeZone'],'payload_time');
    const time=Date.parse(body[k].dateTime);assert.ok(Number.isFinite(time)&&time>began&&time<began+30*86400000,'payload_time');
    assert.equal(body[k].timeZone,'America/Argentina/Buenos_Aires','payload_timezone');
   }
   if(method==='POST'){assert.equal(body.id,eventId,'stable_id');assert.equal(body.extendedProperties?.private?.folio_operation,eventId,'ownership_marker');assert.deepEqual(body.reminders,{useDefault:true},'payload_reminders');}
   if(body.status!==undefined)assert.equal(body.status,'cancelled','payload_status');
  }
  const bearer=await token();
  if(mutation){assert.equal(receipt.uncertain,null,'uncertain_requires_readback');assert.ok(receipt.mutations<LIMITS.mutations,'mutation_budget');receipt.mutations++;receipt.uncertain=eventId;eventRecord(eventId).state='uncertain';await persist();}
  let data;
  try{data=await send(url,{method,headers:{Authorization:`Bearer ${bearer}`,...(safe?{'Content-Type':'application/json'}:{}),...((headers['If-Match']??headers['if-match'])?{'If-Match':headers['If-Match']??headers['if-match']}:{})},...(safe?{body:JSON.stringify(safe)}:{}),signal});}
  catch(e){
   if(mutation&&e.code>=400&&e.code<500){receipt.uncertain=null;eventRecord(eventId).state='rejected';await persist();}
   // Never let gaxios errors expose request URLs, headers or response payloads.
   const error=Error('provider_unavailable');if(e.code){error.code=e.code;error.response={status:e.code};}throw error;
  }
  if(method==='POST'&&eventId===loseId&&!lost){lost=true;throw Error('provider_unavailable');}
  if(id&&method==='GET'&&receipt.uncertain===id){assert.equal(data.id,id,'readback_id');assert.equal(data.extendedProperties?.private?.folio_operation,id,'readback_ownership');receipt.uncertain=null;eventRecord(id).state=data.status==='cancelled'?'cancelled':'confirmed';await persist();}
  if(mutation){receipt.uncertain=null;eventRecord(eventId).state=method==='DELETE'?'deleted':data.status==='cancelled'?'cancelled':'confirmed';await persist();}
  if(!id&&method==='GET'&&!preflight)for(const event of data.items??[])assert.ok(ids.has(event.id),'foreign_event_observed');
  return data;
 };
 const adapter=async options=>{
  const u=new URL(options.url);if(u.username||u.password||u.hash)fail('transport_escape');
  let data;
  if(u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/token'&&!u.search){
   assert.equal(String(options.method).toUpperCase(),'POST','token_method');
   const form=new URLSearchParams(options.data);assert.equal(form.get('grant_type'),'refresh_token','token_grant');assert.equal(form.get('refresh_token'),grant.refreshToken,'token_grant');
   data={access_token:await token(),token_type:'Bearer',expires_in:3600};
  }else{
   assert.equal(u.origin,new URL(base).origin,'transport_escape');
   const basePath=new URL(base).pathname;assert.ok(u.pathname===basePath||u.pathname.startsWith(basePath+'/'),'transport_escape');
   const id=u.pathname===basePath?null:u.pathname.slice(basePath.length+1);assert.ok(!id||/^[a-v0-9]+$/.test(id),'transport_escape');
   data=await request(String(options.method??'GET').toUpperCase(),id,options.data,Object.fromEntries(u.searchParams),Object.fromEntries(new Headers(options.headers)),options.signal);
  }
  return {data,status:200,statusText:'OK',headers:new Headers({'content-type':'application/json'}),config:options};
 };
 return {register,request,adapter,calls:receipt,ids,
  allowMutations:()=>{preflight=false;},loseInsert:id=>{assert.ok(ids.has(id));assert.equal(loseId,null);loseId=id;},
  stop:()=>{stopped=true;},get lost(){return lost;}};
}
export function installTransport(google,transport){
 const Original=google.auth.OAuth2,previous=google._options;
 google.auth.OAuth2=class extends Original{constructor(options){super({...options,transporterOptions:{...options.transporterOptions,adapter:transport.adapter}});}};
 google.options({adapter:transport.adapter});return()=>{google.auth.OAuth2=Original;google.options(previous);};
}
export function installLoopbackFetch(){
 const original=globalThis.fetch;
 globalThis.fetch=(input,options)=>{assertLocalUrl(typeof input==='string'||input instanceof URL?input:input.url);return original(input,options);};
 return()=>{globalThis.fetch=original;};
}
