# Parse-check a PowerShell script and compile its embedded C# as C# 5 (Windows PowerShell 5.1 level).
param([string]$File)
$t = Get-Content -Raw $File
$tok = $null; $err = $null
$null = [System.Management.Automation.Language.Parser]::ParseInput($t, [ref]$tok, [ref]$err)
"parse errors: " + $err.Count; $err | ForEach-Object { $_.ToString() }
$m = [regex]::Match($t, "(?s)@'\r?\n(.*?)\r?\n'@").Groups[1].Value
if (-not $m) { "no embedded C#"; exit }
Add-Type -AssemblyName Microsoft.CodeAnalysis, Microsoft.CodeAnalysis.CSharp
$opt = New-Object Microsoft.CodeAnalysis.CSharp.CSharpParseOptions([Microsoft.CodeAnalysis.CSharp.LanguageVersion]::CSharp5)
$tree = [Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText($m, $opt)
$refs = @([object].Assembly.Location, [System.Linq.Enumerable].Assembly.Location, [System.Collections.Generic.List[int]].Assembly.Location,
  [System.Runtime.InteropServices.Marshal].Assembly.Location) + @([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.Location -and ($_.GetName().Name -in 'System.Runtime','netstandard','System.Collections','System.Runtime.InteropServices','System.Text.Encoding.Extensions') } | ForEach-Object Location)
$mr = $refs | Select-Object -Unique | ForEach-Object { [Microsoft.CodeAnalysis.MetadataReference]::CreateFromFile($_) }
$co = New-Object Microsoft.CodeAnalysis.CSharp.CSharpCompilationOptions([Microsoft.CodeAnalysis.OutputKind]::DynamicallyLinkedLibrary)
$c = [Microsoft.CodeAnalysis.CSharp.CSharpCompilation]::Create('chk', [Microsoft.CodeAnalysis.SyntaxTree[]]@($tree), [Microsoft.CodeAnalysis.MetadataReference[]]@($mr), $co)
$ms = New-Object IO.MemoryStream
$r = $c.Emit($ms)
"C#5 compile ok: " + $r.Success
$r.Diagnostics | Where-Object { $_.Severity -ne 'Hidden' } | ForEach-Object { $_.ToString() }
