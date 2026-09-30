#!/usr/bin/env node
// B10b: one hosted, synthetic Auth/DB/browser proof; never a local Docker run.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {access,readdir,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {totp} from '../clinical-config.mjs';
import callerMarkers from './markers.ts';
import portalContract from './portal-export-contract.ts';
import {openLoopbackBridge,validateBridgeTarget,waitForBridgeTarget} from '../../recovery/ci-loopback-bridge.mjs';

const repo=path.resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const compose=path.join(repo,'scripts/recovery/ci-compose.yml');
const {proofMode,proofSpecs,PORTAL_EXPORT_FIXTURE_NAME,PORTAL_EXPORT_RECEIPT_NAME,portalExportResult,
 portalProofReceipt,addPortalFailure,assertPortalFixture}=portalContract;
const mode=proofMode(process.argv.slice(2));
const portal=mode==='portal-export';
const prefix=portal?'portal_export_proof':'caller_proof';
const project='folio_caller_proof';
const upstreamCommit='8c7a4d9dbbaf8b552893822e89d7bf06f33f9220';
const api='http://127.0.0.1:55421';
const fixtureFile=path.join(tmpdir(),portal?PORTAL_EXPORT_FIXTURE_NAME:'folio-caller-proof-fixture.json');
const receiptFile=path.join(process.env.RUNNER_TEMP??tmpdir(),PORTAL_EXPORT_RECEIPT_NAME);
const random=bytes=>randomBytes(bytes).toString('base64url');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const stages=new Set(['pull','services','migrations','schema','auth','fixture','browser','complete']);
const serviceNames=['db','auth','rest','storage','minio','minio-createbucket','api-gw'];
function retainFailure(state,error,phase){
 state.portalReceipt=addPortalFailure(state.portalReceipt,error,{case:'runner',phase});
 state.portalReceipt.exitCode=1;process.exitCode=1;
}
async function preservePortalReceipt(state){
 try{
  await writeFile(receiptFile,JSON.stringify(state.portalReceipt)+'\n',{flag:state.receiptOwned?'w':'wx',mode:0o600});
  state.receiptOwned=true;
 }catch(error){retainFailure(state,error,'receipt');console.error('portal_export_proof_receipt_failed');}
}

async function finiteServicesDiagnostic(env,step){
 try{
  const result=await run('docker',['compose','-p',project,'-f',compose,'ps','--all','--format','json'],{env,timeout:10000,limit:100000});
  if(result.code!==0)return `step=${step} ps=unavailable`;
  const output=result.output.trim();
  let rows;
  try{const value=JSON.parse(output);rows=Array.isArray(value)?value:[value];}
  catch{rows=output.split(/\r?\n/).filter(Boolean).flatMap(line=>{const value=JSON.parse(line);return Array.isArray(value)?value:[value];});}
  const states=serviceNames.map(name=>{
   const row=rows.find(item=>item?.Service===name);
   const state=['running','exited','restarting','created','paused','dead'].includes(String(row?.State).toLowerCase())?String(row.State).toLowerCase():'other';
   const health=['healthy','unhealthy','starting'].includes(String(row?.Health).toLowerCase())?String(row.Health).toLowerCase():'none';
   return `${name}=${state}_${health}`;
  });
  return `step=${step} ${states.join(' ')}`;
 }catch{return `step=${step} ps=unavailable`;}
}

function token(secret,role){
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const now=Math.floor(Date.now()/1000);
 const body=`${encode({alg:'HS256',typ:'JWT'})}.${encode({iss:'supabase-local',role,aud:role==='anon'?'anon':'authenticated',iat:now,exp:now+3600})}`;
 return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
}
function run(program,args,{env=process.env,timeout=180000,limit=1048576}={}){
 return new Promise((resolve,reject)=>{
  const proc=spawn(program,args,{cwd:repo,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='',overflow=false;
  for(const stream of [proc.stdout,proc.stderr])stream.on('data',piece=>{
   if(output.length+piece.length>limit){overflow=true;return;}output+=piece.toString('utf8');
  });
  const timer=setTimeout(()=>{proc.kill('SIGKILL');reject(Error('child_timeout'));},timeout);
  proc.once('error',()=>{clearTimeout(timer);reject(Error('child_spawn_failed'));});
  proc.once('close',code=>{clearTimeout(timer);if(overflow)return reject(Error('child_output_limit'));resolve({code,output});});
 });
}
async function must(program,args,settings){const result=await run(program,args,settings);if(result.code!==0)throw Error('child_failed');return result.output;}
const docker=(args,env)=>must('docker',args,{env,timeout:300000});
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
 const db=new Client({host:'127.0.0.1',port:55422,user:'postgres',password,database:'postgres',connectionTimeoutMillis:10000,
  ...(portal?{query_timeout:15000,statement_timeout:15000}:{})});
 await db.connect();try{return await fn(db);}finally{await db.end();}
}
async function waitApi(key){
 for(let i=0;i<36;i++){try{const response=await fetch(`${api}/auth/v1/settings`,{headers:{apikey:key},signal:AbortSignal.timeout(2000)});if(response.ok)return;}catch{}await delay(2000);}
 throw Error('api_unhealthy');
}
async function prepareSchema(password,env,serviceKey){
 // Match production's broad historical defaults BEFORE M01. The later
 // restrictive migrations (including M129/M139) must retain their revokes.
 await withPg(password,async db=>{
  await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role');
  await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role');
  await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role');
 });
 const folder=path.join(repo,'supabase/migrations');
 const files=(await readdir(folder)).filter(name=>/^\d{14}_.+\.sql$/.test(name)).sort();
 for(const suffix of portal?['_M70_paciente_cuenta.sql','_M71_rls_autolectura_paciente.sql','_M101_staff_mfa_gate.sql']:
  ['_M139_reception_caller.sql','_M141_caller_screen_list.sql'])assert.ok(files.some(name=>name.endsWith(suffix)),'proof_migration_missing');
 for(const file of files)await must('psql',['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55422','-U','postgres','-d','postgres','-f',path.join(folder,file)],{env:{...env,PGPASSWORD:password},timeout:120000});
 await must('psql',['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55422','-U','postgres','-d','postgres','-c',"NOTIFY pgrst, 'reload schema'"],{env:{...env,PGPASSWORD:password}});
 let ready=false;
 for(let i=0;i<30;i++){
  try{
   const response=await fetch(`${api}/rest/v1/rpc/${portal?'mfa_access_status':'caller_pair'}`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify(portal?{}:{p_code:'0'.repeat(16)}),signal:AbortSignal.timeout(2000)});
   const data=await response.json();if(data?.code!=='PGRST202'){ready=true;break;}
  }catch{}await delay(1000);
 }
 assert.equal(ready,true,'postgrest_schema_cache_not_ready');
 if(!portal)await withPg(password,async db=>{
  const {rows}=await db.query("SELECT has_function_privilege('anon','public.caller_pair(text)','EXECUTE') AS pair_anon,has_function_privilege('anon','public.caller_call(uuid,uuid,uuid,text,integer)','EXECUTE') AS call_anon,has_table_privilege('authenticated','folio_caller_private.screen','SELECT') AS private_read,has_column_privilege('authenticated','public.pedido','motivo_cifrado','SELECT') AS pedido_motivo");
  assert.deepEqual(rows[0],{pair_anon:true,call_anon:false,private_read:false,pedido_motivo:false});
 });
 return files.length;
}
async function fixture(state){
 const service=createClient(api,state.serviceKey,options);
 const actor=createClient(api,state.anonKey,options);
 const email=`${portal?'portal-export':'caller'}-${randomUUID()}@example.test`,password=`Proof-${random(24)}!`;
 const created=await service.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null,'user_create_failed');
 const user=created.data.user.id;
 const login=await actor.auth.signInWithPassword({email,password});assert.equal(login.error,null,'login_failed');
 const enrolled=await actor.auth.mfa.enroll({factorType:'totp',friendlyName:portal?'Synthetic portal export':'Synthetic caller'});assert.equal(enrolled.error,null,'factor_enroll_failed');
 const challenge=await actor.auth.mfa.challenge({factorId:enrolled.data.id});assert.equal(challenge.error,null,'factor_challenge_failed');
 const enrollmentOtpAt=Date.now();
 const verified=await actor.auth.mfa.verify({factorId:enrolled.data.id,challengeId:challenge.data.id,code:totp(enrolled.data.totp.secret,enrollmentOtpAt)});
 assert.equal(verified.error,null,'factor_verify_failed');
 assert.ok(verified.data?.access_token&&verified.data?.refresh_token,'verified_session_missing');
 const org=randomUUID(),member=randomUUID(),patient=randomUUID(),identity=randomUUID(),servicio=randomUUID(),turno=randomUUID();
 const cuentaId=randomUUID();
 const links=[{organizationId:org,patientId:patient,identityId:identity},
  {organizationId:randomUUID(),patientId:randomUUID(),identityId:randomUUID()}];
 const foreign={organizationId:randomUUID(),patientId:randomUUID(),identityId:randomUUID()};
 process.env.FOLIO_ENC_KEY=Buffer.alloc(32,37).toString('base64');
 process.env.FOLIO_ENC_HMAC_KEY=Buffer.alloc(32,71).toString('base64');
 const cryptoModule=await import('../../../lib/crypto.ts');const crypto=cryptoModule.default??cryptoModule;
 const encrypted=crypto.encryptColumn('Paciente sintético');
 const cipher=Buffer.from(encrypted.slice(2),'hex');
 await withPg(state.dbPassword,async db=>{
  await db.query('BEGIN');
  try{
   await db.query('INSERT INTO public.profile(id,email,nombre_cifrado,apellido_cifrado,consent_pii_signed_at,consent_pii_text_version) VALUES($1,$2,$3,$3,now(),$4)',[user,email,cipher,'caller.synthetic.v1']);
   if(portal){
    await db.query('INSERT INTO public.paciente_cuenta(id,auth_user_id,email,email_verificado_en) VALUES($1,$2,$3,now())',[cuentaId,user,email]);
    for(const link of [...links,foreign]){
     await db.query("INSERT INTO public.organization(id,slug,nombre,timezone,especialidad,tipo,onboarding_completed,onboarding_step_max,is_internal_account,is_synthetic,opt_out_analytics,opt_out_public_listing) VALUES($1,$2,'Portal sintético','America/Argentina/Cordoba','quiropraxia','INDEPENDIENTE',true,9,true,true,true,true)",[link.organizationId,`folio-test-portal-${randomUUID().slice(0,12)}`]);
     await db.query("INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,fecha_nacimiento) VALUES($1,$2,$3,$3,$3,'1980-01-01')",[link.identityId,link.organizationId,cipher]);
     await db.query('INSERT INTO public.paciente(id,organization_id,identidad_id,cuenta_id) VALUES($1,$2,$3,$4)',[link.patientId,link.organizationId,link.identityId,link===foreign?null:cuentaId]);
    }
   }else{
   await db.query("INSERT INTO public.organization(id,slug,nombre,timezone,especialidad,tipo,onboarding_completed,onboarding_step_max,is_internal_account,is_synthetic,opt_out_analytics,opt_out_public_listing) VALUES($1,$2,'Recepción sintética','America/Argentina/Cordoba','quiropraxia','INDEPENDIENTE',true,9,true,true,true,true)",[org,`folio-test-caller-${randomUUID().slice(0,12)}`]);
   await db.query("INSERT INTO public.member(id,organization_id,profile_id,role,accepted_at,es_colegiado,especialidad,alcance,profesionales_gestionados) VALUES($1,$2,$3,'OWNER',now(),true,'quiropraxia','TODOS','{}')",[member,org,user]);
   await db.query('INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado) VALUES($1,$2,$3,$3,$3)',[identity,org,cipher]);
   await db.query('INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id) VALUES($1,$2,$3,$4)',[patient,org,identity,member]);
   await db.query("INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES($1,$2,'Consulta sintética',enum_first(null::public.tipo_servicio_canonico),30,1000)",[servicio,org]);
   await db.query("INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,estado) VALUES($1,$2,$3,$4,$5,((timezone('America/Argentina/Cordoba',clock_timestamp())::date)::timestamp+interval '12 hours') AT TIME ZONE 'America/Argentina/Cordoba',30,1000,'EN_SALA')",[turno,org,patient,servicio,member]);
   }
   await db.query('UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now() WHERE singleton');
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
 });
 if(portal)state.portalScope={userId:user,cuentaId,links};
 let cookies=[];
 const seeded=createServerClient(api,state.anonKey,{cookies:{
  getAll:()=>cookies,
  setAll:values=>{cookies=values.map(({name,value,options})=>({name,value,options}));},
 }});
 const session=await seeded.auth.setSession({access_token:verified.data.access_token,refresh_token:verified.data.refresh_token});
 assert.equal(session.error,null,'session_cookie_unavailable');
 const {data:identityCheck,error:identityError}=await seeded.auth.getUser();
 assert.equal(identityError,null,'verified_identity_failed');
 assert.equal(identityCheck.user?.id,user,'verified_identity_mismatch');
 const {data:mfa,error:mfaError}=await seeded.rpc('mfa_access_status');
 assert.equal(mfaError,null,'verified_mfa_status_failed');
 assert.equal(mfa?.required,true,'mfa_not_required');
 assert.equal(mfa?.isStaff,!portal,'mfa_audience_mismatch');
 assert.equal(mfa?.hasVerifiedFactor,true,'mfa_factor_missing');
 assert.equal(mfa?.sessionValid,true,'mfa_session_invalid');
 assert.equal(mfa?.allowed,true,'mfa_access_denied');
 assert.ok(cookies.length>0,'session_cookie_missing');
 if(portal){
  const members=await seeded.from('member').select('id');assert.equal(members.error,null);assert.deepEqual(members.data,[]);
  const account=await seeded.rpc('paciente_cuenta_actual');assert.equal(account.error,null);assert.equal(account.data,cuentaId);
 }
 console.log(`${prefix}_session:identity=matched required=1 staff=${portal?0:1} factor=1 allowed=1 valid=1`);
 const browserCookies=cookies.map(({name,value,options})=>{
  const sameSite={lax:'Lax',strict:'Strict',none:'None'}[String(options?.sameSite??'').toLowerCase()];
  return {name,value,domain:'localhost',path:options?.path??'/',
   ...(typeof options?.httpOnly==='boolean'?{httpOnly:options.httpOnly}:{}),
   ...(typeof options?.secure==='boolean'?{secure:options.secure}:{}),
   ...(sameSite?{sameSite}:{})};
 });
 const data={browserCookies,userId:user,databaseUrl:`postgresql://postgres:${state.dbPassword}@127.0.0.1:55422/postgres`,
  ...(portal?{mode:'portal-export',cuentaId,links,foreign}:{turnoId:turno})};
 if(portal)assertPortalFixture(data);
 await writeFile(fixtureFile,JSON.stringify(data),{flag:'wx',mode:0o600});state.fixtureOwned=true;
}
async function main(){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.RUNNER_OS,'Linux');assert.equal(process.platform,'linux');
 const official=path.resolve(process.env.C01_OFFICIAL_DOCKER??'');
 assert.ok(process.env.RUNNER_TEMP&&official.startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep));
 assert.equal((await must('git',['-C',path.dirname(official),'rev-parse','HEAD'])).trim(),upstreamCommit);
 assert.equal((await must('psql',['--version'])).match(/\b(\d+)\./)?.[1],'17');
 try{await access(fixtureFile);throw Error('fixture_not_fresh');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(portal)try{await access(receiptFile);throw Error('receipt_not_fresh');}catch(error){if(error.code!=='ENOENT')throw error;}
 const secret=random(48),dbPassword=random(32);
 const state={dbPassword,anonKey:token(secret,'anon'),serviceKey:token(secret,'service_role'),
  portalReceipt:{version:1,passed:false,exitCode:1,markers:[],primary:null,secondary:[]}};
 const env={...process.env,C01_OFFICIAL_DOCKER:official,C01_DB_PASSWORD:dbPassword,C01_JWT_SECRET:secret,C01_ANON_KEY:state.anonKey,C01_SERVICE_KEY:state.serviceKey,
  C01_DASHBOARD_PASSWORD:random(18),C01_APP_DATABASE:'postgres',C01_CRON_DATABASE:'postgres',C01_S3_BUCKET:'caller-proof-synthetic',C01_MINIO_USER:random(18),C01_MINIO_PASSWORD:random(36)};
 assert.equal((await dc(['ps','-q'],env)).trim(),'','project_not_fresh');
 assert.equal((await docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${project}`],env)).trim(),'','volumes_not_fresh');
 let stage='pull',servicesStep='none',dbBridge=null,apiBridge=null;
 try{
  await dc(['pull','db','auth','rest','storage','api-gw','minio','minio-createbucket'],env);
  stage='services';servicesStep='compose_up';await dc(['up','-d','--wait'],env);
  servicesStep='network';assert.equal((await docker(['network','inspect',`${project}_default`,'--format','{{.Internal}}'],env)).trim(),'true');
  servicesStep='db_bridge';dbBridge=await bridge('db',55422,5432,env);
  servicesStep='api_bridge';apiBridge=await bridge('api-gw',55421,8000,env);
  servicesStep='api_ready';await waitApi(state.anonKey);
  stage='migrations';const count=await prepareSchema(dbPassword,env,state.serviceKey);
  stage='auth';await fixture(state);
  stage='browser';const browserEnv={...env,E2E_BASE_URL:'http://localhost:4430',FOLIO_TEST_SUPABASE_URL:api,FOLIO_TEST_SUPABASE_ANON_KEY:state.anonKey,FOLIO_TEST_SUPABASE_SERVICE_KEY:state.serviceKey,FOLIO_TEST_DATABASE_URL:`postgresql://postgres:${dbPassword}@127.0.0.1:55422/postgres`,FOLIO_TEST_CLINICAL:portal?'0':'1'};
  const result=await run('pnpm',['test:e2e','--',...proofSpecs(mode),'--trace=off','--reporter=list'],{env:browserEnv,timeout:900000,limit:2000000});
  if(portal){
   const receipt=portalExportResult(result.output);
   state.portalReceipt=portalProofReceipt(result.output,result.code);
   await preservePortalReceipt(state); // Durable finite evidence BEFORE throwing or deleting the backend.
   for(const marker of receipt.markers)console.log(marker);
   if(result.code!==0||!receipt.passed||!state.portalReceipt.passed)throw Error('portal_export_missing_pass');
   stage='complete';state.portalMigrations=count;
   console.log('portal_export_proof_tests:passed=3 skipped=0');
   return;
  }
  const {stages:markers,diagnostics}=callerMarkers.parseCallerProofOutput(result.output);
  for(const item of markers)if(['test_started','settings_loaded','pair_requested','pair_click_returned','pair_issued','screen_context_requested','screen_context_created','screen_script_ready','screen_open','screen_ready','screen_pair_requested','pair_submitted','screen_paired','call_click_actionable','call_click_started','call_post_observed','call_post_committed','call_click_returned','called_on_screen','lost_response_reused','visit_unchanged','polling_bounded','reconnect_silent','revoked_after_reload'].includes(item.stage))
   console.log(`caller_proof_stage:${item.stage} elapsed_ms=${item.elapsedMs}${item.visible11s!==undefined?` visible_11s=${item.visible11s} hidden_6s=0`:''}`);
  for(const item of diagnostics)console.log(`caller_proof_pair_diagnostic:action=${item.action} status=${item.status} button=${item.button} message=${item.message} code=${item.code}`);
  const counts=result.output.split(/\r?\n/).filter(line=>/^\s*\d+ (?:passed|failed|skipped)\b/.test(line));
  for(const line of counts.slice(-3))console.log(line.trim());
  if(result.code!==0){
   const lines=[...result.output.matchAll(/caller-screen\.spec\.ts:(\d+)(?::\d+)?/g)].map(m=>Number(m[1])).filter(n=>n>0&&n<1000);
   const kind=/strict mode violation/i.test(result.output)?'strict':/Test timeout.*exceeded|test timeout of \d+ms/i.test(result.output)?'test_timeout':/(?:Timeout:?|Timed out)\s*\d+ms|expect\([^\n]+\).*timeout/i.test(result.output)?'expect_timeout':/Target closed|browser has been closed/i.test(result.output)?'target_closed':/AssertionError|expect\([^\n]+\) failed/i.test(result.output)?'assertion':'other';
   console.log(`caller_proof_diagnostic:last_stage=${markers.at(-1)?.stage??'none'} spec_lines=${[...new Set(lines)].slice(-3).join(',')||'unknown'} kind=${kind}`);
   throw Error('caller_browser_failed');
  }
  if(/\bskipped\b|\bskip\b/i.test(result.output)||!/\b1 passed\b/.test(result.output))throw Error('caller_browser_missing_pass');
  for(const required of ['pair_issued','screen_paired','called_on_screen','lost_response_reused','visit_unchanged','polling_bounded','reconnect_silent','revoked_after_reload'])
   assert.ok(markers.some(item=>item.stage===required),'caller_stage_missing');
  stage='complete';console.log(`caller_proof_pass:migrations=${count} polls_11s=${markers.find(item=>item.stage==='polling_bounded')?.visible11s} hidden_6s=0`);
 }catch(error){
  if(portal){retainFailure(state,error,stages.has(stage)?stage:'preflight');await preservePortalReceipt(state);}
  if(stage==='services')console.error(`${prefix}_services_diagnostic:${await finiteServicesDiagnostic(env,servicesStep)}`);
  console.error(`${prefix}_${stages.has(stage)?stage:'unclassified'}_failed`);
  process.exitCode=1;
 }finally{
  if(portal&&state.portalScope){
   try{
    await withPg(dbPassword,async db=>{
     const {userId,cuentaId,links}=state.portalScope;
     const account=await db.query('SELECT id FROM public.paciente_cuenta WHERE id=$1 AND auth_user_id=$2 AND deleted_at IS NULL',[cuentaId,userId]);
     assert.equal(account.rowCount,1,'portal_cleanup_account_missing');
     for(const link of links){
      const owned=await db.query('SELECT p.id FROM public.paciente p JOIN public.organization o ON o.id=p.organization_id AND o.is_synthetic AND o.is_internal_account WHERE p.id=$1 AND p.organization_id=$2 AND p.identidad_id=$3',[link.patientId,link.organizationId,link.identityId]);
      assert.equal(owned.rowCount,1,'portal_cleanup_scope_missing');
      const identity=await db.query("UPDATE public.paciente_identidad SET deleted_at=NULL WHERE id=$1 AND organization_id=$2 AND (deleted_at IS NULL OR deleted_at='2026-09-30T00:00:00Z') RETURNING id",[link.identityId,link.organizationId]);
      assert.equal(identity.rowCount,1,'portal_cleanup_identity_missing');
      const patient=await db.query('UPDATE public.paciente SET cuenta_id=$4 WHERE id=$1 AND organization_id=$2 AND identidad_id=$3 AND (cuenta_id IS NULL OR cuenta_id=$4) RETURNING id',[link.patientId,link.organizationId,link.identityId,cuentaId]);
      assert.equal(patient.rowCount,1,'portal_cleanup_link_missing');
      const checked=await db.query('SELECT p.id FROM public.paciente p JOIN public.paciente_identidad i ON i.id=p.identidad_id AND i.organization_id=p.organization_id AND i.deleted_at IS NULL WHERE p.id=$1 AND p.organization_id=$2 AND p.identidad_id=$3 AND p.cuenta_id=$4 AND p.pseudonimizado_en IS NULL',[link.patientId,link.organizationId,link.identityId,cuentaId]);
      assert.equal(checked.rowCount,1,'portal_cleanup_readback_missing');
     }
     console.log('portal_export_proof_restore:owned=2 identities=visible');
    });
   }catch(error){retainFailure(state,error,'restore');console.error('portal_export_proof_restore_failed');}
  }
  if(portal)await preservePortalReceipt(state);
  const cleanupFailure=error=>{if(portal)retainFailure(state,error,'cleanup');else process.exitCode=1;};
  if(state.fixtureOwned)await unlink(fixtureFile).catch(cleanupFailure);
  await apiBridge?.close().catch(cleanupFailure);await dbBridge?.close().catch(cleanupFailure);
  await dc(['down','-v'],env).catch(cleanupFailure);
  if(portal){
   try{
    assert.equal((await dc(['ps','-q'],env)).trim(),'','portal_cleanup_containers_remaining');
    assert.equal((await docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${project}`],env)).trim(),'','portal_cleanup_volumes_remaining');
    assert.equal((await docker(['network','ls','-q','--filter',`label=com.docker.compose.project=${project}`],env)).trim(),'','portal_cleanup_network_remaining');
    console.log('portal_export_proof_cleanup:containers=0 volumes=0 networks=0');
   }catch(error){retainFailure(state,error,'cleanup');console.error('portal_export_proof_cleanup_failed');}
   await preservePortalReceipt(state);
   if(stage==='complete'&&process.exitCode!==1)console.log(`portal_export_proof_pass:tests=3 skipped=0 migrations=${state.portalMigrations} restored=1 cleanup=1`);
  }
 }
}
main().catch(()=>{console.error(`${prefix}_preflight_failed`);process.exitCode=1;});
