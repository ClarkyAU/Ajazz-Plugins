# Removes the iCUE Battery plugin. Closes and restarts the Stream Dock software.
$ErrorActionPreference = 'Stop'
$id = 'com.clarkyau.icuebattery.sdPlugin'
try {
    $dest = Join-Path (Join-Path $env:APPDATA 'HotSpot\StreamDock\plugins') $id
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like '*\Stream Dock AJAZZ*' })
    $exe = $null
    foreach ($p in $running) { if ($p.ProcessName -eq 'Stream Dock AJAZZ') { $exe = $p.Path } }
    if (-not $exe) {
        foreach ($c in @("${env:ProgramFiles(x86)}\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe", "$env:ProgramFiles\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe")) {
            if (Test-Path -LiteralPath $c) { $exe = $c; break }
        }
    }
    if ($running.Count -gt 0) { Write-Host 'Closing the Stream Dock software...'; $running | ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch { } }; Start-Sleep -Seconds 3 }
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force; Write-Host 'Plugin removed.' } else { Write-Host 'The plugin was not installed.' }
    if ($exe) { Write-Host 'Starting the Stream Dock software...'; Start-Process -FilePath $exe }
}
catch { Write-Host ('Problem: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }
