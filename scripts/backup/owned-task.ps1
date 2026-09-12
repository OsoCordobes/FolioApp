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
$taskStatus = $null
$taskFailure = $null
$env:FOLIO_RECOVERY_PASSPHRASE = $null
. (Join-Path $PSScriptRoot 'owned-status.ps1')

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
            # Only a bounded, schema-checked stdout record can carry diagnostics.
            # Arbitrary stderr, nested fields and provider strings are discarded.
            try {
                if ($taskText.Length -gt 65536) { throw 'owned_capture_failed' }
                $record=ConvertTo-OwnedStatus (($taskText.Trim() -split '\r?\n')[-1] | ConvertFrom-Json)
                if ($record.status -notin @('already_running','clock_invalid','configuration_invalid','retention_failed','checkpoint_incomplete')) { throw 'owned_capture_failed' }
                $script:taskFailure=$record
            } catch { $script:taskFailure=$null }
            if ($taskProcess.ExitCode -eq 10) { throw 'owned_busy' }
            if ($taskProcess.ExitCode -eq 11) { throw 'owned_clock' }
            if ($taskProcess.ExitCode -eq 12) { throw 'owned_configuration' }
            if ($taskProcess.ExitCode -eq 22) { throw 'owned_retention' }
            throw 'owned_capture_failed'
        }
        if ($taskText.Length -gt 65536) { throw 'owned_capture_failed' }
        $taskLine = ($taskText.Trim() -split '\r?\n')[-1]
        $taskResult = ConvertTo-OwnedStatus ($taskLine | ConvertFrom-Json)
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
    $safe=ConvertTo-OwnedStatus $Status
    if ($Action -in @('preflight','not_due','captured','verified_existing','failed')) { $safe.action=$Action }
    $safe | ConvertTo-Json -Depth 4 -Compress
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
    # Keep the read-only preflight recovery point even when a provider fails.
    # A child can return a newly verified point after retention failure; its
    # report has already passed the same nested metadata validation.
    $failed=if ($null -ne $taskFailure) { $taskFailure } elseif ($null -ne $taskStatus) { $taskStatus } else { @{status=$taskCategory} }
    if ($null -eq $failed.lastBackup -and $null -ne $taskStatus.lastBackup) { $failed.lastBackup=$taskStatus.lastBackup }
    $failed.status=$taskCategory
    Write-OwnedStatus $failed 'failed'
} finally {
    if ($null -ne $taskPlain) { [Array]::Clear($taskPlain,0,$taskPlain.Length) }
    $taskPlain = $null
    $taskPhrase = $null
    $env:FOLIO_RECOVERY_PASSPHRASE = $null
}
exit $taskExit
