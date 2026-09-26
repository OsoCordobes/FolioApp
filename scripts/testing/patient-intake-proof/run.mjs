#!/usr/bin/env node
// B09: real Auth, PostgREST, Next, browser and PostgreSQL on one GitHub-hosted disposable runner.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {readdir,writeFile,unlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {totp} from '../clinical-config.mjs';
import {openLoopbackBridge,validateBridgeTarget,waitForBridgeTarget} from '../../recovery/ci-loopback-bridge.mjs';
import {dockerFailureKind} from '../auth-proof/diagnostics.mjs';

const repo=path.resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const compose=path.join(repo,'scripts/recovery/ci-compose.yml');
const project='folio_intake_proof';
const upstreamCommit='8c7a4d9dbbaf8b552893822e89d7bf06f33f9220';
const api='http://127.0.0.1:55421';
const fixtureFile=path.join(tmpdir(),'folio-patient-intake-proof-fixture.json');
const evidenceFile=path.join(repo,'test-results/patient-intake-proof-summary.json');
const random=bytes=>randomBytes(bytes).toString('base64url');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const stages=new Set(['guard','pull','services','migrations','auth','fixture','roles','browser','complete','teardown']);
const browserStages=new Set(['initial_fence','staff_issue_response_lost','staff_issue_reconciled','issued','qr_local','token_hash_bound','exchanged','submitted','reviewed','lost_response_committed','lost_response_reconciled','revoked','old_link_rejected','data_preserved','staff_data_cleared_after_revocation']);
const serviceNames=['db','auth','rest','storage','minio','minio-createbucket','api-gw'];

// Docker output can contain credentials. Only these fixed service names and
// bounded Compose status fields may leave the proof runner.
export function servicesStatus(output){
 let rows;
 try{
  const value=JSON.parse(output.trim());rows=Array.isArray(value)?value:[value];
 }catch{
  try{rows=output.trim().split(/\r?\n/).filter(Boolean).flatMap(line=>{
   const value=JSON.parse(line);return Array.isArray(value)?value:[value];
  });}catch{return 'ps=unavailable';}
 }
 if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'))return 'ps=unavailable';
 return serviceNames.map(name=>{
  const row=rows.find(item=>item.Service===name);
  if(!row)return `${name}=missing`;
  const state=String(row.State??'').toLowerCase();
  const health=String(row.Health??'').toLowerCase();
  const exit=typeof row.ExitCode==='number'?row.ExitCode:
   typeof row.ExitCode==='string'&&/^\d{1,3}$/.test(row.ExitCode)?Number(row.ExitCode):NaN;
  const safeState=['running','exited','restarting','created','paused','dead'].includes(state)?state:'other';
  const safeHealth=['healthy','unhealthy','starting'].includes(health)?health:'none';
  const safeExit=Number.isInteger(exit)&&exit>=0&&exit<=255?exit:'other';
  return `${name}=${safeState}_${safeHealth}_exit${safeExit}`;
 }).join(' ');
}

async function finiteServicesDiagnostic(env,step){
 try{
  const result=await run('docker',['compose','-p',project,'-f',compose,'ps','--all','--format','json'],{env,timeout:10000,limit:100000});
  return `step=${step} ${result.code===0?servicesStatus(result.output):'ps=unavailable'}`;
 }catch{return `step=${step} ps=unavailable`;}
}

function servicesFailureKind(error){
 if(error?.diagnosticKind)return error.diagnosticKind;
 if(error?.message==='child_timeout')return 'timeout';
 if(error?.message==='child_output_limit')return 'output_limit';
 if(error?.message==='child_spawn_failed')return 'spawn';
 if(error?.message==='c01_bridge_direct_route_unavailable')return 'bridge_route';
 if(error instanceof assert.AssertionError)return 'assertion';
 return 'other';
}

function token(secret,role){
 const part=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const now=Math.floor(Date.now()/1000);
 const body=`${part({alg:'HS256',typ:'JWT'})}.${part({iss:'supabase-local',role,aud:role==='anon'?'anon':'authenticated',iat:now,exp:now+3600})}`;
 return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
}
function run(program,args,{env=process.env,timeout=180000,limit=2000000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(program,args,{cwd:repo,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='',overflow=false;
  for(const stream of [child.stdout,child.stderr])stream.on('data',piece=>{
   if(output.length+piece.length>limit){overflow=true;return;}output+=piece.toString('utf8');
  });
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('child_timeout'));},timeout);
  child.once('error',()=>{clearTimeout(timer);reject(Error('child_spawn_failed'));});
  child.once('close',code=>{clearTimeout(timer);if(overflow)return reject(Error('child_output_limit'));resolve({code,output});});
 });
}
async function must(program,args,settings){const result=await run(program,args,settings);if(result.code!==0)throw Error('child_failed');return result.output;}
const docker=async(args,env)=>{
 const result=await run('docker',args,{env,timeout:300000});
 if(result.code!==0){
  const error=Error('docker_failed');
  error.diagnosticKind=dockerFailureKind(result.output);
  error.diagnosticExit=Number.isInteger(result.code)&&result.code>=0&&result.code<=255?result.code:'other';
  throw error;
 }
 return result.output;
};
const dc=(args,env)=>docker(['compose','-p',project,'-f',compose,...args],env);
async function bridge(service,localPort,remotePort,env){
 const id=(await dc(['ps','-q',service],env)).trim();assert.match(id,/^[a-f0-9]{64}$/);
 const labels=JSON.parse(await docker(['inspect','--format','{{json .Config.Labels}}',id],env));
 const networks=JSON.parse(await docker(['inspect','--format','{{json .NetworkSettings.Networks}}',id],env));
 const network=JSON.parse(await docker(['network','inspect','--format','{{json .}}',`${project}_default`],env));
 const target=validateBridgeTarget({project,service,containerId:id,labels,networks,network,remotePort});
 await waitForBridgeTarget(target);return openLoopbackBridge(target,localPort);
}
async function withPg(password,fn){
 const db=new Client({host:'127.0.0.1',port:55422,user:'postgres',password,database:'postgres',connectionTimeoutMillis:10000});
 await db.connect();try{return await fn(db);}finally{await db.end();}
}
async function waitApi(key){
 for(let i=0;i<36;i++){
  try{const response=await fetch(`${api}/auth/v1/settings`,{headers:{apikey:key},signal:AbortSignal.timeout(2000)});if(response.ok)return;}catch{}
  await delay(2000);
 }
 throw Error('api_unhealthy');
}
async function prepareSchema(password,env,serviceKey){
 // Production had broad historic defaults before M01; replay must exercise later revokes.
 await withPg(password,async db=>{
  await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role');
  await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role');
  await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role');
 });
 const folder=path.join(repo,'supabase/migrations');
 const files=(await readdir(folder)).filter(name=>/^\d{14}_.+\.sql$/.test(name)).sort();
 assert.equal(files.length,new Set(files.map(name=>name.slice(0,14))).size,'migration_versions_not_unique');
 for(const suffix of ['_M144_patient_intake_foundation.sql','_M145_adult_attestation_revocation.sql','_M146_patient_intake_portal_cancel.sql','_M147_patient_intake_link_recovery.sql'])
  assert.ok(files.some(name=>name.endsWith(suffix)),'intake_migration_missing');
 for(const file of files)await must('psql',['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55422','-U','postgres','-d','postgres','-f',path.join(folder,file)],{env:{...env,PGPASSWORD:password},timeout:120000});
 await must('psql',['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55422','-U','postgres','-d','postgres','-c',"NOTIFY pgrst, 'reload schema'"],{env:{...env,PGPASSWORD:password}});
 let ready=false;
 for(let i=0;i<30;i++){
  try{
   const response=await fetch(`${api}/rest/v1/rpc/patient_intake_link_state`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify({p_org:randomUUID(),p_turno:randomUUID()}),signal:AbortSignal.timeout(2000)});
   const data=await response.json();if(data?.code!=='PGRST202'){ready=true;break;}
  }catch{}await delay(1000);
 }
 assert.equal(ready,true,'postgrest_schema_cache_not_ready');
 await withPg(password,async db=>{
  const {rows:[grant]}=await db.query("SELECT has_function_privilege('authenticated','public.patient_intake_issue_v2(uuid,uuid,uuid,bigint,text,text,bytea)','EXECUTE') AS issue_staff,has_function_privilege('service_role','public.patient_intake_issue_v2(uuid,uuid,uuid,bigint,text,text,bytea)','EXECUTE') AS issue_service,has_function_privilege('authenticated','public.patient_intake_issue(uuid,uuid,bytea)','EXECUTE') AS legacy_issue,has_function_privilege('authenticated','public.patient_intake_revoke(uuid,uuid)','EXECUTE') AS legacy_revoke,has_table_privilege('authenticated','folio_intake_private.invitation','SELECT') AS private_read");
  assert.deepEqual(grant,{issue_staff:true,issue_service:false,legacy_issue:false,legacy_revoke:false,private_read:false});
 });
 return files.length;
}
async function createActor(service,anonKey,label){
 const email=`intake-${label}-${randomUUID()}@example.test`,password=`Intake-${random(24)}!`;
 const created=await service.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null,'user_create_failed');
 const actor=createClient(api,anonKey,options);
 const login=await actor.auth.signInWithPassword({email,password});assert.equal(login.error,null,'login_failed');
 const aal1=login.data.session?.access_token;assert.ok(aal1,'aal1_session_missing');
 const enrolled=await actor.auth.mfa.enroll({factorType:'totp',friendlyName:`Synthetic intake ${label}`});assert.equal(enrolled.error,null,'factor_enroll_failed');
 const challenge=await actor.auth.mfa.challenge({factorId:enrolled.data.id});assert.equal(challenge.error,null,'factor_challenge_failed');
 const verified=await actor.auth.mfa.verify({factorId:enrolled.data.id,challengeId:challenge.data.id,code:totp(enrolled.data.totp.secret)});
 assert.equal(verified.error,null,'factor_verify_failed');
 const aal2=verified.data?.access_token,refresh=verified.data?.refresh_token;
 assert.ok(aal2&&refresh,'aal2_session_missing');
 const claims=JSON.parse(Buffer.from(aal2.split('.')[1],'base64url').toString());assert.equal(claims.aal,'aal2');
 return {id:created.data.user.id,email,aal1,aal2,refresh};
}
async function rpc(key,jwt,name,args){
 const response=await fetch(`${api}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${jwt}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
 return {status:response.status,body:await response.json()};
}
async function fixture(state){
 const service=createClient(api,state.serviceKey,options);
 const owner=await createActor(service,state.anonKey,'owner-a');
 const foreign=await createActor(service,state.anonKey,'owner-b');
 const assistant=await createActor(service,state.anonKey,'assistant-a');
 const org=randomUUID(),otherOrg=randomUUID(),member=randomUUID(),foreignMember=randomUUID(),assistantMember=randomUUID();
 const identity=randomUUID(),patient=randomUUID(),servicio=randomUUID(),turno=randomUUID();
 process.env.FOLIO_ENC_KEY=Buffer.alloc(32,37).toString('base64');
 process.env.FOLIO_ENC_HMAC_KEY=Buffer.alloc(32,71).toString('base64');
 const cryptoModule=await import('../../../lib/crypto.ts');const crypto=cryptoModule.default??cryptoModule;
 const encrypted=crypto.encryptColumn('Paciente sintético B09');const cipher=Buffer.from(encrypted.slice(2),'hex');
 await withPg(state.dbPassword,async db=>{
  await db.query('BEGIN');
  try{
   for(const actor of [owner,foreign,assistant])await db.query('INSERT INTO public.profile(id,email,nombre_cifrado,apellido_cifrado,consent_pii_signed_at,consent_pii_text_version) VALUES($1,$2,$3,$3,now(),$4)',[actor.id,actor.email,cipher,'intake.synthetic.v1']);
   for(const [id,slug] of [[org,'a'],[otherOrg,'b']])await db.query("INSERT INTO public.organization(id,slug,nombre,timezone,especialidad,tipo,onboarding_completed,onboarding_step_max,is_internal_account,is_synthetic,opt_out_analytics,opt_out_public_listing) VALUES($1,$2,'Consultorio sintético B09','America/Argentina/Cordoba','quiropraxia','INDEPENDIENTE',true,9,true,true,true,true)",[id,`folio-test-intake-${slug}-${randomUUID().slice(0,12)}`]);
   await db.query("INSERT INTO public.member(id,organization_id,profile_id,role,accepted_at,es_colegiado,especialidad,alcance,profesionales_gestionados) VALUES($1,$2,$3,'OWNER',now(),true,'quiropraxia','TODOS','{}')",[member,org,owner.id]);
   await db.query("INSERT INTO public.member(id,organization_id,profile_id,role,accepted_at,es_colegiado,especialidad,alcance,profesionales_gestionados) VALUES($1,$2,$3,'OWNER',now(),true,'quiropraxia','TODOS','{}')",[foreignMember,otherOrg,foreign.id]);
   await db.query("INSERT INTO public.member(id,organization_id,profile_id,role,accepted_at,es_colegiado,especialidad,alcance,profesionales_gestionados) VALUES($1,$2,$3,'ASISTENTE',now(),false,'quiropraxia','LISTA_PROFESIONALES','{}')",[assistantMember,org,assistant.id]);
   await db.query('INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado) VALUES($1,$2,$3,$3,$3)',[identity,org,cipher]);
   await db.query('INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id) VALUES($1,$2,$3,$4)',[patient,org,identity,member]);
   await db.query("INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES($1,$2,'Consulta sintética',enum_first(null::public.tipo_servicio_canonico),30,1000)",[servicio,org]);
   await db.query("INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,estado) VALUES($1,$2,$3,$4,$5,((timezone('America/Argentina/Cordoba',clock_timestamp())::date)::timestamp+interval '12 hours') AT TIME ZONE 'America/Argentina/Cordoba',30,1000,'EN_SALA')",[turno,org,patient,servicio,member]);
   await db.query('UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now() WHERE singleton');
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
 });
 const checked=await rpc(state.anonKey,owner.aal2,'mfa_access_status',{});
 assert.equal(checked.status,200);assert.equal(checked.body?.required,true);assert.equal(checked.body?.isStaff,true);
 assert.equal(checked.body?.hasVerifiedFactor,true);assert.equal(checked.body?.sessionValid,true);assert.equal(checked.body?.allowed,true);
 let cookies=[];
 const seeded=createServerClient(api,state.anonKey,{cookies:{getAll:()=>cookies,setAll:values=>{cookies=values.map(({name,value,options})=>({name,value,options}));}}});
 const session=await seeded.auth.setSession({access_token:owner.aal2,refresh_token:owner.refresh});assert.equal(session.error,null);
 const browserCookies=cookies.map(({name,value,options})=>{
  const sameSite={lax:'Lax',strict:'Strict',none:'None'}[String(options?.sameSite??'').toLowerCase()];
  return {name,value,domain:'localhost',path:options?.path??'/',...(typeof options?.httpOnly==='boolean'?{httpOnly:options.httpOnly}:{}),...(typeof options?.secure==='boolean'?{secure:options.secure}:{}),...(sameSite?{sameSite}:{})};
 });
 assert.ok(browserCookies.length>0,'staff_cookie_missing');
 await writeFile(fixtureFile,JSON.stringify({browserCookies,databaseUrl:`postgresql://postgres:${state.dbPassword}@127.0.0.1:55422/postgres`,turnoId:turno}),{flag:'wx',mode:0o600});
 const keyCipher=crypto.encryptColumn(randomBytes(32).toString('base64'));
 assert.ok(keyCipher,'fingerprint_key_missing');
 return {org,turno,owner,foreign,assistant,keyCipher};
}
async function checkRoles(state,seed){
 const args={p_org:seed.org,p_turno:seed.turno};
 const allowed=await rpc(state.anonKey,seed.owner.aal2,'patient_intake_link_state',args);
 assert.equal(allowed.status,200);assert.equal(allowed.body?.generation,'0');assert.equal(allowed.body?.active,false);
 assert.match(allowed.body?.contextHash??'',/^[0-9a-f]{64}$/);
 const expected={p_expected_generation:Number(allowed.body.generation),p_expected_context:allowed.body.contextHash};
 for(const jwt of [seed.owner.aal1,seed.foreign.aal2,seed.assistant.aal2]){
  const denied=[
   ['patient_intake_link_state',args],
   ['patient_intake_issue_v2',{...args,...expected,p_operation:randomUUID(),p_token_hash:createHash('sha256').update(randomBytes(32)).digest('hex'),p_fingerprint_key_cifrado:seed.keyCipher}],
   ['patient_intake_revoke_v2',{...args,...expected,p_operation:randomUUID()}],
   ['patient_intake_review',args],
  ];
  for(const [name,parameters] of denied){
   const result=await rpc(state.anonKey,jwt,name,parameters);
   assert.equal(result.body?.code,'42501',`role_boundary_missing:${name}`);
  }
 }
 await withPg(state.dbPassword,async db=>{
  const {rows:[counts]}=await db.query('SELECT (SELECT count(*)::int FROM folio_intake_private.invitation) AS invitations,(SELECT count(*)::int FROM folio_intake_private.session) AS sessions,(SELECT count(*)::int FROM folio_intake_private.submission) AS submissions,(SELECT count(*)::int FROM folio_intake_private.event) AS events,(SELECT count(*)::int FROM folio_intake_private.link_state) AS link_states,(SELECT count(*)::int FROM folio_intake_private.link_operation) AS link_operations');
  assert.deepEqual(counts,{invitations:0,sessions:0,submissions:0,events:0,link_states:0,link_operations:0});
 });
}
function browserResult(output){
 const markers=[...output.matchAll(/^intake_proof_stage:([a-z_]+)$/gm)].map(m=>m[1]).filter(x=>browserStages.has(x));
 const lines=[...output.matchAll(/patient-intake-live\.spec\.ts:(\d+)(?::\d+)?/g)].map(m=>Number(m[1])).filter(n=>n>0&&n<1000);
 const kind=/strict mode violation/i.test(output)?'strict':/Test timeout.*exceeded|test timeout of \d+ms/i.test(output)?'test_timeout':/TimeoutError|Timed out/i.test(output)?'expect_timeout':/Target closed/i.test(output)?'target_closed':/AssertionError|expect\([^\n]+\) failed/i.test(output)?'assertion':'other';
 return {markers,lines:[...new Set(lines)].slice(0,3),kind};
}
async function main(){
 let stage='guard',servicesStep='none',dbBridge,apiBridge,env,started=false,migrations=0,markers=[],failure=null;
 const sourceSha=(await must('git',['rev-parse','HEAD'])).trim();assert.match(sourceSha,/^[a-f0-9]{40}$/);
 try{
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
  assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request');assert.equal(process.env.RUNNER_OS,'Linux');assert.equal(process.platform,'linux');
  const official=path.resolve(process.env.C01_OFFICIAL_DOCKER??'');
  assert.ok(process.env.RUNNER_TEMP&&official.startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep));
  assert.equal((await must('git',['-C',path.dirname(official),'rev-parse','HEAD'])).trim(),upstreamCommit);
  assert.equal((await must('psql',['--version'])).match(/\b(\d+)\./)?.[1],'17');
  const secret=random(48),dbPassword=random(32);
  const state={dbPassword,anonKey:token(secret,'anon'),serviceKey:token(secret,'service_role')};
  env={...process.env,C01_OFFICIAL_DOCKER:official,C01_DB_PASSWORD:dbPassword,C01_JWT_SECRET:secret,C01_ANON_KEY:state.anonKey,C01_SERVICE_KEY:state.serviceKey,C01_DASHBOARD_PASSWORD:random(18),C01_APP_DATABASE:'postgres',C01_CRON_DATABASE:'postgres',C01_S3_BUCKET:'intake-proof-synthetic',C01_MINIO_USER:random(18),C01_MINIO_PASSWORD:random(36)};
  assert.equal((await dc(['ps','-q'],env)).trim(),'','project_not_fresh');
  assert.equal((await docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${project}`],env)).trim(),'','volumes_not_fresh');
  stage='pull';await dc(['pull','db','auth','rest','storage','api-gw','minio','minio-createbucket'],env);
  stage='services';started=true;servicesStep='compose_up';await dc(['up','-d','--wait'],env);
  servicesStep='network';assert.equal((await docker(['network','inspect',`${project}_default`,'--format','{{.Internal}}'],env)).trim(),'true');
  servicesStep='db_bridge';dbBridge=await bridge('db',55422,5432,env);
  servicesStep='api_bridge';apiBridge=await bridge('api-gw',55421,8000,env);
  servicesStep='api_ready';await waitApi(state.anonKey);
  stage='migrations';migrations=await prepareSchema(dbPassword,env,state.serviceKey);
  stage='auth';const seed=await fixture(state);
  stage='roles';await checkRoles(state,seed);
  stage='browser';const browserEnv={...env,E2E_BASE_URL:'http://localhost:4430',FOLIO_TEST_SUPABASE_URL:api,FOLIO_TEST_SUPABASE_ANON_KEY:state.anonKey,FOLIO_TEST_SUPABASE_SERVICE_KEY:state.serviceKey,FOLIO_TEST_DATABASE_URL:`postgresql://postgres:${dbPassword}@127.0.0.1:55422/postgres`,FOLIO_TEST_CLINICAL:'1'};
  const result=await run('pnpm',['test:e2e','--','tests/e2e/patient-intake-live.spec.ts','--trace=off','--reporter=dot'],{env:browserEnv,timeout:900000});
  const parsed=browserResult(result.output);markers=parsed.markers;
  if(result.code!==0){console.log(`intake_proof_diagnostic:last_stage=${markers.at(-1)??'none'} spec_lines=${parsed.lines.join(',')||'unknown'} kind=${parsed.kind}`);throw Error('browser_failed');}
  if(/\bskipped\b|\bskip\b/i.test(result.output)||!/\b1 passed\b/.test(result.output))throw Error('browser_pass_missing');
  for(const required of browserStages)assert.ok(markers.includes(required),'browser_stage_missing');
  stage='complete';for(const item of markers)console.log(`intake_proof_stage:${item}`);
  console.log(`intake_proof_pass:migrations=${migrations} cases=${browserStages.size+3} real_auth=1 real_db=1`);
 }catch(error){
  failure=stages.has(stage)?stage:'unclassified';process.exitCode=1;
  if(failure==='services'){
   console.error(`intake_proof_services_diagnostic:kind=${servicesFailureKind(error)} exit=${error?.diagnosticExit??'none'} ${await finiteServicesDiagnostic(env,servicesStep)}`);
  }
  console.error(`intake_proof_${failure}_failed`);
 }
 finally{
  await unlink(fixtureFile).catch(()=>{});
  await apiBridge?.close().catch(()=>{process.exitCode=1;});await dbBridge?.close().catch(()=>{process.exitCode=1;});
  if(started)try{await dc(['down','-v'],env);}catch{failure='teardown';process.exitCode=1;console.error('intake_proof_teardown_failed');}
  await mkdir(path.dirname(evidenceFile),{recursive:true});
  await writeFile(evidenceFile,JSON.stringify({sourceSha,migrations,stages:[...new Set(markers)],ok:!process.exitCode,failure},null,2)+'\n',{mode:0o600});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{console.error('intake_proof_guard_failed');process.exitCode=1;});
