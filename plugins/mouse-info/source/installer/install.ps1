# Installs or removes the Mouse Info plugin for the Ajazz "Stream Dock AJAZZ Global" software.
# Keeps the plugin's saved battery history (data folder). Key settings live in the Ajazz profiles
# and are not touched.
param([ValidateSet('install', 'uninstall')][string]$Action = 'install')
$ErrorActionPreference = 'Stop'
$id = 'com.clarkyau.mouseinfo.sdPlugin'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$plugins = Join-Path $env:APPDATA 'HotSpot\StreamDock\plugins'
$dest = Join-Path $plugins $id

function Find-Ajazz {
    Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -and ($_.Path -like '*Stream Dock*' -or $_.Path -like '*StreamDock*') -and $_.ProcessName -notmatch '^node'
    }
}

if (-not (Test-Path -LiteralPath (Split-Path $plugins))) {
    Write-Host "Could not find the Ajazz Stream Dock software folder ($plugins)." -ForegroundColor Red
    Write-Host 'Install and open the Stream Dock AJAZZ Global software once, then run this again.'
    exit 1
}

# Remember where the software is so it can be started again.
$running = @(Find-Ajazz)
$exe = $null
$main = $running | Where-Object { $_.MainWindowHandle -ne 0 -or $_.ProcessName -match 'Stream ?Dock' } | Select-Object -First 1
if ($main) { $exe = $main.Path }
if (-not $exe) {
    foreach ($p in @("${env:ProgramFiles(x86)}\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe", "$env:ProgramFiles\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe")) {
        if (Test-Path -LiteralPath $p) { $exe = $p; break }
    }
}

if ($running.Count) {
    Write-Host 'Closing the Ajazz software...'
    $running | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch { } }
    Start-Sleep -Seconds 2
    Find-Ajazz | ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch { } }
    Start-Sleep -Seconds 2
}
# Stop our own helper if it is still running.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$id*listener.ps1*" } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch { } }

if ($Action -eq 'install') {
    $src = Join-Path $here $id
    if (-not (Test-Path -LiteralPath $src)) { Write-Host "Missing folder $src next to the installer." -ForegroundColor Red; exit 1 }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    # Remove old program files but keep saved data and the log.
    Get-ChildItem -LiteralPath $dest -Force | Where-Object { $_.Name -notin @('data', 'plugin.log', 'plugin.log.old') } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
    Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force
    Write-Host "Installed Mouse Info to $dest" -ForegroundColor Green
} else {
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force; Write-Host 'Mouse Info removed.' -ForegroundColor Green }
    else { Write-Host 'Mouse Info was not installed.' }
}

if ($exe) {
    Write-Host 'Starting the Ajazz software...'
    Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe)
} else {
    Write-Host 'Please start the Stream Dock AJAZZ software.'
}
