param([ValidateSet('install', 'uninstall')][string]$Mode = 'install')
# Installs or removes the TrueNAS plugin for the Ajazz Stream Dock software.
# Uses only built-in Windows PowerShell. Your key layouts and plugin settings are
# kept by the Stream Dock software itself, so they survive a reinstall.

$ErrorActionPreference = 'Stop'
$PluginId = 'com.clarkyau.truenas.sdPlugin'
# Earlier versions used this folder name; it is removed on install/uninstall.
$OldPluginIds = @('com.homelab.truenas.sdPlugin')
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$MemoryFile = Join-Path $env:LOCALAPPDATA 'TrueNAS-StreamDock\streamdock-path.txt'

function Say([string]$Text, [string]$Color = 'Gray') { Write-Host $Text -ForegroundColor $Color }
function Fail([string]$Text) { Say ''; Say $Text 'Red'; exit 1 }

Say ''
if ($Mode -eq 'install') { Say 'Installing the TrueNAS plugin for Stream Dock' 'Cyan' }
else { Say 'Removing the TrueNAS plugin from Stream Dock' 'Cyan' }
Say ''

# ---------------------------------------------------------------- plugins folder
function Find-PluginsFolder {
  $default = Join-Path $env:APPDATA 'HotSpot\StreamDock\plugins'
  if (Test-Path $default) { return $default }
  $found = Get-ChildItem -Path $env:APPDATA -Directory -Recurse -Depth 3 -Filter 'plugins' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'StreamDock' } | Select-Object -First 1
  if ($found) { return $found.FullName }
  $base = Join-Path $env:APPDATA 'HotSpot\StreamDock'
  if (Test-Path $base) {
    New-Item -ItemType Directory -Force -Path $default | Out-Null
    return $default
  }
  return $null
}

# ---------------------------------------------------------------- the software
function Get-StreamDockProcesses {
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $n = $_.ProcessName
    $p = $null
    try { $p = $_.Path } catch { }
    ($n -notmatch '^(powershell|pwsh|cmd|conhost|explorer)$') -and (
      ($n -match 'Stream ?Dock') -or ($p -and ($p -match '\\[^\\]*Stream ?Dock[^\\]*\\')))
  }
}

function Find-StreamDockExe($procs) {
  # 1. the running app
  $main = $procs | Where-Object { $_.ProcessName -match 'Stream ?Dock' } | Select-Object -First 1
  if ($main) { try { if ($main.Path) { return $main.Path } } catch { } }
  # 2. remembered from an earlier install
  if (Test-Path $MemoryFile) {
    $p = (Get-Content $MemoryFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($p -and (Test-Path $p)) { return $p }
  }
  # 3. installed programs list
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')
  foreach ($k in $keys) {
    $apps = Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Stream ?Dock' }
    foreach ($a in $apps) {
      if ($a.DisplayIcon) {
        $icon = ($a.DisplayIcon -replace ',\s*-?\d+$', '').Trim('"')
        if ($icon -match '\.exe$' -and (Test-Path $icon) -and ($icon -notmatch 'unins')) { return $icon }
      }
      if ($a.InstallLocation -and (Test-Path $a.InstallLocation)) {
        $exe = Get-ChildItem -Path $a.InstallLocation -Filter '*.exe' -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -match 'Stream ?Dock' -and $_.Name -notmatch 'unins' } | Select-Object -First 1
        if ($exe) { return $exe.FullName }
      }
    }
  }
  # 4. usual install folders
  foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA 'Programs'))) {
    if (-not $root) { continue }
    $exe = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Stream ?Dock|AJAZZ|HotSpot' } |
      ForEach-Object { Get-ChildItem -Path $_.FullName -Filter '*.exe' -Recurse -Depth 1 -ErrorAction SilentlyContinue } |
      Where-Object { $_.Name -match 'Stream ?Dock' -and $_.Name -notmatch 'unins' } | Select-Object -First 1
    if ($exe) { return $exe.FullName }
  }
  return $null
}

function Stop-StreamDock {
  $procs = @(Get-StreamDockProcesses)
  $exe = Find-StreamDockExe $procs
  # also stop any copy of this plugin that is still running
  $ids = @($PluginId) + $OldPluginIds
  $plugin = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $cl = $_.CommandLine; $cl -and ($ids | Where-Object { $cl -match [regex]::Escape($_) }) })
  if ($procs.Count -gt 0) {
    Say 'Closing the Stream Dock software...'
    foreach ($p in $procs) { try { $p.CloseMainWindow() | Out-Null } catch { } }
    Start-Sleep -Milliseconds 1500
    Get-StreamDockProcesses | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch { } }
  }
  foreach ($p in $plugin) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch { } }
  for ($i = 0; $i -lt 20; $i++) {
    if (@(Get-StreamDockProcesses).Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
  }
  Start-Sleep -Milliseconds 500
  if ($exe) {
    try {
      New-Item -ItemType Directory -Force -Path (Split-Path $MemoryFile) | Out-Null
      Set-Content -Path $MemoryFile -Value $exe -Encoding UTF8
    } catch { }
  }
  return @{ Exe = $exe; WasRunning = ($procs.Count -gt 0) }
}

function Start-StreamDock($info) {
  if ($info.Exe -and (Test-Path $info.Exe)) {
    Say 'Starting the Stream Dock software...'
    Start-Process -FilePath $info.Exe -WorkingDirectory (Split-Path $info.Exe) | Out-Null
  } else {
    Say 'Please start the Stream Dock software yourself (I could not find it).' 'Yellow'
  }
}

# ---------------------------------------------------------------- main
$plugins = Find-PluginsFolder
if (-not $plugins) {
  Fail "I couldn't find the Stream Dock software's plugins folder.`nIs the AJAZZ Stream Dock software installed and has it been opened at least once?"
}
$dest = Join-Path $plugins $PluginId
function Remove-OldVersions {
  foreach ($old in $OldPluginIds) {
    $p = Join-Path $plugins $old
    if (Test-Path $p) {
      try { Remove-Item -Path $p -Recurse -Force; Say "Removed the old copy ($old)." }
      catch { Say "Could not remove the old copy in $p - please delete that folder yourself." 'Yellow' }
    }
  }
}

if ($Mode -eq 'install') {
  $src = Join-Path $Here $PluginId
  if (-not (Test-Path (Join-Path $src 'manifest.json'))) {
    Fail "The plugin files are missing next to install.bat.`nPlease extract (unzip) the whole download first, then run install.bat from the extracted folder."
  }
  $info = Stop-StreamDock
  try {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    # Replace the program files; keep the log and icon cache.
    foreach ($item in @('plugin', 'pi', 'static', 'manifest.json', 'en.json')) {
      $p = Join-Path $dest $item
      if (Test-Path $p) { Remove-Item -Path $p -Recurse -Force }
    }
    Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force
    Get-ChildItem -Path $dest -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
  } catch {
    Say $_.Exception.Message 'Red'
    Start-StreamDock $info
    Fail 'Install failed. Nothing else was changed.'
  }
  Remove-OldVersions
  Say "Installed to $dest" 'Green'
  Start-StreamDock $info
  Say ''
  Say 'Done! In the Stream Dock software, find the "TrueNAS" group, drag a key' 'Green'
  Say 'onto your deck, then enter your TrueNAS address and API key in its settings.' 'Green'
} else {
  $anyOld = @($OldPluginIds | Where-Object { Test-Path (Join-Path $plugins $_) }).Count -gt 0
  if (-not (Test-Path $dest) -and -not $anyOld) {
    Say 'The TrueNAS plugin is not installed. Nothing to remove.' 'Yellow'
    exit 0
  }
  $info = Stop-StreamDock
  try {
    Remove-OldVersions
    if (Test-Path $dest) { Remove-Item -Path $dest -Recurse -Force }
  } catch {
    Say $_.Exception.Message 'Red'
    Start-StreamDock $info
    Fail 'Could not remove every file. Close the Stream Dock software from the tray and try again.'
  }
  Say 'The TrueNAS plugin has been removed.' 'Green'
  Start-StreamDock $info
}
exit 0
