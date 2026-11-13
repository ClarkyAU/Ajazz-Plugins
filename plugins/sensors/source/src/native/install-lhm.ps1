# Installs or updates LibreHardwareMonitor for the System Vitals plugin, or with
# -ConfigOnly just switches how it shares readings. Runs elevated (Windows asks
# for permission once). Steps:
#   1. Download the latest LibreHardwareMonitor.zip from its official GitHub releases
#   2. Copy it to "C:\Program Files\LibreHardwareMonitor" (keeps an existing .config)
#   3. Share readings the chosen way (-Mode):
#        web: its web server for this PC only (127.0.0.1:<Port>), logging off
#        log: its sensor log file every 2 s (one file a day), web server off, and a
#             daily task that deletes log files older than 2 days
#      and start minimised to the tray
#   4. Install PawnIO (signed driver LibreHardwareMonitor uses to read the CPU) if missing/old
#   5. Start it at logon with a scheduled task (the same one its own "Run On Windows Startup" uses)
#   6. Start it now
# Progress is written as JSON to -StatusFile so the plugin can show it.

param(
    [int]$Port = 8085,
    [ValidateSet('web', 'log')][string]$Mode = 'web',
    [string]$User = '',
    [string]$StatusFile = '',
    [switch]$ConfigOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Status([string]$step, [bool]$done = $false, [string]$err = '') {
    if (-not $StatusFile) { return }
    $o = @{ step = $step; done = $done; error = $err; at = [DateTime]::UtcNow.ToString('o') }
    try { [IO.File]::WriteAllText($StatusFile, (ConvertTo-Json $o -Compress)) } catch { }
}

function Stop-Lhm {
    Get-Process -Name 'LibreHardwareMonitor' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 800
}

$dest = Join-Path $env:ProgramFiles 'LibreHardwareMonitor'
$work = Join-Path $env:ProgramFiles 'LibreHardwareMonitor.setup'
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
    New-Item -ItemType Directory -Path $work | Out-Null

    if (-not $ConfigOnly) {
    Write-Status 'Downloading LibreHardwareMonitor'
    $zip = Join-Path $work 'LibreHardwareMonitor.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/latest/download/LibreHardwareMonitor.zip' -OutFile $zip

    Write-Status 'Unpacking'
    $ex = Join-Path $work 'files'
    Expand-Archive -LiteralPath $zip -DestinationPath $ex -Force
    $exe = Get-ChildItem -LiteralPath $ex -Recurse -Filter 'LibreHardwareMonitor.exe' | Select-Object -First 1
    if (-not $exe) { throw 'The download did not contain LibreHardwareMonitor.exe' }

    Write-Status 'Copying to Program Files'
    Get-Process -Name 'LibreHardwareMonitor' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 800
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $cfgPath = Join-Path $dest 'LibreHardwareMonitor.config'
    $oldCfg = $null
    if (Test-Path -LiteralPath $cfgPath) { $oldCfg = [IO.File]::ReadAllText($cfgPath) }
    Copy-Item -Path (Join-Path $exe.DirectoryName '*') -Destination $dest -Recurse -Force
    if ($oldCfg) { [IO.File]::WriteAllText($cfgPath, $oldCfg) }
    Get-ChildItem -LiteralPath $dest -Recurse -File | Unblock-File
    }
    else {
        if (-not (Test-Path -LiteralPath (Join-Path $dest 'LibreHardwareMonitor.exe'))) { throw 'LibreHardwareMonitor is not installed in Program Files' }
        Write-Status 'Stopping LibreHardwareMonitor'
        Stop-Lhm
    }
    $cfgPath = Join-Path $dest 'LibreHardwareMonitor.config'

    Write-Status ($(if ($Mode -eq 'log') { 'Turning on its log file' } else { 'Turning on its web server' }))
    $xml = New-Object System.Xml.XmlDocument
    $loaded = $false
    if (Test-Path -LiteralPath $cfgPath) { try { $xml.Load($cfgPath); $loaded = $true } catch { } }
    if (-not $loaded) { $xml.LoadXml('<?xml version="1.0" encoding="utf-8"?><configuration><appSettings /></configuration>') }
    $app = $xml.SelectSingleNode('/configuration/appSettings')
    if (-not $app) {
        $root = $xml.SelectSingleNode('/configuration')
        if (-not $root) { $root = $xml.AppendChild($xml.CreateElement('configuration')) }
        $app = $root.AppendChild($xml.CreateElement('appSettings'))
    }
    $values = [ordered]@{
        runWebServerMenuItem = $(if ($Mode -eq 'web') { 'true' } else { 'false' })
        listenerIp           = '127.0.0.1'
        listenerPort         = [string]$Port
        logSensorsMenuItem   = $(if ($Mode -eq 'log') { 'true' } else { 'false' })
        loggingInterval      = '1'
        'logger.fileRotation' = '1'
        startMinMenuItem     = 'true'
        minTrayMenuItem      = 'true'
        minCloseMenuItem     = 'true'
    }
    foreach ($k in $values.Keys) {
        $node = $app.SelectSingleNode("add[@key='$k']")
        if (-not $node) {
            $node = $xml.CreateElement('add')
            $node.SetAttribute('key', $k)
            [void]$app.AppendChild($node)
        }
        $node.SetAttribute('value', $values[$k])
    }
    $xml.Save($cfgPath)

    # PawnIO: LibreHardwareMonitor needs version 2 or newer to read the CPU.
    $pawnVersion = $null
    foreach ($view in 'Registry64', 'Registry32') {
        try {
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine', $view)
            $k = $base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO')
            if ($k) { $v = [string]$k.GetValue('DisplayVersion'); if ($v) { $pawnVersion = [Version]$v } }
        } catch { }
        if ($pawnVersion) { break }
    }
    if (-not $pawnVersion -or $pawnVersion -lt [Version]'2.0.0.0') {
        Write-Status 'Installing PawnIO'
        $setup = Join-Path $work 'PawnIO_setup.exe'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/namazso/PawnIO.Setup/releases/latest/download/PawnIO_setup.exe' -OutFile $setup
        $sig = Get-AuthenticodeSignature -LiteralPath $setup
        if ($sig.Status -ne 'Valid') { throw "PawnIO setup is not properly signed ($($sig.Status)); not installing it" }
        $p = Start-Process -FilePath $setup -ArgumentList '-install', '-silent' -Wait -PassThru
        if ($p.ExitCode -ne 0) { throw "PawnIO setup failed (code $($p.ExitCode))" }
    }

    Write-Status 'Setting it to start with Windows'
    $userId = $User
    if (-not $userId) { $userId = "$env:USERDOMAIN\$env:USERNAME" }

    # Log files: one per day, about 50 MB each at 2-second logging; keep the last two days.
    $cleanName = 'LibreHardwareMonitor log cleanup'
    if ($Mode -eq 'log') {
        $cmd = "Get-ChildItem -LiteralPath '" + $dest.Replace("'", "''") + "' -Filter 'LibreHardwareMonitorLog-*.csv' | Where-Object { `$_.LastWriteTime -lt (Get-Date).AddDays(-2) } | Remove-Item -Force -ErrorAction SilentlyContinue"
        $cAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -Command "' + $cmd + '"')
        $cTriggers = @((New-ScheduledTaskTrigger -Daily -At '3:00'), (New-ScheduledTaskTrigger -AtLogOn -User $userId))
        $cPrincipal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
        $cSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
        Register-ScheduledTask -TaskName $cleanName -Action $cAction -Trigger $cTriggers -Principal $cPrincipal -Settings $cSettings -Force | Out-Null
    }
    elseif (Get-ScheduledTask -TaskName $cleanName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $cleanName -Confirm:$false
    }
    $exePath = Join-Path $dest 'LibreHardwareMonitor.exe'
    $action = New-ScheduledTaskAction -Execute $exePath -WorkingDirectory $dest
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName 'LibreHardwareMonitor' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

    Write-Status 'Starting LibreHardwareMonitor'
    Start-ScheduledTask -TaskName 'LibreHardwareMonitor'
    Write-Status $(if ($ConfigOnly) { 'Applied' } else { 'Installed' }) $true
}
catch {
    Write-Status 'Failed' $true $_.Exception.Message
    exit 1
}
finally {
    try { if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force } } catch { }
}
