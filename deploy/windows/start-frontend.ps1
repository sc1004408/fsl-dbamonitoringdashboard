$ErrorActionPreference = 'Stop'
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
Set-Location 'C:\Users\sc1004408\db-monitoring-ai'

if (!(Test-Path '.\logs')) {
  New-Item -Path '.\logs' -ItemType Directory | Out-Null
}

$existing = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Stop-Process -Id $existing.OwningProcess -Force -ErrorAction SilentlyContinue
}

Start-Process -FilePath 'C:\Program Files\nodejs\npx.cmd' `
  -ArgumentList 'serve -s apps/frontend/dist -l 8090' `
  -WorkingDirectory 'C:\Users\sc1004408\db-monitoring-ai' `
  -RedirectStandardOutput 'C:\Users\sc1004408\db-monitoring-ai\logs\frontend.out.log' `
  -RedirectStandardError 'C:\Users\sc1004408\db-monitoring-ai\logs\frontend.err.log' `
  -WindowStyle Hidden
