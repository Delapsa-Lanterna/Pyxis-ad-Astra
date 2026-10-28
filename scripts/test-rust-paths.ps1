[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Long", "Short", "Beyond260")]
    [string]$PathForm,
    [switch]$Strict,
    [switch]$KeepFailed
)

$ErrorActionPreference = "Stop"
$originalLocation = Get-Location
try {
    Set-Location -LiteralPath ([System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, "..")))
    $testArguments = @("scripts/test-rust.mjs", "--path-form", $PathForm)
    if ($Strict) { $testArguments += "--strict" }
    if ($KeepFailed) { $testArguments += "--keep-failed" }
    & node @testArguments
    $testExitCode = $LASTEXITCODE
}
finally {
    Set-Location -LiteralPath $originalLocation.Path
}
exit $testExitCode
