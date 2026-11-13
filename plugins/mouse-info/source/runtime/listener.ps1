# Mouse Info listener, started by the plugin with Windows PowerShell 5.1 (built into Windows).
# Compiles Listener.cs once (cached as a DLL next to this script), then prints one JSON line per
# event to stdout. It only LISTENS to mice; it never sends them commands. Exits when the plugin
# closes stdin.
param([int]$BtSeconds = 60)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = $utf8 } catch { }
function Say([string]$level, [string]$msg) {
    $m = $msg.Replace('\', '\\').Replace('"', '\"').Replace("`r", ' ').Replace("`n", ' ')
    [Console]::Out.WriteLine('{"type":"log","level":"' + $level + '","msg":"' + $m + '"}'); [Console]::Out.Flush()
}
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
try { $src = [IO.File]::ReadAllText((Join-Path $here 'Listener.cs')) } catch { Say 'error' ("Cannot read Listener.cs: " + $_.Exception.Message); exit 2 }
$sha = [Security.Cryptography.SHA1]::Create()
$hash = -join ($sha.ComputeHash($utf8.GetBytes($src + [IntPtr]::Size + $PSVersionTable.PSVersion)) | Select-Object -First 6 | ForEach-Object { $_.ToString('x2') })
$dll = Join-Path $here ('MouseInfo-' + $hash + '.dll')
$t0 = [Diagnostics.Stopwatch]::StartNew()
$loaded = $false
if (Test-Path -LiteralPath $dll) {
    try { Add-Type -LiteralPath $dll; $loaded = $true } catch { Say 'warn' ('Cached listener could not load, rebuilding: ' + $_.Exception.Message) }
}
if (-not $loaded) {
    try {
        Get-ChildItem -LiteralPath $here -Filter 'MouseInfo-*.dll' -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -ne $dll } | ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Force } catch { } }
    } catch { }
    try {
        Add-Type -TypeDefinition $src -Language CSharp -OutputAssembly $dll -OutputType Library -IgnoreWarnings
        if (-not ('MouseInfo.Listener' -as [type])) { Add-Type -LiteralPath $dll }
        $loaded = $true
    } catch {
        Say 'warn' ('Could not save the listener build, compiling in memory: ' + $_.Exception.Message)
        try { Add-Type -TypeDefinition $src -Language CSharp -IgnoreWarnings; $loaded = $true }
        catch { Say 'error' ('Listener failed to compile: ' + $_.Exception.Message); exit 3 }
    }
}
Say 'info' ('Listener ready in ' + $t0.ElapsedMilliseconds + ' ms (PowerShell ' + $PSVersionTable.PSVersion + ', ' + ([IntPtr]::Size * 8) + '-bit)')
[MouseInfo.Listener]::Run($BtSeconds)
