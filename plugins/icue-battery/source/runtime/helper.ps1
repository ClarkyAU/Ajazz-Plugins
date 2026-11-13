# iCUE Battery helper, started by the plugin with Windows PowerShell 5.1 (built into Windows).
# Compiles Helper.cs once (cached as a DLL next to this script), then prints one JSON line per
# change to stdout. It only READS from the devices. Exits when the plugin closes stdin.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = $utf8 } catch { }
function Say([string]$level, [string]$msg) {
    $m = $msg.Replace('\', '\\').Replace('"', '\"').Replace("`r", ' ').Replace("`n", ' ')
    [Console]::Out.WriteLine('{"type":"log","level":"' + $level + '","msg":"' + $m + '"}'); [Console]::Out.Flush()
}
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([IntPtr]::Size -ne 8) { Say 'error' 'This needs 64-bit PowerShell.'; exit 4 }
if (-not (Test-Path -LiteralPath (Join-Path $here 'iCUESDK.x64_2019.dll'))) { Say 'error' 'iCUESDK.x64_2019.dll is missing from the runtime folder.'; exit 5 }
try { $src = [IO.File]::ReadAllText((Join-Path $here 'Helper.cs')) } catch { Say 'error' ('Cannot read Helper.cs: ' + $_.Exception.Message); exit 2 }
$sha = [Security.Cryptography.SHA1]::Create()
$hash = -join ($sha.ComputeHash($utf8.GetBytes($src + [IntPtr]::Size + $PSVersionTable.PSVersion)) | Select-Object -First 6 | ForEach-Object { $_.ToString('x2') })
$dll = Join-Path $here ('IcueBattery-' + $hash + '.dll')
$t0 = [Diagnostics.Stopwatch]::StartNew()
$loaded = $false
if (Test-Path -LiteralPath $dll) {
    try { Add-Type -LiteralPath $dll; $loaded = $true } catch { Say 'warn' ('Cached helper could not load, rebuilding: ' + $_.Exception.Message) }
}
if (-not $loaded) {
    try {
        Get-ChildItem -LiteralPath $here -Filter 'IcueBattery-*.dll' -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -ne $dll } | ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Force } catch { } }
    } catch { }
    try {
        Add-Type -TypeDefinition $src -Language CSharp -OutputAssembly $dll -OutputType Library -IgnoreWarnings
        if (-not ('IcueBattery.Helper' -as [type])) { Add-Type -LiteralPath $dll }
        $loaded = $true
    } catch {
        Say 'warn' ('Could not save the helper build, compiling in memory: ' + $_.Exception.Message)
        try { Add-Type -TypeDefinition $src -Language CSharp -IgnoreWarnings; $loaded = $true }
        catch { Say 'error' ('Helper failed to compile: ' + $_.Exception.Message); exit 3 }
    }
}
Say 'info' ('Helper ready in ' + $t0.ElapsedMilliseconds + ' ms (PowerShell ' + $PSVersionTable.PSVersion + ')')
# Experimental, read only: also log what the iCUE icon in the notification area says. Separate compile so a failure here changes nothing else.
try {
    $traySrc = [IO.File]::ReadAllText((Join-Path $here 'Tray.cs'))
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
    Add-Type -TypeDefinition $traySrc -Language CSharp -ReferencedAssemblies 'UIAutomationClient', 'UIAutomationTypes', 'WindowsBase' -IgnoreWarnings
    [IcueBattery.Tray]::Start()
} catch { Say 'warn' ('Tray reader not started: ' + $_.Exception.Message) }
try { [IcueBattery.Helper]::Run($here) }
catch { Say 'error' ('Helper stopped: ' + $_.Exception.Message); exit 6 }
