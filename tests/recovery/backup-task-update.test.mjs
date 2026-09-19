import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const quote=value=>`'${value.replaceAll("'","''")}'`;
const digest=value=>createHash('sha256').update(value).digest('hex');

test('reviewed task update preserves existing settings and refuses changed/running definitions',{skip:process.platform!=='win32'},async()=>{
 const original=await readFile(new URL('../../scripts/backup/install-windows-task.ps1',import.meta.url),'utf8');
 for(const mode of ['success','changed','running','candidate_tampered']) {
  const root=await mkdtemp(path.join(os.tmpdir(),'folio-task-update-')),candidate=path.join(root,'backup-runtime-synthetic');await mkdir(candidate);
  const launcher=path.join(candidate,'invoke-owned-backup.ps1'),body="throw 'THIS_SYNTHETIC_LAUNCHER_MUST_NEVER_RUN'";
  await writeFile(launcher,mode==='candidate_tampered'?body+' altered':body);
  const installer=path.join(root,'installer.ps1'),record=path.join(root,'updated.json');
  await writeFile(installer,original.replaceAll('C:\\Users\\amiun\\folio-recovery\\initial-20260908-182017',root));
  await writeFile(path.join(root,'owned-status.ps1'),await readFile(new URL('../../scripts/backup/owned-status.ps1',import.meta.url)));
  await writeFile(path.join(root,'owned-notice.ps1'),await readFile(new URL('../../scripts/backup/owned-notice.ps1',import.meta.url)));
  const definition='<Task>synthetic existing owner definition</Task>';
  // All Scheduler and ACL operations are synthetic process-local functions.
  // This test never reads, registers, starts, or changes a Windows task.
  const command=`
$global:taskFixture=[pscustomobject]@{State='${mode==='running'?'Running':'Ready'}';Principal=[pscustomobject]@{UserId=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;LogonType='Interactive';RunLevel='Limited'};Description='Folio owner backup v1; synthetic';Actions=@([pscustomobject]@{Execute='old'});Triggers='original-triggers';Settings='original-settings'}
function global:Get-ScheduledTask { param($TaskName,$TaskPath,$ErrorAction); return $global:taskFixture }
function global:Export-ScheduledTask { param($TaskName,$TaskPath); return ${quote(definition)} }
function global:Get-Acl { param($LiteralPath); return [pscustomobject]@{Access=@()} }
function global:New-ScheduledTaskAction { param($Execute,$Argument,$WorkingDirectory); return [pscustomobject]@{Execute=$Execute;Arguments=$Argument;WorkingDirectory=$WorkingDirectory} }
function global:Set-ScheduledTask { param($InputObject,$ErrorAction); $InputObject | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath ${quote(record)} }
& ${quote(installer)} -Mode Update -CandidateRuntime ${quote(candidate)} -CandidateLauncherSha256 '${digest(body)}' -ExpectedDefinitionSha256 '${mode==='changed'?'0'.repeat(64):digest(definition)}'
exit $LASTEXITCODE
`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.ok(!`${result.stdout}${result.stderr}`.includes('THIS_SYNTHETIC_LAUNCHER_MUST_NEVER_RUN'));
  if(mode==='success') {
   assert.equal(result.status,0,result.stdout+result.stderr);
   const updated=JSON.parse(await readFile(record,'utf8'));
   assert.equal(updated.Triggers,'original-triggers');assert.equal(updated.Settings,'original-settings');assert.equal(updated.Principal.LogonType,'Interactive');
   assert.ok(updated.Description.includes(digest(body)));assert.equal(updated.Actions[0].WorkingDirectory,root);
   assert.equal(JSON.parse(result.stdout.trim()).notificationConfigured,true);
   assert.ok(updated.Actions[0].Arguments.length<32000);
   assert.equal((await readdir(root)).filter(name=>name.startsWith('scheduled-backup-before-update-')).length,1);
  } else {
   assert.equal(result.status,1,result.stdout+result.stderr);await assert.rejects(readFile(record),{code:'ENOENT'});
   assert.ok(result.stdout.includes(mode==='changed'?'task_changed_review_required':mode==='running'?'task_running_retry_later':'runtime_invalid'));
  }
 }
});
