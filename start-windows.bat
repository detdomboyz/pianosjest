@echo off
cd /d "%~dp0"
echo Starting Piano Blind Trainer v23.0...
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)
if not exist "server.cjs" (
  echo server.cjs was not found. Extract the ZIP completely and run this file from the extracted folder.
  pause
  exit /b 1
)
if not exist "index.html" (
  echo index.html was not found. Extract the ZIP completely and run this file from the extracted folder.
  pause
  exit /b 1
)
node server.cjs
pause
