// Adapted from caller-proof/run.mjs at 8317f187. External-only project; no shared modes changed.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {totp} from '../clinical-config.mjs';
import {safeEnvironment} from '../isolation-policy.mjs';
import {openLoopbackBridge,validateBridgeTarget,waitForBridgeTarget} from '../../recovery/ci-loopback-bridge.mjs';
import {PROJECT} from './contract.mjs';
const repo=path.resolve(fileURLToPath(new URL('../../../',import.meta.url))),compose=path.join(repo,'scripts/recovery/ci-compose.yml');
const api='http://127.0.0.1:55421',options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const random=n=>randomBytes(n).toString('base64url'),delay=ms=>new Promise(r=>setTimeout(r,ms));
function token(secret,role){const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
 const body=`${encode({alg:'HS256',typ:'JWT'})}.${encode({iss:'supabase-local',role,aud:role==='anon'?'anon':'authenticated',iat:now,exp:now+3600})}`;
 return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
}
function run(program,args,{env=safeEnvironment(process.env),timeout=180000,limit=1048576}={}){return new Promise((resolve,reject)=>{
 const child=spawn(program,args,{cwd:repo,env,stdio:['ignore','pipe','pipe'],windowsHide:true});let output='',overflow=false;
 for(const stream of [child.stdout,child.stderr])stream.on('data',piece=>{if(output.length+piece.length>limit){overflow=true;return;}output+=piece.toString('utf8');});
 const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('hosted_child_timeout'));},timeout);
 child.once('error',()=>{clearTimeout(timer);reject(Error('hosted_child_spawn'));});child.once('close',code=>{clearTimeout(timer);if(overflow)reject(Error('hosted_output_limit'));else resolve({code,output});});
});}
async function must(program,args,settings){const r=await run(program,args,settings);if(r.code!==0)throw Error('hosted_child_failed');return r.output;}
export const gitValue=async ref=>(await must('git',['rev-parse',ref])).trim();
export async function openHosted({manifest,grant,receipt,persist}){
 const official=path.resolve(process.env.C01_OFFICIAL_DOCKER??'');assert.ok(process.env.RUNNER_TEMP&&official.startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep),'official_checkout');
 assert.equal((await must('git',['-C',path.dirname(official),'rev-parse','HEAD'])).trim(),'8c7a4d9dbbaf8b552893822e89d7bf06f33f9220','official_pin');
 assert.equal((await must('psql',['--version'])).match(/\b(\d+)\./)?.[1],'17','postgres_client');
 const secret=random(48),password=random(32),anon=token(secret,'anon'),serviceKey=token(secret,'service_role');
 const childEnv={...safeEnvironment(process.env),C01_OFFICIAL_DOCKER:official,C01_DB_PASSWORD:password,C01_JWT_SECRET:secret,C01_ANON_KEY:anon,C01_SERVICE_KEY:serviceKey,
  C01_DASHBOARD_PASSWORD:random(18),C01_APP_DATABASE:'postgres',C01_CRON_DATABASE:'postgres',C01_S3_BUCKET:'google-external-synthetic',C01_MINIO_USER:random(18),C01_MINIO_PASSWORD:random(36)};
 const docker=args=>must('docker',args,{env:childEnv,timeout:300000}),dc=args=>docker(['compose','-p',PROJECT,'-f',compose,...args]);
 const withDatabase=async fn=>{const db=new Client({host:'127.0.0.1',port:55422,user:'postgres',password,database:'postgres',connectionTimeoutMillis:10000,query_timeout:15000,statement_timeout:15000});await db.connect();try{return await fn(db);}finally{await db.end();}};
 const bridge=async(service,localPort,remotePort)=>{
  const id=(await dc(['ps','-q',service])).trim();assert.match(id,/^[a-f0-9]{64}$/);
  const labels=JSON.parse(await docker(['inspect','--format','{{json .Config.Labels}}',id])),networks=JSON.parse(await docker(['inspect','--format','{{json .NetworkSettings.Networks}}',id]));
  const network=JSON.parse(await docker(['network','inspect','--format','{{json .}}',`${PROJECT}_default`]));
  const target=validateBridgeTarget({project:PROJECT,service,containerId:id,labels,networks,network,remotePort});await waitForBridgeTarget(target);return openLoopbackBridge(target,localPort);
 };
 // Ownership acquired only after all freshness checks. A foreign/previous project is never removed.
 assert.equal((await dc(['ps','--all','-q'])).trim(),'','project_not_fresh');
 assert.equal((await docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${PROJECT}`])).trim(),'','volumes_not_fresh');
 assert.equal((await docker(['network','ls','-q','--filter',`label=com.docker.compose.project=${PROJECT}`])).trim(),'','network_not_fresh');
 let dbBridge,apiBridge,closed=false;
 const close=async()=>{if(closed)return;closed=true;let ok=true;
  for(const resource of [apiBridge,dbBridge])try{await resource?.close();}catch{ok=false;}
  try{await dc(['down','-v']);
   assert.equal((await dc(['ps','--all','-q'])).trim(),'','containers_remaining');
   assert.equal((await docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${PROJECT}`])).trim(),'','volumes_remaining');
   assert.equal((await docker(['network','ls','-q','--filter',`label=com.docker.compose.project=${PROJECT}`])).trim(),'','network_remaining');
  }catch{ok=false;}
  receipt.backendCleanup=ok;await persist();if(!ok)throw Error('backend_cleanup_failed');
 };
 try{
  await dc(['pull','db','auth','rest','storage','api-gw','minio','minio-createbucket']);await dc(['up','-d','--wait']);
  assert.equal((await docker(['network','inspect',`${PROJECT}_default`,'--format','{{.Internal}}'])).trim(),'true','internal_network');
  dbBridge=await bridge('db',55422,5432);apiBridge=await bridge('api-gw',55421,8000);
  let ready=false;for(let i=0;i<36;i++){try{const r=await fetch(`${api}/auth/v1/settings`,{headers:{apikey:anon},signal:AbortSignal.timeout(2000)});if(r.ok){ready=true;break;}}catch{}await delay(2000);}assert.ok(ready,'api_unhealthy');
  await withDatabase(async db=>{
   await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role');
   await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role');
   await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role');
  });
  const folder=path.join(repo,'supabase/migrations'),files=(await readdir(folder)).filter(n=>/^\d{14}_.+\.sql$/.test(n)).sort();
  for(const suffix of ['_M107_google_calendar_durability.sql','_M119_reschedule_turno_atomic.sql'])assert.ok(files.some(n=>n.endsWith(suffix)),'migration_missing');
  for(const file of files)await must('psql',['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55422','-U','postgres','-d','postgres','-f',path.join(folder,file)],{env:{...childEnv,PGPASSWORD:password},timeout:120000});
  await withDatabase(db=>db.query("NOTIFY pgrst, 'reload schema'"));ready=false;
  for(let i=0;i<30;i++){try{const r=await fetch(`${api}/rest/v1/rpc/mfa_access_status`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(2000)});const data=await r.json();if(data?.code!=='PGRST202'){ready=true;break;}}catch{}await delay(1000);}assert.ok(ready,'schema_not_ready');
  const clean=safeEnvironment(process.env,{supabaseUrl:api,anonKey:anon,serviceKey});
  // New ephemeral encryption keys, unlike fixed unit-test keys. No productive credentials survive.
  clean.FOLIO_ENC_KEY=randomBytes(32).toString('base64');clean.FOLIO_ENC_HMAC_KEY=randomBytes(32).toString('base64');
  for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,clean);
  const service=createClient(api,serviceKey,options),actor=createClient(api,anon,options),email=`c05-${randomUUID()}@example.test`,actorPassword=`C05-${random(24)}!`;
  const read=async result=>{const r=await result;assert.equal(r.error,null,'fixture_query');return r.data;};
  const created=await read(service.auth.admin.createUser({email,password:actorPassword,email_confirm:true})),user=created.user.id;
  await read(actor.auth.signInWithPassword({email,password:actorPassword}));
  const enrolled=await read(actor.auth.mfa.enroll({factorType:'totp',friendlyName:'Synthetic Google external'}));
  const challenged=await read(actor.auth.mfa.challenge({factorId:enrolled.id}));
  await read(actor.auth.mfa.verify({factorId:enrolled.id,challengeId:challenged.id,code:totp(enrolled.totp.secret,Date.now())}));
  const org=randomUUID(),member=randomUUID(),patient=randomUUID(),identity=randomUUID(),servicio=randomUUID(),integration=randomUUID();
  const cryptoModule=await import('../../../lib/crypto.ts'),crypto=cryptoModule.default??cryptoModule,cipher=value=>Buffer.from(crypto.encryptColumn(value).slice(2),'hex'),synthetic=cipher('Paciente sintético');
  await withDatabase(async db=>{await db.query('BEGIN');try{
   for(const table of ['organization','member','paciente','integration','turno','google_outbound_job']){const count=await db.query(`SELECT count(*)::int AS n FROM public.${table}`);assert.equal(count.rows[0].n,0,'fixture_not_empty');}
   await db.query('INSERT INTO public.profile(id,email,nombre_cifrado,apellido_cifrado,consent_pii_signed_at,consent_pii_text_version) VALUES($1,$2,$3,$3,now(),$4)',[user,email,synthetic,'c05.synthetic.v1']);
   await db.query("INSERT INTO public.organization(id,slug,nombre,timezone,especialidad,tipo,onboarding_completed,onboarding_step_max,is_internal_account,is_synthetic,opt_out_analytics,opt_out_public_listing) VALUES($1,$2,'Google sintético','America/Argentina/Buenos_Aires','quiropraxia','INDEPENDIENTE',true,9,true,false,true,true)",[org,`folio-test-c05-${manifest.runId.slice(0,12)}`]);
   await db.query("INSERT INTO public.member(id,organization_id,profile_id,role,accepted_at,es_colegiado,especialidad,alcance,profesionales_gestionados) VALUES($1,$2,$3,'OWNER',now(),true,'quiropraxia','TODOS','{}')",[member,org,user]);
   await db.query("INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,fecha_nacimiento) VALUES($1,$2,$3,$3,$3,'1980-01-01')",[identity,org,synthetic]);
   await db.query('INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id) VALUES($1,$2,$3,$4)',[patient,org,identity,member]);
   await db.query("INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES($1,$2,'Consulta sintética',enum_first(null::public.tipo_servicio_canonico),30,1000)",[servicio,org]);
   await db.query("INSERT INTO public.integration(id,organization_id,profesional_id,proveedor,access_token_cifrado,refresh_token_cifrado,meta_json) VALUES($1,$2,$3,'GOOGLE_CALENDAR',$4,$5,$6::jsonb)",[integration,org,member,cipher('external-access-unused'),cipher(grant.refreshToken),JSON.stringify({calendar_id:manifest.calendarId})]);
   await db.query('UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now() WHERE singleton');await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}});
  const mfa=await read(actor.rpc('mfa_access_status'));for(const key of ['required','isStaff','hasVerifiedFactor','sessionValid','allowed'])assert.equal(mfa[key],true,'fixture_mfa');
  const snapshot=async()=>withDatabase(async db=>{
   const turns=await db.query('SELECT id,estado,gcal_event_id FROM public.turno WHERE organization_id=$1 ORDER BY id',[org]);
   const jobs=await db.query('SELECT id,turno_id,event_id,status,sanitized_error FROM public.google_outbound_job WHERE organization_id=$1 ORDER BY id',[org]);
   const blocks=await db.query('SELECT count(*)::int AS n FROM public.bloqueo WHERE organization_id=$1',[org]);
   return {organizationId:org,memberId:member,patientId:patient,integrationId:integration,turns:turns.rows,jobs:jobs.rows,blocks:blocks.rows[0].n};
  });
  return {actor,service,scope:{org,member,patient,servicio,integration},withDatabase,snapshot,close};
 }catch(e){await close();throw e;}
}
