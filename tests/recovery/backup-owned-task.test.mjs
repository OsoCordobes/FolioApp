import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, copyFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createBackup } from '../../scripts/backup/core.mjs';
import { fileDigest,openArtifact,sealArtifact } from '../../scripts/backup/envelope.mjs';
import { validateReceipt } from '../../scripts/backup/retention.mjs';
import { ownedStatus, runOwnedWorkflow, authenticateAndRetain, validateOwnedRoot, ownedFailure } from '../../scripts/backup/owned-workflow.mjs';

const keys = generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const platformConfig = Object.fromEntries(['auth','storage','database','application','custody'].map(key=>[key,{synthetic:true}]));
async function fixture(t) {
 const root = await mkdtemp(path.join(os.tmpdir(),'folio-owned-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const destination=path.join(root,'database-checkpoints');await mkdir(destination);
 return {root,destination};
}
async function capture(destination) {
 return createBackup({destination,publicKey:keys.publicKey,platformConfig,rotate:false,
  source:{compareStorage(){},async begin(){return {metadata:{objects:[],buckets:[],synthetic:true},database:async()=>[Buffer.from('synthetic private database')],roles:async()=>[Buffer.from('synthetic roles')],verifyUnchanged:async()=>{},close:async()=>{}};}},
  storage:{inventory:async()=>[],download:async()=>{throw Error('unexpected download');}}});
}
async function verified(destination) {const result=await capture(destination);await authenticateAndRetain({destination,result,privateKey:keys.privateKey});return result;}

test('Status is read-only, uses a recorded authenticated copy, and has an exact 20h boundary',async t=>{
 const {root,destination}=await fixture(t),result=await verified(destination);
 const receipt=await validateReceipt(path.join(destination,result.id));
 const files=await readdir(destination);
 for(const [hours,due] of [[19.999,false],[20,true],[23.99,true]]) {
  const status=await ownedStatus(root,new Date(Date.parse(receipt.completedAt)+hours*3600000));
  assert.equal(status.catchUpDue,due);assert.equal(status.lastBackup.id,result.id);
  assert.equal(status.ownerCustodyPending,true);assert.equal(status.restorationProven,false);assert.equal(status.platformConfigurationComplete,false);
 }
 assert.deepEqual(await readdir(destination),files);
 assert.equal((await ownedStatus(root,new Date(Date.parse(receipt.completedAt)-1))).status,'clock_invalid');
});

test('unverified publication never suppresses catch-up; existing verified backup survives failed verification',async t=>{
 const {root,destination}=await fixture(t),old=await verified(destination),next=await capture(destination);
 const receipt=await validateReceipt(path.join(destination,old.id));
 const status=await ownedStatus(root,new Date(Date.parse(receipt.completedAt)+21*3600000));
 assert.equal(status.lastBackup.id,old.id);assert.equal(status.catchUpDue,true);assert.equal(status.status,'verification_attention');
 const encrypted=path.join(destination,next.id,'artifact_2.sealed');const bytes=await readFile(encrypted);bytes[bytes.length-1]^=1;await writeFile(encrypted,bytes);
 const receiptPath=path.join(destination,next.id,'receipt.json'),nextReceipt=JSON.parse(await readFile(receiptPath,'utf8'));
 nextReceipt.files.find(x=>x.file==='artifact_2.sealed').sha256=await fileDigest(encrypted);await writeFile(receiptPath,JSON.stringify(nextReceipt));
 let rotations=0;
 await assert.rejects(authenticateAndRetain({destination,result:next,privateKey:keys.privateKey,rotate:async()=>{rotations++;}}));
 assert.equal(rotations,0);assert.equal((await ownedStatus(root)).lastBackup.id,old.id);
 await assert.rejects(readFile(path.join(destination,`${next.id}-verification.json`)),{code:'ENOENT'});
});

test('retention sees a fully authenticated new package first, and keeps seven days plus four weeks',async t=>{
 const {root,destination}=await fixture(t);
 // Real encrypted synthetic archives: historical dates belong to the encrypted
 // manifest too, and each old package gets its own linked AEAD verification.
 for(let day=40;day>=1;day-=3) {
  const result=await capture(destination),file=path.join(destination,result.id,'receipt.json');
  const receipt=JSON.parse(await readFile(file,'utf8')),time=new Date(Date.now()-day*86400000).toISOString();
  const manifestPath=path.join(destination,result.id,'manifest.sealed');
  const manifest=JSON.parse((await openArtifact(manifestPath,keys.privateKey,{backupId:result.id,artifact:'manifest.sealed'})).toString('utf8'));
  manifest.startedAt=time;manifest.completedAt=time;
  const temporary=path.join(destination,result.id,'synthetic-manifest.tmp');
  await sealArtifact([Buffer.from(JSON.stringify(manifest))],temporary,keys.publicKey,{backupId:result.id,artifact:'manifest.sealed'});
  await rename(temporary,manifestPath);
  receipt.files.find(f=>f.file==='manifest.sealed').sha256=await fileDigest(manifestPath);
  receipt.startedAt=time;receipt.completedAt=time;await writeFile(file,JSON.stringify(receipt));
  await authenticateAndRetain({destination,result,privateKey:keys.privateKey,rotate:async()=>({kept:1,removed:0})});
 }
 const result=await capture(destination);
 await authenticateAndRetain({destination,result,privateKey:keys.privateKey});
 const survivors=(await readdir(destination)).filter(x=>/^backup_/.test(x)&&!x.endsWith('.json'));
 assert.ok(survivors.length>=7&&survivors.length<=11);assert.ok(survivors.includes(result.id));
 assert.equal((await ownedStatus(root)).lastBackup.id,result.id);
});

test('CatchUp does not call any provider before 20h, serializes decisions, and rechecks age inside OS lease',async t=>{
 const {root,destination}=await fixture(t);let calls=0;
 await verified(destination);
 assert.equal((await runOwnedWorkflow({root,catchUp:true,capture:async()=>{calls++;}})).action,'not_due');assert.equal(calls,0);
 let unblock,entered;const started=new Promise(r=>{entered=r}),hold=new Promise(r=>{unblock=r});
 const first=runOwnedWorkflow({root,catchUp:true,status:async()=>({catchUpDue:true}),capture:async()=>{calls++;entered();await hold;}});
 await started;
 await assert.rejects(runOwnedWorkflow({root,catchUp:true,capture:async()=>{calls++;}}),/already_running/);
 unblock();await first;assert.equal(calls,1);
 const actual=await runOwnedWorkflow({root,catchUp:true,capture:async()=>{calls++;}});assert.equal(actual.action,'not_due');assert.equal(calls,1);
 await assert.rejects(runOwnedWorkflow({root,catchUp:true,status:async()=>({status:'clock_invalid',catchUpDue:false}),capture:async()=>{calls++;}}),/clock_invalid/);
});

test('owner root validation rejects repository, relative and unrelated directories; failure output excludes arbitrary provider text',async t=>{
 const {root}=await fixture(t);
 assert.equal(await validateOwnedRoot(root,root),root);
 await assert.rejects(validateOwnedRoot(root),/owned_path_invalid/);
 await assert.rejects(validateOwnedRoot('relative'),/owned_path_invalid/);
 const repo=path.resolve('.');await assert.rejects(validateOwnedRoot(repo,repo),/in_repository/);
 assert.deepEqual(ownedFailure(Error('provider password and PHI')), {status:'checkpoint_incomplete',exitCode:20});
});

test('retention failure keeps the new verified copy and exposes an explicit pending state',async t=>{
 const {root,destination}=await fixture(t),result=await capture(destination);
 await assert.rejects(authenticateAndRetain({destination,result,privateKey:keys.privateKey,rotate:async()=>{throw Error('synthetic failure');}}),/owned_retention_failed/);
 const status=await ownedStatus(root);assert.equal(status.lastBackup.id,result.id);assert.equal(status.status,'verification_attention');
 assert.equal(ownedFailure(Error('owned_retention_failed')).exitCode,22);
});

test('Windows launcher: synthetic child receives DPAPI only for due capture; output and parent environment stay secret-free', {skip:process.platform!=='win32'},async t=>{
 const {root}=await fixture(t),launcher=path.join(root,'owned-task.ps1');
 await copyFile(new URL('../../scripts/backup/owned-task.ps1',import.meta.url),launcher);
 // Only the child adapter is replaced. The real launcher, DPAPI and process handling run.
 await writeFile(path.join(root,'owned-task.mjs'),`import fs from 'node:fs';import path from 'node:path';const mode=process.argv[2],root=process.argv[3];const due=fs.existsSync(path.join(root,'due'));if(mode==='Status'&&process.env.FOLIO_RECOVERY_PASSPHRASE)throw Error('preflight secret leak');if(mode==='CatchUp'){if(process.env.FOLIO_RECOVERY_PASSPHRASE!=='synthetic-owner-phrase-only')throw Error('missing phrase');fs.writeFileSync(path.join(root,'captured'),'synthetic');}console.log(JSON.stringify({status:'verified_checkpoint_recorded',lastBackup:null,ageHours:21,catchUpDue:due,action:'captured'}));`);
 const invoke=(text)=>spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',text],{encoding:'utf8',timeout:30000,env:{...process.env,NODE_OPTIONS:'',NODE_PATH:''}});
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 for(const due of [false,true]) {
  if(due) {
   await writeFile(path.join(root,'due'),'yes');
   const setup=invoke(`Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes('synthetic-owner-phrase-only'); [IO.File]::WriteAllBytes(${quote(path.join(root,'passphrase.dpapi'))},[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`);assert.equal(setup.status,0,setup.stderr);
  }
  const result=invoke(`$env:FOLIO_RECOVERY_PASSPHRASE='inherited-secret'; & ${quote(launcher)} -Mode CatchUp -RecoveryRoot ${quote(root)}; if($env:FOLIO_RECOVERY_PASSPHRASE){throw 'environment not cleared'}`);
  assert.equal(result.status,0,result.stdout+result.stderr);assert.ok(!result.stdout.includes('synthetic-owner-phrase-only'));assert.ok(!result.stdout.includes('inherited-secret'));assert.equal(result.stderr,'');
  if(!due)await assert.rejects(readFile(path.join(root,'captured')),{code:'ENOENT'});
 }
 assert.equal(await readFile(path.join(root,'captured'),'utf8'),'synthetic');
 await writeFile(path.join(root,'owned-task.mjs'),`console.error('synthetic-owner-phrase-only PROVIDER_SECRET');process.exit(20);`);
 const failed=invoke(`$env:FOLIO_RECOVERY_PASSPHRASE='inherited-secret'; & ${quote(launcher)} -Mode Status -RecoveryRoot ${quote(root)}; if($env:FOLIO_RECOVERY_PASSPHRASE){throw 'environment not cleared'}; exit $LASTEXITCODE`);
 assert.equal(failed.status,20);assert.ok(failed.stdout.includes('checkpoint_incomplete'));assert.ok(!failed.stdout.includes('PROVIDER_SECRET'));assert.equal(failed.stderr,'');
 const invalid=invoke(`& ${quote(launcher)} -Mode Status -RecoveryRoot 'C:relative'; exit $LASTEXITCODE`);assert.equal(invalid.status,12);
});

test('Windows launcher timeout kills its own child tree and returns only a static category', {skip:process.platform!=='win32'},async t=>{
 const {root}=await fixture(t),launcher=path.join(root,'owned-task.ps1');
 // Same process/cleanup code, shortening only the deadline for this synthetic test.
 await writeFile(launcher,(await readFile(new URL('../../scripts/backup/owned-task.ps1',import.meta.url),'utf8')).replace('WaitForExit(900000)','WaitForExit(1000)'));
 await writeFile(path.join(root,'owned-task.mjs'),`import{spawn}from'node:child_process';import fs from'node:fs';import path from'node:path';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(path.join(process.argv[3],'children.json'),JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
 const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',launcher,'-Mode','Status','-RecoveryRoot',root],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,21,result.stdout+result.stderr);assert.ok(result.stdout.includes('timeout'));assert.equal(result.stderr,'');
 for(const pid of JSON.parse(await readFile(path.join(root,'children.json'),'utf8')))assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
