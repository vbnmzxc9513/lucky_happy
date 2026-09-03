param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')]
    [string]$Domain,

    [ValidatePattern('^[0-9]{4,12}$')]
    [string]$StaffAccessCode = '1009',

    [switch]$RunStress
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverUrl = "https://$Domain"

Push-Location $projectRoot
try {
    Write-Host "Checking production deployment: $serverUrl"
    $env:STAFF_ACCESS_CODE = $StaffAccessCode
    npm run deploy:check
    if ($LASTEXITCODE -ne 0) { throw 'Deployment file validation failed.' }

    npm run preflight -- --url $serverUrl
    if ($LASTEXITCODE -ne 0) { throw 'Public preflight failed.' }

    if ($RunStress) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $report = Join-Path $projectRoot "reports/public-150-$stamp.json"
        npm run stress -- --url $serverUrl --clients 150 --tapRate 5 --answerRate 0.98 --reconnectClients 15 --reconnectAtQuiz 5 --maxSeconds 720 --enforceDuration true --report $report
        if ($LASTEXITCODE -ne 0) { throw 'Public 150-player stress test failed.' }
        Write-Host "Stress report: $report"
    }

    Write-Host 'Public deployment verification passed.'
}
finally {
    Remove-Item Env:STAFF_ACCESS_CODE -ErrorAction SilentlyContinue
    Pop-Location
}
