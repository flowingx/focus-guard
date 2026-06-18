#!/bin/bash
set -e

echo "========================================"
echo "  Focus Guard - 专注守护 启动器 (Linux/WSL)"
echo "========================================"
echo ""

cd "$(dirname "$0")"

# 检查 Rust
if ! command -v cargo &> /dev/null; then
    echo "[错误] 未找到 Rust，请先安装: https://rustup.rs"
    exit 1
fi

# ==============================
# 步骤 1: 检查并构建 Rust 二进制
# ==============================
echo "[1/3] 检查 Rust 服务..."

RELEASE_DIR="src-tauri/target/release"
NEED_BUILD=0

if [ ! -d "$RELEASE_DIR" ]; then
    echo "    release 目录不存在，需要构建"
    NEED_BUILD=1
else
    SERVER_EXISTS=0
    HOST_EXISTS=0
    [ -f "$RELEASE_DIR/focus-guard-server" ] && SERVER_EXISTS=1
    [ -f "$RELEASE_DIR/focus-guard-native-host" ] && HOST_EXISTS=1

    if [ $SERVER_EXISTS -eq 1 ] && [ $HOST_EXISTS -eq 1 ]; then
        echo "    已有编译好的二进制文件:"
        echo "      - focus-guard-server"
        echo "      - focus-guard-native-host"
    else
        echo "    缺少以下二进制文件:"
        [ $SERVER_EXISTS -eq 0 ] && echo "      - focus-guard-server"
        [ $HOST_EXISTS -eq 0 ] && echo "      - focus-guard-native-host"
        NEED_BUILD=1
    fi
fi

if [ $NEED_BUILD -eq 1 ]; then
    echo "    正在编译..."
    cargo build --manifest-path src-tauri/Cargo.toml --release
    echo "    编译完成！"
fi

# ==============================
# 步骤 2: 启动后端服务
# ==============================
echo ""
echo "[2/3] 启动后端服务 (端口 3001)..."

SERVER_PID=""
if lsof -i :3001 -t >/dev/null 2>&1; then
    echo "    端口 3001 已被占用，后端服务可能已在运行"
else
    ./$RELEASE_DIR/focus-guard-server &
    SERVER_PID=$!
    sleep 2
    if curl -s http://127.0.0.1:3001/health >/dev/null 2>&1; then
        echo "    后端服务已启动 ✓ (PID: $SERVER_PID)"
    else
        echo "    后端服务启动中... (PID: $SERVER_PID)"
    fi
fi

# ==============================
# 步骤 3: 启动桌面 UI
# ==============================
echo ""
echo "[3/3] 启动桌面 UI (端口 3000)..."

UI_PID=""
if lsof -i :3000 -t >/dev/null 2>&1; then
    echo "    端口 3000 已被占用，桌面 UI 可能已在运行"
else
    python3 -m http.server 3000 --bind 0.0.0.0 --directory desktop &
    UI_PID=$!
    sleep 1
    echo "    桌面 UI 已启动 (PID: $UI_PID)"
fi

echo ""
echo "========================================"
echo "  启动完成！"
echo "========================================"
echo ""
echo "  桌面 UI:  http://localhost:3000"
echo "  后端 API: http://localhost:3001"
echo ""
echo "  按 Ctrl+C 停止所有服务"
echo "========================================"

# 捕获退出信号，清理子进程
cleanup() {
    echo ""
    echo "正在停止服务..."
    [ -n "$SERVER_PID" ] && kill $SERVER_PID 2>/dev/null || true
    [ -n "$UI_PID" ] && kill $UI_PID 2>/dev/null || true
    echo "已停止"
}
trap cleanup EXIT INT TERM

# 等待
wait
