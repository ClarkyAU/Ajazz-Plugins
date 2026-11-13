# Compile-check Helper.cs as C# 5 (what Windows PowerShell 5.1 understands). Run with pwsh 7.
param([string]$Path = (Join-Path $PSScriptRoot '..\runtime\Helper.cs'))
$src = [IO.File]::ReadAllText($Path)
$asmDir = [IO.Path]::GetDirectoryName([object].Assembly.Location)
Add-Type -Path (Join-Path $PSHOME 'Microsoft.CodeAnalysis.dll'), (Join-Path $PSHOME 'Microsoft.CodeAnalysis.CSharp.dll')
$opts = New-Object Microsoft.CodeAnalysis.CSharp.CSharpParseOptions([Microsoft.CodeAnalysis.CSharp.LanguageVersion]::CSharp5)
$tree = [Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText($src, $opts)
$refs = [Microsoft.CodeAnalysis.MetadataReference[]]@(foreach ($n in 'System.Private.CoreLib','System.Runtime','System.Console','System.Collections','System.Threading','System.Threading.Thread','System.Runtime.InteropServices','System.Text.Encoding.Extensions','System.Memory','System.Linq','netstandard') {
    $p = Join-Path $asmDir ($n + '.dll'); if (Test-Path $p) { [Microsoft.CodeAnalysis.MetadataReference]::CreateFromFile($p) }
})
$comp = [Microsoft.CodeAnalysis.CSharp.CSharpCompilation]::Create('chk', [Microsoft.CodeAnalysis.SyntaxTree[]]@($tree), $refs, (New-Object Microsoft.CodeAnalysis.CSharp.CSharpCompilationOptions([Microsoft.CodeAnalysis.OutputKind]::DynamicallyLinkedLibrary)))
$bad = 0
if ($null -eq $comp) { Write-Host 'compile setup failed'; exit 2 }
foreach ($d in $comp.GetDiagnostics()) {
    if ($d.Severity -eq 'Error' -or $d.Severity -eq 'Warning') { Write-Host ($d.Severity.ToString() + ' ' + $d.Id + ' ' + $d.GetMessage() + ' @' + $d.Location.GetLineSpan().StartLinePosition.Line); if ($d.Severity -eq 'Error') { $bad++ } }
}
if ($bad -eq 0) { Write-Host 'C# 5 check OK' } else { exit 1 }
