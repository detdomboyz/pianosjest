@echo off
cd /d "%~dp0"
call npm run build:web
if errorlevel 1 goto :failed
echo Open http://127.0.0.1:4173 in your browser.
echo Personal edits stay in that browser. Export your catalog to transfer it.
call npm run preview:web
exit /b %errorlevel%
:failed
pause
exit /b 1
