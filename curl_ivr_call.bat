@echo off
title ArthSathi — Make IVR Test Call
color 0B
echo.
echo  Calling via ArthSathi IVR...
echo  (Reading credentials from backend\.env)
echo.

for /f "tokens=1,2 delims==" %%a in ('findstr "TWILIO_ACCOUNT_SID\|TWILIO_AUTH_TOKEN\|TWILIO_PHONE_NUMBER" backend\.env') do set %%a=%%b

curl -s -X POST "http://localhost:3001/api/ivr/call" ^
  -H "Content-Type: application/json" ^
  -d "{\"to\":\"+918454053146\",\"lang\":\"hi\"}"

echo.
echo  Check your phone!
pause
