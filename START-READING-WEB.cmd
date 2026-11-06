@echo off
setlocal
cd /d "%~dp0"
node --preserve-symlinks --preserve-symlinks-main web-app\tools\serve.cjs
if errorlevel 1 pause
