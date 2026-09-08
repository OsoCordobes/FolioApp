# Owner-approved Folio backup. Plan/Inspect are read-only; Install never replaces a task.
[CmdletBinding()]
param([ValidateSet('Plan','Inspect','Install')][string]$Mode='Plan')
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
try {
    if ($Mode -eq 'Inspect') {
        $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
        if ($null -eq $task) { @{status='not_registered'} | ConvertTo-Json -Compress; exit 0 }
        $info=Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\'
        [ordered]@{status='registered';state=[string]$task.State;lastResult=$info.LastTaskResult;lastRun=$info.LastRunTime.ToUniversalTime().ToString('o');nextRun=$info.NextRunTime.ToUniversalTime().ToString('o');owner=$task.Principal.UserId;logonType=[string]$task.Principal.LogonType;description=$task.Description} | ConvertTo-Json -Compress
        exit 0
    }
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
    $last=$jobLines[-1] | ConvertFrom-Json
    if ($last.status -notin @('clock_invalid','no_verified_checkpoint','verification_attention','verified_checkpoint_recorded','runtime_integrity_failed','already_running','configuration_invalid','timeout','retention_failed','checkpoint_incomplete')) { throw 'invalid_status' }
    $report=[ordered]@{checkedAt=[DateTime]::UtcNow.ToString('o');exitCode=$jobExit;status=$last.status;action=$last.action;lastBackup=$last.lastBackup;ageHours=$last.ageHours;catchUpDue=$last.catchUpDue;platformConfigurationComplete=$false;restorationProven=$false;ownerCustodyPending=$true}
    [IO.File]::WriteAllText(STATUS,($report | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
} catch {
    $jobExit=12
    try {
        Assert-StatusDestination
        $report=@{checkedAt=[DateTime]::UtcNow.ToString('o');exitCode=12;status='scheduled_backup_failed';platformConfigurationComplete=$false;restorationProven=$false;ownerCustodyPending=$true}
        [IO.File]::WriteAllText(STATUS,($report | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    } catch { } # An unsafe destination must never be followed to report a failure.
}
exit $jobExit
'@
    $job=$job.Replace('LAUNCHER',(Quote-Literal $launcher)).Replace('HASH',(Quote-Literal $launcherHash)).Replace('STATUS',(Quote-Literal $statusFile)).Replace('HOSTEXE',(Quote-Literal $hostExe)).Replace('OWNERROOT',(Quote-Literal $ownerRoot))
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($job))
    $arguments='-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+$encoded
    $start=[DateTime]::Now.AddMinutes(5).ToString('yyyy-MM-ddTHH:mm:ss')
    $description='Folio owner backup v1; launcher SHA256 '+$launcherHash+'; requires logged-in owner; no Codex dependency.'
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
    [ordered]@{status=$(if($Mode -eq 'Install'){'registered'}else{'plan_only'});taskName=$taskName;launcherSha256=$launcherHash;owner=$ownerSid;logonType='InteractiveToken';intervalMinutes=60;catchUpAfterHours=20;executionLimitMinutes=20;startWhenAvailable=$true;wakeToRun=$false;codexRequired=$false;statusFile=$statusFile;notificationConfigured=$false} | ConvertTo-Json -Compress
} catch {
    # Installation errors contain no provider data or credentials.
    @{status='task_configuration_failed';reason=$_.Exception.Message} | ConvertTo-Json -Compress
    exit 1
}
