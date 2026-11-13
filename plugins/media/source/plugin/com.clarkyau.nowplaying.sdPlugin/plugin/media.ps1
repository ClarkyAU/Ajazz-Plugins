# Now Playing helper for the com.clarkyau.nowplaying plugin (Ajazz / Stream Dock).
#
# Reads the current Windows media session (the same one shown in the Windows
# volume flyout) and prints one JSON object per line to stdout:
#   {"type":"state", "title":..., "artist":..., "album":..., "status":..., "app":...,
#    "duration": seconds (0 = unknown), "position": seconds, "updated": unix ms}
#   {"type":"art",   "key":..., "mime":..., "data":"<base64>"}
#   {"type":"error", "message":...}
# Accepts one command per line on stdin:
#   playpause | next | prev | volup | voldown | mute
#
# Works with any player that integrates with Windows media controls
# (Spotify, browsers, Apple Music, foobar2000, VLC, etc.). No login needed.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$out = [Console]::Out
function Emit($obj) {
    $json = ConvertTo-Json -InputObject $obj -Compress -Depth 3
    $out.WriteLine($json)
    $out.Flush()
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime

    # Volume keys are sent as media key presses, exactly like a keyboard's volume keys.
    Add-Type -Namespace NowPlaying -Name Keys -MemberDefinition @'
[DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
public static void Tap(byte vk) {
    keybd_event(vk, 0, 1, System.UIntPtr.Zero);
    keybd_event(vk, 0, 3, System.UIntPtr.Zero);
}
'@

    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionTimelineProperties, Windows.Media.Control, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime]
}
catch {
    Emit @{ type = 'error'; message = "Startup failed: $($_.Exception.Message)" }
    exit 1
}

# WinRT async calls are awaited by converting them to .NET tasks.
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($op, [Type]$resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    if (-not $task.Wait(5000)) { throw 'Timed out waiting for Windows media API' }
    return $task.Result
}

$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

# The artwork stream comes back as an untyped WinRT object, which PowerShell
# cannot pass to .NET methods itself ("Cannot find an overload for
# AsStreamForRead"). Calling through reflection lets .NET do the conversion.
$miAsStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
$piStreamSize = [Windows.Storage.Streams.IRandomAccessStream].GetProperty('Size')
$miGetInputStreamAt = [Windows.Storage.Streams.IRandomAccessStream].GetMethod('GetInputStreamAt')
$ciDataReader = [Windows.Storage.Streams.DataReader].GetConstructor([Type[]]@([Windows.Storage.Streams.IInputStream]))
$miDispose = [System.IDisposable].GetMethod('Dispose')

function Read-Art($props) {
    $ref = $props.Thumbnail
    if ($null -eq $ref) { return $null }
    $stream = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if ($null -eq $stream) { return $null }
    try {
        $bytes = $null
        try {
            $netStream = $miAsStreamForRead.Invoke($null, @($stream))
            $mem = New-Object System.IO.MemoryStream
            $netStream.CopyTo($mem)
            $bytes = $mem.ToArray()
        }
        catch {
            # Fallback: read the stream with a DataReader instead.
            $size = [uint32]$piStreamSize.GetValue($stream)
            if ($size -gt 0) {
                $inStream = $miGetInputStreamAt.Invoke($stream, @([uint64]0))
                $reader = $ciDataReader.Invoke(@($inStream))
                $null = Await ($reader.LoadAsync($size)) ([uint32])
                $bytes = New-Object byte[] $size
                $reader.ReadBytes($bytes)
                $reader.Dispose()
            }
        }
        if ($null -eq $bytes -or $bytes.Length -eq 0) { return $null }
        return @{ mime = 'image'; bytes = $bytes }
    }
    finally { try { $miDispose.Invoke($stream, $null) } catch { } }
}

function Send-Command($cmd) {
    switch ($cmd) {
        'volup'   { [NowPlaying.Keys]::Tap(0xAF); return }
        'voldown' { [NowPlaying.Keys]::Tap(0xAE); return }
        'mute'    { [NowPlaying.Keys]::Tap(0xAD); return }
    }
    $session = $manager.GetCurrentSession()
    if ($null -eq $session) {
        # Nothing registered with Windows: fall back to the keyboard media keys.
        switch ($cmd) {
            'playpause' { [NowPlaying.Keys]::Tap(0xB3) }
            'next'      { [NowPlaying.Keys]::Tap(0xB0) }
            'prev'      { [NowPlaying.Keys]::Tap(0xB1) }
        }
        return
    }
    switch ($cmd) {
        'playpause' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
        'next'      { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
        'prev'      { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
    }
}

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$pendingLine = $stdin.ReadLineAsync()

$lastStateJson = ''
$lastTrackKey = $null
$lastArtHash = ''
$artAttempts = 0
$md5 = [System.Security.Cryptography.MD5]::Create()
$lastErrorAt = [DateTime]::MinValue

while ($true) {
    # Handle any commands the plugin has sent.
    while ($pendingLine.IsCompleted) {
        $line = $pendingLine.Result
        if ($null -eq $line) { exit 0 }   # plugin went away
        $pendingLine = $stdin.ReadLineAsync()
        try { Send-Command ($line.Trim().ToLowerInvariant()) }
        catch { Emit @{ type = 'error'; message = "Command '$line' failed: $($_.Exception.Message)" } }
    }

    try {
        $session = $manager.GetCurrentSession()
        if ($null -eq $session) {
            $state = [ordered]@{ type = 'state'; status = 'none'; title = ''; artist = ''; album = ''; app = ''; duration = 0; position = 0; updated = 0 }
            $trackKey = ''
            $props = $null
        }
        else {
            $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            $status = $session.GetPlaybackInfo().PlaybackStatus.ToString().ToLowerInvariant()
            $artist = [string]$props.Artist
            if (-not $artist) { $artist = [string]$props.AlbumArtist }
            $state = [ordered]@{
                type   = 'state'
                status = $status
                title  = [string]$props.Title
                artist = $artist
                album  = [string]$props.AlbumTitle
                app    = [string]$session.SourceAppUserModelId
                duration = 0
                position = 0
                updated  = 0
            }
            # Song position and length. Players only report these now and then,
            # so the plugin counts on from "updated" while playing.
            try {
                $tl = $session.GetTimelineProperties()
                $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds
                if ($dur -gt 0) {
                    $state.duration = [math]::Round($dur, 1)
                    $state.position = [math]::Round(($tl.Position - $tl.StartTime).TotalSeconds, 1)
                    $state.updated  = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
                }
            }
            catch { }
            $trackKey = "$($state.app)|$($state.title)|$($state.artist)|$($state.album)"
        }

        $stateJson = ConvertTo-Json -InputObject $state -Compress
        if ($stateJson -ne $lastStateJson) {
            $out.WriteLine($stateJson); $out.Flush()
            $lastStateJson = $stateJson
        }

        if ($trackKey -ne $lastTrackKey) {
            $lastTrackKey = $trackKey
            # Players often publish the new title before the new artwork, so keep
            # re-checking the artwork for a few seconds after every track change.
            $artAttempts = 12
            if ($trackKey -eq '') {
                $lastArtHash = ''
                Emit @{ type = 'art'; key = ''; mime = ''; data = '' }
                $artAttempts = 0
            }
        }

        if ($artAttempts -gt 0 -and $null -ne $props) {
            $artAttempts--
            $art = Read-Art $props
            $hash = if ($null -eq $art) { 'none' } else { [BitConverter]::ToString($md5.ComputeHash($art.bytes)) }
            if ($hash -ne $lastArtHash) {
                $lastArtHash = $hash
                if ($null -eq $art) {
                    Emit @{ type = 'art'; key = $trackKey; mime = ''; data = '' }
                }
                else {
                    Emit @{ type = 'art'; key = $trackKey; mime = $art.mime; data = [Convert]::ToBase64String($art.bytes) }
                }
            }
        }
    }
    catch {
        # Media sessions can vanish mid-call when a player closes; report at most every 10 s.
        if (([DateTime]::Now - $lastErrorAt).TotalSeconds -gt 10) {
            $lastErrorAt = [DateTime]::Now
            Emit @{ type = 'error'; message = "$($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" }
        }
    }

    # Wait up to 400 ms, but wake immediately if a button press arrives.
    $null = $pendingLine.Wait(400)
}
