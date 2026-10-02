import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {safeEnvironment} from '../isolation-policy.mjs';
import {testAppConfig} from '../app-config.mjs';
import {JOINED_TIMEZONE} from './prove.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)?value:null;
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;
const instant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)?value:null;
const count=value=>Number.isInteger(value)&&value>=0&&value<=10?value:null;
const names=['fixture','publicRequest','manualConfirmation','calendarHoy','googleIntent'];
const phases=new Set(['preflight','pull','services','migrations','schema','auth','fixture','browser','complete',
 'public-request','manual-confirmation','calendar-hoy','google-intent','module-cleanup','next','cleanup','unclassified']);
export function joinedReceipt(sha,tree){
 assert.match(sha,/^[a-f0-9]{40}$/);assert.match(tree,/^[a-f0-9]{40}$/);
 return {sha,tree,stages:{},failure:null,modulePassed:false,moduleCleanup:false,nextCleanup:false,
  nextIsolation:false,cleanup:false,migrations:0};
}
/** Never serialize cookies, config, raw errors, patient names or credentials. */
export function finishJoinedReceipt(source){
 assert.match(source.sha,/^[a-f0-9]{40}$/);assert.match(source.tree,/^[a-f0-9]{40}$/);
 const stages={};
 for(const name of names){
  const v=source.stages?.[name];if(!v)continue;
  const common={passed:v.passed===true};
  if(name==='fixture')stages[name]={...common,day:day(v.day),start:instant(v.start),timezone:v.timezone===JOINED_TIMEZONE?JOINED_TIMEZONE:null};
  if(name==='publicRequest')stages[name]={...common,pedidoId:uuid(v.pedidoId),operationId:uuid(v.operationId),requestCount:count(v.requestCount),autoConfirmed:v.autoConfirmed===false?false:null};
  if(name==='manualConfirmation')stages[name]={...common,turnoId:uuid(v.turnoId),pacienteId:uuid(v.pacienteId),serviceId:uuid(v.serviceId),professionalId:uuid(v.professionalId)};
  if(name==='calendarHoy')stages[name]={...common,calendarVisible:v.calendarVisible===true,calendarPatientLink:v.calendarPatientLink===true,
   hoyVisible:v.hoyVisible===true,hoyPatientLink:v.hoyPatientLink===true,day:day(v.day)};
  if(name==='googleIntent')stages[name]={...common,integrationId:uuid(v.integrationId),eventId:typeof v.eventId==='string'&&/^[a-z0-9]{1,128}$/.test(v.eventId)?v.eventId:null,
   intents:count(v.intents),events:count(v.events),http:Object.fromEntries(['insert','get','patch','list','token'].map(key=>[key,count(v.http?.[key])]))};
 }
 const failure=source.failure===null?null:phases.has(source.failure)?source.failure:'unclassified';
 const receipt={version:1,sha:source.sha,tree:source.tree,environment:'github-ephemeral-supabase',provider:'http-loopback',stages,failure,
  modulePassed:source.modulePassed===true,moduleCleanup:source.moduleCleanup===true,nextCleanup:source.nextCleanup===true,
  nextIsolation:source.nextIsolation===true,cleanup:source.cleanup===true,migrations:Number.isInteger(source.migrations)&&source.migrations>0?source.migrations:0,
  limits:{nextMode:'development',captcha:'absent-secret-development-policy',professionalUi:'single-owner-implicit',mailWorkersExecuted:0}};
 const f=stages.fixture,p=stages.publicRequest,m=stages.manualConfirmation,c=stages.calendarHoy,g=stages.googleIntent;
 receipt.passed=receipt.failure===null&&receipt.modulePassed&&receipt.moduleCleanup&&receipt.nextCleanup&&receipt.nextIsolation&&receipt.cleanup&&receipt.migrations>0&&
  Object.keys(source.stages??{}).length===names.length&&names.every(name=>stages[name]?.passed===true)&&
  Boolean(f?.day&&f.start&&f.timezone&&p?.pedidoId&&p.operationId&&p.requestCount===1&&p.autoConfirmed===false&&
   m?.turnoId&&m.pacienteId&&m.serviceId&&m.professionalId&&c?.calendarVisible&&c.calendarPatientLink&&c.hoyVisible&&c.hoyPatientLink&&c.day===f.day&&
   g?.integrationId&&g.eventId&&g.intents===1&&g.events===1&&g.http.insert===1&&g.http.patch===0&&g.http.list===0&&Object.values(g.http).every(value=>value!==null));
 return receipt;
}

/** Exact hostname mapping; session remains private in runner memory. */
export function joinedBrowserCookies(cookies,appUrl){
 return cookies.map(({name,value,options})=>{
  const sameSite={lax:'Lax',strict:'Strict',none:'None'}[String(options?.sameSite??'').toLowerCase()];
  return {name,value,domain:new URL(appUrl).hostname,path:options?.path??'/',
   ...(typeof options?.httpOnly==='boolean'?{httpOnly:options.httpOnly}:{}),
   ...(typeof options?.secure==='boolean'?{secure:options.secure}:{}),...(sameSite?{sameSite}:{})};
 });
}

export function joinedNextEnvironment(config,source=process.env){
 const checked=testAppConfig({E2E_BASE_URL:config.appUrl,FOLIO_TEST_SUPABASE_URL:config.supabaseUrl,
  FOLIO_TEST_SUPABASE_ANON_KEY:config.anonKey,FOLIO_TEST_SUPABASE_SERVICE_KEY:config.serviceKey,
  FOLIO_TEST_DATABASE_URL:config.databaseUrl,FOLIO_TEST_CLINICAL:'1'});
 assert.equal(config.mode,'app');assert.equal(config.realSupabase,true);assert.equal(config.clinical,true);
 assert.ok(!config.turnstileSitekey);assert.ok(checked.databaseUrl);
 const bootstrap=new URL('../app-bootstrap.mjs',import.meta.url).href;
 return {...safeEnvironment(source,checked),E2E_BASE_URL:checked.appUrl,FOLIO_TEST_APP_CONFIG:JSON.stringify(checked),
  NODE_OPTIONS:`--import=${bootstrap}`};
}

/** Owned Linux process group includes Next's forked dev workers. No output leaks. */
export async function withJoinedNext(config,receipt,persist,callback){
 assert.equal(process.platform,'linux');assert.equal(globalThis[Symbol.for('folio.test.isolation')],true);
 const env=joinedNextEnvironment(config),repo=fileURLToPath(new URL('../../../',import.meta.url));
 // Refuse an existing app at this port instead of mistaking it for our child.
 await new Promise((resolve,reject)=>{
  const reservation=net.createServer();reservation.once('error',()=>reject(Error('joined_next_port_not_fresh')));
  reservation.listen(Number(new URL(config.appUrl).port),new URL(config.appUrl).hostname,()=>reservation.close(error=>error?reject(Error('joined_next_port_not_fresh')):resolve()));
 });
 const child=spawn(process.execPath,['scripts/testing/app-server.mjs'],{cwd:repo,env,stdio:'ignore',detached:true});
 let closed=false,spawnFailed=false;
 const finished=new Promise(resolve=>{child.once('error',()=>{spawnFailed=true;closed=true;resolve();});child.once('close',()=>{closed=true;resolve();});});
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 try{
  let ready=false;
  for(let attempt=0;attempt<90;attempt++){
   if(closed)throw Error('joined_next_exited');
   try{const response=await fetch(`${config.appUrl}/login`,{signal:AbortSignal.timeout(1500)});if(response.ok){ready=true;break;}}catch{}
   await pause(1000);
  }
  assert.equal(ready,true,'joined_next_not_ready');receipt.nextIsolation=true;await persist();
  return await callback({kind:'next-dev',appUrl:config.appUrl,externalIoDenied:true,turnstileSecretPresent:false});
 }finally{
  let cleanup=false;
  try{
   if(spawnFailed||!child.pid)throw Error('joined_next_spawn_failed');
   const signal=value=>{try{process.kill(-child.pid,value);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
   signal('SIGTERM');await Promise.race([finished,pause(3000)]);
   signal('SIGKILL');await Promise.race([finished,pause(5000)]);
   for(let attempt=0;attempt<30;attempt++){if(!signal(0)){cleanup=closed;break;}await pause(100);}
  }finally{
   receipt.nextCleanup=cleanup;if(!cleanup){receipt.modulePassed=false;receipt.failure??='next';}
   await persist();
  }
  if(!cleanup)throw Error('joined_next_cleanup_failed');
 }
}
