@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo ========================================
echo   Focus Guard - Start
echo ========================================
echo.

cd /d "%~dp0"

REM Kill any leftover processes from previous runs
taskkill /IM focus-guard-server.exe /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 /nobreak >nul

REM Check if the app exists
set APP_PATH=src-tauri\target\release\focus-guard-app.exe
if not exist "%APP_PATH%" (
    echo [ERROR] App not found. Building...
    cargo build --manifest-path src-tauri\Cargo.toml --release --bin focus-guard-app
    if %errorlevel% neq 0 (
        echo [ERROR] Build failed
        pause
        exit /b 1
    )
)

REM Launch the Tauri app
echo Starting Focus Guard...
start "" "%APP_PATH%"
