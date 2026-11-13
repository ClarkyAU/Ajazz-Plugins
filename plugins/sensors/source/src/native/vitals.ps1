# System Vitals collector for the Ajazz / Stream Dock plugin.
#
# Started by the plugin with Windows PowerShell 5.1 (built into Windows).
# Compiles Vitals.cs once (cached as a DLL next to this script), then prints one
# JSON line per second to stdout. Reads commands from stdin, one per line:
#   need gpu=1 top=0 sensors=1     which optional readings are wanted
#   interval 1000                  milliseconds between samples
# Exits when the plugin closes stdin or the parent process is gone.

param(
    [int]$ParentPid = 0,
    [string]$CacheDir = ''
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = $utf8 } catch { }
try { [Console]::InputEncoding = $utf8 } catch { }
$out = [Console]::Out

function Emit([string]$line) {
    $out.WriteLine($line)
    $out.Flush()
}
function Say([string]$level, [string]$msg) {
    $m = $msg.Replace('\', '\\').Replace('"', '\"').Replace("`r", ' ').Replace("`n", ' ')
    Emit ('{"type":"log","level":"' + $level + '","msg":"' + $m + '"}')
}

# ---------------------------------------------------------------- compile
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $CacheDir) { $CacheDir = $here }
$srcPath = Join-Path $here 'Vitals.cs'
try {
    $src = [IO.File]::ReadAllText($srcPath)
} catch {
    Say 'error' ("Cannot read Vitals.cs: " + $_.Exception.Message)
    exit 2
}

$sha = [Security.Cryptography.SHA1]::Create()
$hash = -join ($sha.ComputeHash($utf8.GetBytes($src + [IntPtr]::Size + $PSVersionTable.PSVersion)) | Select-Object -First 6 | ForEach-Object { $_.ToString('x2') })
$dll = Join-Path $CacheDir ("SysVitals-" + $hash + ".dll")

$loaded = $false
$t0 = [Diagnostics.Stopwatch]::StartNew()
if (Test-Path -LiteralPath $dll) {
    try {
        Add-Type -LiteralPath $dll
        $loaded = $true
    } catch {
        Say 'warn' ("Cached collector could not load, rebuilding: " + $_.Exception.Message)
    }
}
if (-not $loaded) {
    # Remove stale builds from older versions.
    try {
        Get-ChildItem -LiteralPath $CacheDir -Filter 'SysVitals-*.dll' -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -ne $dll } |
            ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop } catch { } }
    } catch { }
    try {
        Add-Type -TypeDefinition $src -Language CSharp -OutputAssembly $dll -OutputType Library -IgnoreWarnings
        if (-not ('SysVitals.Collector' -as [type])) { Add-Type -LiteralPath $dll }
        $loaded = $true
    } catch {
        Say 'warn' ("Could not save the collector build, compiling in memory: " + $_.Exception.Message)
        try {
            Add-Type -TypeDefinition $src -Language CSharp -IgnoreWarnings
            $loaded = $true
        } catch {
            Say 'error' ("Collector failed to compile: " + $_.Exception.Message)
            exit 3
        }
    }
}
Say 'info' ("Collector ready in " + $t0.ElapsedMilliseconds + " ms (PowerShell " + $PSVersionTable.PSVersion + ", " + ([IntPtr]::Size * 8) + "-bit)")

$c = New-Object SysVitals.Collector

# ---------------------------------------------------------------- LibreHardwareMonitor / OpenHardwareMonitor
$extNext = [DateTime]::MinValue
$extFails = 0
$extWorking = ''
function Read-External {
    foreach ($ns in @('root/LibreHardwareMonitor', 'root/OpenHardwareMonitor')) {
        try {
            $hw = @(Get-CimInstance -Namespace $ns -ClassName Hardware -OperationTimeoutSec 2 -ErrorAction Stop)
            $sens = @(Get-CimInstance -Namespace $ns -ClassName Sensor -OperationTimeoutSec 2 -ErrorAction Stop)
            if ($sens.Count -eq 0) { continue }
            $name = if ($ns -like '*Libre*') { 'LibreHardwareMonitor' } else { 'OpenHardwareMonitor' }
            $c.BeginExternal($name)
            foreach ($h in $hw) { $c.AddExternalHardware([string]$h.Identifier, [string]$h.Name) }
            foreach ($s in $sens) {
                if ($null -eq $s.Value) { continue }
                $c.AddExternalSensor([string]$s.Identifier, [string]$s.Parent, [string]$s.Name, [string]$s.SensorType, [double]$s.Value)
            }
            $c.EndExternal()
            return $name
        } catch { }
    }
    return ''
}

# ---------------------------------------------------------------- main loop
# A plain StreamReader: Console.In's ReadLineAsync blocks until a line arrives.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$pending = $stdin.ReadLineAsync()
$n = 0
while ($true) {
    $sw = [Diagnostics.Stopwatch]::StartNew()

    # commands from the plugin
    $closed = $false
    while ($pending.IsCompleted) {
        if ($pending.IsFaulted) { $closed = $true; break }
        $line = $pending.Result
        if ($null -eq $line) { $closed = $true; break }
        if ($line.Trim() -eq 'quit') { $closed = $true; break }
        try { $c.Command($line) } catch { Say 'warn' ("Bad command: " + $line) }
        $pending = $stdin.ReadLineAsync()
    }
    if ($closed) { break }

    # sensors from LibreHardwareMonitor / OpenHardwareMonitor (only when a key wants them)
    if ($c.WantExternal -and [DateTime]::UtcNow -ge $extNext) {
        $got = Read-External
        if ($got) {
            $extFails = 0
            $extNext = [DateTime]::UtcNow.AddSeconds(2)
            $extWorking = $got
        } else {
            if ($extWorking) { Say 'info' ($extWorking + ' stopped sharing sensors'); $extWorking = ''; $c.ClearExternal() }
            $extFails++
            $extNext = [DateTime]::UtcNow.AddSeconds([Math]::Min(30, 5 * $extFails))
        }
    }

    try {
        foreach ($l in $c.Tick()) { Emit $l }
    } catch {
        Say 'warn' ("Sample failed: " + $_.Exception.Message)
    }

    $n++
    if ($ParentPid -gt 0 -and ($n % 5) -eq 0) {
        if (-not [SysVitals.Collector]::ProcessAlive($ParentPid)) { break }
    }

    $wait = $c.IntervalMs - [int]$sw.ElapsedMilliseconds
    if ($wait -gt 5) { Start-Sleep -Milliseconds $wait }
}
