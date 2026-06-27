@echo off
cd /d "%~dp0"
echo ============================================
echo   AI Secretary (LM Studio) - starting up
echo ============================================
echo.

if not exist "node_modules" (
  echo [1/3] Installing packages... first time only, a few minutes.
  call npm install
  if errorlevel 1 goto err
)

echo [2/3] Building app...
call npm run build
if errorlevel 1 goto err

echo [3/3] Starting server. Press Ctrl + C to stop.
echo     PC  : http://localhost:8080
echo     Phone: http://(this PC IP):8080
echo     Switch backend on PC: http://localhost:8080/switch
echo.
node server.mjs
goto end

:err
echo.
echo *** ERROR. Please check the messages above. ***
echo (If Node.js is not installed, get the LTS version from https://nodejs.org )

:end
echo.
pause
