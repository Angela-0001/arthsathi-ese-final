@echo off
title ArthSathi — Starting All Services
color 0A
echo.
echo  ====================================================
echo   ArthSathi — AI Financial Companion for Rural India
echo  ====================================================
echo.
echo  Starting all services... Please wait.
echo.

set ROOT=%~dp0

:: ── 1. Python Recommendation Engine (FastAPI on port 8001) ─────────────────
echo  [1/3] Starting Python Recommendation Engine (port 8001)...
start "ArthSathi Engine" cmd /k "cd /d %ROOT%ml-model && python recommendation_engine.py"
timeout /t 4 /nobreak >nul

:: ── 2. Node.js Backend API (Express on port 3001) ──────────────────────────
echo  [2/3] Starting Backend API (port 3001)...
start "ArthSathi Backend" cmd /k "cd /d %ROOT%backend && node server.js"
timeout /t 4 /nobreak >nul

:: ── 3. Next.js Frontend (PWA on port 3000) ─────────────────────────────────
echo  [3/3] Starting Frontend PWA (port 3000)...
start "ArthSathi Frontend" cmd /k "cd /d %ROOT%frontend && npx next start -p 3000"
timeout /t 6 /nobreak >nul

:: ── Open browser ────────────────────────────────────────────────────────────
echo.
echo  All services started!
echo.
echo   Frontend  : http://localhost:3000
echo   Backend   : http://localhost:3001
echo   Engine    : http://127.0.0.1:8001
echo.
echo  Opening browser...
start "" "http://localhost:3000"

echo.
echo  Close this window to keep services running in their own windows.
echo  Close each service window to stop it.
pause
