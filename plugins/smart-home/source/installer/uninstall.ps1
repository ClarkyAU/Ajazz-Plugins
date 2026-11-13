# Removes the Smart Home plugin from the Ajazz / Stream Dock software.
$ErrorActionPreference = 'Stop'
$folder = 'com.clarkyau.smarthome.sdPlugin'
$dest = Join-Path (Join-Path $env:APPDATA 'HotSpot\StreamDock\plugins') $folder

Write-Host ''
Write-Host '  Smart Home plugin - uninstall' -ForegroundColor Cyan
Write-Host ''
if (-not (Test-Path $dest)) { Write-Host '  The plugin is not installed.'; exit 0 }

$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Stream Dock*' -or $_.ProcessName -like 'StreamDock*' })
$exe = $null
foreach ($p in $running) { try { if ($p.Path) { $exe = $p.Path; break } } catch {} }
if ($running.Count -gt 0) {
  Write-Host '  Closing the Stream Dock software...'
  $running | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {} }
  Start-Sleep -Seconds 2
}
$ok = $false
for ($i = 0; $i -lt 10 -and -not $ok; $i++) {
  try { Remove-Item -LiteralPath $dest -Recurse -Force; $ok = $true } catch { Start-Sleep -Milliseconds 500 }
}
if ($ok) { Write-Host '  Removed.' -ForegroundColor Green } else { Write-Host "  Could not remove $dest - quit the software from the tray and try again." -ForegroundColor Red }
if ($exe) { Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) }
