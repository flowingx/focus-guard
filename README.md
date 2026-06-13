# Focus Guard 专注守门员

Windows 为核心的专注守护应用。Chrome/Edge 扩展 + Rust 后端 + 本地 AI 截图分析，检测摸鱼行为并弹窗提醒。

## 系统架构

```
Chrome/Edge 扩展  ◄──Native Messaging──►  focus-guard-native-host (Rust)
                                                  │
                                          focus-guard-server (Rust, HTTP :3001)
                                                  │
                                          Win32 API 截图 → AI 分析
                                                  │
                                          llama-server (WSL/Linux, HTTP :8080)
```

## 快速启动

### 前置条件

- Windows 10/11
- Rust（rustup 安装）
- Node.js（v18+）
- Chrome/Edge 浏览器
- WSL 或 Linux（运行 AI 模型）

### 第一步：启动 AI 模型服务（WSL/Linux）

```bash
# 下载 llama.cpp 预编译二进制（或从源码编译）
# https://github.com/ggerganov/llama.cpp/releases

# 启动视觉模型服务
llama-server \
  --model /path/to/Qwen3VL-4B-Instruct-Q4_K_M.gguf \
  --mmproj /path/to/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 4096

# 验证服务
curl http://127.0.0.1:8080/v1/models
```

### 第二步：构建并运行 Rust 服务（Windows）

```bash
# 构建两个二进制
cargo build --manifest-path src-tauri/Cargo.toml --release

# 运行 HTTP 截图分析服务（端口 3001）
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-server --release

# 另一个终端：运行原生消息主机（供扩展通信）
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-native-host --release
```

### 第三步：加载 Chrome/Edge 扩展

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择项目中的 `extension/` 文件夹
4. （可选）注册原生消息主机以启用扩展↔Rust 通信

### 第四步：打开桌面 UI

```bash
# 用 Python 启动静态文件服务
python3 -m http.server 3000 --bind 0.0.0.0 --directory desktop/

# 浏览器打开
# http://localhost:3000
```

### 第五步：测试摸鱼检测

1. 在桌面 UI 中点击「检测摸鱼」按钮
2. focus-guard-server 会通过 Win32 API 截取当前前台窗口
3. 截图发送给 AI 分析，返回分类结果
4. 摸鱼时显示 🚨 警告，专注时显示 ✅ 正常

## 二进制说明

| 二进制 | 作用 | 端口 |
|--------|------|------|
| `focus-guard-server` | HTTP 截图分析服务，桌面 UI 调用 | 3001 |
| `focus-guard-native-host` | Chrome 原生消息主机，扩展通信 | stdin/stdout |

## AI 配置

- 端点：`http://127.0.0.1:8080/v1/chat/completions`
- 模型名：`Qwen3VL-4B-Instruct-Q4_K_M.gguf`（视觉模型）
- 系统提示必须以 `/no_think` 开头（防止 Qwen3 thinking 模式消耗所有 token）
- 详细故障排查见 `AI-CONFIG.md`

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
extension/          Chrome/Edge 扩展（Manifest V3）
desktop/            桌面 UI（HTML/JS/CSS）
shared/policy.js    共享策略逻辑（域名匹配、意图会话）
src-tauri/          Rust 后端
  src/lib.rs        核心逻辑（策略、AI、截图）
  src/screenshot.rs Win32 API 截图
  src/ai_analyzer.rs AI 分析器
  src/bin/server.rs HTTP 截图分析服务
  src/bin/native_host.rs 原生消息主机
tests/              JS 测试（node:test）
```

## 注意事项

- Win32 API 截图只在 Windows 上可用
- AI 模型需要 GPU 或大内存（4B 模型约需 1.4GB RAM）
- 扩展的白名单/高风险域名列表在 `shared/policy.js` 和 Rust `lib.rs` 中各有一份，修改时需同步
