[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Long", "Short")]
    [string]$PathForm
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CircinusTestPathNames {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetLongPathName(string path, StringBuilder buffer, uint capacity);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetShortPathName(string path, StringBuilder buffer, uint capacity);
}
'@

$testDirectory = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "circinus_rust_path_tests_" + [Guid]::NewGuid().ToString("N"))
[System.IO.Directory]::CreateDirectory($testDirectory) | Out-Null
$longBuffer = [System.Text.StringBuilder]::new(32768)
$shortBuffer = [System.Text.StringBuilder]::new(32768)
$longLength = [CircinusTestPathNames]::GetLongPathName($testDirectory, $longBuffer, 32768)
$shortLength = [CircinusTestPathNames]::GetShortPathName($testDirectory, $shortBuffer, 32768)
if ($longLength -eq 0 -or $shortLength -eq 0 -or $longLength -ge 32768 -or $shortLength -ge 32768) {
    throw "Windows path fixture failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
$longPath = $longBuffer.ToString()
$shortPath = $shortBuffer.ToString()
if ($longPath.Equals($shortPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The test volume did not provide an actual 8.3 alias: $longPath"
}
$expandedBuffer = [System.Text.StringBuilder]::new(32768)
$expandedLength = [CircinusTestPathNames]::GetLongPathName($shortPath, $expandedBuffer, 32768)
if ($expandedLength -eq 0 -or -not $expandedBuffer.ToString().Equals($longPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The short path does not resolve to the test directory."
}
$originalTemp = $env:TEMP
$originalTmp = $env:TMP
$originalLocation = Get-Location
$testClock = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $env:TEMP = if ($PathForm -eq "Long") { $longPath } else { $shortPath }
    $env:TMP = $env:TEMP
    Set-Location -LiteralPath ([System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, "..")))
    Write-Output "Rust path environment: $PathForm; TEMP=$env:TEMP; long=$longPath; short=$shortPath"
    & cargo test --manifest-path src-tauri/Cargo.toml
    $testExitCode = $LASTEXITCODE
    $testClock.Stop()
    Write-Output ("RUST_PATH_RESULT mode={0} exit={1} seconds={2:F3}" -f $PathForm, $testExitCode, $testClock.Elapsed.TotalSeconds)
}
finally {
    $env:TEMP = $originalTemp
    $env:TMP = $originalTmp
    Set-Location -LiteralPath $originalLocation.Path
    $expectedDirectory = [System.IO.Path]::GetFullPath($testDirectory)
    $cleanupBuffer = [System.Text.StringBuilder]::new(32768)
    $cleanupLength = [CircinusTestPathNames]::GetLongPathName($expectedDirectory, $cleanupBuffer, 32768)
    if ($cleanupLength -eq 0 -or -not $cleanupBuffer.ToString().Equals($longPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Test directory cleanup identity changed: $expectedDirectory"
    }
    Remove-Item -LiteralPath $longPath -Recurse -Force
}
exit $testExitCode
