# Installs (or with -Uninstall removes) the System Vitals plugin.
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$id = 'com.clarkyau.sysvitals.sdPlugin'
$src = Join-Path $PSScriptRoot $id

function Find-PluginsFolder {
    $p = Join-Path $env:APPDATA 'HotSpot\StreamDock\plugins'
    if (Test-Path -LiteralPath $p) { return $p }
    $found = Get-ChildItem -LiteralPath $env:APPDATA -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'StreamDock\plugins' } |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    return $found
}

$plugins = Find-PluginsFolder
if (-not $plugins) {
    Write-Host 'Could not find the Stream Dock plugins folder.'
    Write-Host 'Install and start the Ajazz Stream Dock software once, then run this again.'
    exit 1
}
if (-not $Uninstall -and -not (Test-Path -LiteralPath (Join-Path $src 'manifest.json'))) {
    Write-Host "The $id folder is missing. Extract the whole zip first, then run install.bat from the extracted folder."
    exit 1
}

# Find the running Stream Dock software so it can be restarted afterwards.
$app = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -and ($_.Path -match 'StreamDock|Stream Dock|AJAZZ|HotSpot') -and $_.ProcessName -notmatch '^(node|powershell|pwsh)$' } catch { $false }
})
$exe = $null
$mainProc = $app | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $mainProc) { $mainProc = $app | Sort-Object StartTime | Select-Object -First 1 }
if ($mainProc) { $exe = $mainProc.Path }

if ($app.Count -gt 0) {
    Write-Host 'Closing the Stream Dock software...'
    $app | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch { } }
    Start-Sleep -Seconds 2
}
# The plugin's helper exits by itself when the software closes; make sure nothing holds its files.
try {
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop |
        Where-Object { $_.CommandLine -like "*$id*" } |
        ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { } }
} catch { }
Start-Sleep -Milliseconds 500

$dest = Join-Path $plugins $id
if ($Uninstall) {
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
    Write-Host 'System Vitals has been removed.'
} else {
    if (Test-Path -LiteralPath $dest) {
        # Your key settings are kept by the Stream Dock software itself; only the plugin files are replaced.
        foreach ($item in 'plugin', 'pi', 'static', 'runtime', 'manifest.json', 'en.json') {
            $p = Join-Path $dest $item
            if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
        }
    } else {
        New-Item -ItemType Directory -Path $dest | Out-Null
    }
    Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force
    Write-Host "System Vitals installed to $dest"
}

if ($exe -and (Test-Path -LiteralPath $exe)) {
    Write-Host 'Starting the Stream Dock software again...'
    Start-Process -FilePath $exe
} else {
    Write-Host 'Start the Stream Dock software to use the plugin.'
}
