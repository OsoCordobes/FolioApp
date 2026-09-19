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
const statusFunctions=await readFile(new URL('../../scripts/backup/owned-status.ps1',import.meta.url),'utf8');
const noticeFunctions=await readFile(new URL('../../scripts/backup/owned-notice.ps1',import.meta.url),'utf8');
// Never call the native UI in tests. Exercise the real decision and durable
// deduplication with only the final platform adapter replaced.
const syntheticNotice=noticeFunctions+'\nfunction Show-OwnedBackupBalloon { Write-Output "UNTRUSTED_NOTICE_OUTPUT" }\n';
const template=source.match(/\$job=@'\r?\n([\s\S]*?)\r?\n'@/)[1].replace('# SAFE_STATUS_FUNCTIONS',()=>statusFunctions).replace('# SAFE_NOTICE_FUNCTIONS',()=>syntheticNotice);
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

test('scheduler retains last verified age after damaged runtime and rejects hostile child metadata',{skip:process.platform!=='win32'},async()=>{
 const backup={id:'backup_20260101T000000000Z_00000000-0000-4000-8000-000000000000',completedAt:new Date(Date.now()-94*3600000).toISOString()};
 for(const hostile of [false,true]) {
  const f=await fixture(hostile?`@{status='checkpoint_incomplete';action='PRIVATE_PATIENT';category='credential=synthetic';lastBackup=@{id='PRIVATE_PATIENT';completedAt='not-a-date'}} | ConvertTo-Json -Compress\nexit 20\n`:"'{}'\nexit 0\n");
  await writeFile(f.status,JSON.stringify({status:'verified_checkpoint_recorded',lastBackup:backup,ageHours:0,catchUpDue:false,stale24h:false}));
  if(!hostile)await writeFile(f.launcher,"throw 'PRIVATE_PATIENT'\n");
  const result=f.invoke();assert.equal(result.status,12,result.stdout+result.stderr);
  const text=await readFile(f.status,'utf8'),report=JSON.parse(text);
  assert.equal(report.status,'scheduled_backup_failed');assert.equal(report.lastBackup.id,backup.id);assert.ok(report.ageHours>=94);
  assert.equal(report.stale24h,true);assert.equal(report.catchUpDue,true);assert.ok(!text.includes('PRIVATE_PATIENT'));assert.ok(!text.includes('credential='));
  assert.equal(report.notification.status,'notice_requested');assert.equal(report.notification.reason,'stale_backup');assert.equal(report.notification.userSeen,false);
  assert.ok(!`${result.stdout}${result.stderr}${text}`.includes('UNTRUSTED_NOTICE_OUTPUT'));
 }
});
