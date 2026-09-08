import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

// Execute the actual scheduled command template, substituting only synthetic
// paths. Never registers a task, opens DPAPI, reads owner data or contacts a host.
const source=await readFile(new URL('../../scripts/backup/install-windows-task.ps1',import.meta.url),'utf8');
const template=source.match(/\$job=@'\r?\n([\s\S]*?)\r?\n'@/)[1];
const quote=value=>`'${value.replaceAll("'","''")}'`;
async function fixture(content){
 const root=await mkdtemp(path.join(os.tmpdir(),"folio-task-test-"));
 const launcher=path.join(root,"synthetic ' launcher.ps1"),status=path.join(root,'status.json');
 await writeFile(launcher,content);
 const hash=createHash('sha256').update(content).digest('hex');
 const host=path.join(process.env.SystemRoot??process.env.SYSTEMROOT,'System32/WindowsPowerShell/v1.0/powershell.exe');
 let job=template;
 for(const [key,value] of Object.entries({LAUNCHER:launcher,HASH:hash,STATUS:status,HOSTEXE:host,OWNERROOT:root}))job=job.replaceAll(key,quote(value));
 const invoke=()=>spawnSync(host,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(job,'utf16le').toString('base64')],{encoding:'utf8',timeout:20000,windowsHide:true});
 return {root,launcher,status,invoke};
}
test('scheduled command records not_due and forwards a nonzero capture exit code',{skip:process.platform!=='win32'},async()=>{
 for(const exit of [0,20]){
  const f=await fixture(`@{status='${exit?'checkpoint_incomplete':'verified_checkpoint_recorded'}';action='not_due';ageHours=3;catchUpDue=$false} | ConvertTo-Json -Compress\nexit ${exit}\n`);
  const result=f.invoke();assert.equal(result.status,exit,result.stdout+result.stderr);
  const report=JSON.parse(await readFile(f.status,'utf8'));assert.equal(report.exitCode,exit);assert.equal(report.action,'not_due');assert.equal(report.ownerCustodyPending,true);assert.equal(report.restorationProven,false);assert.ok(Number.isFinite(Date.parse(report.checkedAt)));
 }
});
test('modified launcher cannot execute and replaces a stale success with a categorical failure',{skip:process.platform!=='win32'},async()=>{
 const f=await fixture("'{}'\nexit 0\n");await writeFile(f.status,JSON.stringify({status:'old_success'}));
 await writeFile(f.launcher,"throw 'UNREVIEWED_LAUNCHER_EXECUTED'\n");
 const result=f.invoke();assert.equal(result.status,12);assert.ok(!`${result.stdout}${result.stderr}`.includes('UNREVIEWED_LAUNCHER_EXECUTED'));
 const report=JSON.parse(await readFile(f.status,'utf8'));assert.equal(report.status,'scheduled_backup_failed');assert.equal(report.exitCode,12);
});
test('malformed output cannot leave an old success or write arbitrary output to the status file',{skip:process.platform!=='win32'},async()=>{
 const f=await fixture("'SYNTHETIC_UNTRUSTED_OUTPUT'\nexit 0\n");await writeFile(f.status,JSON.stringify({status:'old_success'}));
 const result=f.invoke();assert.equal(result.status,12);
 const text=await readFile(f.status,'utf8');assert.equal(JSON.parse(text).status,'scheduled_backup_failed');assert.ok(!text.includes('SYNTHETIC_UNTRUSTED_OUTPUT'));
});
