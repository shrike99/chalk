@echo off
rem Opens the backend and the frontend in two windows, then the app in your browser.
start "Chalk backend" cmd /k "%~dp0backend\run.bat"
start "Chalk frontend" cmd /k "%~dp0frontend\run.bat"
timeout /t 8 >nul
start http://localhost:5173
