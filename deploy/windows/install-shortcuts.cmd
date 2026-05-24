@echo off
setlocal

set "REPO=%~dp0..\.."
cd /d "%REPO%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-shortcuts.ps1"
