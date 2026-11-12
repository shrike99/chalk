@echo off
rem Builds the Chalk installer. Double-click, or run from a terminal.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1" %*
if errorlevel 1 (
  echo.
  echo Build failed. See the messages above.
)
pause
