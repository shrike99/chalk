@echo off
rem Starts the web page on http://localhost:5173
cd /d %~dp0
rem npm install is quick when nothing changed, and picks up new libraries after an update
call npm install --no-audit --no-fund
npm run dev
