$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$startCmd = Join-Path $repoRoot 'deploy\windows\start-local-prod.cmd'
$stopCmd = Join-Path $repoRoot 'deploy\windows\stop-local-prod.cmd'

if (-not (Test-Path $startCmd)) {
  throw "Missing file: $startCmd"
}

if (-not (Test-Path $stopCmd)) {
  throw "Missing file: $stopCmd"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$startMenuPrograms = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$folderName = 'DB Monitoring AI'
$startMenuFolder = Join-Path $startMenuPrograms $folderName

if (-not (Test-Path $startMenuFolder)) {
  New-Item -Path $startMenuFolder -ItemType Directory | Out-Null
}

$shell = New-Object -ComObject WScript.Shell

function New-AppShortcut {
  param(
    [Parameter(Mandatory = $true)] [string] $ShortcutPath,
    [Parameter(Mandatory = $true)] [string] $TargetPath,
    [Parameter(Mandatory = $true)] [string] $Arguments,
    [Parameter(Mandatory = $true)] [string] $WorkingDirectory,
    [Parameter(Mandatory = $true)] [string] $Description
  )

  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = $Description
  $shortcut.IconLocation = "$TargetPath,0"
  $shortcut.Save()
}

$cmdExe = Join-Path $env:WINDIR 'System32\cmd.exe'

$desktopStart = Join-Path $desktop 'DB Monitoring AI - Start.lnk'
$desktopStop = Join-Path $desktop 'DB Monitoring AI - Stop.lnk'
$menuStart = Join-Path $startMenuFolder 'DB Monitoring AI - Start.lnk'
$menuStop = Join-Path $startMenuFolder 'DB Monitoring AI - Stop.lnk'

$startArgs = "/c `"$startCmd`""
$stopArgs = "/c `"$stopCmd`""

New-AppShortcut -ShortcutPath $desktopStart -TargetPath $cmdExe -Arguments $startArgs -WorkingDirectory $repoRoot -Description 'Start DB Monitoring AI local production app'
New-AppShortcut -ShortcutPath $desktopStop -TargetPath $cmdExe -Arguments $stopArgs -WorkingDirectory $repoRoot -Description 'Stop DB Monitoring AI local production app'
New-AppShortcut -ShortcutPath $menuStart -TargetPath $cmdExe -Arguments $startArgs -WorkingDirectory $repoRoot -Description 'Start DB Monitoring AI local production app'
New-AppShortcut -ShortcutPath $menuStop -TargetPath $cmdExe -Arguments $stopArgs -WorkingDirectory $repoRoot -Description 'Stop DB Monitoring AI local production app'

Write-Host "Shortcuts created:"
Write-Host "- $desktopStart"
Write-Host "- $desktopStop"
Write-Host "- $menuStart"
Write-Host "- $menuStop"