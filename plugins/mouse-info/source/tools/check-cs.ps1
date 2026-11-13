# Compile a C# file as C# 5 with Roslyn (the language level Windows PowerShell 5.1 Add-Type accepts).
param([string]$File)
$m = Get-Content -Raw $File
Add-Type -AssemblyName Microsoft.CodeAnalysis, Microsoft.CodeAnalysis.CSharp
$opt = New-Object Microsoft.CodeAnalysis.CSharp.CSharpParseOptions([Microsoft.CodeAnalysis.CSharp.LanguageVersion]::CSharp5)
$tree = [Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText($m, $opt)
$dir = [IO.Path]::GetDirectoryName([object].Assembly.Location)
$mr = Get-ChildItem $dir -Filter 'System*.dll' | Where-Object { $_.Name -notmatch 'Native' } | ForEach-Object { try { [Microsoft.CodeAnalysis.MetadataReference]::CreateFromFile($_.FullName) } catch { } }
$mr += [Microsoft.CodeAnalysis.MetadataReference]::CreateFromFile((Join-Path $dir 'netstandard.dll'))
$co = (New-Object Microsoft.CodeAnalysis.CSharp.CSharpCompilationOptions([Microsoft.CodeAnalysis.OutputKind]::DynamicallyLinkedLibrary)).WithWarningLevel(4)
$c = [Microsoft.CodeAnalysis.CSharp.CSharpCompilation]::Create('chk', [Microsoft.CodeAnalysis.SyntaxTree[]]@($tree), [Microsoft.CodeAnalysis.MetadataReference[]]@($mr), $co)
$r = $c.Emit((New-Object IO.MemoryStream))
$d = @($r.Diagnostics | Where-Object { $_.Severity -ne 'Hidden' })
"C#5 compile ok: " + $r.Success + ", warnings/errors: " + $d.Count
$d | ForEach-Object { $_.ToString() }
if (-not $r.Success -or $d.Count) { exit 1 }
