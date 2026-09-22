$ErrorActionPreference = 'Stop'
$npmRoot = (& npm.cmd root -g).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate global npm packages' }
$entry = Join-Path $npmRoot '@deepseek-ai\dsh\lib\bin.js'
if (!(Test-Path -LiteralPath $entry)) { throw 'Install @deepseek-ai/dsh globally first' }
$processes = @(Get-CimInstance Win32_Process)
$roots = $processes | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($entry) -and $_.CommandLine.Contains('--port 3080')
}
function Stop-PetTree([uint32]$processId) {
    foreach ($child in $processes | Where-Object { $_.ParentProcessId -eq $processId }) {
        Stop-PetTree $child.ProcessId
    }
    Stop-Process -Id $processId -ErrorAction SilentlyContinue
}
foreach ($root in $roots) { Stop-PetTree $root.ProcessId }
