#!/usr/bin/env node
// Hosted synthetic B06b3 HTTP delivery proof. No real tenant or provider.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {totp} from '../clinical-config.mjs';
import {openLoopbackBridge,validateBridgeTarget,waitForBridgeTarget} from '../../recovery/ci-loopback-bridge.mjs';
import {safeServiceState,SERVICES} from '../export-package-proof/service-diagnostics.mjs';
import {proveHttp} from './prove-http.mjs';

const repo=path.resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const compose=path.join(repo,'scripts/recovery/ci-compose.yml');
// The isolated bridge allowlist already pins this synthetic project name.
// A fresh GitHub runner has no previous containers or volumes under it.
const project='folio_export_bytes_proof';
const officialCommit='8c7a4d9dbbaf8b552893822e89d7bf06f33f9220';
const api='http://127.0.0.1:55421';
const app='http://localhost:4460';
const dbPort=55422;
const random=bytes=>randomBytes(bytes).toString('base64url');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const options={auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}};
const STAGES=new Set(['pull','services','migrations','user_create','totp','fixture_db',
 'source_upload','app_start','session','begin','claim','entry_fragment','finish',
 'manifest','reconstruction','browser','revocation','complete']);

function jwt(secret,role){
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
   if(output.length+piece.length>limit){overflow=true;return;}
   output+=piece.toString('utf8');
  });
  const timer=setTimeout(()=>{proc.kill('SIGKILL');reject(Error('child_timeout'));},timeout);
  proc.once('error',()=>{clearTimeout(timer);reject(Error('child_spawn_failed'));});
  proc.once('close',code=>{clearTimeout(timer);
   if(overflow)return reject(Error('child_output_limit'));
   resolve({code,output});
  });
 });
}
async function must(program,args,settings){
 const result=await run(program,args,settings);
 if(result.code!==0)throw Error(`child_exit_${Number.isInteger(result.code)?result.code:'unknown'}`);
 return result.output;
}
const docker=(args,env)=>must('docker',args,{env,timeout:300000});
const dc=(args,env)=>docker(['compose','-p',project,'-f',compose,...args],env);
async function serviceStates(env){
 const states=[];
 for(const service of SERVICES){
  try{
   const ps=await run('docker',['compose','-p',project,'-f',compose,'ps','--all','-q',service],{env,timeout:10000,limit:8192});
   if(ps.code!==0){states.push(safeServiceState(service,null));continue;}
   const id=ps.output.trim();
   if(!/^[a-f0-9]{64}$/.test(id)){states.push(safeServiceState(service,null));continue;}
   const inspected=await run('docker',['inspect','--format','{{json .State}}',id],{env,timeout:10000,limit:8192});
   if(inspected.code!==0){states.push(safeServiceState(service,null));continue;}
   const raw=JSON.parse(inspected.output);
   states.push(safeServiceState(service,raw));
  }catch{states.push(safeServiceState(service,null));}
 }
 return states;
}
async function bridge(service,port,remotePort,env){
 const id=(await dc(['ps','-q',service],env)).trim();
 assert.match(id,/^[a-f0-9]{64}$/);
 const labels=JSON.parse(await docker(['inspect','--format','{{json .Config.Labels}}',id],env));
 const networks=JSON.parse(await docker(['inspect','--format','{{json .NetworkSettings.Networks}}',id],env));
 const network=JSON.parse(await docker(['network','inspect','--format','{{json .}}',`${project}_default`],env));
 const target=validateBridgeTarget({project,service,containerId:id,labels,networks,network,remotePort});
 await waitForBridgeTarget(target);
 return openLoopbackBridge(target,port);
}
async function withPg(password,fn){
 const client=new Client({host:'127.0.0.1',port:dbPort,user:'postgres',password,database:'postgres',connectionTimeoutMillis:10000,statement_timeout:30000});
 await client.connect();
 try{return await fn(client);}finally{await client.end();}
}
async function installPublicDefaultPrivileges(password){
 // Exact Supabase production role defaults, only in this disposable database
 // and before M01. Later migrations can still revoke/limit their own objects.
 await withPg(password,async db=>{
  await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role');
  await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role');
  await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role');
 });
}
async function assertPublicPrivilegeParity(password){
 await withPg(password,async db=>{
  const {rows}=await db.query(`SELECT
    has_table_privilege('authenticated','public.member','SELECT') AS member_read,
    has_table_privilege('authenticated','public.paciente','SELECT') AS patient_read,
    has_table_privilege('authenticated','public.documento_clinico','SELECT') AS document_read,
    has_table_privilege('authenticated','public.pedido','SELECT') AS broad_pedido_read,
    has_column_privilege('authenticated','public.pedido','motivo_cifrado','SELECT') AS motivo_read,
    has_schema_privilege('authenticated','folio_export_private','USAGE') AS export_schema_usage,
    has_table_privilege('service_role','folio_export_private.job','SELECT') AS direct_job_read,
    (SELECT count(*)::int FROM pg_policies WHERE
      (schemaname='public' AND tablename='documento_clinico' AND policyname IN ('documento_server_insert','documento_server_update') AND permissive='RESTRICTIVE')
      OR (schemaname='storage' AND tablename='objects' AND policyname='clinical_attachments_server_only' AND permissive='RESTRICTIVE')) AS attachment_guards`);
  const actual=rows[0];
  assert.deepEqual(actual,{member_read:true,patient_read:true,document_read:true,
   broad_pedido_read:false,motivo_read:false,export_schema_usage:false,direct_job_read:false,attachment_guards:3},
   'public_privilege_parity_failed');
 });
}
async function waitApi(key){
 for(let i=0;i<36;i++){
  try{const response=await fetch(`${api}/auth/v1/settings`,{headers:{apikey:key},signal:AbortSignal.timeout(2000)});
   if(response.ok)return;
  }catch{}
  await pause(2000);
 }
 throw Error('api_unhealthy');
}
async function startApp(state,env){
 const config={mode:'app',appUrl:app,supabaseUrl:api,anonKey:state.anonKey,
  serviceKey:state.serviceKey,databaseUrl:`postgresql://postgres:${state.dbPassword}@127.0.0.1:${dbPort}/postgres`,
  realSupabase:true,clinical:true};
 const child=spawn(process.execPath,['scripts/testing/app-server.mjs'],{cwd:repo,
  env:{...env,E2E_BASE_URL:app,FOLIO_TEST_APP_CONFIG:JSON.stringify(config)},
  stdio:'ignore',windowsHide:true});
 child.on('error',()=>{});
 for(let attempt=0;attempt<90;attempt++){
  if(child.exitCode!==null)break;
  try{
   const response=await fetch(`${app}/login`,{redirect:'manual',signal:AbortSignal.timeout(1500)});
   if(response.status>=200&&response.status<400)return child;
  }catch{}
  await pause(2000);
 }
 child.kill('SIGTERM');
 throw Error('app_unhealthy');
}
async function reloadRest(password,env,key){
 await must('psql',['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(dbPort),'-U','postgres','-d','postgres','-c',"NOTIFY pgrst, 'reload schema'"],{env:{...env,PGPASSWORD:password}});
 const service=createClient(api,key,options);
 for(let i=0;i<30;i++){
  const {error}=await service.rpc('export_package_read',{p_id:randomUUID(),p_actor:randomUUID()});
  if(!error)return;
  await pause(1000);
 }
 throw Error('postgrest_schema_unavailable');
}
const pdf=(label,padding=0)=>Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Proof (${label}) >>\n%${'x'.repeat(padding)}\nendobj\nstartxref\n0\n%%EOF\n`);
async function fixture(state,mark){
 const service=createClient(api,state.serviceKey,options);
 const actor=createClient(api,state.anonKey,options);
 const email=`folio-b06-${randomUUID()}@example.test`,password=`B06-${random(24)}!`;
 mark('user_create');
 const created=await service.auth.admin.createUser({email,password,email_confirm:true});
 assert.equal(created.error,null,'auth_user_create_failed');
 const user=created.data.user.id;
 const login=await actor.auth.signInWithPassword({email,password});
 assert.equal(login.error,null,'auth_password_failed');
 mark('totp');
 const enrolled=await actor.auth.mfa.enroll({factorType:'totp',friendlyName:'B06 synthetic'});
 assert.equal(enrolled.error,null,'auth_totp_enroll_failed');
 const challenge=await actor.auth.mfa.challenge({factorId:enrolled.data.id});
 assert.equal(challenge.error,null,'auth_totp_challenge_failed');
 const verified=await actor.auth.mfa.verify({factorId:enrolled.data.id,challengeId:challenge.data.id,code:totp(enrolled.data.totp.secret)});
 assert.equal(verified.error,null,'auth_totp_verify_failed');
 const claims=JSON.parse(Buffer.from(verified.data.access_token.split('.')[1],'base64url').toString('utf8'));
 assert.equal(claims.aal,'aal2','auth_not_aal2');
 const org=randomUUID(),member=randomUUID(),patient=randomUUID(),identity=randomUUID();
 const document=randomUUID(),withdrawn=randomUUID(),consent=randomUUID(),template=randomUUID();
 const file=pdf('synthetic-document',50*1024*1024-1024),signature=pdf('synthetic-signature');
 assert.ok(file.length>49*1024*1024&&file.length<=50*1024*1024,'document_not_50mib');
 const documentPath=`documentos-clinicos/${org}/${patient}/${document}.pdf`;
 const withdrawnPath=`documentos-clinicos/${org}/${patient}/${withdrawn}.pdf`;
 const signaturePath=`consentimientos-firmados/${org}/${patient}/${consent}.pdf`;
 const loadedCrypto=await import('../../../lib/crypto.ts');
 const crypto=loadedCrypto.default??loadedCrypto;
 const encrypted=crypto.encryptColumn('Paciente ficticio B06');
 assert.match(encrypted,/^\\x[0-9a-f]+$/);
 const cipher=Buffer.from(encrypted.slice(2),'hex');
 mark('fixture_db');
 await withPg(state.dbPassword,async db=>{
  await db.query('BEGIN');
  try{
   await db.query('INSERT INTO public.profile(id,email,nombre_cifrado,apellido_cifrado,consent_pii_signed_at,consent_pii_text_version) VALUES($1,$2,$3,$3,now(),$4)',[user,email,cipher,'synthetic-b06.v1']);
   await db.query("INSERT INTO public.organization(id,slug,nombre,ciudad,provincia,timezone,especialidad,tipo,onboarding_completed,onboarding_step_max,is_internal_account,is_synthetic,opt_out_analytics,opt_out_public_listing) VALUES($1,$2,'Consultorio sintético B06','Alta Gracia','Córdoba','America/Argentina/Cordoba','quiropraxia','INDEPENDIENTE',true,9,true,true,true,true)",[org,`folio-test-clinical-${randomUUID().slice(0,12)}`]);
   await db.query("INSERT INTO public.member(id,organization_id,profile_id,role,accepted_at,es_colegiado,especialidad,alcance,profesionales_gestionados) VALUES($1,$2,$3,'OWNER',now(),true,'quiropraxia','TODOS','{}')",[member,org,user]);
   await db.query('INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado) VALUES($1,$2,$3,$3,$3)',[identity,org,cipher]);
   await db.query('INSERT INTO public.paciente(id,organization_id,identidad_id) VALUES($1,$2,$3)',[patient,org,identity]);
   await db.query("INSERT INTO public.plantilla_consentimiento(id,organization_id,tipo,titulo,texto_markdown) VALUES($1,$2,'GENERAL','Consentimiento sintético',$3)",[template,org,'Prueba sintética de consentimiento. '.repeat(5)]);
   await db.query("INSERT INTO public.documento_clinico(id,organization_id,paciente_id,tipo,storage_path,mime_type,tamanio_bytes,subido_por_id,content_sha256,validated_at) VALUES($1,$2,$3,'INFORME_EXTERNO',$4,'application/pdf',$5,$6,$7,now())",[document,org,patient,documentPath,file.length,member,sha(file)]);
   await db.query("INSERT INTO public.documento_clinico(id,organization_id,paciente_id,tipo,storage_path,mime_type,tamanio_bytes,subido_por_id,deleted_at) VALUES($1,$2,$3,'INFORME_EXTERNO',$4,'application/pdf',$5,$6,now())",[withdrawn,org,patient,withdrawnPath,file.length,member]);
   await db.query("INSERT INTO public.consentimiento(id,organization_id,paciente_id,plantilla_id,tipo,firma_storage_path) VALUES($1,$2,$3,$4,'GENERAL',$5)",[consent,org,patient,template,signaturePath]);
   // Only this disposable database enables the staff MFA policy. The actor's
   // real TOTP session must satisfy M138; no production flag is touched.
   await db.query('UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now() WHERE singleton');
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
 });
 mark('source_upload');
 for(const [bucket,fullPath,bytes] of [
  ['documentos-clinicos',documentPath,file],['consentimientos-firmados',signaturePath,signature],
 ]){
  const {error}=await service.storage.from(bucket).upload(fullPath.slice(bucket.length+1),bytes,
   {contentType:'application/pdf',upsert:false});
  assert.equal(error,null,'source_upload_failed');
 }
 return {service,actor,user,org,member,patient,document,withdrawn,consent,file,signature,
  withdrawnPath,accessToken:verified.data.access_token,refreshToken:verified.data.refresh_token};
}

async function main(){
 assert.equal(process.env.GITHUB_ACTIONS,'true');
 assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
 assert.equal(process.env.RUNNER_OS,'Linux');
 assert.equal(process.platform,'linux');
 assert.ok(process.env.RUNNER_TEMP&&path.isAbsolute(process.env.RUNNER_TEMP));
 const official=path.resolve(process.env.C01_OFFICIAL_DOCKER??'');
 assert.ok(official.startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep));
 assert.equal((await must('git',['-C',path.dirname(official),'rev-parse','HEAD'])).trim(),officialCommit);
 assert.equal((await must('psql',['--version'])).match(/\b(\d+)\./)?.[1],'17');
 const secret=random(48),dbPassword=random(32);
 const state={dbPassword,anonKey:jwt(secret,'anon'),serviceKey:jwt(secret,'service_role')};
 const env={...process.env,C01_OFFICIAL_DOCKER:official,C01_DB_PASSWORD:dbPassword,
  C01_JWT_SECRET:secret,C01_ANON_KEY:state.anonKey,C01_SERVICE_KEY:state.serviceKey,
  C01_DASHBOARD_PASSWORD:random(18),C01_APP_DATABASE:'postgres',C01_CRON_DATABASE:'postgres',
  C01_S3_BUCKET:'folio-b06-synthetic',C01_MINIO_USER:randomBytes(16).toString('hex'),
  C01_MINIO_PASSWORD:random(36),FOLIO_ENC_KEY:Buffer.alloc(32,37).toString('base64'),
  FOLIO_ENC_HMAC_KEY:Buffer.alloc(32,71).toString('base64')};
 process.env.FOLIO_ENC_KEY=env.FOLIO_ENC_KEY;
 process.env.FOLIO_ENC_HMAC_KEY=env.FOLIO_ENC_HMAC_KEY;
 assert.equal((await dc(['ps','-q'],env)).trim(),'','project_not_fresh');
 assert.equal((await docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${project}`],env)).trim(),'','volumes_not_fresh');
 let stage='pull',dbBridge=null,apiBridge=null,appProcess=null,composeExit=null;
 try{
  await dc(['pull','db','auth','rest','storage','api-gw','minio','minio-createbucket'],env);
  stage='services';
  const started=await run('docker',['compose','-p',project,'-f',compose,'up','-d','--wait'],{env,timeout:300000});
  composeExit=Number.isInteger(started.code)&&started.code>=0&&started.code<=255?started.code:null;
  assert.equal(composeExit,0,'compose_services_failed');
  assert.equal((await docker(['network','inspect',`${project}_default`,'--format','{{.Internal}}'],env)).trim(),'true');
  dbBridge=await bridge('db',dbPort,5432,env);
  apiBridge=await bridge('api-gw',55421,8000,env);
  await waitApi(state.anonKey);
  stage='migrations';
  await installPublicDefaultPrivileges(dbPassword);
  const folder=path.join(repo,'supabase/migrations');
  const files=(await readdir(folder)).filter(name=>/^\d{14}_.+\.sql$/.test(name)).sort();
  assert.ok(files.some(name=>name.endsWith('_M140_export_package_delivery.sql')),'M140_missing');
  for(const file of files)await must('psql',['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(dbPort),'-U','postgres','-d','postgres','-f',path.join(folder,file)],{env:{...env,PGPASSWORD:dbPassword},timeout:120000});
  await assertPublicPrivilegeParity(dbPassword);
  await reloadRest(dbPassword,env,state.serviceKey);
  const mark=value=>{assert.ok(STAGES.has(value));stage=value;};
  stage='user_create';const seed=await fixture(state,mark);
  stage='app_start';appProcess=await startApp(state,env);
  const proof=await proveHttp({state,seed,mark,app,api});
  stage='complete';
  if(process.env.GITHUB_STEP_SUMMARY){
   const {appendFile}=await import('node:fs/promises');
   await appendFile(process.env.GITHUB_STEP_SUMMARY,`## B06b3 synthetic HTTP delivery proof\n\n- Exact head: ${(await must('git',['rev-parse','HEAD'])).trim()}\n- Migrations in fresh PostgreSQL 17: ${files.length}\n- Seven Next HTTP routes with real session, AAL2, RLS and private S3 Storage: verified\n- Actual 50 MiB document in 17 fragments, JSON and signature: reconstructed with SHA-256\n- Retired document: inventory only; no bytes\n- Lost begin response: same operation and job\n- Source withdrawal after READY: blocked\n- Chromium writer: real OPFS file handle, native picker substituted; interrupted overwrite aborted after partial write and prior file SHA-256 preserved; unsupported API explained\n- Independent TAR reader: document, signature and JSON verified\n- TAR bytes: ${proof.archiveBytes}; SHA-256: ${proof.archiveSha256}; browser seconds: ${proof.elapsedSeconds}\n- Maximum observed progress call: ${proof.maxProgressMs} ms\n- Native OS picker and maximum inventory volume: not certified\n`,{flag:'a'});
  }
 }catch{
  if(stage==='services'){
   const states=await serviceStates(env);
   console.error(JSON.stringify({diagnostic:'b06b3_compose_services',composeExit,states}));
  }
  console.error(`b06b3_${STAGES.has(stage)?stage:'unclassified'}_failed`); // No raw HTTP, SQL, Storage or Auth bodies.
  process.exitCode=1;
 }finally{
  appProcess?.kill('SIGTERM');
  await apiBridge?.close();await dbBridge?.close();
  try{await dc(['down'],env);}catch{console.error('b06b3_teardown_failed');process.exitCode=1;}
 }
}
main().catch(()=>{console.error('b06b3_preflight_failed');process.exitCode=1;});
