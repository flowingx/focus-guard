# AGENTS.md

## Environment

- OS: WSL (Ubuntu) on Windows
- Node.js: v22.22.3 (installed via nvm at `~/.nvm`)
- Rust: 1.96.0 (installed via rustup at `~/.cargo`)

## Run Commands

```bash
# Source runtimes before any command
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && source "$HOME/.cargo/env"

# Run all tests
npm run test:all

# Run JS tests only
npm test

# Run Rust tests only
cargo test --manifest-path src-tauri/Cargo.toml

# Serve desktop UI for preview
python3 -m http.server 3000 --bind 0.0.0.0 --directory /home/flow/focus-guard/desktop
```

## Architecture

- `extension/` — Chrome/Edge Manifest V3 extension (service worker in `background.js`)
- `shared/policy.js` — Shared policy logic (domain matching, intent sessions, allowlists). Used by the extension.
- `src-tauri/` — Rust backend (`lib.rs` + modules). Communicates with extension via Chrome Native Messaging protocol (4-byte LE length prefix + JSON).
- `desktop/` — Desktop UI (plain HTML/JS/CSS, served as Tauri frontend via `tauri.conf.json`)
- `tests/` — JS tests using `node:test` + `node:assert/strict`. Run via `node tests/run.js`.

## Binaries

| Binary | Purpose | Port |
|--------|---------|------|
| `focus-guard-server` | HTTP screenshot analysis (called by desktop UI) | 3001 |
| `focus-guard-native-host` | Chrome native messaging host (extension ↔ Rust) | stdin/stdout |

## How to Run

### 1. Start AI model (WSL/Linux)
```bash
llama-server \
  --model /path/to/Qwen3VL-4B-Instruct-Q4_K_M.gguf \
  --mmproj /path/to/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf \
  --host 127.0.0.1 --port 8080 --ctx-size 4096
```

### 2. Build & run Rust services (Windows)
```powershell
cargo build --manifest-path src-tauri/Cargo.toml --release
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-server --release
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-native-host --release
```

### 3. Load Chrome extension
- `chrome://extensions` → Developer mode → Load unpacked → select `extension/` folder

### 4. Open desktop UI
- `python3 -m http.server 3000 --bind 0.0.0.0 --directory desktop/`
- Browse to `http://localhost:3000`

## How to Debug

### 快速诊断清单

| 问题 | 检查命令 | 正常输出 |
|------|----------|----------|
| AI 模型没启动 | `curl http://127.0.0.1:8080/v1/models` | JSON with model list |
| 截图服务没启动 | `curl http://127.0.0.1:3001/health` | `{"ok":true,...}` |
| 端口转发没配置 | `netsh interface portproxy show v4tov4` | 有 8080 端口条目 |
| 扩展没加载 | `chrome://extensions` | Focus Guard 显示且无错误 |

### 调试 focus-guard-server

**查看日志：** stderr 输出到控制台
```powershell
.\focus-guard-server.exe 2> debug.log
```

**调试文件：** 运行时写入 `C:\TestDir\debug.log`，包含 AI 请求/响应详情

**手动测试端点：**
```powershell
# 健康检查
Invoke-RestMethod -Uri "http://127.0.0.1:3001/health"

# 截图+AI分析
$body = '{}' | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3001/detect" -Method POST -Body $body -ContentType "application/json"
```

### 调试 AI 连接

```powershell
# 测试 llama-server 是否可达
Invoke-RestMethod -Uri "http://127.0.0.1:8080/v1/models"

# 手动发一个分类请求
$body = '{"model":"Qwen3VL-4B-Instruct-Q4_K_M.gguf","messages":[{"role":"system","content":"/no_think\nClassify activity."},{"role":"user","content":"Process: chrome.exe. Window title: bilibili.com"}],"max_tokens":100}'
Invoke-RestMethod -Uri "http://127.0.0.1:8080/v1/chat/completions" -Method POST -Body $body -ContentType "application/json"
```

### 调试扩展

- 右键扩展图标 → 「检查弹出页面」→ Console 查看日志
- `chrome://extensions` → Focus Guard → 「背景页」→ Console 查看 service worker 日志
- `chrome://serviceworker-internals` → 可以 stop/restart service worker

### 环境变量配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FG_AI_ENDPOINT` | `http://127.0.0.1:8080/v1/chat/completions` | AI 服务地址 |
| `FG_AI_MODEL` | `Qwen3VL-4B-Instruct-Q4_K_M.gguf` | 模型名称 |
| `FG_SERVER_PORT` | `3001` | 截图服务端口 |

```powershell
# 自定义 AI 地址
$env:FG_AI_ENDPOINT="http://192.168.1.100:8080/v1/chat/completions"
.\focus-guard-server.exe
```

### WSL↔Windows 调试

WSL 中无法直接运行 Win32 API。通过共享目录触发 Windows 端测试：
```bash
# 在 WSL 中触发 Windows 构建+测试
echo "run_health" > /mnt/c/TestDir/run_test.trigger
# 结果写入 C:\TestDir\test_result.log
cat /mnt/c/TestDir/test_result.log
```

## Build & Release

### 本地构建
```powershell
cargo build --manifest-path src-tauri/Cargo.toml --release
# 产物: src-tauri/target/release/focus-guard-server.exe
```

### GitHub Actions 自动构建
- 推送 `v*` 标签自动触发 Windows 构建
- 产物: `focus-guard-windows-x64.zip`（含 exe + extension + desktop）

```bash
# 打标签触发发布
git tag v0.1.0
git push origin v0.1.0
```

### 发布包内容
```
focus-guard-windows-x64.zip
├── focus-guard-server.exe        # 截图分析服务
├── focus-guard-native-host.exe   # 扩展通信主机
├── extension/                    # 浏览器扩展
├── desktop/                      # 桌面 UI
├── README.md
└── AI-CONFIG.md
```

## Critical: Policy Logic Duplication

`shared/policy.js` and `src-tauri/src/lib.rs` both implement domain matching (`matches_host_rule`), host normalization (`strip_www`), and allowlist evaluation. Changes to matching behavior must be made in **both** files to stay consistent.

## Rust Notes

- CI runs `cargo clippy -- -D warnings` — fix all warnings before pushing.
- `read_foreground_window()` and `capture_screen_thumbnail_base64()` return `None` on non-Windows. The codebase uses `#[cfg(windows)]` / `#[cfg(not(windows))]` for platform-specific paths.
- Binary target: `focus-guard-native-host` (native messaging host). Build: `cargo build --manifest-path src-tauri/Cargo.toml --bin focus-guard-native-host`

## AI Configuration

- Local AI endpoint: `http://127.0.0.1:8080/v1/chat/completions` (must be localhost; enforced in Rust).
- Model name: `Qwen3VL-4B-Instruct-Q4_K_M.gguf` (vision model, not the text-only variant).
- System prompt **must** start with `/no_think` or Qwen3 thinking mode consumes all tokens and returns empty content.
- AI config is set in three places that must stay in sync: `src-tauri/src/lib.rs` (`LocalAiConfig::default()`), `desktop/app.js` (`DEFAULT_LOCAL_AI`), and `src-tauri/src/ai_analyzer.rs`.
- See `AI-CONFIG.md` for troubleshooting.

## Testing

- JS tests are assertion-based with `node:test` (no test framework). Extension tests do static analysis of file contents.
- Rust tests are standard unit/integration tests in `src-tauri/tests/desktop_policy.rs`.
- No JS linter or formatter is configured.
- CI runs on `windows-latest`, Node 20, Rust stable with clippy.

## GitHub CLI

- `gh` is installed and authenticated as `flowingx`
- Remote: `git@github.com:flowingx/focus-guard.git` (SSH)
- Git identity for this repo:
  ```
  user.name = flowingx
  user.email = flowingx@users.noreply.github.com
  ```

## Rules

- **每次更改项目运行流程（启动命令、依赖、目录结构、二进制名称、端口号等），必须同步更新 `README.md` 和 `AGENTS.md`。**

## Notes

- Project requires Windows for full functionality (Win32 API for desktop monitoring)
- Local AI feature needs a running llama.cpp server with a vision model
