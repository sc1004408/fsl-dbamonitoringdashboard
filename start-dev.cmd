@echo off
REM Fast start script for db-monitoring-ai (Windows)

set "ROOT_DIR=%~dp0"
set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"

if not exist "%NPM_CMD%" (
	echo npm.cmd not found at "%NPM_CMD%".
	echo Install Node.js or update this script with the correct npm.cmd path.
	pause
	exit /b 1
)

REM Start backend (without npm install)
start "Backend" cmd /k "cd /d ""%ROOT_DIR%"" && ""%NPM_CMD%"" run dev -w apps/backend"

REM Start frontend (without npm install)
start "Frontend" cmd /k "cd /d ""%ROOT_DIR%"" && ""%NPM_CMD%"" run dev -w apps/frontend"

echo Backend and frontend dev servers are starting in new windows.
pause
