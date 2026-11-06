param([int]$ApplicationPid)
$ErrorActionPreference = 'Stop'
$all = @(Get-CimInstance Win32_Process)
$owned = [Collections.Generic.HashSet[int]]::new()
[void]$owned.Add($ApplicationPid)
do {
    $count = $owned.Count
    foreach ($entry in $all) {
        if ($owned.Contains([int]$entry.ParentProcessId)) { [void]$owned.Add([int]$entry.ProcessId) }
    }
} while ($owned.Count -gt $count)
$processes = @($owned | ForEach-Object { Get-Process -Id $_ })
Add-Type -TypeDefinition 'using System; using System.Threading.Tasks; public static class ProcessSamplerInput { public static Task<string> ReadLine() { return Task.Run(() => Console.In.ReadLine()); } }'
$watch = [Diagnostics.Stopwatch]::StartNew()
$phase = 'ready'
$inputTask = [ProcessSamplerInput]::ReadLine()
[Console]::WriteLine((@{kind='ready';pids=@($owned);processes=@($all | Where-Object {$owned.Contains([int]$_.ProcessId)} | ForEach-Object { $kind='browser';if($_.ProcessId -eq $ApplicationPid){$kind='native'}elseif($_.CommandLine -match '--type=([^\s"]+)'){$kind=$Matches[1]};@{pid=[int]$_.ProcessId;kind=$kind} });logicalProcessors=[Environment]::ProcessorCount} | ConvertTo-Json -Compress -Depth 4))
while ($true) {
    if ($inputTask.IsCompleted) {
        $line = $inputTask.GetAwaiter().GetResult()
        if ($null -eq $line -or $line -eq 'stop') { break }
        $phase = $line
        $inputTask = [ProcessSamplerInput]::ReadLine()
    }
    $cpu = 0.0; $working = 0L; $private = 0L; $nativeCpu = 0.0; $nativePrivate = 0L
    $parts = @()
    foreach ($process in $processes) {
        $process.Refresh()
        $cpu += $process.TotalProcessorTime.TotalMilliseconds
        $working += $process.WorkingSet64
        $private += $process.PrivateMemorySize64
        $parts += @{pid=$process.Id;cpuMs=$process.TotalProcessorTime.TotalMilliseconds;privateBytes=$process.PrivateMemorySize64}
        if ($process.Id -eq $ApplicationPid) {
            $nativeCpu = $process.TotalProcessorTime.TotalMilliseconds
            $nativePrivate = $process.PrivateMemorySize64
        }
    }
    [Console]::WriteLine((@{kind='sample';phase=$phase;ms=$watch.Elapsed.TotalMilliseconds;cpuMs=$cpu;workingBytes=$working;privateBytes=$private;nativeCpuMs=$nativeCpu;nativePrivateBytes=$nativePrivate;processes=$parts} | ConvertTo-Json -Compress -Depth 4))
    Start-Sleep -Milliseconds 200
}
foreach ($process in $processes) { $process.Dispose() }
