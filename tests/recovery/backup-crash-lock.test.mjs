import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createBackup } from '../../scripts/backup/core.mjs';
import { acquireBackupLock } from '../../scripts/backup/lock.mjs';

const platformConfig = { auth:{fixture:true}, storage:{fixture:true}, database:{fixture:true}, application:{fixture:true}, custody:{fixture:true} };
test('a killed capture releases exclusivity and catch-up publishes a separate valid snapshot', {timeout:15000}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'folio-backup-crash-'));
  const {publicKey} = generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'}});
  const helper = path.join(directory,'capture-child.mjs');
  await writeFile(helper, `import {createBackup} from ${JSON.stringify(new URL('../../scripts/backup/core.mjs',import.meta.url).href)};
    const config=JSON.parse(process.argv[2]);
    await createBackup({...config,source:{begin:async()=>{process.stdout.write('CAPTURE_STARTED');await new Promise(()=>setInterval(()=>{},1000));}},storage:{}});`);
  let child;
  try {
    child = spawn(process.execPath,[helper,JSON.stringify({destination:directory,publicKey,platformConfig})],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    let childErrors=''; child.stderr.on('data',data=>childErrors+=data);
    const ready=await Promise.race([once(child.stdout,'data').then(([data])=>String(data)),once(child,'exit').then(()=>`EXIT:${childErrors}`)]);
    assert.equal(ready,'CAPTURE_STARTED');
    await assert.rejects(acquireBackupLock(directory),/backup_capture_already_running_or_lock_unavailable/);
    child.kill('SIGKILL'); await once(child,'exit');
    const result = await createBackup({destination:directory,publicKey,platformConfig,
      source:{begin:async()=>({metadata:{objects:[],buckets:[]},database:async()=>[Buffer.from('synthetic-db')],roles:async()=>[Buffer.from('synthetic-roles')],verifyUnchanged:async()=>{},close:async()=>{}}),compareStorage:()=>{}},
      storage:{inventory:async()=>[]}, rotate:false,
    });
    assert.equal(result.complete,true);
    assert.equal(result.storageObjects,0);
  } finally {
    if(child && child.exitCode===null && child.signalCode===null) { child.kill('SIGKILL'); await once(child,'exit'); }
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('folio-backup-crash-'));
    await rm(resolved,{recursive:true,force:true});
  }
});

test('an old live legacy capture is never evicted based on age', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'folio-backup-legacy-lock-'));
  const legacy = path.join(directory,'.backup.lock');
  try {
    await mkdir(legacy);
    const value=JSON.stringify({pid:process.pid,startedAt:'2000-01-01T00:00:00.000Z'});
    await writeFile(path.join(legacy,'owner.json'),value);
    await assert.rejects(acquireBackupLock(directory),/backup_legacy_capture_running/);
    assert.equal(await readFile(path.join(legacy,'owner.json'),'utf8'),value);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('folio-backup-legacy-lock-'));
    await rm(directory,{recursive:true,force:true});
  }
});
