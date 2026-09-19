import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { stageOwnedRuntime, sealOwnedRuntime, verifyOwnedRuntime } from '../../scripts/backup/package-owned-runtime.mjs';
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'folio-runtime-test-'));await mkdir(path.join(root,'database-checkpoints'));const node=path.join(root,'synthetic-node.exe');await writeFile(node,'synthetic executable; never run');return {root,node,sourceRoot:path.resolve('.'),directory:path.join(root,'backup-runtime-test-1')};}
test('staging copies only reviewed executable sources and pins pg without secrets',async()=>{const f=await fixture();await stageOwnedRuntime({...f,expectedRoot:f.root,nodeExecutable:f.node});const pkg=JSON.parse(await readFile(path.join(f.directory,'package.json'),'utf8'));assert.equal(pkg.dependencies.pg,'8.21.0');const lock=await readFile(path.join(f.directory,'pnpm-lock.yaml'),'utf8');assert.ok(lock.includes('pg-pool@3.14.0(pg@8.21.0):'));assert.ok(lock.includes('split2@4.2.0:'));assert.ok(!lock.includes('next@'));assert.deepEqual((await readdir(f.directory)).sort(),['bin','package.json','pnpm-lock.yaml','scripts']);assert.equal(await readFile(path.join(f.directory,'bin/node.exe'),'utf8'),'synthetic executable; never run');await assert.rejects(()=>stageOwnedRuntime({...f,expectedRoot:f.root,nodeExecutable:f.node}));});
test('stage refuses outside root and an unapproved source checkpoint path',async()=>{const f=await fixture();await assert.rejects(()=>stageOwnedRuntime({...f,directory:path.join(f.root,'..','outside'),expectedRoot:f.root,nodeExecutable:f.node}));await assert.rejects(()=>stageOwnedRuntime({...f,expectedRoot:path.join(f.root,'different'),nodeExecutable:f.node}));});
test('seal and verification bind source, pinned pg, Node bytes and no unexpected executable',async()=>{const f=await fixture();await stageOwnedRuntime({...f,expectedRoot:f.root,nodeExecutable:f.node});await mkdir(path.join(f.directory,'node_modules/pg'),{recursive:true});await writeFile(path.join(f.directory,'node_modules/pg/package.json'),JSON.stringify({name:'pg',version:'8.21.0'}));const sealed=await sealOwnedRuntime(f.directory,{expectedRoot:f.root});await verifyOwnedRuntime(f.directory,sealed.manifestSha256);const launcher=await readFile(path.join(f.directory,'invoke-owned-backup.ps1'),'utf8');assert.ok(launcher.includes(sealed.manifestSha256));assert.ok(launcher.includes('bin\\node.exe'));await writeFile(path.join(f.directory,'scripts/backup/owned-task.mjs'),'tampered');await assert.rejects(()=>verifyOwnedRuntime(f.directory,sealed.manifestSha256));});
test('seal refuses a different pg version and verifier refuses changed manifest or additional file',async()=>{const f=await fixture();await stageOwnedRuntime({...f,expectedRoot:f.root,nodeExecutable:f.node});await mkdir(path.join(f.directory,'node_modules/pg'),{recursive:true});const pkg=path.join(f.directory,'node_modules/pg/package.json');await writeFile(pkg,JSON.stringify({version:'8.20.0'}));await assert.rejects(()=>sealOwnedRuntime(f.directory,{expectedRoot:f.root}));await writeFile(pkg,JSON.stringify({version:'8.21.0'}));const sealed=await sealOwnedRuntime(f.directory,{expectedRoot:f.root});await writeFile(path.join(f.directory,'extra.mjs'),'tampered');await assert.rejects(()=>verifyOwnedRuntime(f.directory,sealed.manifestSha256));await assert.rejects(()=>verifyOwnedRuntime(f.directory,'0'.repeat(64)));});




test('generated Windows launcher checks pinned files before dispatch, and uses its private Node path',{skip:process.platform!=='win32'},async()=>{
 const {spawnSync}=await import('node:child_process');const f=await fixture();await stageOwnedRuntime({...f,expectedRoot:f.root,nodeExecutable:f.node});
 await mkdir(path.join(f.directory,'node_modules/pg'),{recursive:true});await writeFile(path.join(f.directory,'node_modules/pg/package.json'),JSON.stringify({name:'pg',version:'8.21.0'}));
 const task=path.join(f.directory,'scripts/backup/owned-task.ps1');
 await writeFile(task,"param([string]$Mode,[string]$RecoveryRoot)\n@{mode=$Mode;node=(Get-Command node.exe).Source} | ConvertTo-Json -Compress\nexit 0\n");
 await sealOwnedRuntime(f.directory,{expectedRoot:f.root});const launcher=path.join(f.directory,'invoke-owned-backup.ps1');
 const invoke=()=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',launcher,'-Mode','Status'],{encoding:'utf8',timeout:15000,windowsHide:true});
 const good=invoke();assert.equal(good.status,0,good.stdout+good.stderr);assert.equal(JSON.parse(good.stdout.trim()).node,path.join(f.directory,'bin/node.exe'));
 await writeFile(task,'throw "UNVERIFIED_EXECUTABLE_RAN"');const bad=invoke();assert.equal(bad.status,12);assert.equal(JSON.parse(bad.stdout.trim()).status,'runtime_integrity_failed');assert.ok(!bad.stderr.includes('UNVERIFIED_EXECUTABLE_RAN'));
});

