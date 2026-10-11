Write-Host "Starting ArthSathi Complete System..." -ForegroundColor Green

# Backend (Node.js)
Write-Host "Starting Backend on port 3001..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; npm start"

Start-Sleep -Seconds 3

# Bot (Telegram + WhatsApp)
Write-Host "Starting Bot on port 3002..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\bot'; npm install -q; npm start"

Start-Sleep -Seconds 3

# IVR Python voicebot
Write-Host "Starting IVR Voicebot on port 8001..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\ivr'; pip install -r requirements.txt -q; uvicorn voicebot_clean:app --host 0.0.0.0 --port 8001"

Write-Host ""
Write-Host "All services starting!" -ForegroundColor Green
Write-Host "Backend:     http://localhost:3001" -ForegroundColor Cyan
Write-Host "Bot:         http://localhost:3002" -ForegroundColor Cyan
Write-Host "IVR:         http://localhost:8001" -ForegroundColor Cyan
Write-Host ""
Write-Host "ngrok tunnels to start manually:" -ForegroundColor Yellow
Write-Host "  ngrok http 3001 --url=casing-stopwatch-slate.ngrok-free.dev" -ForegroundColor White
Write-Host "  ngrok http 8001 --url=unkempt-swung-fantastic.ngrok-free.dev --config=`"C:\Users\angel\.ngrok-ivr\ngrok.yml`"" -ForegroundColor White
