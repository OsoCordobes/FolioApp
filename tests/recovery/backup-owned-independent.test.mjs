import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {createBackup} from '../../scripts/backup/core.mjs';
import {fileDigest} from '../../scripts/backup/envelope.mjs';
import {ownedStatus,authenticateAndRetain} from '../../scripts/backup/owned-workflow.mjs';
const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'folio-owned-independent-'));
 t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('folio-owned-independent-'));await rm(root,{recursive:true,force:true});});
 const destination=path.join(root,'database-checkpoints');await mkdir(destination);return{root,destination};
}
async function capture(destination){return createBackup({destination,publicKey:keys.publicKey,rotate:false,platformConfig:Object.fromEntries(['auth','storage','database','application','custody'].map(key=>[key,{synthetic:true}])),source:{compareStorage(){},async begin(){return{metadata:{objects:[],buckets:[],synthetic:true},database:async()=>[Buffer.from('synthetic database')],roles:async()=>[Buffer.from('synthetic roles')],verifyUnchanged:async()=>{},close:async()=>{}}}},storage:{inventory:async()=>[],download:async()=>{throw Error('unexpected')}}});}
test('recorded AEAD verification cannot be reused after ciphertext and receipt checksum change',async t=>{
 const{root,destination}=await fixture(t),result=await capture(destination);
 await authenticateAndRetain({destination,result,privateKey:keys.privateKey});
 const artifact=path.join(destination,result.id,'artifact_1.sealed'),body=await readFile(artifact);body[body.length-1]^=1;await writeFile(artifact,body);
 const receiptPath=path.join(destination,result.id,'receipt.json'),receipt=JSON.parse(await readFile(receiptPath,'utf8'));receipt.files.find(f=>f.file==='artifact_1.sealed').sha256=await fileDigest(artifact);await writeFile(receiptPath,JSON.stringify(receipt));
 const status=await ownedStatus(root);assert.notEqual(status.status,'verified_checkpoint_recorded');assert.equal(status.catchUpDue,true);
});
test('mutable receipt dates cannot suppress catch-up after twenty hours',async t=>{
 const{root,destination}=await fixture(t),result=await capture(destination);
 await authenticateAndRetain({destination,result,privateKey:keys.privateKey});
 const receiptPath=path.join(destination,result.id,'receipt.json'),receipt=JSON.parse(await readFile(receiptPath,'utf8')),original=Date.parse(receipt.completedAt);
 receipt.completedAt=new Date(original+20*3600000).toISOString();await writeFile(receiptPath,JSON.stringify(receipt));
 const status=await ownedStatus(root,new Date(original+21*3600000));assert.equal(status.catchUpDue,true);assert.notEqual(status.status,'verified_checkpoint_recorded');
});
test('owned retention preserves an unverified package instead of treating it as an owned recovery point',async t=>{
 const{destination}=await fixture(t),unverified=await capture(destination),result=await capture(destination);
 await authenticateAndRetain({destination,result,privateKey:keys.privateKey});
 assert.equal((await stat(path.join(destination,unverified.id))).isDirectory(),true);
});
test('legacy verification notes are preserved without silently certifying current ciphertext',async t=>{
 const{root,destination}=await fixture(t),result=await capture(destination);
 const note=path.join(destination,`${result.id}-verification.json`);
 const legacy=JSON.stringify({...result,authenticated:true});await writeFile(note,legacy);
 const status=await ownedStatus(root);assert.equal(status.status,'no_verified_checkpoint');assert.equal(status.lastBackup,null);
 const next=await capture(destination);await authenticateAndRetain({destination,result:next,privateKey:keys.privateKey});
 assert.equal((await stat(path.join(destination,result.id))).isDirectory(),true);assert.equal(await readFile(note,'utf8'),legacy);
});
test('AEAD authentication cannot adopt modified receipt dates that disagree with the encrypted manifest',async t=>{
 const{destination}=await fixture(t),result=await capture(destination);
 const receiptPath=path.join(destination,result.id,'receipt.json'),receipt=JSON.parse(await readFile(receiptPath,'utf8'));
 receipt.completedAt=new Date(Date.parse(receipt.completedAt)+3600000).toISOString();await writeFile(receiptPath,JSON.stringify(receipt));
 let rotations=0;await assert.rejects(authenticateAndRetain({destination,result,privateKey:keys.privateKey,rotate:async()=>{rotations++;}}),/owned_metadata_invalid/);
 assert.equal(rotations,0);await assert.rejects(readFile(path.join(destination,`${result.id}-verification.json`)),{code:'ENOENT'});
});
test('launcher does not abandon a descendant when its immediate child exits',{skip:process.platform!=='win32'},async t=>{
 const{root}=await fixture(t),launcher=path.join(root,'owned-task.ps1');
 await writeFile(launcher,(await readFile(new URL('../../scripts/backup/owned-task.ps1',import.meta.url),'utf8')).replace('WaitForExit(900000)','WaitForExit(1000)'));
 await writeFile(path.join(root,'owned-task.mjs'),`import{spawn}from'node:child_process';import fs from'node:fs';import path from'node:path';const child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),4000)'],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(path.join(process.argv[3],'child.json'),JSON.stringify(child.pid));child.unref();console.log(JSON.stringify({status:'verified_checkpoint_recorded',lastBackup:null,ageHours:1,catchUpDue:false}));process.exit(0);`);
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 const command=`& ${quote(launcher)} -Mode Status -RecoveryRoot ${quote(root)}; $taskChildId=Get-Content -LiteralPath ${quote(path.join(root,'child.json'))} | ConvertFrom-Json; @{childAlive=[bool](Get-Process -Id $taskChildId -ErrorAction SilentlyContinue)} | ConvertTo-Json -Compress`;
 const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:10000});
 // The only synthetic descendant also exits itself after four seconds, even
 // on a RED run. Never terminate or enumerate any unrelated process.
 t.after(()=>new Promise(resolve=>setTimeout(resolve,4100)));
 assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.stderr,'');
 assert.equal(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)).childAlive,false);
});
