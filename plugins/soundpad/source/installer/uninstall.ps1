# Removes the "right sound" patch: puts the Soundpad plugin's own manifest back and deletes the helper.
# The Soundpad plugin itself and your keys stay. Closes and restarts the Stream Dock software.
param([string]$PluginsDir = '', [switch]$NoRestart)
$ErrorActionPreference = 'Stop'
$id = 'com.hotspot.soundpad.sdPlugin'
try {
    if (-not $PluginsDir) { $PluginsDir = Join-Path $env:APPDATA 'HotSpot\StreamDock\plugins' }
    $dest = Join-Path $PluginsDir $id
    $manifest = Join-Path $dest 'manifest.json'
    $original = Join-Path $dest 'manifest.original.json'
    if (-not (Test-Path -LiteralPath $manifest)) { Write-Host 'The Soundpad plugin is not installed. Nothing to do.'; exit 0 }

    $exe = $null
    if (-not $NoRestart) {
        $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like '*\Stream Dock AJAZZ*' })
        foreach ($p in $running) { if ($p.ProcessName -eq 'Stream Dock AJAZZ') { $exe = $p.Path } }
        if (-not $exe) {
            foreach ($c in @("${env:ProgramFiles(x86)}\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe", "$env:ProgramFiles\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe")) {
                if (Test-Path -LiteralPath $c) { $exe = $c; break }
            }
        }
        if ($running.Count -gt 0) { Write-Host 'Closing the Stream Dock software...'; $running | ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch { } }; Start-Sleep -Seconds 3 }
        Get-Process -Name 'SoundpadPlugin' -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch { } }
    }

    $text = [IO.File]::ReadAllText($manifest)
    if (Test-Path -LiteralPath $original) {
        if ($text.Contains('"CodePathWin": "patch/index.js"')) { Copy-Item -LiteralPath $original -Destination $manifest -Force; Write-Host 'Original manifest put back.' }
        else { Write-Host 'The manifest is not patched (maybe a store update replaced it); left as it is.' }
        Remove-Item -LiteralPath $original -Force
    } elseif ($text.Contains('"CodePathWin": "patch/index.js"')) {
        $new = [regex]::Replace($text, '\s*"CodePathWin": "patch/index\.js",\s*"Nodejs":\s*\{\s*"Version":\s*"20"\s*\},', '')
        [IO.File]::WriteAllText($manifest, $new, (New-Object Text.UTF8Encoding $false))
        Write-Host 'Patch lines removed from the manifest.'
    }
    foreach ($f in @('patch', 'README-PATCH.txt', 'restore-original.bat')) {
        $p = Join-Path $dest $f
        if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
    }
    Write-Host 'Patch removed.'
    if ($exe) { Write-Host 'Starting the Stream Dock software...'; Start-Process -FilePath $exe }
}
catch { Write-Host ('Problem: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }
