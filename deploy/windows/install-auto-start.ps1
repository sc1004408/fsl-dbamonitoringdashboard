$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$startCmd = Join-Path $repoRoot 'deploy\windows\start-local-prod.cmd'

if (-not (Test-Path $startCmd)) {
  throw "Missing file: $startCmd"
}

$startupFolder = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$shortcutPath = Join-Path $startupFolder 'DB Monitoring AI - Start.lnk'

$shell = New-Object -ComObject WScript.Shell
$cmdExe = Join-Path $env:WINDIR 'System32\cmd.exe'

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $cmdExe
$shortcut.Arguments = "/c `"$startCmd`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = 'Auto-start DB Monitoring AI local production app'
$shortcut.IconLocation = "$cmdExe,0"
$shortcut.Save()

Write-Host "Auto-start shortcut created: $shortcutPath"