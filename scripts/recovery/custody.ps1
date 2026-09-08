# Owner-only UI: no network, console output or plaintext secret file.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$taskPlain = $null
try {
    $taskPlain = [System.Security.Cryptography.ProtectedData]::Unprotect(
        [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'passphrase.dpapi')),
        $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $taskForm = New-Object Windows.Forms.Form
    $taskForm.Text = 'Folio - guardar la llave de recuperacion'
    $taskForm.Size = New-Object Drawing.Size(760,365)
    $taskForm.StartPosition = 'CenterScreen'

    $taskLabel = New-Object Windows.Forms.Label
    $taskLabel.Location = New-Object Drawing.Point(20,20)
    $taskLabel.Size = New-Object Drawing.Size(700,90)
    $taskLabel.Text = 'Esta frase abre tu paquete cifrado en otra computadora. Guardala en tu gestor de contrasenas o en papel en un lugar seguro, separado del disco de respaldo. No la pegues en el chat, un correo o un documento compartido. Esta ventana funciona solamente en tu PC.'
    $taskForm.Controls.Add($taskLabel)

    $taskBox = New-Object Windows.Forms.TextBox
    $taskBox.Location = New-Object Drawing.Point(20,120)
    $taskBox.Size = New-Object Drawing.Size(700,30)
    $taskBox.Font = New-Object Drawing.Font('Consolas',12)
    $taskBox.ReadOnly = $true
    $taskBox.UseSystemPasswordChar = $true
    $taskBox.Text = [Text.Encoding]::UTF8.GetString($taskPlain)
    $taskForm.Controls.Add($taskBox)

    $taskShow = New-Object Windows.Forms.CheckBox
    $taskShow.Location = New-Object Drawing.Point(20,162)
    $taskShow.Size = New-Object Drawing.Size(400,25)
    $taskShow.Text = 'Mostrar la frase en esta pantalla privada'
    $taskShow.Add_CheckedChanged({ $taskBox.UseSystemPasswordChar = -not $taskShow.Checked })
    $taskForm.Controls.Add($taskShow)

    $taskCopy = New-Object Windows.Forms.Button
    $taskCopy.Location = New-Object Drawing.Point(20,205)
    $taskCopy.Size = New-Object Drawing.Size(230,34)
    $taskCopy.Text = 'Copiar para guardar en mi gestor'
    $taskCopy.Add_Click({ [Windows.Forms.Clipboard]::SetText($taskBox.Text) })
    $taskForm.Controls.Add($taskCopy)

    $taskDone = New-Object Windows.Forms.Button
    $taskDone.Location = New-Object Drawing.Point(20,264)
    $taskDone.Size = New-Object Drawing.Size(450,34)
    $taskDone.Text = 'Confirmo que la guarde en otro lugar seguro'
    $taskDone.Add_Click({
        $taskAttestation = @{ ownerReportedSavedSeparatelyAt = [DateTime]::UtcNow.ToString('o') }
        [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'custody-user-confirmed.json'),
            ($taskAttestation | ConvertTo-Json -Compress))
        $taskForm.Close()
    })
    $taskForm.Controls.Add($taskDone)

    $taskClose = New-Object Windows.Forms.Button
    $taskClose.Location = New-Object Drawing.Point(510,264)
    $taskClose.Size = New-Object Drawing.Size(210,34)
    $taskClose.Text = 'Cerrar sin confirmar'
    $taskClose.Add_Click({ $taskForm.Close() })
    $taskForm.Controls.Add($taskClose)
    [void]$taskForm.ShowDialog()
    $taskBox.Text = ''
    $taskForm.Dispose()
} catch {
    [void][Windows.Forms.MessageBox]::Show(
        'No se pudo abrir la llave. Usa la cuenta de Windows con la que se preparo la recuperacion. No compartas archivos ni frases en el chat.', 'Folio')
} finally {
    if ($null -ne $taskPlain) { [Array]::Clear($taskPlain,0,$taskPlain.Length) }
}
