import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const quote=value=>`'${value.replaceAll("'","''")}'`;

test('Windows backup notice uses verified age, deduplicates requests and never forwards private errors',{skip:process.platform!=='win32'},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'folio-notice-test-'));
 const helpers=await Promise.all(['owned-status.ps1','owned-notice.ps1'].map(file=>readFile(new URL(`../../scripts/backup/${file}`,import.meta.url),'utf8')));
 const command=helpers.join('\n')+`
$ErrorActionPreference='Stop'
$script:calls=0
$adapter={ $script:calls++; Write-Output 'HOSTILE_ADAPTER_OUTPUT' }
function global:Add-Type { throw 'REAL_NOTIFICATION_MUST_NEVER_RUN' }
$state=@{status='checkpoint_incomplete';action='failed';lastBackup=@{id='backup_20260101T000000000Z_00000000-0000-4000-8000-000000000000';completedAt=[DateTime]::UtcNow.AddHours(-25).ToString('o')};ageHours=0;stale24h=$false;message='PRIVATE_PATIENT';category='password=PRIVATE_PATIENT'}
$one=Invoke-OwnedBackupNotice -OwnerRoot ${quote(root)} -Value $state -Notify $adapter
$two=Invoke-OwnedBackupNotice -OwnerRoot ${quote(root)} -Value $state -Notify $adapter
$record=Join-Path ${quote(root)} 'scheduled-backup-notification.json'
$past=@{requestedAt=[DateTime]::UtcNow.AddHours(-25).ToString('o')}|ConvertTo-Json
[IO.File]::WriteAllText($record,$past)
$three=Invoke-OwnedBackupNotice -OwnerRoot ${quote(root)} -Value $state -Notify $adapter
$state.lastBackup.completedAt=[DateTime]::UtcNow.AddHours(-1).ToString('o')
$state.stale24h=$true
$fresh=Invoke-OwnedBackupNotice -OwnerRoot ${quote(root)} -Value $state -Notify $adapter
$state.lastBackup.completedAt=[DateTime]::UtcNow.AddHours(2).ToString('o')
$future=Invoke-OwnedBackupNotice -OwnerRoot ${quote(root)} -Value $state -Notify $adapter
$state.lastBackup.completedAt=[DateTime]::UtcNow.AddHours(-1).ToString('o')
$state.status='clock_invalid'
$clock=Invoke-OwnedBackupNotice -OwnerRoot ${quote(root)} -Value $state -Notify $adapter
$state.status='checkpoint_incomplete'
$state.lastBackup=$null
[IO.File]::WriteAllText($record,$past)
$missing=Invoke-OwnedBackupNotice -OwnerRoot ${quote(root)} -Value $state -Notify $adapter
[IO.File]::WriteAllText($record,$past)
$failed=Invoke-OwnedBackupNotice -OwnerRoot ${quote(root)} -Value $state -Notify {throw 'PRIVATE_PATIENT credential=secret'}
$bad=Invoke-OwnedBackupNotice -OwnerRoot ${quote(root)} -Value @{status='checkpoint_incomplete';lastBackup=@{id='PRIVATE_PATIENT';completedAt='bad'}} -Notify $adapter
[IO.File]::WriteAllText($record,'{"requestedAt":"PRIVATE_PATIENT"}')
$corrupt=Invoke-OwnedBackupNotice -OwnerRoot ${quote(root)} -Value $state -Notify $adapter
$held=[IO.File]::Open($record,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try { $locked=Invoke-OwnedBackupNotice -OwnerRoot ${quote(root)} -Value $state -Notify $adapter } finally { $held.Dispose() }
@{one=$one;two=$two;three=$three;fresh=$fresh;future=$future;clock=$clock;missing=$missing;failed=$failed;bad=$bad;corrupt=$corrupt;locked=$locked;calls=$script:calls} | ConvertTo-Json -Depth 6 -Compress
`;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 const text=result.stdout+result.stderr,report=JSON.parse(result.stdout.trim());
 assert.ok(!/PRIVATE_PATIENT|credential=|HOSTILE_ADAPTER_OUTPUT|REAL_NOTIFICATION/.test(text));
 assert.equal(report.one.status,'notice_requested');assert.equal(report.one.reason,'stale_backup');
 assert.equal(report.two.status,'deduplicated');assert.equal(report.three.status,'notice_requested');
 assert.equal(report.fresh.status,'not_needed');assert.equal(report.missing.reason,'no_verified_backup');
 for(const item of [report.future,report.clock]){assert.equal(item.status,'notice_unavailable');assert.equal(item.reason,'clock_invalid');}
 assert.equal(report.failed.status,'notice_unavailable');assert.equal(report.bad.status,'notice_unavailable');
 assert.equal(report.corrupt.status,'notice_requested');assert.equal(report.locked.status,'notice_unavailable');
 assert.equal(report.calls,4);
 for(const value of Object.values(report).filter(value=>typeof value==='object'))assert.equal(value.userSeen,false);
 const record=await readFile(path.join(root,'scheduled-backup-notification.json'),'utf8');
 assert.ok(!/PRIVATE_PATIENT|credential=|HOSTILE/.test(record));assert.ok(Number.isFinite(Date.parse(JSON.parse(record).requestedAt)));
});

test('notification refuses unsafe destinations without executing the synthetic adapter',{skip:process.platform!=='win32'},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'folio-notice-path-'));
 const helper=await readFile(new URL('../../scripts/backup/owned-notice.ps1',import.meta.url),'utf8');
 await writeFile(path.join(root,'scheduled-backup-notification.json'),'old');
 const command=(await readFile(new URL('../../scripts/backup/owned-status.ps1',import.meta.url),'utf8'))+'\n'+helper+`
$script:calls=0
$result=Invoke-OwnedBackupNotice -OwnerRoot 'relative-unsafe-path' -Value @{status='no_verified_checkpoint'} -Notify {$script:calls++}
@{result=$result;calls=$script:calls}|ConvertTo-Json -Compress -Depth 3
`;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 const report=JSON.parse(result.stdout.trim());assert.equal(report.calls,0);assert.equal(report.result.status,'notice_unavailable');
});
