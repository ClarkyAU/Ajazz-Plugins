# Installer for the Now Playing plugin (com.clarkyau.nowplaying) for the
# Ajazz / Stream Dock software. Run it through install.bat or uninstall.bat.
#
# Keys of earlier versions (dev.nowplaying.deck, and the single
# com.clarkyau.nowplaying.display key) are moved to the current keys on every
# profile page (a backup of each changed page is kept in the plugin's
# migration-backup folder), their settings are carried over, and the old
# dev.nowplaying.deck folder is removed.
param(
    [switch]$Uninstall,
    [string]$PluginsDir = '',   # for testing: use this plugins folder
    [switch]$NoRestart,         # for testing: don't stop/start the software
    [switch]$Yes                # don't wait for Enter
)

$ErrorActionPreference = 'Stop'
$pluginName = 'com.clarkyau.nowplaying.sdPlugin'
$newId = 'com.clarkyau.nowplaying'
$oldId = 'dev.nowplaying.deck'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here $pluginName
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail($text) { Say ''; Say $text 'Red'; exit 1 }

Say ''
if ($Uninstall) { Say '  Now Playing - uninstall' 'Cyan' } else { Say '  Now Playing - install' 'Cyan' }
Say '  -----------------------' 'Cyan'
Say ''

if (-not $Uninstall -and -not (Test-Path (Join-Path $src 'manifest.json'))) {
    Fail ("The plugin files were not found next to this installer.`n" +
          "Extract the whole zip first (right-click the zip > Extract All),`n" +
          "then run install.bat from the extracted folder.")
}

# --- 1. Find the Stream Dock plugins folder ----------------------------------
$pluginsDir = $PluginsDir
if (-not $pluginsDir) {
    $preferred = Join-Path $env:APPDATA 'HotSpot\StreamDock\plugins'
    if (Test-Path $preferred) { $pluginsDir = $preferred }
    else {
        $found = Get-ChildItem -Path $env:APPDATA -Directory -Recurse -Depth 3 -Filter 'plugins' -ErrorAction SilentlyContinue |
            Where-Object { $_.Parent.Name -match 'Stream ?Dock' } | Select-Object -First 1
        if ($found) { $pluginsDir = $found.FullName }
    }
}
if (-not $pluginsDir) {
    Say 'Could not find the Ajazz software''s plugins folder.' 'Yellow'
    Say 'Make sure the Ajazz software is installed and has been opened at least once.'
    $typed = Read-Host 'Paste the plugins folder path (or press Enter to cancel)'
    if (-not $typed) { Fail 'Cancelled. Nothing was changed.' }
    $pluginsDir = $typed.Trim('"', ' ')
    if (-not (Test-Path $pluginsDir)) { Fail "That folder does not exist: $pluginsDir" }
}
Say "Plugins folder: $pluginsDir"
$dest = Join-Path $pluginsDir $pluginName
$oldDir = Join-Path $pluginsDir "$oldId.sdPlugin"
$profilesDir = Join-Path (Split-Path -Parent $pluginsDir) 'profiles'

if ($Uninstall -and -not (Test-Path $dest)) { Fail 'Now Playing is not installed. Nothing to remove.' }

# --- 2. Close the software (it locks plugin files and rewrites profiles) -----
$appExe = $null
if (-not $NoRestart) {
    $procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Id -ne $PID -and $_.Path -and $_.Path -match 'StreamDock|Stream Dock|HotSpot' -and
        $_.ProcessName -notmatch '^(node|powershell|pwsh|conhost|cmd)$'
    })
    if ($procs.Count -gt 0) {
        $main = $procs | Where-Object { $_.ProcessName -match 'Stream ?Dock' } | Select-Object -First 1
        if (-not $main) { $main = $procs | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
        if (-not $main) { $main = $procs[0] }
        $appExe = $main.Path
        Say ''
        Say 'The Ajazz software is running. It will be closed now and started again afterwards.' 'Yellow'
        if (-not $Yes) { $null = Read-Host 'Press Enter to continue (or close this window to cancel)' }
        $procs | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch { } }
    }
    # Leftover plugin processes (Node and PowerShell helpers) of either version.
    try {
        Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object { $_.ProcessId -ne $PID -and ($_.CommandLine -like "*$newId*" -or $_.CommandLine -like "*$oldId*") } |
            ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { } }
    } catch { }
    Start-Sleep -Seconds 2
}

function Remove-Folder($path) {
    for ($i = 0; $i -lt 6; $i++) {
        try { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop; return $true }
        catch { Start-Sleep -Seconds 1 }
    }
    return $false
}

# --- Settings carried over from earlier versions -----------------------------
#   v1  dev.nowplaying.deck.*            (one set of shared settings, from its log)
#   v2  com.clarkyau.nowplaying.display  (one action for everything)
function Pick($value, $allowed, $default) { if ($allowed -contains $value) { return $value } else { return $default } }
function PickColour($value, $default) {
    if ([string]$value -match '^#?([0-9a-fA-F]{6})$') { return '#' + $Matches[1].ToLower() } else { return $default }
}
# $s: an object with this plugin's setting names (v1 settings are renamed first)
function NewSettings($action, $s) {
    switch ($action) {
        'art' { return [ordered]@{ v = 3; join = ($s.join -ne $false); press = Pick $s.press @('playpause', 'next', 'none') 'playpause' } }
        'info' {
            return [ordered]@{
                v = 3; show = Pick $s.show @('auto', 'titleartist', 'title', 'artist', 'line', 'album', 'player') 'auto'; join = ($s.join -ne $false)
                size = Pick $s.size @('small', 'medium', 'large') 'medium'
                scroll = Pick $s.scroll @('off', 'slow', 'normal', 'fast') 'normal'
                titleColor = PickColour $s.titleColor '#ffffff'
                artistColor = PickColour $s.artistColor '#b4b4c0'
                background = Pick $s.background @('dark', 'tinted') 'dark'
                press = Pick $s.press @('playpause', 'next', 'none') 'playpause'
            }
        }
        'time' {
            return [ordered]@{ v = 3; time = Pick $s.time @('remaining', 'elapsed') 'remaining'; titleColor = PickColour $s.titleColor '#ffffff'
                background = Pick $s.background @('dark', 'tinted') 'dark'; press = Pick $s.press @('playpause', 'next', 'none') 'playpause' }
        }
        'progress' {
            return [ordered]@{ v = 3; join = ($s.join -ne $false); background = Pick $s.background @('dark', 'tinted') 'dark'
                press = Pick $s.press @('playpause', 'next', 'none') 'playpause' }
        }
        default {
            return [ordered]@{ v = 3; style = Pick $s.style @('glow', 'flat') 'glow'; color = Pick $s.color @('art', 'custom') 'art'
                customColor = PickColour $s.customColor '#7888ff' }
        }
    }
}
$actionNames = @{ art = 'Album Art'; info = 'Track Info'; time = 'Time'; progress = 'Progress Bar'; playpause = 'Play / Pause';
    prev = 'Previous Track'; next = 'Next Track'; voldown = 'Volume Down'; volup = 'Volume Up'; mute = 'Mute' }
$controls = @('playpause', 'prev', 'next', 'voldown', 'volup', 'mute')

# Returns @(newAction, settingsObject) for an old key, or $null.
function Convert-Key($uuid, $settings, $v1) {
    if ($uuid.StartsWith("$oldId.")) {
        $a = $uuid.Substring($oldId.Length + 1)
        $s = [pscustomobject]@{ size = $v1.textSize; scroll = $v1.scrollSpeed; titleColor = $v1.titleColor; artistColor = $v1.artistColor
            background = $v1.textBackground; press = $v1.artPress; style = $v1.controlStyle; color = $v1.controlColor; customColor = $v1.customColor; join = $true; show = 'auto' }
        switch ($a) {
            'art' { return @('art', $s) }
            'title' { $s.show = 'title'; return @('info', $s) }
            'artist' { $s.show = 'artist'; return @('info', $s) }
            'combined' { return @('info', $s) }
            default { if ($controls -contains $a) { return @($a, $s) } else { return $null } }
        }
    }
    if ($uuid -eq "$newId.display") {
        $show = [string]$settings.show
        if (-not $show -or $show -eq 'auto') { $show = 'art' }   # Automatic keys were album art
        $s = [pscustomobject]@{ show = $show; join = $settings.join; size = $settings.size; scroll = $settings.scroll
            titleColor = $settings.titleColor; artistColor = $settings.artistColor; background = $settings.background
            press = $settings.press; time = $settings.time }
        if ($show -eq 'art' -or $show -eq 'time' -or $show -eq 'progress') { return @($show, $s) }
        return @('info', $s)
    }
    return $null
}

function Move-OldKeys {
    if (-not (Test-Path $profilesDir)) { return }
    # The previous version logged its settings each time they changed; the last line wins.
    $old = [pscustomobject]@{}
    $logFile = Join-Path $oldDir 'nowplaying.log'
    if (Test-Path $logFile) {
        foreach ($line in (Get-Content -LiteralPath $logFile -Encoding UTF8)) {
            if ($line -match ' settings (\{.*\})\s*$') { try { $old = $Matches[1] | ConvertFrom-Json } catch { } }
        }
    }
    $backupRoot = Join-Path $dest 'migration-backup'
    $movedKeys = 0
    foreach ($man in (Get-ChildItem -LiteralPath $profilesDir -Recurse -Filter 'manifest.json' -File -ErrorAction SilentlyContinue)) {
        $text = [System.IO.File]::ReadAllText($man.FullName, $utf8)
        if ($text -notmatch [regex]::Escape("`"$oldId.") -and $text -notmatch [regex]::Escape("`"$newId.display`"")) { continue }
        try { $json = $text | ConvertFrom-Json } catch { Say "  Skipped $($man.Directory.Name) (could not read it)" 'Yellow'; continue }
        $changed = 0
        foreach ($prop in @($json.Actions.PSObject.Properties)) {
            $a = $prop.Value
            if (-not ($a.UUID -is [string])) { continue }
            $conv = Convert-Key $a.UUID $a.Settings $old
            if (-not $conv) { continue }
            $new = $conv[0]
            $a.UUID = "$newId.$new"
            $a.Name = $actionNames[$new]
            $a.Settings = [pscustomobject](NewSettings $new $conv[1])
            $a.State = 0
            $a.States = @([pscustomobject][ordered]@{ Image = "static/$new.png"; TitleAlignment = 'bottom'; FontSize = '10'; ShowTitle = $false })
            $changed++
        }
        if ($changed -eq 0) { continue }
        $backup = Join-Path $backupRoot $man.Directory.Name
        New-Item -ItemType Directory -Force -Path $backup | Out-Null
        Copy-Item -LiteralPath $man.FullName -Destination (Join-Path $backup 'manifest.json') -Force
        [System.IO.File]::WriteAllText($man.FullName, ($json | ConvertTo-Json -Depth 50), $utf8)
        $movedKeys += $changed
        Say "  Moved $changed key(s) on profile page '$($json.Name)'"
    }
    if ($movedKeys -gt 0) { Say "Moved $movedKeys key(s) from an earlier version (backups in migration-backup)." 'Green' }
    if (Test-Path $oldDir) {
        if (Remove-Folder $oldDir) { Say 'Removed the previous version (dev.nowplaying.deck).' }
        else { Say 'Could not remove the previous version yet; the plugin will remove it after the restart.' 'Yellow' }
    }
}

# --- 3. Install, update or remove --------------------------------------------
if ($Uninstall) {
    if (-not (Remove-Folder $dest)) { Fail "Could not remove $dest - a file is still in use. Restart your PC and try again." }
    Say ''
    Say 'Now Playing has been removed.' 'Green'
}
else {
    $isUpdate = Test-Path $dest
    $backupKeep = $null
    if ($isUpdate) {
        # keep earlier migration backups
        $mb = Join-Path $dest 'migration-backup'
        if (Test-Path $mb) { $backupKeep = Join-Path ([System.IO.Path]::GetTempPath()) "np-migration-backup-$PID"; Copy-Item -LiteralPath $mb -Destination $backupKeep -Recurse -Force }
        if (-not (Remove-Folder $dest)) { Fail "Could not replace $dest - a file is still in use. Restart your PC and try again." }
    }
    Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
    if ($backupKeep) { Copy-Item -LiteralPath $backupKeep -Destination (Join-Path $dest 'migration-backup') -Recurse -Force; Remove-Item -LiteralPath $backupKeep -Recurse -Force -ErrorAction SilentlyContinue }
    try { Get-ChildItem -LiteralPath $dest -Recurse -File | Unblock-File -ErrorAction SilentlyContinue } catch { }
    Move-OldKeys
    Say ''
    if ($isUpdate) { Say 'Now Playing has been updated. Your keys and settings are kept.' 'Green' }
    else { Say 'Now Playing has been installed.' 'Green' }
}

# --- 4. Start the software again ---------------------------------------------
if ($NoRestart) { exit 0 }
if ($appExe -and (Test-Path $appExe)) {
    Say 'Starting the Ajazz software...'
    Start-Process -FilePath $appExe -WorkingDirectory (Split-Path -Parent $appExe)
}
else { Say 'Now open the Ajazz software.' }
if (-not $Uninstall) {
    Say ''
    Say 'Find "Now Playing" in the action list and drag it onto your keys.' 'White'
    Say 'Click a key to choose what it shows. See README.txt for ideas.' 'White'
}
