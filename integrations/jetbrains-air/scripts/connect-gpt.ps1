$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$data = Join-Path $dshHome 'dsh-pet'
$log = Get-Content (Join-Path $data 'host.log') -Raw -Encoding utf8
$urls = [regex]::Matches($log, 'http://127\.0\.0\.1:3080/\?token=\S+')
if (!$urls.Count) { throw 'Start DSH first.' }
$null = Invoke-WebRequest $urls[$urls.Count - 1].Value -UseBasicParsing -SessionVariable petSession -TimeoutSec 10
$result = Invoke-RestMethod 'http://127.0.0.1:3080/dsh-pet-7340/quota/login' -Method Post -Body '{}' -ContentType 'application/json' -WebSession $petSession -TimeoutSec 35
$url = [Uri]$result.authUrl
if ($url.Scheme -ne 'https' -or $url.Host -notin @('auth.openai.com','chatgpt.com')) { throw 'Unexpected authorization origin.' }
Start-Process -FilePath $url.AbsoluteUri
Write-Output 'Browser authorization opened. Select the account shown in Air. Fatfish will compare identities after authorization.'
