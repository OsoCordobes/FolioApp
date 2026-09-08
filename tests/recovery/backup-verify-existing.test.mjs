import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createBackup } from '../../scripts/backup/core.mjs';
import { acquireBackupLock } from '../../scripts/backup/lock.mjs';
import { fileDigest } from '../../scripts/backup/envelope.mjs';
import { verifyBackup } from '../../scripts/backup/restore.mjs';
import * as owned from '../../scripts/backup/owned-workflow.mjs';

const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'folio-verify-existing-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const destination=path.join(root,'database-checkpoints');await mkdir(destination);
 const platformConfig=Object.fromEntries(['auth','storage','database','application','custody'].map(k=>[k,{synthetic:true}]));
 const result=await createBackup({destination,publicKey:keys.publicKey,platformConfig,rotate:false,source:{compareStorage(){},async begin(){return {metadata:{objects:[],buckets:[]},database:async()=>[Buffer.from('synthetic clinical bytes')],roles:async()=>[Buffer.from('synthetic roles')],verifyUnchanged:async()=>{},close:async()=>{}};}},storage:{inventory:async()=>[]}});
 const summary=path.join(destination,`${result.id}-verification.json`);await writeFile(summary,JSON.stringify({...result,authenticated:true,checkedAt:'2020-01-01T00:00:00Z'}));
 const directory=path.join(destination,result.id),receipt=JSON.parse(await readFile(path.join(directory,'receipt.json'),'utf8'));
 const args={root,checkpointId:result.id,privateKey:keys.privateKey,expectedRoot:root};
 return {root,destination,directory,summary,result,receipt,args};
}
test('VerifyExisting fully authenticates a legacy package, changes only its external verification note and preserves capture time',async t=>{
 const f=await fixture(t),beforeFiles=await readdir(f.directory),before=new Map(await Promise.all(beforeFiles.map(async name=>[name,await fileDigest(path.join(f.directory,name))])));
 const index=await readFile(path.join(f.destination,'last-success.json'),'utf8');
 assert.equal((await owned.ownedStatus(f.root)).lastBackup,null);
 const value=await owned.verifyExistingOwned(f.args);
 assert.equal(value.action,'verified_existing');assert.equal(value.verifiedBackup.id,f.result.id);assert.equal(value.verifiedBackup.completedAt,f.receipt.completedAt);
 assert.equal(value.ownerCustodyPending,true);assert.equal(value.restorationProven,false);assert.equal(value.platformConfigurationComplete,false);
 const summary=JSON.parse(await readFile(f.summary,'utf8'));assert.equal(summary.verificationVersion,2);assert.equal(summary.completedAt,f.receipt.completedAt);assert.equal(summary.verificationOnly,true);assert.equal(summary.retentionApplied,false);
 assert.equal(await readFile(path.join(f.destination,'last-success.json'),'utf8'),index);
 assert.deepEqual(await readdir(f.directory),beforeFiles);for(const [name,digest]of before)assert.equal(await fileDigest(path.join(f.directory,name)),digest);
 assert.equal((await owned.ownedStatus(f.root,new Date(Date.parse(f.receipt.completedAt)+20*3600000))).catchUpDue,true);
 assert.equal((await owned.verifyExistingOwned(f.args)).verifiedBackup.completedAt,f.receipt.completedAt);
});
test('tampered last artifact plus recomputed public checksum never promotes the legacy summary',async t=>{
 const f=await fixture(t),previous=await readFile(f.summary,'utf8');
 const file=path.join(f.directory,'artifact_2.sealed'),bytes=await readFile(file);bytes[bytes.length-1]^=1;await writeFile(file,bytes);
 f.receipt.files.find(x=>x.file==='artifact_2.sealed').sha256=await fileDigest(file);await writeFile(path.join(f.directory,'receipt.json'),JSON.stringify(f.receipt));
 await assert.rejects(owned.verifyExistingOwned(f.args));assert.equal(await readFile(f.summary,'utf8'),previous);assert.equal((await owned.ownedStatus(f.root)).lastBackup,null);
});
test('strict checkpoint path and owner allowlist reject traversal, another package root and incomplete directories',async t=>{
 const f=await fixture(t);
 for(const checkpointId of ['../other',f.directory,'.incomplete_'+f.result.id,'backup_fake',f.result.id+'/../other'])await assert.rejects(owned.verifyExistingOwned({...f.args,checkpointId}),/owned_path_invalid/);
 await assert.rejects(owned.verifyExistingOwned({...f.args,expectedRoot:undefined}),/owned_path_invalid/);
});
test('VerifyExisting shares both owner and destination leases with capture and never evicts their holder',async t=>{
 const f=await fixture(t);
 for(const directory of [f.root,f.destination]){
  const lease=await acquireBackupLock(directory);
  try{await assert.rejects(owned.verifyExistingOwned(f.args),/already_running/);}finally{await lease.release();}
 }
 await owned.verifyExistingOwned(f.args);
});
test('receipt date mismatch or mutation during verification fails before replacing any evidence',async t=>{
 const f=await fixture(t),previous=await readFile(f.summary,'utf8'),file=path.join(f.directory,'receipt.json'),original=await readFile(file,'utf8');
 f.receipt.completedAt=new Date(Date.parse(f.receipt.completedAt)+1000).toISOString();await writeFile(file,JSON.stringify(f.receipt));
 await assert.rejects(owned.verifyExistingOwned(f.args),/owned_metadata_invalid/);assert.equal(await readFile(f.summary,'utf8'),previous);
 await writeFile(file,original);
 await assert.rejects(owned.verifyExistingOwned({...f.args,verify:async(...args)=>{const manifest=await verifyBackup(...args);await writeFile(file,original+' ');return manifest;}}),/owned_metadata_invalid/);
 assert.equal(await readFile(f.summary,'utf8'),previous);
});
test('Windows VerifyExisting sends only the exact checkpoint and in-memory DPAPI phrase to the verification child', {skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),launcher=path.join(f.root,'owned-task.ps1');
 await copyFile(new URL('../../scripts/backup/owned-task.ps1',import.meta.url),launcher);
 await writeFile(path.join(f.root,'owned-task.mjs'),`import fs from'node:fs';import path from'node:path';const mode=process.argv[2];if(mode==='CatchUp')throw Error('capture forbidden');if(mode==='VerifyExisting'){if(process.argv[4]!==${JSON.stringify(f.result.id)}||process.env.FOLIO_RECOVERY_PASSPHRASE!=='synthetic-verify-only')throw Error('wrong verification arguments');fs.writeFileSync(path.join(process.argv[3],'verified-local-only'),'yes');}else if(process.env.FOLIO_RECOVERY_PASSPHRASE)throw Error('secret in preflight');console.log(JSON.stringify({status:'verified_checkpoint_recorded',lastBackup:{id:${JSON.stringify(f.result.id)},completedAt:${JSON.stringify(f.receipt.completedAt)}},ageHours:21,catchUpDue:true,action:'verified_existing'}));`);
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',`Add-Type -AssemblyName System.Security;[IO.File]::WriteAllBytes(${quote(path.join(f.root,'passphrase.dpapi'))},[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('synthetic-verify-only'),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)); & ${quote(launcher)} -Mode VerifyExisting -RecoveryRoot ${quote(f.root)} -CheckpointId ${quote(f.result.id)};if($env:FOLIO_RECOVERY_PASSPHRASE){throw 'secret retained'};exit $LASTEXITCODE`],{encoding:'utf8',timeout:30000});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.ok(result.stdout.includes('verified_existing'));assert.ok(!result.stdout.includes('synthetic-verify-only'));assert.equal(result.stderr,'');assert.equal(await readFile(path.join(f.root,'verified-local-only'),'utf8'),'yes');
 const invalid=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',launcher,'-Mode','VerifyExisting','-RecoveryRoot',f.root,'-CheckpointId','../outside'],{encoding:'utf8',timeout:10000});assert.equal(invalid.status,12);assert.ok(invalid.stdout.includes('configuration_invalid'));
});
