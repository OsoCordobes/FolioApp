#!/usr/bin/env node
// B01/B02: fresh, synthetic Auth + browser proof on a GitHub-hosted runner.
// Never use this runner with a hosted Supabase project or inherited env files.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHmac,randomBytes} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openLoopbackBridge,validateBridgeTarget,waitForBridgeTarget} from '../../recovery/ci-loopback-bridge.mjs';

const repo=path.resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const compose=path.join(repo,'scripts/recovery/ci-compose.yml');
const overlay=path.join(repo,'scripts/testing/auth-proof/compose.yml');
const project='folio_c01_source';
const upstreamCommit='8c7a4d9dbbaf8b552893822e89d7bf06f33f9220';
const api='http://127.0.0.1:55421';
const b64=bytes=>randomBytes(bytes).toString('base64url');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function token(secret,role){
 const part=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const now=Math.floor(Date.now()/1000);
 const body=`${part({alg:'HS256',typ:'JWT'})}.${part({iss:'supabase-local',role,aud:role==='anon'?'anon':'authenticated',iat:now,exp:now+86400})}`;
 return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
}

function cleanOutput(value){
 return String(value).replace(/https?:\/\/[^\s<>"']+/g,'[local-url-redacted]')
  .replace(/[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,'[jwt-redacted]')
  .replace(/[\w.+-]+@(?:example\.test|[\w.-]+\.invalid)/gi,'[synthetic-email]')
  .replace(/(?:token|code|secret|password)[=:][^\s&]+/gi,'[credential-redacted]');
}

function run(program,args,{env,limit=1_048_576,timeout=180_000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(program,args,{cwd:repo,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='',overflow=false;
  const collect=piece=>{if(output.length+piece.length>limit){overflow=true;return;}output+=piece.toString('utf8');};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error(`timeout:${path.basename(program)}`));},timeout);
  child.once('error',error=>{clearTimeout(timer);reject(Error(`spawn:${path.basename(program)}:${error.code??'unknown'}`));});
  child.once('close',code=>{clearTimeout(timer);if(overflow)return reject(Error(`output_limit:${path.basename(program)}`));resolve({code,output});});
 });
}
async function must(program,args,options){
 const result=await run(program,args,options);
 if(result.code!==0)throw Error(`command_failed:${path.basename(program)}:${result.code}`);
 return result.output;
}
const docker=(args,env)=>must('docker',args,{env,timeout:300_000});
const dc=(args,env)=>docker(['compose','-p',project,'-f',compose,'-f',overlay,...args],env);
async function inspect(name,env){
 const id=(await dc(['ps','-q',name],env)).trim();
 assert.match(id,/^[a-f0-9]{64}$/);
 const labels=JSON.parse(await docker(['inspect','--format','{{json .Config.Labels}}',id],env));
 const networks=JSON.parse(await docker(['inspect','--format','{{json .NetworkSettings.Networks}}',id],env));
 const network=JSON.parse(await docker(['network','inspect','--format','{{json .}}',`${project}_default`],env));
 return {id,labels,networks,network};
}
async function c01Bridge(service,localPort,remotePort,env){
 const {id,labels,networks,network}=await inspect(service,env);
 const target=validateBridgeTarget({project,service,containerId:id,labels,networks,network,remotePort});
 await waitForBridgeTarget(target);
 return openLoopbackBridge(target,localPort);
}
async function mailBridge(env){
 const {id,labels,networks,network}=await inspect('inbucket',env);
 const name=`${project}_default`;
 assert.equal(labels['com.docker.compose.project'],project);
 assert.equal(labels['com.docker.compose.service'],'inbucket');
 assert.deepEqual(Object.keys(networks),[name]);
 assert.equal(network.Name,name);
 assert.equal(network.Internal,true);
 assert.equal(network.Driver,'bridge');
 assert.equal(network.Containers[id]?.IPv4Address?.split('/')[0],networks[name].IPAddress);
 assert.equal(networks[name].NetworkID,network.Id);
 const address=networks[name].IPAddress;
 assert.equal(net.isIP(address),4);
 await waitForBridgeTarget({address,port:9000});
 const sockets=new Set();
 const server=net.createServer(inbound=>{
  const outbound=net.connect({host:address,port:9000});
  sockets.add(inbound);sockets.add(outbound);
  const end=()=>{inbound.destroy();outbound.destroy();sockets.delete(inbound);sockets.delete(outbound);};
  inbound.once('error',end);outbound.once('error',end);
  inbound.once('close',end);outbound.once('close',end);
  inbound.pipe(outbound);outbound.pipe(inbound);
 });
 server.maxConnections=8;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:55424,exclusive:true},resolve);});
 assert.equal(server.address().address,'127.0.0.1');
 return {async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
async function waitApi(anon){
 for(let i=0;i<30;i++){
  try{const response=await fetch(`${api}/auth/v1/settings`,{headers:{apikey:anon},signal:AbortSignal.timeout(2000)});if(response.ok)return;}catch{}
  await delay(2000);
 }
 throw Error('auth_api_unavailable');
}
async function main(){
 assert.equal(process.env.GITHUB_ACTIONS,'true');
 assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
 assert.equal(process.env.RUNNER_OS,'Linux');
 assert.equal(process.platform,'linux');
 const official=path.resolve(process.env.C01_OFFICIAL_DOCKER??'');
 assert.ok(process.env.RUNNER_TEMP&&official.startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep));
 assert.equal((await must('git',['-C',path.dirname(official),'rev-parse','HEAD'],{env:process.env})).trim(),upstreamCommit);
 const secret=b64(48),password=b64(32);
 const anon=token(secret,'anon'),service=token(secret,'service_role');
 const env={...process.env,C01_OFFICIAL_DOCKER:official,C01_DB_PASSWORD:password,C01_JWT_SECRET:secret,C01_ANON_KEY:anon,C01_SERVICE_KEY:service,C01_DASHBOARD_PASSWORD:b64(18),C01_APP_DATABASE:'postgres',C01_CRON_DATABASE:'postgres',C01_S3_BUCKET:'auth-proof-synthetic',C01_MINIO_USER:b64(18),C01_MINIO_PASSWORD:b64(36)};
 const existing=await dc(['ps','-q'],env);
 assert.equal(existing.trim(),'','auth proof requires a fresh Docker project');
 const volumes=(await docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${project}`],env)).trim();
 assert.equal(volumes,'','auth proof requires fresh volumes');
 let dbBridge,apiBridge,inboxBridge;
 try{
  await dc(['pull','db','auth','rest','storage','api-gw','minio','minio-createbucket','inbucket'],env);
  await dc(['up','-d','--wait'],env);
  const network=(await docker(['network','inspect',`${project}_default`,'--format','{{.Internal}}'],env)).trim();
  assert.equal(network,'true','Auth and SMTP must have no external route');
  dbBridge=await c01Bridge('db',55422,5432,env);
  apiBridge=await c01Bridge('api-gw',55421,8000,env);
  inboxBridge=await mailBridge(env);
  await waitApi(anon);
  const folder=path.join(repo,'supabase/migrations');
  const files=(await readdir(folder)).filter(name=>/^\d{14}_.+\.sql$/.test(name)).sort();
  assert.ok(files.length>=125,'incomplete migration set');
  for(const file of files)await must('psql',['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55422','-U','postgres','-d','postgres','-f',path.join(folder,file)],{env:{...env,PGPASSWORD:password},timeout:120_000});
  // PostgREST started before Folio's schema existed. Explicitly reload its
  // cache and wait until a newly migrated RPC is visible before opening UI.
  await must('psql',['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55422','-U','postgres','-d','postgres','-c',"NOTIFY pgrst, 'reload schema'"],{env:{...env,PGPASSWORD:password}});
  let schemaReady=false;
  for(let i=0;i<30;i++){
   try{
    const response=await fetch(`${api}/rest/v1/rpc/mfa_access_status`,{method:'POST',headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(2000)});
    if(response.ok){schemaReady=true;break;}
   }catch{}
   await delay(1000);
  }
  assert.equal(schemaReady,true,'postgrest_schema_cache_not_ready');
  // The fresh migration defaults to preparation-off. Assert the actual policy,
  // rather than changing it or claiming an MFA challenge was exercised.
  const mfaPolicy=(await must('psql',['-X','-t','-A','-h','127.0.0.1','-p','55422','-U','postgres','-d','postgres','-c',"SELECT application_ready::int, (staff_enforce_after IS NULL)::int FROM folio_mfa_private.policy WHERE singleton"],{env:{...env,PGPASSWORD:password}})).trim();
  assert.equal(mfaPolicy,'0|1','unexpected MFA policy: proof cannot bypass or silently omit the gate');
  const browserEnv={...env,E2E_BASE_URL:'http://127.0.0.1:4430',FOLIO_TEST_SUPABASE_URL:api,FOLIO_TEST_SUPABASE_ANON_KEY:anon,FOLIO_TEST_SUPABASE_SERVICE_KEY:service,FOLIO_TEST_DATABASE_URL:`postgresql://postgres:${password}@127.0.0.1:55422/postgres`};
  const result=await run('pnpm',['test:e2e','--','tests/e2e/auth-mail-onboarding.spec.ts'],{env:browserEnv,limit:2_000_000,timeout:900_000});
  // Report only synthetic stage markers and Playwright's aggregate counts;
  // never print a failed action's raw URL, email body, password, or token.
  const allowedStages=new Set([
   'independiente_signup_mail_captured','independiente_confirmed_and_bootstrapped',
   'independiente_db_saved','independiente_fresh_context_resumed',
   'clinica_signup_mail_captured','clinica_confirmed_and_bootstrapped',
   'clinica_db_saved','clinica_fresh_context_resumed',
   'recovery_mail_captured','password_updated','old_password_rejected_new_login_resumed',
  ]);
  const stages=[...result.output.matchAll(/auth_proof_stage:([a-z0-9_]+)/g)]
   .map(match=>match[1]).filter(stage=>allowedStages.has(stage));
  const counts=result.output.split(/\r?\n/).filter(line=>/^\s*\d+ (?:passed|failed|skipped)\b/.test(line));
  for(const stage of stages.slice(-30))console.log(`auth_proof_stage:${stage}`);
  for(const count of counts.slice(-3))console.log(cleanOutput(count));
  if(result.code!==0){
   // The browser's raw report can contain one-use mail links and credentials.
   // Only the last reached synthetic stage, test source line, and error class
   // leave this process; enough to target the next correction safely.
   const lines=[...result.output.matchAll(/auth-mail-onboarding\.spec\.ts:(\d+)(?::\d+)?/g)]
    .map(match=>Number(match[1])).filter(line=>line>0&&line<1000);
   const allowedErrors=new Set([
    'auth_proof_mail_missing','auth_proof_mailbox_unavailable','auth_proof_message_unavailable',
    'auth_proof_redirect_mismatch','auth_proof_mailbox_invalid','auth_proof_mailbox_shape',
    'auth_proof_requires_dedicated_local_auth','auth_proof_local_target_mismatch',
    'auth_proof_turnstile_must_use_existing_development_path','auth_proof_local_read_key_missing',
   ]);
   const detected=[...result.output.matchAll(/auth_proof_[a-z0-9_]+(?=\b)/gi)]
    .map(match=>match[0]).find(value=>allowedErrors.has(value))??'';
   const knownError=allowedErrors.has(detected)?detected:
    (result.output.includes('TimeoutError')?'timeout':
     result.output.includes('AssertionError')?'assertion':
     result.output.includes('locator')?'locator':'unknown');
   console.log(`auth_proof_diagnostic:last_stage=${stages.at(-1)??'none'} spec_lines=${[...new Set(lines)].slice(-3).join(',')||'unknown'} kind=${knownError}`);
   throw Error(`auth_proof_browser_failed:${result.code}`);
  }
  if(/\bskipped\b|\bskip\b/i.test(result.output))throw Error('auth_proof_skipped_test');
  if(!/\b1 passed\b/.test(result.output))throw Error('auth_proof_pass_count_missing');
  console.log(`auth_proof_pass: migrations=${files.length} modes=2 confirmation=2 reset=1 mailbox=local mfa=fresh_policy_unenforced`);
 }finally{
  if(inboxBridge)await inboxBridge.close();
  if(apiBridge)await apiBridge.close();
  if(dbBridge)await dbBridge.close();
  await dc(['down','-v'],env).catch(()=>{});
 }
}
main().catch(error=>{console.error(`auth_proof_failed:${cleanOutput(error?.message??'unknown')}`);process.exitCode=1;});
