@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ========================================
echo   Focus Guard - Stop
echo ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Get-Process focus-guard-server,focus-guard-native-host | Stop-Process -Force; $ports = @(3000, 3001); $pids = @(); foreach ($port in $ports) { $pids += Get-NetTCPConnection -LocalPort $port -State Listen | Select-Object -ExpandProperty OwningProcess; $lines = netstat -ano | Select-String ('0.0.0.0:' + $port + '\s+.*LISTENING|127.0.0.1:' + $port + '\s+.*LISTENING|\[::\]:' + $port + '\s+.*LISTENING'); foreach ($line in $lines) { $parts = ($line.ToString() -split '\s+') | Where-Object { $_ }; $pids += [int]$parts[-1] } }; $pids | Sort-Object -Unique | Where-Object { $_ -gt 0 } | ForEach-Object { Stop-Process -Id $_ -Force }" >nul 2>&1

echo Services stopped.
powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul 2>&1
exit /b 0
