@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo ========================================
echo   Focus Guard - 专注守护 启动器
echo ========================================
echo.

REM 切换到脚本所在目录
cd /d "%~dp0"

REM 检查 Rust 是否安装
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Rust，请先安装: https://rustup.rs
    pause
    exit /b 1
)

REM 检查 Python 是否安装（用于提供桌面 UI）
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
REM 步骤 1: 检查并构建 Rust 二进制
REM ==============================
echo [1/3] 检查 Rust 服务...

set NEED_BUILD=0
set RELEASE_DIR=src-tauri\target\release

REM 检查 release 目录是否存在
if not exist "%RELEASE_DIR%" (
    echo     release 目录不存在，需要构建
    set NEED_BUILD=1
    goto :do_build
)

REM 检查两个关键二进制是否存在
set SERVER_EXISTS=0
set HOST_EXISTS=0

if exist "%RELEASE_DIR%\focus-guard-server.exe" set SERVER_EXISTS=1
if exist "%RELEASE_DIR%\focus-guard-native-host.exe" set HOST_EXISTS=1

if %SERVER_EXISTS% equ 1 (
    if %HOST_EXISTS% equ 1 (
        echo     已有编译好的二进制文件:
        echo       - focus-guard-server.exe
        echo       - focus-guard-native-host.exe
        goto :skip_build
    )
)

echo     缺少以下二进制文件:
if %SERVER_EXISTS% equ 0 echo       - focus-guard-server.exe
if %HOST_EXISTS% equ 0 echo       - focus-guard-native-host.exe
set NEED_BUILD=1

:do_build
echo     正在编译（可能需要几分钟）...
cargo build --manifest-path src-tauri\Cargo.toml --release
if %errorlevel% neq 0 (
    echo.
    echo [错误] Rust 编译失败
    pause
    exit /b 1
)
echo     编译完成！

:skip_build

REM ==============================
REM 步骤 2: 启动后端服务
REM ==============================
echo.
echo [2/3] 启动后端服务 (端口 3001)...

REM 先检查端口是否已被占用（可能之前已启动）
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo     端口 3001 已被占用，后端服务可能已在运行
) else (
    REM 使用 PowerShell 最小化启动，窗口会最小化到任务栏
    powershell -Command "Start-Process -FilePath '%RELEASE_DIR%\focus-guard-server.exe' -WindowStyle Minimized"
    timeout /t 2 /nobreak >nul
    
    REM 检查服务是否启动
    curl -s http://127.0.0.1:3001/health >nul 2>&1
    if %errorlevel% equ 0 (
        echo     后端服务已启动 ✓
    ) else (
        echo     后端服务启动中...
    )
)

REM ==============================
REM 步骤 3: 启动桌面 UI
REM ==============================
echo.
echo [3/3] 启动桌面 UI (端口 3000)...

REM 先检查端口是否已被占用
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo     端口 3000 已被占用，桌面 UI 可能已在运行
) else (
    if defined PYTHON_CMD (
        echo     使用 Python 提供静态文件服务
        REM 使用 PowerShell 最小化启动
        powershell -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c %PYTHON_CMD% -m http.server 3000 --bind 0.0.0.0 --directory desktop' -WindowStyle Minimized"
    ) else (
        echo     未找到 Python，直接打开 HTML 文件
        start "" "%~dp0desktop\index.html"
    )
)

timeout /t 1 /nobreak >nul

REM ==============================
REM 完成
REM ==============================
echo.
echo ========================================
echo   启动完成！
echo ========================================
echo.
echo   桌面 UI:  http://localhost:3000
echo   后端 API: http://localhost:3001
echo.
echo   Chrome 扩展: chrome://extensions
echo   开启「开发者模式」→「加载已解压的扩展程序」→ 选择 extension/ 文件夹
echo.
echo   按 Ctrl+C 停止服务，或关闭此窗口
echo ========================================
echo.

REM 打开浏览器
start http://localhost:3000

REM 保持窗口打开，等待用户关闭
pause
