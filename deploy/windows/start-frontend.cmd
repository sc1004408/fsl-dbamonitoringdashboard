@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d C:\Users\sc1004408\db-monitoring-ai
if not exist logs mkdir logs
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>nul
start "" /b "C:\Program Files\nodejs\npm.cmd" run dev:frontend >> logs\frontend.out.log 2>> logs\frontend.err.log
