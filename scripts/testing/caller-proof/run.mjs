#!/usr/bin/env node
// B10b: one hosted, synthetic Auth/DB/browser proof; never a local Docker run.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {readdir,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {totp} from '../clinical-config.mjs';
import {openLoopbackBridge,validateBridgeTarget,waitForBridgeTarget} from '../../recovery/ci-loopback-bridge.mjs';

const repo=path.resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const compose=path.join(repo,'scripts/recovery/ci-compose.yml');
const project='folio_caller_proof';
const upstreamCommit='8c7a4d9dbbaf8b552893822e89d7bf06f33f9220';
const api='http://127.0.0.1:55421';
const fixtureFile=path.join(tmpdir(),'folio-caller-proof-fixture.json');
const random=bytes=>randomBytes(bytes).toString('base64url');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const stages=new Set(['pull','services','migrations','schema','auth','fixture','browser','complete']);

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
 const db=new Client({host:'127.0.0.1',port:55422,user:'postgres',password,database:'postgres',connectionTimeoutMillis:10000});
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
 for(const suffix of ['_M139_reception_caller.sql','_M141_caller_screen_list.sql'])assert.ok(files.some(name=>name.endsWith(suffix)),'caller_migration_missing');
 for(const file of files)await must('psql',['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55422','-U','postgres','-d','postgres','-f',path.join(folder,file)],{env:{...env,PGPASSWORD:password},timeout:120000});
 await must('psql',['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55422','-U','postgres','-d','postgres','-c',"NOTIFY pgrst, 'reload schema'"],{env:{...env,PGPASSWORD:password}});
 let ready=false;
 for(let i=0;i<30;i++){
  try{
   const response=await fetch(`${api}/rest/v1/rpc/caller_pair`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify({p_code:'0'.repeat(16)}),signal:AbortSignal.timeout(2000)});
   const data=await response.json();if(data?.code!=='PGRST202'){ready=true;break;}
  }catch{}await delay(1000);
 }
 assert.equal(ready,true,'postgrest_schema_cache_not_ready');
 await withPg(password,async db=>{
  const {rows}=await db.query("SELECT has_function_privilege('anon','public.caller_pair(text)','EXECUTE') AS pair_anon,has_function_privilege('anon','public.caller_call(uuid,uuid,uuid,text,integer)','EXECUTE') AS call_anon,has_table_privilege('authenticated','folio_caller_private.screen','SELECT') AS private_read,has_column_privilege('authenticated','public.pedido','motivo_cifrado','SELECT') AS pedido_motivo");
  assert.deepEqual(rows[0],{pair_anon:true,call_anon:false,private_read:false,pedido_motivo:false});
 });
 return files.length;
}
async function fixture(state){
 const service=createClient(api,state.serviceKey,options);
 const actor=createClient(api,state.anonKey,options);
 const email=`caller-${randomUUID()}@example.test`,password=`Caller-${random(24)}!`;
 const created=await service.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null,'user_create_failed');
 const user=created.data.user.id;
 const login=await actor.auth.signInWithPassword({email,password});assert.equal(login.error,null,'login_failed');
 const enrolled=await actor.auth.mfa.enroll({factorType:'totp',friendlyName:'Synthetic caller'});assert.equal(enrolled.error,null,'factor_enroll_failed');
 const challenge=await actor.auth.mfa.challenge({factorId:enrolled.data.id});assert.equal(challenge.error,null,'factor_challenge_failed');
 const verified=await actor.auth.mfa.verify({factorId:enrolled.data.id,challengeId:challenge.data.id,code:totp(enrolled.data.totp.secret)});
 assert.equal(verified.error,null,'factor_verify_failed');
 const org=randomUUID(),member=randomUUID(),patient=randomUUID(),identity=randomUUID(),servicio=randomUUID(),turno=randomUUID();
 process.env.FOLIO_ENC_KEY=Buffer.alloc(32,37).toString('base64');
 process.env.FOLIO_ENC_HMAC_KEY=Buffer.alloc(32,71).toString('base64');
 const module=await import('../../../lib/crypto.ts');const crypto=module.default??module;
 const encrypted=crypto.encryptColumn('Paciente sintético');
 const cipher=Buffer.from(encrypted.slice(2),'hex');
 await withPg(state.dbPassword,async db=>{
  await db.query('BEGIN');
  try{
   await db.query('INSERT INTO public.profile(id,email,nombre_cifrado,apellido_cifrado,consent_pii_signed_at,consent_pii_text_version) VALUES($1,$2,$3,$3,now(),$4)',[user,email,cipher,'caller.synthetic.v1']);
   await db.query("INSERT INTO public.organization(id,slug,nombre,timezone,especialidad,tipo,onboarding_completed,onboarding_step_max,is_internal_account,is_synthetic,opt_out_analytics,opt_out_public_listing) VALUES($1,$2,'Recepción sintética','America/Argentina/Cordoba','quiropraxia','INDEPENDIENTE',true,9,true,true,true,true)",[org,`folio-test-caller-${randomUUID().slice(0,12)}`]);
   await db.query("INSERT INTO public.member(id,organization_id,profile_id,role,accepted_at,es_colegiado,especialidad,alcance,profesionales_gestionados) VALUES($1,$2,$3,'OWNER',now(),true,'quiropraxia','TODOS','{}')",[member,org,user]);
   await db.query('INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado) VALUES($1,$2,$3,$3,$3)',[identity,org,cipher]);
   await db.query('INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id) VALUES($1,$2,$3,$4)',[patient,org,identity,member]);
   await db.query("INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES($1,$2,'Consulta sintética',enum_first(null::public.tipo_servicio_canonico),30,1000)",[servicio,org]);
   await db.query("INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,estado) VALUES($1,$2,$3,$4,$5,((timezone('America/Argentina/Cordoba',clock_timestamp())::date)::timestamp+interval '12 hours') AT TIME ZONE 'America/Argentina/Cordoba',30,1000,'EN_SALA')",[turno,org,patient,servicio,member]);
   await db.query('UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now() WHERE singleton');
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
 });
 await writeFile(fixtureFile,JSON.stringify({email,password,totpSecret:enrolled.data.totp.secret,databaseUrl:`postgresql://postgres:${state.dbPassword}@127.0.0.1:55422/postgres`,turnoId:turno}),{flag:'wx',mode:0o600});
}
async function main(){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.RUNNER_OS,'Linux');assert.equal(process.platform,'linux');
 const official=path.resolve(process.env.C01_OFFICIAL_DOCKER??'');
 assert.ok(process.env.RUNNER_TEMP&&official.startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep));
 assert.equal((await must('git',['-C',path.dirname(official),'rev-parse','HEAD'])).trim(),upstreamCommit);
 assert.equal((await must('psql',['--version'])).match(/\b(\d+)\./)?.[1],'17');
 const secret=random(48),dbPassword=random(32);
 const state={dbPassword,anonKey:token(secret,'anon'),serviceKey:token(secret,'service_role')};
 const env={...process.env,C01_OFFICIAL_DOCKER:official,C01_DB_PASSWORD:dbPassword,C01_JWT_SECRET:secret,C01_ANON_KEY:state.anonKey,C01_SERVICE_KEY:state.serviceKey,
  C01_DASHBOARD_PASSWORD:random(18),C01_APP_DATABASE:'postgres',C01_CRON_DATABASE:'postgres',C01_S3_BUCKET:'caller-proof-synthetic',C01_MINIO_USER:random(18),C01_MINIO_PASSWORD:random(36)};
 assert.equal((await dc(['ps','-q'],env)).trim(),'','project_not_fresh');
 assert.equal((await docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${project}`],env)).trim(),'','volumes_not_fresh');
 let stage='pull',dbBridge=null,apiBridge=null;
 try{
  await dc(['pull','db','auth','rest','storage','api-gw','minio','minio-createbucket'],env);
  stage='services';await dc(['up','-d','--wait'],env);
  assert.equal((await docker(['network','inspect',`${project}_default`,'--format','{{.Internal}}'],env)).trim(),'true');
  dbBridge=await bridge('db',55422,5432,env);apiBridge=await bridge('api-gw',55421,8000,env);await waitApi(state.anonKey);
  stage='migrations';const count=await prepareSchema(dbPassword,env,state.serviceKey);
  stage='auth';await fixture(state);
  stage='browser';const browserEnv={...env,E2E_BASE_URL:'http://localhost:4430',FOLIO_TEST_SUPABASE_URL:api,FOLIO_TEST_SUPABASE_ANON_KEY:state.anonKey,FOLIO_TEST_SUPABASE_SERVICE_KEY:state.serviceKey,FOLIO_TEST_DATABASE_URL:`postgresql://postgres:${dbPassword}@127.0.0.1:55422/postgres`,FOLIO_TEST_CLINICAL:'1'};
  const result=await run('pnpm',['test:e2e','--','tests/e2e/caller-screen.spec.ts','--trace=off'],{env:browserEnv,timeout:900000,limit:2000000});
  const markers=[...result.output.matchAll(/caller_proof_stage:([a-z0-9_]+)(?: visible_11s=([0-9]+) hidden_6s=0)?/g)].map(match=>({stage:match[1],visible:match[2]}));
  for(const item of markers)if(['pair_issued','screen_paired','called_on_screen','lost_response_reused','visit_unchanged','polling_bounded','reconnect_silent','revoked_after_reload'].includes(item.stage))
   console.log(`caller_proof_stage:${item.stage}${item.visible?` visible_11s=${item.visible} hidden_6s=0`:''}`);
  const counts=result.output.split(/\r?\n/).filter(line=>/^\s*\d+ (?:passed|failed|skipped)\b/.test(line));
  for(const line of counts.slice(-3))console.log(line.trim());
  if(result.code!==0){
   const lines=[...result.output.matchAll(/caller-screen\.spec\.ts:(\d+)(?::\d+)?/g)].map(m=>Number(m[1])).filter(n=>n>0&&n<1000);
   const kind=result.output.includes('TimeoutError')?'timeout':result.output.includes('AssertionError')?'assertion':result.output.includes('locator')?'locator':'unknown';
   console.log(`caller_proof_diagnostic:last_stage=${markers.at(-1)?.stage??'none'} spec_lines=${[...new Set(lines)].slice(-3).join(',')||'unknown'} kind=${kind}`);
   throw Error('caller_browser_failed');
  }
  if(/\bskipped\b|\bskip\b/i.test(result.output)||!/\b1 passed\b/.test(result.output))throw Error('caller_browser_missing_pass');
  for(const required of ['pair_issued','screen_paired','called_on_screen','lost_response_reused','visit_unchanged','polling_bounded','reconnect_silent','revoked_after_reload'])
   assert.ok(markers.some(item=>item.stage===required),'caller_stage_missing');
  stage='complete';console.log(`caller_proof_pass:migrations=${count} polls_11s=${markers.find(item=>item.stage==='polling_bounded')?.visible} hidden_6s=0`);
 }catch{
  console.error(`caller_proof_${stages.has(stage)?stage:'unclassified'}_failed`);
  process.exitCode=1;
 }finally{
  await unlink(fixtureFile).catch(()=>{});
  await apiBridge?.close();await dbBridge?.close();
  await dc(['down','-v'],env).catch(()=>{process.exitCode=1;});
 }
}
main().catch(()=>{console.error('caller_proof_preflight_failed');process.exitCode=1;});
