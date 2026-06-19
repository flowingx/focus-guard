# AGENTS.md

## Environment

- OS: WSL (Ubuntu) on Windows
- Node.js: v22.22.3 (nvm at `~/.nvm`)
- Rust: 1.96.0 (rustup at `~/.cargo`)
- GPU: RTX 4060 (CUDA 12.6 in WSL)

## Run Commands

```bash
# Source runtimes before any command
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && source "$HOME/.cargo/env"

# One-click start (builds + runs everything)
./start.sh          # Linux/WSL
start.bat           # Windows

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
- `src-tauri/` — Rust backend + Tauri desktop app. Communicates with extension via Chrome Native Messaging protocol (4-byte LE length prefix + JSON).
- `desktop/` — Desktop UI (HTML/JS/CSS, loaded by Tauri WebView on Windows, served by Python on Linux)
- `tests/` — JS tests using `node:test` + `node:assert/strict`. Run via `node tests/run.js`.

## Binaries

| Binary | Purpose | Port |
|--------|---------|------|
| `focus-guard-app` | Tauri desktop app (system tray + WebView UI + server management) | — |
| `focus-guard-server` | HTTP screenshot analysis + multi-provider AI | 3001 (0.0.0.0) |
| `focus-guard-native-host` | Chrome native messaging host (extension ↔ Rust) | stdin/stdout |

## How to Run

### 1. Start AI model (WSL/Linux)
```bash
# CPU mode
LD_LIBRARY_PATH=~/llama-cpp/llama-b9616 \
  ~/llama-cpp/llama-b9616/llama-server \
  --model ~/models/Qwen3VL-4B-Instruct-Q4_K_M.gguf \
  --mmproj ~/models/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf \
  --host 127.0.0.1 --port 8080 --ctx-size 4096

# GPU mode (requires CUDA build of llama.cpp)
LD_LIBRARY_PATH=/usr/local/cuda-12.6/lib64:/tmp/llama-cuda-build/build/bin \
  /tmp/llama-cuda-build/build/bin/llama-server \
  --model ~/models/Qwen3VL-4B-Instruct-Q4_K_M.gguf \
  --mmproj ~/models/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf \
  --host 127.0.0.1 --port 8080 --ctx-size 4096 -ngl 99
```

### 2. Build & run Rust services (Windows)
```powershell
cargo build --manifest-path src-tauri/Cargo.toml --release
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-app --release
# focus-guard-app auto-starts focus-guard-server, no need to run separately
```

### 3. Load Chrome extension
- `chrome://extensions` → Developer mode → Load unpacked → select `extension/` folder

### 4. Open desktop UI
- **Windows**: `focus-guard-app` opens a WebView window with the UI, or access via system tray
- **Linux/WSL**: `python3 -m http.server 3000 --bind 0.0.0.0 --directory desktop/` then browse to `http://localhost:3000`

## How to Debug

### Quick Diagnostic

| Problem | Check | Expected |
|---------|-------|----------|
| AI model not running | `curl http://127.0.0.1:8080/v1/models` | JSON with model list |
| Screenshot server not running | `curl http://127.0.0.1:3001/health` | `{"ok":true,...}` |
| Extension not loaded | `chrome://extensions` | Focus Guard shown, no errors |

### Server Logs & Endpoints

```powershell
# Capture stderr to file
.\focus-guard-server.exe 2> debug.log

# Health check
Invoke-RestMethod -Uri "http://127.0.0.1:3001/health"

# Screenshot + AI analysis
$body = '{}' | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3001/detect" -Method POST -Body $body -ContentType "application/json"

# Multi-provider management
Invoke-RestMethod -Uri "http://127.0.0.1:3001/providers" -Method GET
Invoke-RestMethod -Uri "http://127.0.0.1:3001/providers/test-all" -Method POST
```

### WSL↔Windows Debugging

WSL cannot run Win32 API directly. Use shared directory to trigger Windows-side tests:
```bash
echo "run_health" > /mnt/c/TestDir/run_test.trigger
cat /mnt/c/TestDir/test_result.log
```

### Firewall

```powershell
# Allow focus-guard-server through Windows Firewall (run as admin)
netsh advfirewall firewall add rule name=FocusGuard dir=in action=allow program=C:\TestDir\src-tauri\target\release\focus-guard-server.exe enable=yes
netsh advfirewall firewall add rule name=FocusGuard-3001 dir=in action=allow protocol=tcp localport=3001
```

## Critical: Policy Logic Duplication

`shared/policy.js` and `src-tauri/src/lib.rs` both implement domain matching (`matches_host_rule`), host normalization (`strip_www`), and allowlist evaluation. Changes to matching behavior must be made in **both** files to stay consistent.

## Rust Notes

- CI runs `cargo clippy -- -D warnings` — fix all warnings before pushing.
- `read_foreground_window()` and `capture_screen_thumbnail_base64()` return `None` on non-Windows. Uses `#[cfg(windows)]` / `#[cfg(not(windows))]` for platform-specific paths.
- Screenshot uses `SetProcessDPIAware()` for full resolution capture on high-DPI displays.
- Server binds to `0.0.0.0:3001` (not `127.0.0.1`) so WSL can reach it.
- `reqwest` with `blocking` feature used for outgoing HTTPS API calls.

## AI Configuration

- Supports both local llama.cpp and remote APIs (OpenAI format).
- Provider configs saved in `AppData\Local\FocusGuard\providers.json`.
- System prompt **must** start with `/no_think` for Qwen3 models.
- AI config is set in three places: `src-tauri/src/lib.rs` (`LocalAiConfig::default()`), `desktop/app.js` (`DEFAULT_LOCAL_AI`), and `src-tauri/src/ai_analyzer.rs`.
- Screenshot analysis prompt must instruct model to analyze ENTIRE screen, not just foreground window.

## Testing

- JS tests are assertion-based with `node:test` (no test framework). Extension tests do static analysis of file contents.
- Rust tests are standard unit/integration tests in `src-tauri/tests/desktop_policy.rs`.
- No JS linter or formatter is configured.
- CI runs on `windows-latest`, Node 20, Rust stable with clippy.

## GitHub CLI

- `gh` is installed and authenticated as `flowingx`
- Remote: `git@github.com:flowingx/focus-guard.git` (SSH)
- Git identity: `user.name = flowingx`, `user.email = flowingx@users.noreply.github.com`

## Rules

- **每次更改项目运行流程（启动命令、依赖、目录结构、二进制名称、端口号等），必须同步更新 `README.md` 和 `AGENTS.md`。**

## Known Bugs & TODO

### P0 - Critical

No known P0 items after the current build/test baseline.

### P1 - Important

1. **扩展 detect 端到端验证**: `triggerAiDetect` 的 fetch、错误日志、`scripting.insertCSS` + `scripting.executeScript` 注入流程已有 VM 行为测试保护；options 页也提供“检查服务”“立即检测”和最近 AI 检测日志。但仍需要在真实 Chrome extension service worker 中验证 `http://127.0.0.1:3001/detect` 调用、CORS、截图服务器返回和遮罩注入。
2. **分屏检测 AI 准确性**: 4B 小模型在分屏场景（左视频右学习）下仍可能误判为 study。需要更强的 prompt 或换用更大的视觉模型。
3. **强制干预流程真实验证**: `interference.js` 放行后创建短会话、注入失败日志、理由验证服务不可用时放行等已有自动化测试；仍需在真实网页中验证遮罩显示、按钮交互和样式覆盖。
4. **强制关闭页面真实验证**: `close_current_tab` 成功/失败返回和页面提示已有 VM 行为测试；仍需在真实 Chrome 标签页中验证 `chrome.tabs.remove(tabId)` 的关闭效果。

### P2 - Nice to Have

5. **深色模式切换**: CSS 使用 `[data-theme="dark"]` 和 `@media (prefers-color-scheme: dark)` 双重机制，但需验证手动切换是否正常工作。
6. **WSL 无法直连 Windows**: WSL 通过 `172.21.208.1:3001` 连接 Windows 超时。需要确认防火墙规则是否正确生效。

## Model Setup Notes

- Models are symlinked: `~/models/` → `/mnt/f/models/`
- **Do NOT delete model files directly, only `unlink` symlinks**
- llama.cpp build location: `~/llama-cpp/llama-b9616/` (CPU) and `/tmp/llama-cuda-build/` (GPU)
- CUDA toolkit: `/usr/local/cuda-12.6/`

## Notes

- Project requires Windows for full functionality (Win32 API for desktop monitoring)
- Local AI feature needs a running llama.cpp server with a vision model
- Server debug log written to `C:\TestDir\debug.log`
- Last screenshot saved to `C:\TestDir\last_screenshot.png`
