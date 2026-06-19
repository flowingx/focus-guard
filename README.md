# Focus Guard 专注守门员

Windows 为核心的专注守护应用。Chrome/Edge 扩展 + Rust 后端 + AI 截图分析，检测摸鱼行为并强制弹窗提醒。

## 系统架构

```
Chrome/Edge 扩展  ◄──Native Messaging──►  focus-guard-native-host (Rust)
                                                  │
                                          focus-guard-server (Rust, HTTP :3001)
                                                  │
                                          Win32 API 全桌面截图 → AI 分析
                                                  │
                              ┌────────────────────┼────────────────────┐
                              │                    │                    │
                      本地 llama.cpp         远程 API (OpenAI      远程 API (DeepSeek
                      (WSL/Linux :8080)      Anthropic 等)         等中转站)
```

## 功能特性

- **全桌面截图分析** — 2560×1440 全分辨率截图，DPI 自适应
- **多供应商 AI** — 支持本地 llama.cpp + 远程 API（OpenAI 格式）
- **智能配置解析** — 粘贴 curl 命令自动提取 API 地址和密钥
- **供应商管理** — 多供应商卡片展示，自动测试排序，一键切换
- **强制干预** — AI 检测到摸鱼时弹出全屏遮罩，验证理由后决定放行或关闭页面
- **定时轮询 + 中断触发** — 扩展在页面加载时和每 5 分钟自动检测
- **深色模式** — 支持手动切换（浅色/深色/跟随系统）

## 快速启动

### 一键启动（推荐）

**Windows:**
```bash
start.bat
```

**Linux/WSL:**
```bash
./start.sh
```

Windows 上 `start.bat` 会启动 Tauri 桌面应用（系统托盘 + 内嵌 WebView），自动启动后端服务。
Linux/WSL 上 `start.sh` 启动服务器 + Python HTTP 服务，浏览器打开 UI。

### 手动启动

### 前置条件

- Windows 10/11
- Rust（rustup 安装）
- Node.js（v18+）
- Chrome/Edge 浏览器
- WSL 或 Linux（运行 AI 模型）

### 第一步：下载 AI 模型

```bash
# 在 WSL 中创建模型目录
mkdir -p ~/models

# 下载 Qwen3VL-4B 视觉模型（约 2.5GB）
cd ~/models
wget https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/Qwen3VL-4B-Instruct-Q4_K_M.gguf

# 下载对应的 mmproj 文件（约 750MB）
wget https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf

# 如果下载慢，可以用 huggingface-cli：
# pip install huggingface_hub
# huggingface-cli download Qwen/Qwen3-VL-4B-Instruct-GGUF Qwen3VL-4B-Instruct-Q4_K_M.gguf mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf --local-dir ~/models
```

### 第二步：启动 AI 模型服务

#### 方式 A：CPU 模式（简单，不需要 CUDA）

```bash
cd ~/llama-cpp/llama-b9616
LD_LIBRARY_PATH=. ./llama-server \
  --model ~/models/Qwen3VL-4B-Instruct-Q4_K_M.gguf \
  --mmproj ~/models/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf \
  --host 127.0.0.1 --port 8080 --ctx-size 4096
```

#### 方式 B：GPU 模式（需要 CUDA 编译的 llama.cpp）

```bash
# 如果还没有 CUDA 版本，需要从源码编译：
cd /tmp
git clone --depth 1 https://github.com/ggml-org/llama.cpp.git llama-cuda-build
cd llama-cuda-build
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release -DCUDAToolkit_ROOT=/usr/local/cuda-12.6
cmake --build build --target llama-server -j$(nproc)

# 启动（-ngl 99 = 所有层卸载到 GPU）
LD_LIBRARY_PATH=/usr/local/cuda-12.6/lib64:build/bin \
  build/bin/llama-server \
  --model ~/models/Qwen3VL-4B-Instruct-Q4_K_M.gguf \
  --mmproj ~/models/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf \
  --host 127.0.0.1 --port 8080 --ctx-size 4096 -ngl 99
```

```bash
# 验证服务
curl http://127.0.0.1:8080/v1/models
```

### 第三步：构建 Rust 服务（Windows）

```bash
cargo build --manifest-path src-tauri/Cargo.toml --release

# 启动桌面应用（推荐，自动管理服务）
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-app --release

# 或单独运行服务
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-server --release
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-native-host --release
```

### 第四步：加载 Chrome/Edge 扩展

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `extension/` 文件夹

### 扩展端到端验证

加载扩展后，可在扩展的「详细信息」页打开「扩展程序选项」：

1. 点击「检查服务」，预期显示「服务正常」。
2. 打开一个普通网页标签页，例如 `https://example.com`。
3. 回到扩展选项页，点击「立即检测」。
4. 查看「AI 检测日志」：
   - `ok`：检测请求成功，未触发干预。
   - `interference_shown`：检测到分心并已注入遮罩。
   - `server_error` / `http_error` / `request_failed`：后端服务或网络请求异常。
   - `inject_failed`：遮罩脚本或 CSS 注入失败。
   - `no_http_tab`：当前窗口没有可检测的网页标签。

建议记录以下证据，便于后续排查：

- 「检查服务」状态文本。
- 「立即检测」后的状态文本。
- 「AI 检测日志」最新一行。
- 如果出现遮罩，记录遮罩是否显示、放行按钮是否创建短会话、关闭按钮是否关闭标签页。
- 如果失败，记录日志中的 `status` 和 `error` 字段。

### 第五步：打开桌面 UI

**Windows（Tauri 桌面应用）：**
启动 `focus-guard-app.exe` 后自动显示配置界面，无需浏览器。系统托盘右键可管理服务。

**Linux/WSL（浏览器 UI）：**
```bash
python3 -m http.server 3000 --bind 0.0.0.0 --directory desktop/
# 浏览器打开 http://localhost:3000
```

### 第六步：配置 AI 供应商

1. 在桌面 UI 中点击「📋 粘贴配置」
2. 粘贴 curl 命令或 API 配置，系统自动识别
3. 或点击「+ 添加供应商」手动填写 Base URL 和 API Key
4. 点击「全部测试排序」自动选择最快的供应商

## 二进制说明

| 二进制 | 作用 | 端口 |
|--------|------|------|
| `focus-guard-app` | Tauri 桌面应用（系统托盘 + WebView UI） | — |
| `focus-guard-server` | HTTP 截图分析服务 | 3001 (0.0.0.0) |
| `focus-guard-native-host` | Chrome 原生消息主机 | stdin/stdout |

## 测试

```bash
# 运行所有测试
npm run test:all

# 仅 JS 测试
npm test

# 仅 Rust 测试
cargo test --manifest-path src-tauri/Cargo.toml
```

## 目录结构

```
extension/              Chrome/Edge 扩展（Manifest V3）
  background.js         服务脚本（策略、AI 检测、强制干预）
  interference.js       强制干预遮罩逻辑
  interference.css      遮罩样式（支持深色模式）
desktop/                桌面 UI（HTML/JS/CSS，Tauri WebView 加载）
  app.js                主逻辑（供应商管理、深色模式、服务状态）
  styles.css            样式（Claude/macOS 风格）
shared/policy.js        共享策略逻辑（域名匹配、意图会话）
src-tauri/              Rust 后端 + Tauri 桌面应用
  tauri.conf.json       Tauri 配置（窗口、托盘、打包）
  build.rs              Tauri 构建脚本
  icons/                应用图标（ICO + PNG）
  src/lib.rs            核心逻辑（策略、AI、截图）
  src/screenshot.rs     Win32 API 全桌面截图（DPI 感知）
  src/bin/app.rs        Tauri 桌面应用（系统托盘、服务管理、日志流）
  src/bin/server.rs     HTTP 服务（多供应商管理、配置解析）
  src/bin/native_host.rs 原生消息主机
tests/                  JS 测试（node:test）
```

## 构建发布

```bash
# 构建桌面应用（Windows）
cargo build --manifest-path src-tauri/Cargo.toml --release --bin focus-guard-app

# 构建所有二进制
cargo build --manifest-path src-tauri/Cargo.toml --release

# GitHub Actions 自动构建（推送 v* 标签触发）
git tag v0.1.0
git push origin v0.1.0
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FG_AI_ENDPOINT` | `http://127.0.0.1:8080/v1/chat/completions` | AI 服务地址 |
| `FG_AI_MODEL` | `Qwen3VL-4B-Instruct-Q4_K_M.gguf` | 模型名称 |
| `FG_AI_API_KEY` | (空) | API Key |
| `FG_SERVER_PORT` | `3001` | 截图服务端口 |

## 注意事项

- Win32 API 截图只在 Windows 上可用
- 本地 AI 模型需要 GPU 或大内存（4B 模型约需 4GB 显存或 14GB 内存）
- 扩展的白名单/高风险域名列表在 `shared/policy.js` 和 Rust `lib.rs` 中各有一份，修改时需同步
- AI 系统提示必须以 `/no_think` 开头（防止 Qwen3 thinking 模式消耗所有 token）
- 供应商配置保存在 `AppData\Local\FocusGuard\providers.json`
