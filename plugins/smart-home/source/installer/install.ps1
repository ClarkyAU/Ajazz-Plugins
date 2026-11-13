# Installs (or updates) the Smart Home plugin (com.clarkyau.smarthome) for the
# Ajazz / Stream Dock software. Closes the software, copies the plugin, keeps
# the saved device list, moves keys over from the old "dev.smarthome.tuya"
# plugin if it is there, and starts the software again.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$folder = 'com.clarkyau.smarthome.sdPlugin'
$oldFolder = 'dev.smarthome.tuya.sdPlugin'
$src = Join-Path $here $folder
$root = Join-Path $env:APPDATA 'HotSpot\StreamDock'
$plugins = Join-Path $root 'plugins'
$dest = Join-Path $plugins $folder
$old = Join-Path $plugins $oldFolder
$keep = @('devices.json')
$utf8 = New-Object System.Text.UTF8Encoding($false)

Write-Host ''
Write-Host '  Smart Home plugin for Ajazz / Stream Dock' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path (Join-Path $src 'manifest.json'))) {
  Write-Host "  Can't find the '$folder' folder next to this installer." -ForegroundColor Red
  Write-Host '  Extract the whole zip first (right-click > Extract All), then run install.bat again.'
  exit 1
}

function Find-Software {
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Stream Dock*' -or $_.ProcessName -like 'StreamDock*' }
}
function Find-Exe($running) {
  foreach ($p in $running) { try { if ($p.Path -and (Test-Path $p.Path)) { return $p.Path } } catch {} }
  $roots = @(${env:ProgramFiles(x86)}, $env:ProgramFiles, "$env:LOCALAPPDATA\Programs") | Where-Object { $_ }
  foreach ($r in $roots) {
    $hit = Get-ChildItem -Path $r -Directory -Filter 'Stream Dock*' -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ChildItem -Path $_.FullName -Filter 'Stream Dock*.exe' -File -ErrorAction SilentlyContinue } |
      Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

$running = @(Find-Software)
$exe = Find-Exe $running
if ($running.Count -gt 0) {
  Write-Host '  Closing the Stream Dock software...'
  $running | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {} }
  for ($i = 0; $i -lt 20 -and @(Find-Software).Count -gt 0; $i++) { Start-Sleep -Milliseconds 250 }
  Start-Sleep -Milliseconds 800
}
New-Item -ItemType Directory -Force -Path $plugins | Out-Null

# keep the saved device list (from this plugin, or else from the old one)
$saved = @{}
foreach ($f in $keep) {
  foreach ($from in @((Join-Path $dest $f), (Join-Path $old $f))) {
    if (-not $saved.ContainsKey($f) -and (Test-Path $from)) { $saved[$f] = [System.IO.File]::ReadAllBytes($from) }
  }
}

if (Test-Path $dest) {
  $ok = $false
  for ($i = 0; $i -lt 10 -and -not $ok; $i++) { try { Remove-Item -LiteralPath $dest -Recurse -Force; $ok = $true } catch { Start-Sleep -Milliseconds 500 } }
  if (-not $ok) { Write-Host '  The old plugin files are still in use. Quit the Stream Dock software from the tray and try again.' -ForegroundColor Red; exit 1 }
}
Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
Get-ChildItem -LiteralPath $dest -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
foreach ($f in $saved.Keys) { [System.IO.File]::WriteAllBytes((Join-Path $dest $f), $saved[$f]) }

# Moving over from the old plugin (dev.smarthome.tuya)
if (Test-Path (Join-Path $old 'manifest.json')) {
  Write-Host '  Moving your keys over from the previous version...'
  $backup = Join-Path $dest 'migration-backup'
  $profiles = Join-Path $root 'profiles'
  $n = 0
  Get-ChildItem -Path $profiles -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'manifest.json*' } | ForEach-Object {
    $text = [System.IO.File]::ReadAllText($_.FullName)
    if ($text.Contains('dev.smarthome.tuya.')) {
      $b = Join-Path $backup $_.Directory.Name
      New-Item -ItemType Directory -Force -Path $b | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $b $_.Name) -Force
      [System.IO.File]::WriteAllText($_.FullName, $text.Replace('dev.smarthome.tuya.', 'com.clarkyau.smarthome.'), $utf8)
      $n++
    }
  }
  Write-Host "  Updated $n profile file(s). Copies of the originals are in migration-backup."
  # Let the old plugin start one last time to hand over its saved account
  # details; the new plugin then removes the old folder.
  Copy-Item -LiteralPath (Join-Path $dest 'plugin\bridge.js') -Destination (Join-Path $old 'plugin\index.js') -Force
  Set-Content -LiteralPath (Join-Path $old 'MOVED.txt') -Value 'This plugin moved to com.clarkyau.smarthome. This folder is removed automatically.'
}

$version = (Get-Content (Join-Path $dest 'manifest.json') -Raw | ConvertFrom-Json).Version
Write-Host "  Installed Smart Home $version to:" -ForegroundColor Green
Write-Host "  $dest"
if ($saved.Count -gt 0) { Write-Host '  Kept your saved device list.' }

if ($exe) {
  Write-Host '  Starting the Stream Dock software...'
  Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)
} else {
  Write-Host '  Start the Stream Dock software now (could not find it automatically).' -ForegroundColor Yellow
}
Write-Host ''
Write-Host '  Next: add the Setup key from the Smart Home list and enter your Tuya details there.'
Write-Host '  If Windows asks whether node.exe may use the network, choose Allow (private networks).'
