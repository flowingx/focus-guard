# Focus Guard 专注守门员

Windows 为核心的专注守护应用。Chrome/Edge 扩展 + Rust 后端 + AI 元信息检测，检测摸鱼行为并强制弹窗提醒。

## 系统架构

```
Chrome/Edge 扩展  ◄──Native Messaging──►  focus-guard-native-host (Rust)
                                                  │
                                          focus-guard-server (Rust, HTTP :3001)
                                                  │
                                          Win32 API 窗口元信息 → AI 分析
                                                  │
                              ┌────────────────────┼────────────────────┐
                              │                    │                    │
                      本地 llama.cpp         远程 API (OpenAI      远程 API (DeepSeek
                      (WSL/Linux :8080)      Anthropic 等)         等中转站)
```

## 功能特性

- **元信息优先检测** — 默认只使用前台窗口、可见窗口、进程名、浏览器域名/标题和脱敏信号
- **手动截图分析** — 用户显式点击后才截图；云端模式仍需先本地脱敏
- **多供应商 AI** — 支持本地 llama.cpp + 远程 API（OpenAI 格式）
- **智能配置解析** — 粘贴 curl 命令自动提取 API 地址和密钥
- **供应商管理** — 多供应商卡片展示，自动测试排序，一键切换
- **强制干预** — AI 检测到摸鱼时弹出全屏遮罩，验证理由后决定放行或关闭页面
- **定时轮询 + 中断触发** — 扩展在页面加载时和每 5 分钟自动检测
- **后台定时巡检** — `focus-guard-server` 可按分钟定时读取窗口元信息，用于检测非浏览器应用摸鱼并弹出提醒
- **AI 判断记录与总结** — 桌面 UI 显示最近 20 次元信息检测，并用后端保留的最近 1000 条记录估算每日/每小时专注、摸鱼、无变化与网页/窗口时长
- **深色模式** — 支持手动切换（浅色/深色/跟随系统）

## 快速启动

### 一键启动（推荐）

**Windows:**
```bash
start.bat
stop.bat
```

**Linux/WSL:**
```bash
./start.sh
```

`start.bat` 会自动增量构建 Rust 后端、在后台隐藏启动服务器和桌面 UI，并打开浏览器。启动窗口会自动退出；需要关闭服务时运行 `stop.bat`。
启动日志写入 `logs\start.log`，服务日志写入 `logs\server.err.log` / `logs\server.out.log`，静态 UI 日志写入 `logs\web.err.log` / `logs\web.out.log`。

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

# 运行服务
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-server --release
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-native-host --release
```

### 第四步：加载 Chrome/Edge 扩展

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `extension/` 文件夹

### 第五步：打开桌面 UI

```bash
python3 -m http.server 3000 --bind 0.0.0.0 --directory desktop/
# 浏览器打开 http://localhost:3000
```

Windows 下 `start.bat` 每次启动都会先调用 `stop.bat` 清理旧的 Focus Guard 服务和本地 3000/3001 端口占用；后台启动后也可随时用 `stop.bat` 停止 `focus-guard-server` 和本地 UI 服务。如果未手动设置 `FOCUS_GUARD_REDACTOR_PYTHON`，启动脚本会自动优先使用 `E:\Software\miniConda3\envs\cnocr\python.exe` 作为 CnOCR 脱敏环境。

桌面 UI 的「AI 摸鱼检测」区域可以开启「后台定时巡检」，配置会保存到后端；只要 `focus-guard-server` 仍在后台运行，关闭浏览器页面后也会按设定间隔检测非浏览器应用。浏览器网页拦截仍由 Chrome/Edge 扩展处理。

「专注总结」区域按巡检间隔估算今日与最近小时的学习/工作、摸鱼、未使用/无变化时长，并汇总网页/窗口停留时间；如果连续两次巡检的进程、窗口标题、分类和原因完全一致，会计为未使用/无变化，不计入专注时间。「AI 判断记录」区域仍只显示最近 20 次桌面分析，最新记录在滚动列表顶部。记录由后端保存到 `AppData\Local\FocusGuard\ai-records.json`，后端保留最近 1000 条用于总结统计；默认检测不截图，也不会把原始截图写入记录文件。

隐私配置保存到 `AppData\Local\FocusGuard\privacy-config.json`。云端 AI 默认只接收低敏文本元信息，不接收截图。只有用户点击「手动截图分析」时，后端才会截图；该手动入口会强制走 CnOCR 本地脱敏，再把脱敏图发给云端分析，脱敏失败则不上传。脱敏成功后只会把脱敏图发给云端，并把脱敏图保存到 AI 判断记录用于预览；原始截图不会写入记录文件。本地模型可以使用原始截图分析，但默认也不持久化原图。可选 OCR sidecar 脚本位于 `tools/privacy_redactor.py`，切换到 CnOCR/EasyOCR 后端前需要在本机 Python 环境安装对应 OCR 包和 Pillow。

桌面检测优先使用本地信号抽取：前台窗口、当前桌面可见顶层窗口、进程名、浏览器域名、标题类型和安全关键词会先被归纳为 `code_tool`、`pdf_reader`、`search`、`technical_research`、`bilibili`、`entertainment_signal` 等低敏信号；云端文本 AI 默认只接收这些信号，不接收截图、网页正文或聊天内容。Chrome/Edge 扩展会为 B站等页面附加低敏 `page_metadata`（站点、页面类型、分类 hints），不会上传完整 HTML、评论、弹幕、推荐列表或正文。用户在 AI 判断记录里手动保存分类后，会写入 `AppData\Local\FocusGuard\category-rules.json`，后续相似窗口优先命中本地规则。

```powershell
# 可选：启用 CnOCR 脱敏后端
python -m pip install pillow cnocr

# 如果 CnOCR 装在 conda/venv 中，指定后端调用的 Python
$env:FOCUS_GUARD_REDACTOR_PYTHON="E:\Software\miniConda3\envs\cnocr\python.exe"

# 默认使用项目内模型目录，也可手动指定
$env:FOCUS_GUARD_CNOCR_MODEL_DIR="F:\X_code\Projects\agent\focus-guard\models\doc-densenet_lite_136-gru"

# 验证 CnOCR sidecar 是否可用，会输出 logs\cnocr_redactor_verify.png
python tools\verify_cnocr_redactor.py

# 可选：启用 EasyOCR 脱敏后端
python -m pip install pillow easyocr
```

### 第六步：配置 AI 供应商

1. 在桌面 UI 中点击「📋 粘贴配置」
2. 粘贴 curl 命令或 API 配置，系统自动识别
3. 或点击「+ 添加供应商」手动填写 Base URL 和 API Key
4. 点击「全部测试排序」自动选择最快的供应商

## 二进制说明

| 二进制 | 作用 | 端口 |
|--------|------|------|
| `focus-guard-server` | HTTP 元信息检测服务 | 3001 (0.0.0.0) |
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
desktop/                桌面 UI（HTML/JS/CSS）
  app.js                主逻辑（供应商管理、深色模式）
  styles.css            样式（Claude/macOS 风格）
shared/policy.js        共享策略逻辑（域名匹配、意图会话）
src-tauri/              Rust 后端
  src/lib.rs            核心逻辑（策略、AI、截图）
  src/screenshot.rs     Win32 API 全桌面截图（DPI 感知）
  src/bin/server.rs     HTTP 服务（多供应商管理、配置解析）
  src/bin/native_host.rs 原生消息主机
tests/                  JS 测试（node:test）
```

## 构建发布

```bash
# 本地构建
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
- 白名单/高风险域名配置保存在 `AppData\Local\FocusGuard\policy-config.json`；桌面 UI 通过 `/policy-config` 保存，扩展会同步到 `chrome.storage.local.config`
- 域名匹配逻辑在 `shared/policy.js`、`extension/background.js` 和 Rust `lib.rs` 中各有一份，修改时需同步
- AI 系统提示必须以 `/no_think` 开头（防止 Qwen3 thinking 模式消耗所有 token）
- 供应商配置保存在 `AppData\Local\FocusGuard\providers.json`，不要提交 API Key、`.env` 或复制出来的本地配置文件
- 如果真实 API Key 曾经提交到 GitHub 历史记录，请在对应供应商后台重置 Key；仅删除当前代码里的 Key 不能让历史记录失效
