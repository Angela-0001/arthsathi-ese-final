@echo off
title ArthSathi — IVR Setup
color 0A
echo.
echo  ============================================
echo   ArthSathi IVR Setup
echo  ============================================
echo.
echo  STEP 1: Start ngrok to expose your backend
echo  -------------------------------------------
echo  1. Go to https://ngrok.com and sign up (free)
echo  2. Copy your authtoken from the dashboard
echo  3. Run this command once:
echo     ngrok config add-authtoken YOUR_TOKEN_HERE
echo.
echo  STEP 2: Start ngrok in a new window
echo  ------------------------------------
start "ngrok" cmd /k "ngrok http 3001"
echo  ngrok started. Wait 3 seconds...
timeout /t 3 /nobreak >nul
echo.
echo  STEP 3: Get your ngrok URL
echo  --------------------------
echo  Look at the ngrok window for a line like:
echo    Forwarding  https://xxxx-xx-xx.ngrok-free.app -> localhost:3001
echo.
echo  STEP 4: Add it to backend\.env
echo  --------------------------------
echo  Open backend\.env and add:
echo    BASE_URL=https://xxxx-xx-xx.ngrok-free.app
echo.
echo  STEP 5: Restart backend and make a call
echo  ----------------------------------------
echo  Run: node backend\server.js
echo  Then call API:
echo    POST http://localhost:3001/api/ivr/call
echo    Body: {"to":"+918454053146","lang":"hi"}
echo.
echo  OR just run: curl_ivr_call.bat
echo.
pause
