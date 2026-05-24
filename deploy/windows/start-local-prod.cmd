@echo off
setlocal

set "REPO=%~dp0..\.."
cd /d "%REPO%"

set "PATH=C:\Program Files\nodejs;%PATH%"
if not exist logs mkdir logs

echo [1/3] Installing dependencies (if needed)...
call "C:\Program Files\nodejs\npm.cmd" install
if errorlevel 1 goto :fail

echo [2/3] Building backend and frontend...
call "C:\Program Files\nodejs\npm.cmd" run build
if errorlevel 1 goto :fail

echo [3/3] Starting app on http://localhost:4000 ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :4000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>nul
start "db-monitoring-ai" /b "C:\Program Files\nodejs\node.exe" apps\backend\dist\server.js >> logs\backend.out.log 2>> logs\backend.err.log

echo Done. Open http://localhost:4000
echo Logs: logs\backend.out.log and logs\backend.err.log
goto :eof

:fail
echo Deployment failed. Check output above.
exit /b 1
