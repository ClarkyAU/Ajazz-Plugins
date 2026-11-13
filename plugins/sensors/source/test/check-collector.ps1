# Static checks for the Windows collector, runnable with PowerShell 7 on any OS:
#  - vitals.ps1 parses without errors
#  - Vitals.cs only uses C# 5 features (Windows PowerShell 5.1 compiles with C# 5)
#  - Vitals.cs compiles
param([string]$Dir = (Join-Path $PSScriptRoot '..' 'src' 'native'))
$ErrorActionPreference = 'Stop'
$fail = 0

$tokens = $null; $errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Dir 'vitals.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { $fail++; $errors | ForEach-Object { Write-Host "PS1 ERROR: $($_.Message) at line $($_.Extent.StartLineNumber)" } }
else { Write-Host 'vitals.ps1 parses OK' }

$src = [IO.File]::ReadAllText((Join-Path $Dir 'Vitals.cs'))
$opts = [Microsoft.CodeAnalysis.CSharp.CSharpParseOptions]::new([Microsoft.CodeAnalysis.CSharp.LanguageVersion]::CSharp5)
$tree = [Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText($src, $opts)
$diag = @($tree.GetDiagnostics() | Where-Object { $_.Severity -eq 'Error' })
if ($diag.Count) { $fail++; $diag | ForEach-Object { Write-Host "C#5 ERROR: $_" } }
else { Write-Host 'Vitals.cs is valid C# 5 syntax' }

# Full compile check (against .NET here; the Windows build uses .NET Framework).
# Language features beyond C# 5 that parse fine (e.g. nameof as an identifier) are
# caught by compiling with LangVersion 5.
$refs = @(
    [object].Assembly.Location,
    [System.Text.RegularExpressions.Regex].Assembly.Location,
    [System.Diagnostics.Process].Assembly.Location,
    [System.Net.NetworkInformation.NetworkInterface].Assembly.Location,
    [System.ComponentModel.Component].Assembly.Location,
    [Microsoft.Win32.Registry].Assembly.Location,
    [System.Runtime.InteropServices.Marshal].Assembly.Location,
    [System.Collections.Generic.Stack[int]].Assembly.Location,
    [System.Collections.Generic.HashSet[int]].Assembly.Location,
    [System.IO.DriveInfo].Assembly.Location,
    [System.Net.IPAddress].Assembly.Location,
    [System.Net.Sockets.AddressFamily].Assembly.Location
) | Sort-Object -Unique
$coreDir = Split-Path ([object].Assembly.Location)
foreach ($n in 'System.Runtime.dll','netstandard.dll','System.Collections.dll','System.Net.Primitives.dll','System.Runtime.InteropServices.dll','System.Diagnostics.Process.dll','System.ComponentModel.Primitives.dll') {
    $p = Join-Path $coreDir $n; if (Test-Path $p) { $refs += $p }
}
$mrefs = $refs | Sort-Object -Unique | ForEach-Object { [Microsoft.CodeAnalysis.MetadataReference]::CreateFromFile($_) }
$copts = [Microsoft.CodeAnalysis.CSharp.CSharpCompilationOptions]::new([Microsoft.CodeAnalysis.OutputKind]::DynamicallyLinkedLibrary)
$comp = [Microsoft.CodeAnalysis.CSharp.CSharpCompilation]::Create('SysVitalsCheck', [Microsoft.CodeAnalysis.SyntaxTree[]]@($tree), [Microsoft.CodeAnalysis.MetadataReference[]]$mrefs, $copts)
# Windows PowerShell 5.1 treats compiler warnings as errors, so warnings fail here too.
$cd = @($comp.GetDiagnostics() | Where-Object { $_.Severity -eq 'Error' -or ($_.Severity -eq 'Warning' -and $_.WarningLevel -le 4) })
if ($cd.Count) { $fail++; $cd | Select-Object -First 30 | ForEach-Object { Write-Host "COMPILE $($_.Severity.ToString().ToUpper()): $_" } }
else { Write-Host 'Vitals.cs compiles (C# 5)' }

# Things the Windows renderer/compiler dislike
if ($src -match '\$"') { $fail++; Write-Host 'C# string interpolation found' }
if ($src -match '\?\.') { Write-Host 'Note: ?. found (check it is not null-conditional)' }

exit $fail
