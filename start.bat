@echo off
title ArthSathi — Starting...
color 0A
cls

set ROOT=%~dp0
set NGROK=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe

echo.
echo  ============================================================
echo   ArthSathi — AI Financial Companion for Rural India
echo  ============================================================
echo.

:: ── Step 1: Start Python Recommendation Engine ────────────────────────────
echo  [1/4] Starting Python Recommendation Engine on port 8001...
start "ArthSathi Engine" cmd /k "cd /d %ROOT%ml-model && python recommendation_engine.py"

:: Wait for engine to be ready (health check loop)
echo  Waiting for engine to start...
:WAIT_ENGINE
timeout /t 3 /nobreak >nul
curl -s http://127.0.0.1:8001/health | find "ok" >nul 2>&1
if errorlevel 1 goto WAIT_ENGINE
echo  Engine is UP!

:: ── Step 2: Start Backend ─────────────────────────────────────────────────
echo.
echo  [2/4] Starting Backend API on port 3001...
start "ArthSathi Backend" cmd /k "cd /d %ROOT%backend && node server.js"

:: Wait for backend to be ready
echo  Waiting for backend to start...
:WAIT_BACKEND
timeout /t 3 /nobreak >nul
curl -s http://localhost:3001/api/health | find "ok" >nul 2>&1
if errorlevel 1 goto WAIT_BACKEND
echo  Backend is UP!

:: ── Step 3: Start ngrok ───────────────────────────────────────────────────
echo.
echo  [3/4] Starting ngrok tunnel...
start "ngrok" cmd /k "%NGROK% http 3001"
timeout /t 6 /nobreak >nul

:: Wait for ngrok API to be ready
:WAIT_NGROK
timeout /t 2 /nobreak >nul
curl -s http://localhost:4040/api/tunnels | find "ngrok" >nul 2>&1
if errorlevel 1 goto WAIT_NGROK
echo  ngrok is UP!

:: ── Step 4: Start Frontend ────────────────────────────────────────────────
echo.
echo  [4/4] Starting Frontend PWA on port 3000...
start "ArthSathi Frontend" cmd /k "cd /d %ROOT%frontend && npx next start -p 3000"

:: Wait for frontend to be ready
echo  Waiting for frontend to start...
:WAIT_FRONTEND
timeout /t 3 /nobreak >nul
curl -s http://localhost:3000 | find "ArthSathi" >nul 2>&1
if errorlevel 1 goto WAIT_FRONTEND
echo  Frontend is UP!

:: ── All services ready ────────────────────────────────────────────────────
echo.
echo  ============================================================
echo   ALL SERVICES RUNNING
echo.
echo   Frontend  : http://localhost:3000
echo   Backend   : http://localhost:3001
echo   Engine    : http://127.0.0.1:8001
echo  ============================================================
echo.

:: Open browser
start "" "http://localhost:3000"

:: ── Make IVR Call ─────────────────────────────────────────────────────────
echo.
echo  Making IVR call...
echo  (Loading Twilio credentials from backend\.env)
echo.

:: Read credentials from .env file
for /f "tokens=1,2 delims==" %%a in ('findstr "TWILIO_ACCOUNT_SID\|TWILIO_AUTH_TOKEN\|TWILIO_PHONE_NUMBER" %ROOT%backend\.env') do (
    set %%a=%%b
)

if "%TWILIO_ACCOUNT_SID%"=="" (
    echo  ERROR: TWILIO_ACCOUNT_SID not set in backend\.env
    pause
    exit /b 1
)

curl -s -X POST "https://api.twilio.com/2010-04-01/Accounts/%TWILIO_ACCOUNT_SID%/Calls.json" ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "To=%%2B918454053146" ^
  -d "From=%TWILIO_PHONE_NUMBER%" ^
  -d "Url=https%%3A%%2F%%2Fhandler.twilio.com%%2Ftwiml%%2FEHf0899cc02790837612bd5a035084ef12" ^
  -u "%TWILIO_ACCOUNT_SID%:%TWILIO_AUTH_TOKEN%"

echo.
echo  ============================================================
echo   ANSWER YOUR PHONE +918454053146 NOW!
echo   ArthSathi Hindi IVR is calling you.
echo  ============================================================
echo.
echo  Press any key to close this window (services keep running).
pause >nul
