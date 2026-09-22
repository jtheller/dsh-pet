$ErrorActionPreference = 'Stop'
$mutex = New-Object Threading.Mutex($false, 'Local\DshPetVisibilityToggle')
$locked = $false
try {
    $locked = $mutex.WaitOne(0)
    if (!$locked) { exit 0 }
    $dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$data = Join-Path $dshHome 'dsh-pet'
    $log = Get-Content (Join-Path $data 'host.log') -Raw -Encoding utf8
    $urls = [regex]::Matches($log, 'http://127\.0\.0\.1:3080/\?token=\S+')
    if (!$urls.Count) { throw 'Start DSH using the Start Pet shortcut first.' }
    $null = Invoke-WebRequest $urls[$urls.Count - 1].Value -UseBasicParsing -SessionVariable petSession -TimeoutSec 10
    $endpoint = 'http://127.0.0.1:3080/dsh-pet-7340/config'
    $config = Invoke-RestMethod $endpoint -WebSession $petSession -TimeoutSec 10
    $pets = @($config.main.pets)
    $pet = $pets | Where-Object { $_.id -eq 'main' } | Select-Object -First 1
    if (!$pet) { throw 'The main pet was not found.' }
    $statePath = Join-Path $data 'visibility-previous.txt'
    if ($pet.display -eq 'none') {
        $previous = 'desktop'
        if (Test-Path -LiteralPath $statePath) {
            $saved = (Get-Content $statePath -Raw).Trim()
            if ($saved -in @('desktop', 'both', 'web')) { $previous = $saved }
        }
        $pet.display = $previous
    } else {
        [IO.File]::WriteAllText($statePath, $pet.display)
        $pet.display = 'none'
    }
    $body = [Text.Encoding]::UTF8.GetBytes((@{pets = $pets} | ConvertTo-Json -Depth 20))
    $result = Invoke-RestMethod $endpoint -Method Put -WebSession $petSession -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 15
    $actual = $result.main.pets | Where-Object { $_.id -eq 'main' } | Select-Object -First 1
    if ($actual.display -ne $pet.display) { throw 'Visibility update was not applied.' }
    Write-Output ('Pet display: ' + $actual.display)
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show('Could not toggle the pet. Make sure DSH is running, then try again.', 'DSH Pet')
    Write-Error $_
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
