@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install the LTS version of Node.js.
  pause
  exit /b 1
)

if not exist "%~dp0server.cjs" (
  echo ERROR: server.cjs was not found. Extract the ZIP completely.
  pause
  exit /b 1
)

echo Building or opening the standalone Windows EXE...
echo PowerShell is not used in this version.
echo Keep this console open while you use the program.
echo.
node "%~dp0server.cjs" --midi-keyboard
set "PBT_EXIT_CODE=%ERRORLEVEL%"
if not "%PBT_EXIT_CODE%"=="0" (
  echo.
  echo ERROR: The standalone Windows EXE failed. Exit code: %PBT_EXIT_CODE%
  echo The exact compiler or Windows loader error is shown above.
  pause
  exit /b %PBT_EXIT_CODE%
)

exit /b 0
