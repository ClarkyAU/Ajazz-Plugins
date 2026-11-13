# Applies the "right sound" patch to the Soundpad plugin from the Ajazz store (com.hotspot.soundpad).
# Closes the Stream Dock software, adds the patch, and starts the software again.
# Your keys and their settings are kept. Run it again after a store update of the Soundpad plugin.
param([string]$PluginsDir = '', [switch]$NoRestart)
$ErrorActionPreference = 'Stop'
$id = 'com.hotspot.soundpad.sdPlugin'
$src = Join-Path $PSScriptRoot $id
$marker = '"CodePathWin": "patch/index.js"'
try {
    if (-not (Test-Path -LiteralPath (Join-Path $src 'patch/index.js'))) { throw "Cannot find the patch files next to this installer: $src" }
    if (-not $PluginsDir) { $PluginsDir = Join-Path $env:APPDATA 'HotSpot\StreamDock\plugins' }
    $dest = Join-Path $PluginsDir $id
    $manifest = Join-Path $dest 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifest)) { throw "The Soundpad plugin is not installed ($dest). Install 'Soundpad Integration' from the Ajazz store first, then run this again." }

    # Check the manifest before closing anything.
    $text = [IO.File]::ReadAllText($manifest)
    $patched = $text.Contains($marker)
    if (-not $patched) {
        if ($text -match '"CodePathWin"') { throw 'This version of the Soundpad plugin is different from the one the patch was made for (it already has its own CodePathWin). Nothing was changed.' }
        if (-not ($text -match '"CodePath"\s*:\s*"SoundpadPlugin\.exe"\s*,')) { throw 'This version of the Soundpad plugin is different from the one the patch was made for (no CodePath SoundpadPlugin.exe). Nothing was changed.' }
    }

    $exe = $null
    if (-not $NoRestart) {
        $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like '*\Stream Dock AJAZZ*' })
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
        Get-Process -Name 'SoundpadPlugin' -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch { } }
    }

    Write-Host "Adding the patch to $dest"
    New-Item -ItemType Directory -Force -Path (Join-Path $dest 'patch') | Out-Null
    Copy-Item -LiteralPath (Join-Path $src 'patch/index.js') -Destination (Join-Path $dest 'patch/index.js') -Force
    foreach ($f in @('README-PATCH.txt', 'restore-original.bat')) {
        if (Test-Path -LiteralPath (Join-Path $src $f)) { Copy-Item -LiteralPath (Join-Path $src $f) -Destination (Join-Path $dest $f) -Force }
    }

    if ($patched) {
        Write-Host 'The manifest was already patched; the helper was updated.'
    } else {
        # Keep the store's manifest so uninstall can put it back exactly.
        Copy-Item -LiteralPath $manifest -Destination (Join-Path $dest 'manifest.original.json') -Force
        $nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
        $add = '"CodePath": "SoundpadPlugin.exe",' + $nl + '  ' + $marker + ',' + $nl + '  "Nodejs": {' + $nl + '    "Version": "20"' + $nl + '  },'
        $new = [regex]::Replace($text, '"CodePath"\s*:\s*"SoundpadPlugin\.exe"\s*,', $add.Replace('$', '$$'), 1)
        $null = $new | ConvertFrom-Json
        [IO.File]::WriteAllText($manifest, $new, (New-Object Text.UTF8Encoding $false))
        Write-Host 'Manifest patched (the original is saved as manifest.original.json).'
    }

    if ($NoRestart) { }
    elseif ($exe) { Write-Host 'Starting the Stream Dock software...'; Start-Process -FilePath $exe }
    else { Write-Host 'Could not find the Stream Dock software to start it. Please start it yourself.' }
    Write-Host ''
    Write-Host 'Done. Your Soundpad keys now play the right sound even after you change the list in Soundpad.'
}
catch {
    Write-Host ''
    Write-Host ('Problem: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
