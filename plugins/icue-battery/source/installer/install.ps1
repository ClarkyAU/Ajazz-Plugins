# Installs (or updates) the iCUE Battery plugin for the Ajazz Stream Dock software.
# Closes the software, copies the plugin in (your key settings are kept: they live in the software,
# not in the plugin), and starts the software again.
$ErrorActionPreference = 'Stop'
$id = 'com.clarkyau.icuebattery.sdPlugin'
$src = Join-Path $PSScriptRoot $id
try {
    if (-not (Test-Path -LiteralPath $src)) { throw "Cannot find the plugin folder next to this installer: $src" }
    $plugins = Join-Path $env:APPDATA 'HotSpot\StreamDock\plugins'
    if (-not (Test-Path -LiteralPath $plugins)) { throw "Cannot find the Ajazz plugins folder ($plugins). Start the Stream Dock AJAZZ software once, then run this again." }

    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like '*\Stream Dock AJAZZ*' })
    $exe = $null
    foreach ($p in $running) { if ($p.ProcessName -eq 'Stream Dock AJAZZ') { $exe = $p.Path } }
    if (-not $exe) {
        foreach ($c in @("${env:ProgramFiles(x86)}\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe", "$env:ProgramFiles\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe")) {
            if (Test-Path -LiteralPath $c) { $exe = $c; break }
        }
    }
    if ($running.Count -gt 0) {
        Write-Host 'Closing the Stream Dock software...'
        $running | ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch { } }
        Start-Sleep -Seconds 3
    }

    $dest = Join-Path $plugins $id
    Write-Host "Copying the plugin to $dest"
    & robocopy $src $dest /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy code $LASTEXITCODE)." }

    if ($exe) { Write-Host 'Starting the Stream Dock software...'; Start-Process -FilePath $exe }
    else { Write-Host 'Could not find the Stream Dock software to start it. Please start it yourself.' }
    Write-Host ''
    Write-Host 'Done. In the software, add the iCUE Battery "Setup" key first, then the "Device" keys.'
}
catch {
    Write-Host ''
    Write-Host ('Problem: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
