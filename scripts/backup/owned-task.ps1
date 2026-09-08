# Local owner package only. This file does not register a Windows task or automation.
[CmdletBinding()]
param(
    [ValidateSet('Status','CatchUp','VerifyExisting')][string]$Mode = 'Status',
    [string]$RecoveryRoot = 'C:\Users\amiun\folio-recovery\initial-20260908-182017',
    [string]$CheckpointId
)
$ErrorActionPreference = 'Stop'
$taskPlain = $null
$taskPhrase = $null
$taskExit = 0
$env:FOLIO_RECOVERY_PASSPHRASE = $null

function Invoke-OwnedNode([string]$Operation, [string]$Phrase) {
    $taskInfo = New-Object System.Diagnostics.ProcessStartInfo
    $taskInfo.FileName = (Get-Command node.exe -ErrorAction Stop).Source
    $taskInfo.Arguments = '"' + (Join-Path $PSScriptRoot 'owned-task.mjs') + '" ' + $Operation + ' "' + $script:RecoveryRoot + '"'
    if ($Operation -eq 'CatchUp') { $taskInfo.Arguments += ' --capture-owner-production-read-only' }
    if ($Operation -eq 'VerifyExisting') { $taskInfo.Arguments += ' ' + $script:CheckpointId }
    $taskInfo.UseShellExecute = $false
    $taskInfo.CreateNoWindow = $true
    $taskInfo.RedirectStandardOutput = $true
    $taskInfo.RedirectStandardError = $true
    $taskInfo.EnvironmentVariables.Remove('NODE_OPTIONS')
    $taskInfo.EnvironmentVariables.Remove('NODE_PATH')
    $taskInfo.EnvironmentVariables.Remove('FOLIO_RECOVERY_PASSPHRASE')
    if ($Operation -in @('CatchUp','VerifyExisting')) { $taskInfo.EnvironmentVariables['FOLIO_RECOVERY_PASSPHRASE'] = $Phrase }
    $taskProcess = New-Object System.Diagnostics.Process
    $taskProcess.StartInfo = $taskInfo
    try {
        [void]$taskProcess.Start()
        $taskOut = $taskProcess.StandardOutput.ReadToEndAsync()
        $taskErr = $taskProcess.StandardError.ReadToEndAsync()
        # Fifteen minutes total; pg_dump also has its narrower own timeout.
        if (-not $taskProcess.WaitForExit(900000)) {
            # Kill only this launched process and its children, including pg_dump.
            if ($PSVersionTable.PSEdition -eq 'Core') { $taskProcess.Kill($true) }
            else { & "$env:SystemRoot\System32\taskkill.exe" /PID $taskProcess.Id /T /F 2>&1 | Out-Null }
            throw 'owned_timeout'
        }
        $taskText = $taskOut.GetAwaiter().GetResult()
        [void]$taskErr.GetAwaiter().GetResult() # Never echo provider or exception output.
        if ($taskProcess.ExitCode -ne 0) {
            if ($taskProcess.ExitCode -eq 10) { throw 'owned_busy' }
            if ($taskProcess.ExitCode -eq 11) { throw 'owned_clock' }
            if ($taskProcess.ExitCode -eq 12) { throw 'owned_configuration' }
            if ($taskProcess.ExitCode -eq 22) { throw 'owned_retention' }
            throw 'owned_capture_failed'
        }
        $taskLine = ($taskText.Trim() -split '\r?\n')[-1]
        $taskResult = $taskLine | ConvertFrom-Json
        if ($taskResult.status -notin @('clock_invalid','no_verified_checkpoint','verification_attention','verified_checkpoint_recorded')) { throw 'owned_capture_failed' }
        return $taskResult
    } finally {
        $taskInfo.EnvironmentVariables.Remove('FOLIO_RECOVERY_PASSPHRASE')
        $taskInfo = $null
        $Phrase = $null
        $taskProcess.Dispose()
    }
}
function Write-OwnedStatus($Status, [string]$Action) {
    # Do not forward arbitrary fields emitted by a child process.
    [ordered]@{ status=$Status.status; action=$Action; lastBackup=$Status.lastBackup; verifiedBackup=$Status.verifiedBackup; ageHours=$Status.ageHours;
        catchUpDue=$Status.catchUpDue; platformConfigurationComplete=$false; restorationProven=$false; ownerCustodyPending=$true } | ConvertTo-Json -Compress
}
try {
    if ($RecoveryRoot -notmatch '^[A-Za-z]:[\\/]' -or $RecoveryRoot.StartsWith('\\') -or $RecoveryRoot.Contains('"')) { throw 'owned_configuration' }
    if ($Mode -eq 'VerifyExisting') {
        if ($CheckpointId -cnotmatch '^backup_[0-9]{8}T[0-9]{9}Z_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { throw 'owned_configuration' }
    } elseif (-not [string]::IsNullOrEmpty($CheckpointId)) { throw 'owned_configuration' }
    $RecoveryRoot = [IO.Path]::GetFullPath($RecoveryRoot).TrimEnd('\','/')
    $taskStatus = Invoke-OwnedNode 'Status' $null
    Write-OwnedStatus $taskStatus 'preflight'
    if ($Mode -in @('CatchUp','VerifyExisting')) {
        if ($Mode -eq 'CatchUp' -and $taskStatus.status -eq 'clock_invalid') { throw 'owned_clock' }
        if ($Mode -eq 'VerifyExisting' -or $taskStatus.catchUpDue -eq $true) {
            Add-Type -AssemblyName System.Security
            $taskPlain = [Security.Cryptography.ProtectedData]::Unprotect(
                [IO.File]::ReadAllBytes((Join-Path $RecoveryRoot 'passphrase.dpapi')),
                $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
            $taskPhrase = [Text.Encoding]::UTF8.GetString($taskPlain)
            if ([string]::IsNullOrEmpty($taskPhrase)) { throw 'owned_configuration' }
            $taskStatus = Invoke-OwnedNode $Mode $taskPhrase
            Write-OwnedStatus $taskStatus $taskStatus.action
        } else { Write-OwnedStatus $taskStatus 'not_due' }
    }
} catch {
    $taskCategory = switch ($_.Exception.Message) {
        'owned_busy' { $script:taskExit=10; 'already_running' }
        'owned_clock' { $script:taskExit=11; 'clock_invalid' }
        'owned_configuration' { $script:taskExit=12; 'configuration_invalid' }
        'owned_timeout' { $script:taskExit=21; 'timeout' }
        'owned_retention' { $script:taskExit=22; 'retention_failed' }
        default { $script:taskExit=20; 'checkpoint_incomplete' }
    }
    @{status=$taskCategory;ownerCustodyPending=$true;restorationProven=$false;platformConfigurationComplete=$false} | ConvertTo-Json -Compress
} finally {
    if ($null -ne $taskPlain) { [Array]::Clear($taskPlain,0,$taskPlain.Length) }
    $taskPlain = $null
    $taskPhrase = $null
    $env:FOLIO_RECOVERY_PASSPHRASE = $null
}
exit $taskExit
