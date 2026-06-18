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

REM Check Rust
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Rust not found. Install: https://rustup.rs
    pause
    exit /b 1
)

REM Check Python
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

REM ==============================
REM Step 1: Build Rust binaries
REM ==============================
echo [1/3] Checking Rust binaries...

set NEED_BUILD=0
set RELEASE_DIR=src-tauri\target\release

if not exist "%RELEASE_DIR%" (
    echo     release directory not found, building...
    set NEED_BUILD=1
    goto :do_build
)

set SERVER_EXISTS=0
set HOST_EXISTS=0

if exist "%RELEASE_DIR%\focus-guard-server.exe" set SERVER_EXISTS=1
if exist "%RELEASE_DIR%\focus-guard-native-host.exe" set HOST_EXISTS=1

if %SERVER_EXISTS% equ 1 (
    if %HOST_EXISTS% equ 1 (
        echo     Binaries found:
        echo       - focus-guard-server.exe
        echo       - focus-guard-native-host.exe
        goto :skip_build
    )
)

echo     Missing binaries:
if %SERVER_EXISTS% equ 0 echo       - focus-guard-server.exe
if %HOST_EXISTS% equ 0 echo       - focus-guard-native-host.exe
set NEED_BUILD=1

:do_build
echo     Building (may take a few minutes)...
cargo build --manifest-path src-tauri\Cargo.toml --release
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed
    pause
    exit /b 1
)
echo     Build complete!

:skip_build

REM ==============================
REM Step 2: Start backend server
REM ==============================
echo.
echo [2/3] Starting server on port 3001...

REM Use start /b to run in background without new window
start /b "" cmd /c ""%RELEASE_DIR%\focus-guard-server.exe" >nul 2>&1"
timeout /t 2 /nobreak >nul

curl -s http://127.0.0.1:3001/health >nul 2>&1
if %errorlevel% equ 0 (
    echo     Server: OK
) else (
    echo     Server starting...
)

REM ==============================
REM Step 3: Start desktop UI
REM ==============================
echo.
echo [3/3] Starting UI on port 3000...

if defined PYTHON_CMD (
    start /b cmd /c "%PYTHON_CMD% -m http.server 3000 --bind 0.0.0.0 --directory desktop >nul 2>&1"
) else (
    start "" "%~dp0desktop\index.html"
)

timeout /t 1 /nobreak >nul

REM ==============================
REM Done
REM ==============================
echo.
echo ========================================
echo   All services started!
echo ========================================
echo.
echo   UI:  http://localhost:3000
echo   API: http://localhost:3001
echo.
echo   Chrome extension: chrome://extensions
echo   Enable Developer Mode - Load Unpacked - select extension/ folder
echo.
echo   Press any key to stop all services.
echo ========================================
echo.

start http://localhost:3000

REM Wait for user to press a key, then clean up
pause >nul

echo.
echo Stopping services...
taskkill /IM focus-guard-server.exe /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
echo Done.
