$ErrorActionPreference = 'Stop'
$npmRoot = (& npm.cmd root -g).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate global npm packages' }
$entry = Join-Path $npmRoot '@deepseek-ai\dsh\lib\bin.js'
if (!(Test-Path -LiteralPath $entry)) { throw 'Install @deepseek-ai/dsh globally first' }
$running = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains($entry) -and $_.CommandLine.Contains('--port 3080')
}
if ($running) { exit 0 }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$data = Join-Path $dshHome 'dsh-pet'
New-Item -ItemType Directory -Path $data -Force | Out-Null
Start-Process -FilePath $node -ArgumentList @(('"' + $entry + '"'), 'web', '--no-open', '--host', '127.0.0.1', '--port', '3080') -WorkingDirectory $env:USERPROFILE -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'host.log') -RedirectStandardError (Join-Path $data 'host-error.log')
