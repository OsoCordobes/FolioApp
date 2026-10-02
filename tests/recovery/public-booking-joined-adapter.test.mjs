import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {joinedReceipt,finishJoinedReceipt,joinedNextEnvironment,joinedBrowserCookies} from '../../scripts/testing/public-booking-joined-proof/adapter.mjs';

const id='11111111-1111-4111-8111-111111111111',sha='a'.repeat(40),tree='b'.repeat(40);
function complete(){return {...joinedReceipt(sha,tree),modulePassed:true,moduleCleanup:true,nextCleanup:true,nextIsolation:true,cleanup:true,migrations:150,
 stages:{fixture:{passed:true,day:'2026-10-02',start:'2026-10-02T18:00:00.000Z',timezone:'America/Argentina/Cordoba'},
  publicRequest:{passed:true,pedidoId:id,operationId:id,requestCount:1,autoConfirmed:false},
  manualConfirmation:{passed:true,turnoId:id,pacienteId:id,serviceId:id,professionalId:id},
  calendarHoy:{passed:true,calendarVisible:true,calendarPatientLink:true,hoyVisible:true,hoyPatientLink:true,day:'2026-10-02'},
  googleIntent:{passed:true,integrationId:id,eventId:'folio123',intents:1,events:1,http:{insert:1,get:1,patch:0,list:0,token:1}}}};}
test('Joined receipt requires all observations, Hoy destination and every cleanup',()=>{
 assert.equal(finishJoinedReceipt(joinedReceipt(sha,tree)).passed,false);assert.equal(finishJoinedReceipt(complete()).passed,true);
 for(const key of ['modulePassed','moduleCleanup','nextCleanup','nextIsolation','cleanup']){
  const value=complete();value[key]=false;assert.equal(finishJoinedReceipt(value).passed,false);
 }
 for(const mutate of [x=>{x.stages.calendarHoy.hoyPatientLink=false;},x=>{x.stages.calendarHoy.day='2026-10-03';},
  x=>{x.stages.publicRequest.requestCount=2;},x=>{x.stages.googleIntent.events=2;},x=>{x.stages.googleIntent.http.patch=1;},
  x=>{x.stages.extra={passed:true};},x=>{delete x.stages.manualConfirmation;},x=>{x.failure='fixture';}]){
  const value=complete();mutate(value);assert.equal(finishJoinedReceipt(value).passed,false);
 }
});
test('Joined receipt drops raw errors, env, cookies, bodies and nonfinite IDs',()=>{
 const value=complete(),secret='private-secret cookie=raw synthetic@example.invalid';
 Object.assign(value,{config:secret,browserCookies:secret,error:secret,limits:{secret},token:secret});
 value.failure=secret;value.stages.fixture.body=secret;value.stages.manualConfirmation.pacienteId=secret;
 const output=finishJoinedReceipt(value);assert.equal(output.failure,'unclassified');assert.equal(output.passed,false);
 assert.equal(output.stages.manualConfirmation.pacienteId,null);assert.ok(!JSON.stringify(output).includes(secret));
});
const key=role=>`x.${Buffer.from(JSON.stringify({iss:'supabase-local',role})).toString('base64url')}.x`;
function config(){return {mode:'app',appUrl:'http://127.0.0.1:4440',supabaseUrl:'http://127.0.0.1:55421',anonKey:key('anon'),serviceKey:key('service_role'),
 databaseUrl:'postgresql://postgres:synthetic@127.0.0.1:55422/postgres',realSupabase:true,clinical:true};}
test('Joined Next environment strips inherited secrets/selectors and preloads app guard',()=>{
 const env=joinedNextEnvironment(config(),{...process.env,TURNSTILE_SECRET_KEY:'private',GOOGLE_OAUTH_CLIENT_SECRET:'private',
  RESEND_API_KEY:'private',UNEXPECTED_PRIVATE_SECRET:'private',NODE_OPTIONS:'--eval=unsafe',NEXT_PRIVATE_WORKER:'1',TURBOPACK:'1'});
 for(const name of ['TURNSTILE_SECRET_KEY','GOOGLE_OAUTH_CLIENT_SECRET','RESEND_API_KEY','UNEXPECTED_PRIVATE_SECRET','NEXT_PRIVATE_WORKER','TURBOPACK'])assert.equal(env[name],undefined);
 assert.equal(env.NODE_ENV,'development');assert.match(env.NODE_OPTIONS,/^--import=file:.*app-bootstrap\.mjs$/);
 const invalid=config();invalid.databaseUrl='postgresql://postgres:x@198.51.100.1/postgres';assert.throws(()=>joinedNextEnvironment(invalid));
});
test('Joined seeded session cookies map only to the exact app hostname',()=>{
 assert.deepEqual(joinedBrowserCookies([{name:'sb-local-auth-token',value:'synthetic',options:{path:'/',sameSite:'lax',httpOnly:true}}],config().appUrl),
  [{name:'sb-local-auth-token',value:'synthetic',domain:'127.0.0.1',path:'/',sameSite:'Lax',httpOnly:true}]);
});
test('Joined real app bootstrap guards the Node parent, thread worker and IPC child without Next/DB',()=>{
 const env=joinedNextEnvironment(config());
 const bootstrap=new URL('../../scripts/testing/app-bootstrap.mjs',import.meta.url).href;
 const output=execFileSync(process.execPath,['--import',bootstrap,fileURLToPath(new URL('./fixtures/joined-next-isolation-probe.mjs',import.meta.url))],
  {env,encoding:'utf8',timeout:15000});
 assert.equal(output.trim(),'joined_next_bootstrap_parent_worker_ipc_guard_pass');
});
