@echo off
setlocal

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :4000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>nul
echo Stopped app on port 4000 (if it was running).
