# Embedded in the reviewed owner task. No UI or data access on import.
function Show-OwnedBackupBalloon {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $icon=New-Object System.Windows.Forms.NotifyIcon
    try {
        $icon.Icon=[Drawing.SystemIcons]::Warning
        $icon.Text='Folio: respaldo pendiente'
        $icon.Visible=$true
        $icon.ShowBalloonTip(8000,'Folio: revisá el respaldo','No hay una copia verificada de las últimas 24 horas. Revisá el respaldo. Folio sigue funcionando en internet.',[Windows.Forms.ToolTipIcon]::Warning)
        $timer=[Diagnostics.Stopwatch]::StartNew()
        while ($timer.ElapsedMilliseconds -lt 8000) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
    } finally { $icon.Visible=$false; $icon.Dispose() }
}
function Invoke-OwnedBackupNotice {
    param([string]$OwnerRoot,$Value,[scriptblock]$Notify={Show-OwnedBackupBalloon})
    $ErrorActionPreference='Stop'
    $result=[ordered]@{status='notice_unavailable';reason=$null;userSeen=$false}
    $file=$null
    try {
        $safe=ConvertTo-OwnedStatus $Value
        if ($null -eq $safe.stale24h) { $result.reason='clock_invalid';return $result }
        if ($null -ne $safe.lastBackup -and $safe.stale24h -ne $true) { $result.status='not_needed';return $result }
        $result.reason=if($null -eq $safe.lastBackup){'no_verified_backup'}else{'stale_backup'}
        if (-not [IO.Path]::IsPathRooted($OwnerRoot)) { throw 'notice_invalid' }
        $root=[IO.Path]::GetFullPath($OwnerRoot)
        for($check=$root; $check; $check=Split-Path -Parent $check) {
            $entry=Get-Item -LiteralPath $check -Force
            if (-not $entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'notice_invalid' }
        }
        $record=Join-Path $root 'scheduled-backup-notification.json'
        if (Test-Path -LiteralPath $record) {
            $entry=Get-Item -LiteralPath $record -Force
            if ($entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'notice_invalid' }
        }
        # One private file is both durable deduplication and an exclusive lock.
        $file=[IO.File]::Open($record,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        if ($file.Length -gt 0 -and $file.Length -le 1024) {
            try {
                $bytes=New-Object byte[] $file.Length
                [void]$file.Read($bytes,0,$bytes.Length)
                $prior=([Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json).requestedAt
                if ($prior -is [DateTime] -and $prior.Kind -eq [DateTimeKind]::Utc) { $prior=$prior.ToString('o') }
                if ($prior -is [string] -and $prior -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,7}Z$') {
                    $hours=([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($prior,[Globalization.CultureInfo]::InvariantCulture)).TotalHours
                    if ($hours -ge 0 -and $hours -lt 24) { $result.status='deduplicated';return $result }
                }
            } catch { } # Corrupt/future dates cannot suppress a needed warning.
        }
        $null=& $Notify *>&1
        $bytes=[Text.Encoding]::UTF8.GetBytes((@{requestedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress))
        $file.Position=0;$file.SetLength(0);$file.Write($bytes,0,$bytes.Length);$file.Flush($true)
        $result.status='notice_requested'
    } catch { $result.status='notice_unavailable' } finally { if($null -ne $file){$file.Dispose()} }
    # Shell acceptance never proves that Windows displayed it or the owner saw it.
    return $result
}
