import assert from 'node:assert/strict';
import http from 'node:http';
import {assertLocalUrl} from '../isolation-policy.mjs';

/** Redirect only Calendar and token transport; still perform real loopback HTTP. */
export function googleAdapter(origin){
 const local=assertLocalUrl(origin);
 assert.equal(local.protocol,'http:');assert.equal(local.hostname,'127.0.0.1');
 assert.ok(Number(local.port)>1024);assert.equal(local.pathname,'/');assert.equal(local.search,'');assert.equal(local.hash,'');
 return async (options,defaultAdapter)=>{
  const url=new URL(options.url);
  const calendar=url.origin==='https://www.googleapis.com'&&/^\/calendar\/v3\/calendars\/c05-internal\/events(?:\/[a-z0-9]+)?$/.test(url.pathname);
  const oauth=url.origin==='https://oauth2.googleapis.com'&&url.pathname==='/token';
  if(url.username||url.password||url.hash||(!calendar&&!oauth))throw Error('c05_transport_escape');
  return defaultAdapter({...options,url:new URL(url.pathname+url.search,local.origin)});
 };
}
export function installGoogleTransport(google,origin){
 const adapter=googleAdapter(origin),Original=google.auth.OAuth2,previous=google._options;
 google.auth.OAuth2=class extends Original {
  constructor(options){super({...options,transporterOptions:{...options.transporterOptions,adapter}});}
 };
 google.options({adapter});
 return ()=>{google.auth.OAuth2=Original;google.options(previous);};
}
export async function startGoogleHttp(){
 const events=new Map(),calls={insert:0,get:0,patch:0,list:0,token:0};let revision=0,loseNextInsert=false;
 const server=http.createServer(async(req,res)=>{
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  try{
   let text='';for await(const chunk of req){text+=chunk;assert.ok(text.length<32768);}
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/token'&&req.method==='POST'){
    const body=new URLSearchParams(text);
    assert.equal(body.get('refresh_token'),'c05-http-refresh');assert.equal(body.get('grant_type'),'refresh_token');
    assert.equal(body.get('client_id'),'c05-client.invalid');assert.equal(body.get('client_secret'),'c05-test-secret');
    calls.token++;return reply(200,{access_token:'c05-http-access',token_type:'Bearer',expires_in:3600});
   }
   assert.equal(req.headers.authorization,'Bearer c05-http-access');
   const match=/^\/calendar\/v3\/calendars\/c05-internal\/events(?:\/([a-z0-9]+))?$/.exec(url.pathname);
   assert.ok(match);const id=match[1],body=text?JSON.parse(text):{};
   if(req.method==='GET'&&!id){
    calls.list++;const start=Date.parse(url.searchParams.get('timeMin')),end=Date.parse(url.searchParams.get('timeMax'));
    const active=[...events.values()].filter(e=>e.status!=='cancelled'&&Date.parse(e.end.dateTime)>start&&Date.parse(e.start.dateTime)<end);
    const offset=Number(url.searchParams.get('pageToken')??0),items=active.slice(offset,offset+2);
    return reply(200,{kind:'calendar#events',etag:'snapshot',items,
     ...(offset+2<active.length?{nextPageToken:String(offset+2)}:{nextSyncToken:'complete'})});
   }
   if(req.method==='GET'&&id){calls.get++;return reply(events.has(id)?200:404,events.get(id)??{error:{code:404}});}
   assert.equal(url.searchParams.get('sendUpdates'),'none');
   if(req.method==='POST'&&!id){
    calls.insert++;assert.match(body.id,/^[a-z0-9]+$/);assert.equal(body.extendedProperties?.private?.folio_operation,body.id);
    assert.equal(body.summary,'Turno reservado');assert.equal(body.description,'Reserva gestionada por Folio.');
    assert.equal(body.attendees,undefined);assert.equal(body.location,undefined);
    if(events.has(body.id))return reply(409,{error:{code:409}});
    const row={...body,status:'confirmed',etag:`revision${++revision}`};events.set(body.id,row);
    if(loseNextInsert){loseNextInsert=false;req.socket.destroy();return;}
    return reply(200,row);
   }
   if(req.method==='PATCH'&&id&&events.has(id)){
    calls.patch++;if(req.headers['if-match']!==events.get(id).etag)return reply(412,{error:{code:412}});
    const row={...events.get(id),...body,etag:`revision${++revision}`};events.set(id,row);return reply(200,row);
   }
   reply(405,{error:{code:405}});
  }catch{reply(400,{error:{code:400}});}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {origin:`http://127.0.0.1:${server.address().port}`,events,calls,
  loseInsert:()=>{loseNextInsert=true;},
  close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
