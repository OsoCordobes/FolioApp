import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {generateKeyPairSync} from 'node:crypto';
import ts from 'typescript';
import {createBackup} from '../../scripts/backup/core.mjs';
import {sealArtifact} from '../../scripts/backup/envelope.mjs';
import * as envelope from '../../scripts/backup/envelope.mjs';
import * as retention from '../../scripts/backup/retention.mjs';

test('database consumer rechecks manifest digest if a valid encrypted archive changes after package verification',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'folio-backup-consumption-'));
 const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 try{
  const backup=await createBackup({destination:root,publicKey:keys.publicKey,rotate:false,platformConfig:{auth:{},storage:{},database:{},application:{},custody:{}},source:{compareStorage(){},begin:async()=>({metadata:{objects:[],buckets:[],serverMajor:16,pgDumpMajor:16,roles:[],extensions:[]},database:async()=>[Buffer.from('original synthetic archive')],roles:async()=>[Buffer.from('synthetic roles')],verifyUnchanged:async()=>{},close:async()=>{}})},storage:{inventory:async()=>[]}});
  const directory=path.join(root,backup.id);let consumed=0;
  const pg={
   parseConnection:()=>({}),assertEmptyRestoreTarget:async()=>{},toolVersion:async()=>16,closePgClient:async()=>{},
   pgConnection:()=>({connect:async()=>{
    const replacement=path.join(root,'replacement.sealed');
    await sealArtifact([Buffer.from('changed synthetic archive')],replacement,keys.publicKey,{backupId:backup.id,artifact:'artifact_1.sealed'});
    await writeFile(path.join(directory,'artifact_1.sealed'),await readFile(replacement));
   },query:async(sql)=>({rows:sql.startsWith('show')?[{server_version_num:'160000'}]:sql.includes('pg_try_advisory_lock')?[{locked:true}]:[]})}),
   pgProcess:()=>{consumed++;return {child:{stdout:{resume(){}},stdin:{on(){},end(){}}},completion:Promise.resolve()};},
  };
  const actual=createRequire(import.meta.url),exports={};
  const code=ts.transpileModule(readFileSync(new URL('../../scripts/backup/restore.mjs',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  runInNewContext(code,{exports,Buffer,Set,Error,require:(name)=>name==='./postgres.mjs'?pg:name==='./envelope.mjs'?envelope:name==='./retention.mjs'?retention:actual(name)});
  await assert.rejects(exports.restoreDatabase({directory,privateKey:keys.privateKey,databaseUrl:'postgres://synthetic@127.0.0.1/folio_restore_synthetic',confirmDatabase:'folio_restore_synthetic'}),/backup_manifest_integrity_failed/);
  assert.equal(consumed,0);
 }finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('folio-backup-consumption-'));await rm(root,{recursive:true,force:true});}
});
