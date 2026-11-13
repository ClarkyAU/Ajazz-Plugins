# Installs or removes __NAME__ for the Ajazz Stream Dock software.
# Parameters (all optional):
#   -PluginsDir  where plugins live (default: %APPDATA%\HotSpot\StreamDock\plugins)
#   -NoRestart   do not print the restart reminder
#   -Yes         do not ask for confirmation
#   -Uninstall   remove the plugin but keep saved settings and readings (the data folder)
param(
  [string]$PluginsDir = (Join-Path $env:APPDATA 'HotSpot\StreamDock\plugins'),
  [switch]$NoRestart,
  [switch]$Yes,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$Id = '__ID__'
$Name = '__NAME__'
# Folder names this plugin used before a rename. The installer removes them. Example: @('com.clarkyau.oldname')
$OldIds = @()
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Source = Join-Path $Here ($Id + '.sdPlugin')
$Target = Join-Path $PluginsDir ($Id + '.sdPlugin')
$Keep = @('data', 'settings.json', 'plugin.log', 'plugin.log.old')

function Confirm-Step([string]$Question) {
  if ($Yes) { return $true }
  $answer = Read-Host ($Question + ' (Y/N)')
  return ($answer -match '^[Yy]')
}

if ($Uninstall) {
  if (-not (Test-Path -LiteralPath $Target)) { Write-Host "$Name is not installed in $PluginsDir."; exit 0 }
  if (-not (Confirm-Step "Remove $Name from $PluginsDir? Your saved settings stay.")) { Write-Host 'Cancelled.'; exit 0 }
  Get-ChildItem -LiteralPath $Target -Force | Where-Object { $Keep -notcontains $_.Name } | ForEach-Object {
    try { Remove-Item -LiteralPath $_.FullName -Recurse -Force } catch { Write-Host ("Could not remove " + $_.Name + " (in use). Restart the Stream Dock software and run this again.") }
  }
  Write-Host "$Name removed. Saved data kept in: $(Join-Path $Target 'data')"
  if (-not $NoRestart) { Write-Host 'Now restart the Stream Dock software (tray icon: Quit, then open it again).' }
  exit 0
}

if (-not (Test-Path -LiteralPath $Source)) { throw "Cannot find $Source. Unzip the whole download first." }
if (-not (Test-Path -LiteralPath $PluginsDir)) { throw "Plugins folder not found: $PluginsDir. Is the Stream Dock software installed?" }
if (-not (Confirm-Step "Install $Name into $PluginsDir?")) { Write-Host 'Cancelled.'; exit 0 }

foreach ($old in $OldIds) {
  $oldPath = Join-Path $PluginsDir ($old + '.sdPlugin')
  if (Test-Path -LiteralPath $oldPath) {
    try { Remove-Item -LiteralPath $oldPath -Recurse -Force; Write-Host "Removed old folder $old" }
    catch { Set-Content -LiteralPath (Join-Path $oldPath 'MOVED.txt') -Value "Replaced by $Id" -Encoding ASCII }
  }
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null
# Copy over the top (files in use are still replaced), then drop files this version no longer has.
Copy-Item -Path (Join-Path $Source '*') -Destination $Target -Recurse -Force
$newFiles = @{}
Get-ChildItem -LiteralPath $Source -Recurse -File | ForEach-Object { $newFiles[$_.FullName.Substring($Source.Length).Replace('/', '\')] = $true }
Get-ChildItem -LiteralPath $Target -Recurse -File -Force | ForEach-Object {
  $rel = $_.FullName.Substring($Target.Length).Replace('/', '\')
  $top = ($rel.TrimStart('\') -split '\\')[0]
  if (($Keep -notcontains $top) -and (-not $newFiles.ContainsKey($rel))) {
    try { Remove-Item -LiteralPath $_.FullName -Force } catch { }
  }
}
Write-Host "$Name installed in $Target"
if (-not $NoRestart) { Write-Host 'Now restart the Stream Dock software (tray icon: Quit, then open it again).' }
