@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please install Node.js 22 or newer.
  pause
  exit /b 1
)

start "Campus Assistant Server" /min cmd /c "node serve.mjs"

rem 等本地服务就绪；/health 返回 app=campus-assistant 才打开页面
for /l %%i in (1,1,20) do (
  powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8130/health' -TimeoutSec 1; if ($r.app -eq 'campus-assistant') { exit 0 } } catch {}; exit 1" >nul 2>nul
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)

echo 本地服务未能启动，请查看 %LOCALAPPDATA%\CampusAssistant\logs\web.log
pause
exit /b 1

:ready
where msedge.exe >nul 2>nul
if not errorlevel 1 (
  start "" msedge.exe --start-fullscreen --new-window http://127.0.0.1:8130
) else (
  start "" http://127.0.0.1:8130
)
