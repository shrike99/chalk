@echo off
rem Installs the local, natural-sounding voice (Kokoro) and local speech recognition (Whisper).
rem Needs an NVIDIA graphics card for best speed. Downloads about 4-5 GB in total.
setlocal
cd /d %~dp0
if not exist ".venv\Scripts\python.exe" (
  echo [!] Run start.bat once first, so the backend is set up, then run this again.
  pause
  exit /b 1
)
set "PY=.venv\Scripts\python.exe"
echo Installing PyTorch with CUDA support (about 2.5 GB, this can take a while)...
%PY% -m pip install torch --index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 (
  echo [!] Installing PyTorch failed. See the error above.
  pause
  exit /b 1
)
%PY% -c "import sys; sys.exit(0 if sys.version_info < (3, 13) else 1)"
if errorlevel 1 (
  echo.
  echo [!] Kokoro needs Python 3.12 or older, and this backend uses a newer Python.
  echo     Installing Whisper only. For Kokoro: install Python 3.12, delete the backend\.venv folder,
  echo     run start.bat once, then run this file again.
  %PY% -m pip install "faster-whisper>=1.1"
) else (
  echo Installing Whisper and Kokoro...
  %PY% -m pip install -r requirements-voice.txt
  if errorlevel 1 (
    echo [!] Installing the voice libraries failed. See the error above.
    pause
    exit /b 1
  )
)
echo Downloading the voice models...
%PY% prefetch_voice.py
echo.
echo Done! Close the backend window and run start.bat again to use the new voice.
echo Then pick a voice in Settings (Claudes voice) and press Preview.
pause
