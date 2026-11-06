@echo off
cd /d "%~dp0"
echo DEBUG START
echo Current folder: %CD%
echo.
dir
echo.
node -v
echo.
node server.cjs
pause
