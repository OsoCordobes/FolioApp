# Strict metadata boundary shared by the owner launcher and embedded scheduler.
# Never forward arbitrary child fields or strings, including nested backup data.
function ConvertTo-OwnedBackup($Value) {
    if ($null -eq $Value) { return $null }
    if ($Value.id -isnot [string] -or $Value.id -cnotmatch '^backup_[0-9]{8}T[0-9]{9}Z_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { throw 'owned_capture_failed' }
    # Recent PowerShell converts ISO JSON dates into DateTime; Windows 5.1 keeps strings.
    $completed=$Value.completedAt
    if ($completed -is [DateTime] -and $completed.Kind -eq [DateTimeKind]::Utc) { $completed=$completed.ToString('o') }
    if ($completed -isnot [string] -or $completed -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,7}Z$') { throw 'owned_capture_failed' }
    $time=[DateTimeOffset]::Parse($completed,[Globalization.CultureInfo]::InvariantCulture)
    return [ordered]@{id=$Value.id;completedAt=$time.UtcDateTime.ToString('o')}
}
function ConvertTo-OwnedStatus($Value) {
    if ($Value.status -isnot [string] -or $Value.status -notin @('clock_invalid','no_verified_checkpoint','verification_attention','verified_checkpoint_recorded','runtime_integrity_failed','already_running','configuration_invalid','timeout','retention_failed','checkpoint_incomplete','scheduled_backup_failed')) { throw 'owned_capture_failed' }
    $last=ConvertTo-OwnedBackup $Value.lastBackup
    $verified=ConvertTo-OwnedBackup $Value.verifiedBackup
    $age=$null
    if ($null -ne $last) { $age=([DateTime]::UtcNow-[DateTime]::Parse($last.completedAt,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind)).TotalHours }
    $clockInvalid=$Value.status -eq 'clock_invalid' -or ($null -ne $age -and $age -lt 0)
    if ($clockInvalid) { $age=$null }
    $action=if ($Value.action -in @('preflight','not_due','captured','verified_existing','failed')) { $Value.action } else { $null }
    $stage=if ($Value.stage -in @('connect','tool_version','server_version','snapshot_begin','snapshot_export','inventory','extension_review','database_dump','roles_dump','verify_connect','verify_inventory','verify_configuration','snapshot_close','connection_idle')) { $Value.stage } else { $null }
    $category=if ($Value.category -in @('permission_denied','tls_certificate','authentication_failed','snapshot_unavailable','timeout','dns_failed','connection_failed','tool_failure_or_warning','circular_foreign_keys','collation_version_mismatch','privilege_warning','tool_unavailable','diagnostic_capture_failed')) { $Value.category } else { 'unspecified' }
    $backupStage=if ($Value.backupStage -in @('snapshot','configuration','database','roles','storage','consistency','publish')) { $Value.backupStage } else { $null }
    return [ordered]@{status=$Value.status;action=$action;stage=$stage;category=$category;backupStage=$backupStage;lastBackup=$last;verifiedBackup=$verified;ageHours=$age;
        catchUpDue=(!$clockInvalid -and ($null -eq $last -or $age -ge 20));stale24h=$(if($clockInvalid){$null}else{$null -eq $last -or $age -gt 24});
        platformConfigurationComplete=$false;restorationProven=$false;ownerCustodyPending=$true}
}
