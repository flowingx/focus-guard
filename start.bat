@echo off
chcp 65001 >nul 2>&1

if /i not "%~1"=="--worker" (
    powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' -ArgumentList '/c', '\"%~f0\" --worker'"
    exit /b 0
)

setlocal enabledelayedexpansion
cd /d "%~dp0"

set LOG_DIR=%~dp0logs
set START_LOG=%LOG_DIR%\start.log
set SERVER_OUT_LOG=%LOG_DIR%\server.out.log
set SERVER_ERR_LOG=%LOG_DIR%\server.err.log
set WEB_OUT_LOG=%LOG_DIR%\web.out.log
set WEB_ERR_LOG=%LOG_DIR%\web.err.log

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

echo [%date% %time%] Focus Guard start > "%START_LOG%"

call :log "Stopping stale services"
taskkill /IM focus-guard-server.exe /F >> "%START_LOG%" 2>&1
taskkill /IM focus-guard-native-host.exe /F >> "%START_LOG%" 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /PID %%a /F >> "%START_LOG%" 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do taskkill /PID %%a /F >> "%START_LOG%" 2>&1
timeout /t 1 /nobreak >nul

where cargo >nul 2>&1
if %errorlevel% neq 0 (
    call :log "ERROR: Rust cargo not found"
    exit /b 1
)

set PYTHON_CMD=
where python >nul 2>&1
if %errorlevel% equ 0 (
    set PYTHON_CMD=python
) else (
    where python3 >nul 2>&1
    if %errorlevel% equ 0 (
        set PYTHON_CMD=python3
    )
)

set RELEASE_DIR=src-tauri\target\release
set SERVER_EXE=%CD%\%RELEASE_DIR%\focus-guard-server.exe
set HOST_EXE=%CD%\%RELEASE_DIR%\focus-guard-native-host.exe

call :build

if not exist "%SERVER_EXE%" (
    call :log "ERROR: focus-guard-server.exe missing after build"
    exit /b 1
)

call :log "Starting server on port 3001"
powershell -NoProfile -WindowStyle Hidden -Command "try { $p = Start-Process -WindowStyle Hidden -FilePath '%SERVER_EXE%' -WorkingDirectory '%CD%' -PassThru; Add-Content -LiteralPath '%START_LOG%' -Value ('Server PID: ' + $p.Id); exit 0 } catch { Add-Content -LiteralPath '%START_LOG%' -Value ('ERROR: failed to start server: ' + $_.Exception.Message); exit 1 }"
if %errorlevel% neq 0 (
    call :log "ERROR: server process launch failed"
    exit /b 1
)
timeout /t 2 /nobreak >nul

powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >> "%START_LOG%" 2>&1
if %errorlevel% equ 0 (
    call :log "Server health OK"
) else (
    call :log "Server health pending"
)

if defined PYTHON_CMD (
    call :log "Starting browser UI on port 3000"
    powershell -NoProfile -WindowStyle Hidden -Command "try { $p = Start-Process -WindowStyle Hidden -FilePath '%PYTHON_CMD%' -ArgumentList '-m','http.server','3000','--bind','0.0.0.0','--directory','desktop' -WorkingDirectory '%CD%' -PassThru; Add-Content -LiteralPath '%START_LOG%' -Value ('UI PID: ' + $p.Id); exit 0 } catch { Add-Content -LiteralPath '%START_LOG%' -Value ('ERROR: failed to start UI: ' + $_.Exception.Message); exit 1 }"
    if %errorlevel% neq 0 (
        call :log "ERROR: browser UI launch failed"
        exit /b 1
    )
    timeout /t 1 /nobreak >nul
    if not "%FG_NO_BROWSER%"=="1" start "" http://localhost:3000
) else (
    call :log "Python not found; opening desktop/index.html directly"
    if not "%FG_NO_BROWSER%"=="1" start "" "%~dp0desktop\index.html"
)

call :log "Startup complete"
exit /b 0

:build
call :log "Building release binaries"
cargo build --manifest-path src-tauri\Cargo.toml --release >> "%START_LOG%" 2>&1
if %errorlevel% neq 0 (
    call :log "ERROR: cargo build failed"
    exit /b 1
)
call :log "Build complete"
exit /b 0

:log
echo [%date% %time%] %~1 >> "%START_LOG%"
exit /b 0
