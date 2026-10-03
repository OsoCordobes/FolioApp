import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManifest,validateGrant,assertHosted,assertEmptySnapshot,receipt,sanitizedReceipt,SCOPE,LIMITS} from './contract.mjs';
import {createTransport,installTransport,installLoopbackFetch} from './transport.mjs';
import {bootstrapChallenge,validateCallback,exchange} from './oauth-bootstrap.mjs';
import {cleanupKnownEvents} from './prove.mjs';
const epoch=Date.parse('2026-10-03T10:00:00Z'),sha='a'.repeat(40);
const manifest=()=>({version:1,runId:'b'.repeat(32),candidateSha:sha,environment:'synthetic-test-environment',accountEmail:'c05-account@example.test',calendarId:'c05-account@example.test',
 clientId:'synthetic.apps.googleusercontent.com',redirectUri:'http://127.0.0.1:49123/callback',authorization:{reference:'synthetic-authorization',approvedAt:new Date(epoch-1000).toISOString(),expiresAt:new Date(epoch+3600000).toISOString(),dedicatedAccount:true,noSharedCalendars:true,allowConsent:true,allowCreateMoveDeleteFiveEvents:true}});
const grant=m=>({version:1,clientId:m.clientId,accountEmail:m.accountEmail,calendarId:m.calendarId,scopes:[SCOPE],refreshToken:'synthetic-refresh-token-only-123456',consentAt:new Date(epoch).toISOString(),custodianConfirmedDedicatedAccount:true});
const context={sha,environment:'synthetic-test-environment',authorizationId:'synthetic-authorization',now:epoch};
function harness(handler=()=>({id:'abcde',status:'confirmed',etag:'e1',extendedProperties:{private:{folio_operation:'abcde'}}})){
 const m=manifest(),r=receipt(m,'c'.repeat(40)),calls=[],journal=[];let now=epoch;
 const fetchImpl=async(url,options)=>{calls.push({url:String(url),options});if(String(url).includes('/token'))return new Response(JSON.stringify({access_token:'synthetic-access-token',token_type:'Bearer',scope:SCOPE}));const value=handler(url,options);return value instanceof Response?value:new Response(JSON.stringify(value));};
 const t=createTransport({manifest:m,grant:grant(m),clientSecret:'synthetic-secret-only',receipt:r,persist:async()=>journal.push(JSON.parse(JSON.stringify(r))),fetchImpl,now:()=>now});
 return {m,r,t,calls,journal,advance:ms=>{now+=ms;}};
}
const body={id:'abcde',summary:'Turno reservado',description:'Reserva gestionada por Folio.',attendees:undefined,location:undefined,
 start:{dateTime:new Date(epoch+86400000).toISOString(),timeZone:'America/Argentina/Buenos_Aires'},end:{dateTime:new Date(epoch+86400000+1800000).toISOString(),timeZone:'America/Argentina/Buenos_Aires'},reminders:{useDefault:true},extendedProperties:{private:{folio_operation:'abcde'}}};
test('contract rejects missing inputs, personal aliases, fallback, stale authorization and excessive grant',()=>{
 validateManifest(manifest(),context);validateGrant(grant(manifest()),manifest(),epoch);
 for(const key of ['clientId','redirectUri','environment','calendarId','accountEmail','authorization']){const m=manifest();delete m[key];assert.throws(()=>validateManifest(m,context));}
 for(const account of ['amiunelautaro@gmail.com','a.m.i.u.n.e.l.a.u.t.a.r.o@googlemail.com']){const m=manifest();m.accountEmail=m.calendarId=account;assert.throws(()=>validateManifest(m,context));}
 const m=manifest();m.calendarId='primary';assert.throws(()=>validateManifest(m,context));
 assert.throws(()=>validateManifest(manifest(),{...context,sha:'d'.repeat(40)}));assert.throws(()=>validateManifest(manifest(),{...context,now:epoch+86400000}));
 const g=grant(manifest());g.scopes.push('openid');assert.throws(()=>validateGrant(g,manifest(),epoch));
 assert.throws(()=>assertHosted({},'win32'));
 const hosted={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',C05_EXECUTE:'authorized',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123',C05_REVIEWED_RUN_ID:'123'};
 assertHosted(hosted,'linux');assert.throws(()=>assertHosted({...hosted,GITHUB_RUN_ATTEMPT:'2'},'linux'));assert.throws(()=>assertHosted({...hosted,C05_REVIEWED_RUN_ID:'124'},'linux'));
});
test('empty preflight rejects defaults, events, partial snapshots and nonowner',()=>{
 const valid={kind:'calendar#events',etag:'x',accessRole:'owner',defaultReminders:[],items:[],nextSyncToken:'done'};assertEmptySnapshot(valid);
 for(const delta of [{defaultReminders:[{method:'email',minutes:5}]},{items:[{id:'foreign'}]},{nextPageToken:'next'},{accessRole:'writer'},{nextSyncToken:undefined}])assert.throws(()=>assertEmptySnapshot({...valid,...delta}));
});
test('transport rejects wrong origin/calendar/IDs, watch, redirects and unsafe payload before I/O',async()=>{
 const {t,calls}=harness();t.register('abcde','A');t.allowMutations();
 for(const url of ['https://evil.test/calendar/v3/calendars/x/events','https://www.googleapis.com/calendar/v3/calendars/primary/events','https://www.googleapis.com/calendar/v3/calendars/c05-account%40example.test/events/watch','https://www.googleapis.com/calendar/v3/users/me/calendarList','https://oauth2.googleapis.com/token?x=y'])await assert.rejects(t.adapter({url,method:'GET'}));
 await assert.rejects(t.request('GET','foreign'));await assert.rejects(t.request('POST',null,{...body,attendees:[{email:'nobody@example.test'}]}));
 await assert.rejects(t.request('POST',null,{...body,summary:'Clinical title'}));assert.equal(calls.length,0);
});
test('minimum preflight query and write sanitization force no notifications, private journal before send',async()=>{
 const {t,r,calls,journal}=harness();t.register('abcde','A');await assert.rejects(t.request('POST',null,body));assert.equal(calls.length,0);
 await t.request('GET',null,undefined,{maxResults:1,fields:'kind,etag,items(id),nextPageToken,nextSyncToken,defaultReminders,accessRole'});
 const preflight=new URL(calls[1].url);assert.equal(preflight.searchParams.get('maxResults'),'1');assert.equal(preflight.searchParams.has('timeMin'),false);
 t.allowMutations();await t.request('POST',null,body,{sendUpdates:'all'});
 const request=calls.at(-1),sent=JSON.parse(request.options.body);assert.equal(request.options.redirect,'error');assert.equal(new URL(request.url).searchParams.get('sendUpdates'),'none');assert.equal(sent.summary,'Folio C05 prueba A');assert.equal(sent.description,undefined);assert.equal(sent.attendees,undefined);
 assert.equal(journal.some(j=>j.uncertain==='abcde'&&j.mutations===1),true);assert.equal(r.uncertain,null);
});
test('five IDs, twenty writes, sixty requests and deadline are enforced before extra I/O',async()=>{
 const a=harness();for(let n=0;n<5;n++)a.t.register('abcde'+n,'ABCDE'[n]);assert.throws(()=>a.t.register('abcdef','A'));assert.equal(a.calls.length,0);
 const b=harness();b.t.register('abcde','A');b.t.allowMutations();b.r.mutations=LIMITS.mutations;await assert.rejects(b.t.request('POST',null,body));assert.equal(b.calls.length,0);
 const c=harness();c.r.requests=LIMITS.requests;await assert.rejects(c.t.request('GET',null));assert.equal(c.calls.length,0);
 const d=harness();d.advance(LIMITS.milliseconds);await assert.rejects(d.t.request('GET',null));assert.equal(d.calls.length,0);
});
test('lost accepted response requires same-ID owned readback, forbids retry/cleanup until reconciled',async()=>{
 const {t,r,calls}=harness();t.register('abcde','A');t.register('abcdf','B');t.allowMutations();t.loseInsert('abcde');
 await assert.rejects(t.request('POST',null,body));assert.equal(r.uncertain,'abcde');const count=calls.length;
 await assert.rejects(t.request('POST',null,body));await assert.rejects(t.request('GET','abcdf'));await assert.rejects(t.request('DELETE','abcde'));assert.equal(calls.length,count);
 await t.request('GET','abcde');assert.equal(r.uncertain,null);const afterReconcile=calls.length;await assert.rejects(t.request('POST',null,body));assert.equal(calls.length,afterReconcile);assert.equal(calls.filter(c=>c.options.method==='POST'&&!c.url.includes('/token')).length,1);
});
test('network failure and wrong ownership preserve uncertainty and redact error bodies',async()=>{
 const h=harness(()=>{throw Error('SECRET raw provider clinical payload');});h.t.register('abcde','A');h.t.allowMutations();
 await assert.rejects(h.t.request('POST',null,body),e=>e.message==='provider_unavailable');assert.equal(h.r.uncertain,'abcde');
 const x=harness(()=>({id:'abcde',extendedProperties:{private:{folio_operation:'foreign'}}}));x.t.register('abcde','A');x.t.allowMutations();x.t.loseInsert('abcde');await assert.rejects(x.t.request('POST',null,body));await assert.rejects(x.t.request('GET','abcde'));assert.equal(x.r.uncertain,'abcde');
 const redacted=sanitizedReceipt({...h.r,grant:{refreshToken:'SECRET'},error:'SECRET'});assert.equal(JSON.stringify(redacted).includes('SECRET'),false);
});
test('wrong readback ID with correct ownership retains durable uncertainty and blocks cleanup',async()=>{
 const {t,r,calls,journal}=harness(()=>({id:'abcdf',status:'confirmed',extendedProperties:{private:{folio_operation:'abcde'}}}));
 t.register('abcde','A');t.allowMutations();t.loseInsert('abcde');await assert.rejects(t.request('POST',null,body));
 await assert.rejects(t.request('GET','abcde'),e=>e.message.includes('readback_id'));
 assert.equal(r.uncertain,'abcde');assert.equal(r.events[0].state,'uncertain');assert.equal(journal.at(-1).uncertain,'abcde');
 assert.equal(journal.some(j=>j.uncertain===null&&j.mutations===1),false);
 const count=calls.length;await assert.rejects(cleanupKnownEvents({transport:t,receipt:r,persist:async()=>{throw Error('cleanup_must_not_persist');}}),e=>e.message.includes('cleanup_requires_reconciliation'));
 await assert.rejects(t.request('DELETE','abcde'));assert.equal(calls.length,count);
});
test('OAuth state/expiry/PKCE validation and exact scope; no implicit exchange',async()=>{
 const m=manifest(),challenge=bootstrapChallenge(m,epoch),callback={state:challenge.state,code:'synthetic-code-only'};validateCallback(callback,challenge,m,epoch);
 assert.throws(()=>validateCallback({...callback,state:'wrong'},challenge,m,epoch));assert.throws(()=>validateCallback(callback,challenge,m,epoch+600001));
 let calls=0;const g=await exchange({manifest:m,challenge,callback,clientSecret:'synthetic-client-secret',now:epoch,fetchImpl:async(url,opts)=>{calls++;assert.equal(opts.redirect,'error');assert.equal(opts.body.get('code_verifier'),challenge.verifier);return new Response(JSON.stringify({scope:SCOPE,refresh_token:'synthetic-refresh-token-only-123456'}));}});assert.equal(calls,1);validateGrant(g,m,epoch);
});
test('unrelated application fetch remains loopback only',async()=>{
 const restore=installLoopbackFetch();try{assert.throws(()=>fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events'));assert.throws(()=>fetch('https://production.supabase.co/rest/v1/turno'));}finally{restore();}
});
test('locked googleapis OAuth + Calendar use controlled adapter with no real network',async()=>{
 const {google}=await import('googleapis'),h=harness();h.t.register('abcde','A');h.t.allowMutations();
 const restore=installTransport(google,h.t),restoreFetch=installLoopbackFetch();
 try{
  const auth=new google.auth.OAuth2({clientId:h.m.clientId,clientSecret:'synthetic-secret-only',redirectUri:h.m.redirectUri,transporterOptions:{retry:false}});
  auth.setCredentials({refresh_token:grant(h.m).refreshToken});
  const cal=google.calendar({version:'v3',auth});
  const result=await cal.events.insert({calendarId:h.m.calendarId,requestBody:body,sendUpdates:'none'},{retry:false});assert.equal(result.data.id,'abcde');
  await cal.events.patch({calendarId:h.m.calendarId,eventId:'abcde',requestBody:{status:'cancelled'},sendUpdates:'none'},{retry:false,headers:{'If-Match':'e1'}});
  assert.equal(h.calls.at(-1).options.headers['If-Match'],'e1');
  await assert.rejects(cal.events.watch({calendarId:h.m.calendarId,requestBody:{id:'channel',type:'web_hook',address:'https://invalid.test'}},{retry:false}));
 }finally{restore();restoreFetch();}
});
