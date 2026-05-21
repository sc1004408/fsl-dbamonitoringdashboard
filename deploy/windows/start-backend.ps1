$ErrorActionPreference = 'Stop'
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
Set-Location 'C:\Users\sc1004408\db-monitoring-ai'

if (!(Test-Path '.\logs')) {
  New-Item -Path '.\logs' -ItemType Directory | Out-Null
}

$existing = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Stop-Process -Id $existing.OwningProcess -Force -ErrorAction SilentlyContinue
}

Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' `
  -ArgumentList 'apps/backend/dist/server.js' `
  -WorkingDirectory 'C:\Users\sc1004408\db-monitoring-ai' `
  -RedirectStandardOutput 'C:\Users\sc1004408\db-monitoring-ai\logs\backend.out.log' `
  -RedirectStandardError 'C:\Users\sc1004408\db-monitoring-ai\logs\backend.err.log' `
  -WindowStyle Hidden
