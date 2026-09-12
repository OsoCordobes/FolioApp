# Owner-approved Folio backup. Plan/Inspect are read-only; Update requires the
# reviewed candidate hash and an exact fingerprint of the existing definition.
[CmdletBinding()]
param(
    [ValidateSet('Plan','Inspect','Install','Update')][string]$Mode='Plan',
    [string]$CandidateRuntime,
    [string]$CandidateLauncherSha256,
    [string]$ExpectedDefinitionSha256
)
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$taskName='Folio - respaldo cifrado'
$ownerRoot='C:\Users\amiun\folio-recovery\initial-20260908-182017'
$launcher=Join-Path $ownerRoot 'backup-runtime-20260908T202842Z\invoke-owned-backup.ps1'
$launcherHash='72af22c9e67a29c1bbf55de80b11cbb754dcd5e3166aa0b20f63a084eef0f4e2'
$statusFile=Join-Path $ownerRoot 'scheduled-backup-last-status.json'
$hostExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Quote-Literal([string]$Text) { return "'"+$Text.Replace("'","''")+"'" }
function Xml-Text([string]$Text) { return [Security.SecurityElement]::Escape($Text) }
function Get-DefinitionSha256([string]$Text) {
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
try {
    if ($Mode -eq 'Inspect') {
        $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
        if ($null -eq $task) { @{status='not_registered'} | ConvertTo-Json -Compress; exit 0 }
        $info=Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\'
        $definition=Export-ScheduledTask -TaskName $taskName -TaskPath '\'
        [ordered]@{status='registered';state=[string]$task.State;definitionSha256=(Get-DefinitionSha256 $definition);lastResult=$info.LastTaskResult;lastRun=$info.LastRunTime.ToUniversalTime().ToString('o');nextRun=$info.NextRunTime.ToUniversalTime().ToString('o');owner=$task.Principal.UserId;logonType=[string]$task.Principal.LogonType;description=$task.Description} | ConvertTo-Json -Compress
        exit 0
    }
    if ($CandidateRuntime -or $CandidateLauncherSha256) {
        if (-not $CandidateRuntime -or $CandidateLauncherSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'candidate_invalid' }
        $candidate=[IO.Path]::GetFullPath($CandidateRuntime).TrimEnd('\','/')
        if ((Split-Path -Parent $candidate) -ne $ownerRoot -or (Split-Path -Leaf $candidate) -cnotmatch '^backup-runtime-[a-zA-Z0-9-]+$') { throw 'candidate_invalid' }
        $launcher=Join-Path $candidate 'invoke-owned-backup.ps1'
        $launcherHash=$CandidateLauncherSha256
    }
    if ($Mode -eq 'Update' -and (-not $CandidateRuntime -or $ExpectedDefinitionSha256 -cnotmatch '^[a-f0-9]{64}$')) { throw 'update_review_required' }
    if ($Mode -ne 'Update' -and $ExpectedDefinitionSha256) { throw 'update_review_required' }
    # The fixed private destination must belong to this Windows identity.
    for($check=$launcher; $check; $check=Split-Path -Parent $check) {
        if ((Get-Item -LiteralPath $check -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'path_invalid' }
    }
    foreach($check in @($ownerRoot,$launcher)) {
        foreach($rule in (Get-Acl -LiteralPath $check).Access) {
            if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $ownerSid) { throw 'owner_acl_invalid' }
        }
    }
    if ((Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant() -ne $launcherHash) { throw 'runtime_invalid' }
    # EncodedCommand is UTF-16 encoding, not encryption. It contains paths/hashes only.
    # A separate hidden process preserves the launcher's exit code; arbitrary stderr is discarded.
    $job=@'
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$jobExit=12
$report=$null
# SAFE_STATUS_FUNCTIONS
# SAFE_NOTICE_FUNCTIONS
function Assert-StatusDestination {
    for($check=OWNERROOT; $check; $check=Split-Path -Parent $check) {
        $entry=Get-Item -LiteralPath $check -Force
        if (-not $entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'integrity' }
    }
    if (Test-Path -LiteralPath STATUS) {
        $entry=Get-Item -LiteralPath STATUS -Force
        if ($entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'integrity' }
    }
}
try {
    Assert-StatusDestination
    if ((Get-Item -LiteralPath LAUNCHER).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'integrity' }
    if ((Get-FileHash -LiteralPath LAUNCHER -Algorithm SHA256).Hash.ToLowerInvariant() -ne HASH) { throw 'integrity' }
    $jobLines=@(& HOSTEXE -NoProfile -NonInteractive -WindowStyle Hidden -File LAUNCHER -Mode CatchUp 2>$null)
    $jobExit=$LASTEXITCODE
    if ($jobLines[-1].Length -gt 65536) { throw 'invalid_status' }
    $last=ConvertTo-OwnedStatus ($jobLines[-1] | ConvertFrom-Json)
    $report=[ordered]@{checkedAt=[DateTime]::UtcNow.ToString('o');exitCode=$jobExit}
    foreach($key in $last.Keys) { $report[$key]=$last[$key] }
    [IO.File]::WriteAllText(STATUS,($report | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
} catch {
    $jobExit=12
    try {
        Assert-StatusDestination
        $previous=@{status='scheduled_backup_failed'}
        if ((Test-Path -LiteralPath STATUS) -and (Get-Item -LiteralPath STATUS).Length -le 65536) {
            try { $previous=ConvertTo-OwnedStatus (Get-Content -LiteralPath STATUS -Raw | ConvertFrom-Json) } catch { }
        }
        $previous.status='scheduled_backup_failed'
        $previous.action='failed'
        $report=[ordered]@{checkedAt=[DateTime]::UtcNow.ToString('o');exitCode=12}
        $safe=ConvertTo-OwnedStatus $previous
        foreach($key in $safe.Keys) { $report[$key]=$safe[$key] }
        [IO.File]::WriteAllText(STATUS,($report | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
    } catch { } # An unsafe destination must never be followed to report a failure.
}
# Notification failure cannot turn a valid backup into a failed capture. Only
# closed metadata crosses this boundary; the message itself is static Spanish.
if ($null -ne $report) {
    try {
        Assert-StatusDestination
        $report.notification=Invoke-OwnedBackupNotice -OwnerRoot OWNERROOT -Value $report
        [IO.File]::WriteAllText(STATUS,($report | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
    } catch { }
}
exit $jobExit
'@
    $job=$job.Replace('# SAFE_STATUS_FUNCTIONS',(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'owned-status.ps1') -Raw -Encoding UTF8))
    $job=$job.Replace('# SAFE_NOTICE_FUNCTIONS',(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'owned-notice.ps1') -Raw -Encoding UTF8))
    $job=$job.Replace('LAUNCHER',(Quote-Literal $launcher)).Replace('HASH',(Quote-Literal $launcherHash)).Replace('STATUS',(Quote-Literal $statusFile)).Replace('HOSTEXE',(Quote-Literal $hostExe)).Replace('OWNERROOT',(Quote-Literal $ownerRoot))
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($job))
    $arguments='-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+$encoded
    if (($hostExe.Length+$arguments.Length+3) -gt 32000) { throw 'task_command_too_long' }
    $start=[DateTime]::Now.AddMinutes(5).ToString('yyyy-MM-ddTHH:mm:ss')
    $description='Folio owner backup v3; launcher SHA256 '+$launcherHash+'; stale backup Windows notice; requires logged-in owner; no Codex dependency.'
    $xml=@"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>$(Xml-Text $description)</Description></RegistrationInfo>
<Triggers><TimeTrigger><Repetition><Interval>PT1H</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$start</StartBoundary><Enabled>true</Enabled></TimeTrigger><LogonTrigger><Enabled>true</Enabled><UserId>$ownerSid</UserId></LogonTrigger></Triggers>
<Principals><Principal id="Owner"><UserId>$ownerSid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><Enabled>true</Enabled><Hidden>true</Hidden><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT20M</ExecutionTimeLimit></Settings>
<Actions Context="Owner"><Exec><Command>$(Xml-Text $hostExe)</Command><Arguments>$(Xml-Text $arguments)</Arguments><WorkingDirectory>$(Xml-Text $ownerRoot)</WorkingDirectory></Exec></Actions>
</Task>
"@
    [void][xml]$xml
    if ($Mode -eq 'Install') {
        if (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue) { throw 'task_already_exists_review_required' }
        Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Xml $xml -ErrorAction Stop | Out-Null
    }
    if ($Mode -eq 'Update') {
        $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
        $definition=Export-ScheduledTask -TaskName $taskName -TaskPath '\'
        if ((Get-DefinitionSha256 $definition) -ne $ExpectedDefinitionSha256) { throw 'task_changed_review_required' }
        $principalSid=if($task.Principal.UserId -match '^S-1-'){ $task.Principal.UserId }else{ ([Security.Principal.NTAccount]::new($task.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value }
        if ($principalSid -ne $ownerSid -or [string]$task.Principal.LogonType -ne 'Interactive' -or [string]$task.Principal.RunLevel -ne 'Limited' -or $task.Description -notmatch '^Folio owner backup v[123];' -or @($task.Actions).Count -ne 1) { throw 'task_owner_invalid' }
        if ([string]$task.State -eq 'Running') { throw 'task_running_retry_later' }
        # Preserve the exact previous definition privately before a reversible
        # action-only update. Triggers, settings and Windows identity stay intact.
        $saved=Join-Path $ownerRoot ('scheduled-backup-before-update-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'-'+[Guid]::NewGuid().ToString('N')+'.xml')
        $stream=[IO.File]::Open($saved,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $bytes=[Text.Encoding]::Unicode.GetBytes($definition);$stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
        if ((Get-DefinitionSha256 (Export-ScheduledTask -TaskName $taskName -TaskPath '\')) -ne $ExpectedDefinitionSha256 -or [string](Get-ScheduledTask -TaskName $taskName -TaskPath '\').State -eq 'Running') { throw 'task_changed_review_required' }
        $task.Actions=@(New-ScheduledTaskAction -Execute $hostExe -Argument $arguments -WorkingDirectory $ownerRoot)
        $task.Description=$description
        Set-ScheduledTask -InputObject $task -ErrorAction Stop | Out-Null
    }
    [ordered]@{status=$(if($Mode -eq 'Install'){'registered'}elseif($Mode -eq 'Update'){'updated'}else{'plan_only'});taskName=$taskName;launcherSha256=$launcherHash;owner=$ownerSid;logonType='InteractiveToken';intervalMinutes=60;catchUpAfterHours=20;executionLimitMinutes=20;startWhenAvailable=$true;wakeToRun=$false;codexRequired=$false;statusFile=$statusFile;notificationPlanned=$true;notificationConfigured=($Mode -in @('Install','Update'));notificationChannel='windows_tray';notificationDeliveryVerified=$false} | ConvertTo-Json -Compress
} catch {
    $reason=if($_.Exception.Message -in @('candidate_invalid','update_review_required','task_changed_review_required','task_owner_invalid','task_running_retry_later','path_invalid','owner_acl_invalid','runtime_invalid','task_already_exists_review_required','task_command_too_long')){$_.Exception.Message}else{'configuration_failed'}
    @{status='task_configuration_failed';reason=$reason} | ConvertTo-Json -Compress
    exit 1
}
