@echo off
rem Starts the Python backend on http://127.0.0.1:8000
setlocal
cd /d %~dp0

rem Find Python: the py launcher with 3.12 first, then any py, then python.
set "PY="
py -3.12 --version >nul 2>&1 && set "PY=py -3.12"
if not defined PY (py --version >nul 2>&1 && set "PY=py")
if not defined PY (python --version >nul 2>&1 && set "PY=python")
if not defined PY (
  echo.
  echo [!] Python was not found.
  echo     Install Python 3.12 from https://www.python.org/downloads/
  echo     and tick "Add python.exe to PATH" in the installer, then run this again.
  pause
  exit /b 1
)
echo Using Python: %PY%
%PY% --version

rem Create the virtual environment if it's missing or broken.
if not exist ".venv\Scripts\python.exe" (
  if exist .venv rmdir /s /q .venv
  echo Creating virtual environment...
  %PY% -m venv .venv
  if errorlevel 1 (
    echo [!] Could not create the virtual environment. See the error above.
    pause
    exit /b 1
  )
)

echo Installing packages (first run takes a minute)...
".venv\Scripts\python.exe" -m pip install -q --upgrade pip
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo [!] Installing packages failed. See the error above.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" -m uvicorn app:app --port 8000
pause
