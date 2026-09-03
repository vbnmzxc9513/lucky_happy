@echo off
setlocal

set "PORT=3000"
if not "%~1"=="" set "PORT=%~1"

cd /d "%~dp0"

echo.
echo Lucky Horse local server restart
echo Project: %CD%
echo Port: %PORT%
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found. Please install Node.js first.
  pause
  exit /b 1
)

echo Checking for an old server on localhost:%PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'SilentlyContinue';" ^
  "$port = [int]'%PORT%';" ^
  "$processIds = @(Get-NetTCPConnection -LocalPort $port -State Listen | Select-Object -ExpandProperty OwningProcess -Unique);" ^
  "if ($processIds.Count -gt 0) { foreach ($processId in $processIds) { $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue; if ($proc) { Write-Host ('Stopping PID ' + $processId + ' (' + $proc.ProcessName + ') on port ' + $port); Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue } } } else { Write-Host ('No old localhost server found on port ' + $port + '.') }"

if errorlevel 1 (
  echo WARNING: Could not check port %PORT%. Continuing to start the server.
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 1" >nul

echo.
echo Starting new server...
echo URL:   http://localhost:%PORT%/
echo Host:  http://localhost:%PORT%/host/
echo Admin: http://localhost:%PORT%/admin/
echo Press Ctrl+C in this window to stop it.
echo.

call npm start

echo.
echo Server stopped.
pause
