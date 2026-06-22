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
start.bat           # Windows, first calls stop.bat, then incremental build + hidden background start, opens browser, then exits
stop.bat            # Windows, stops focus-guard-server and local UI ports

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
- `desktop/` — Desktop UI (plain HTML/JS/CSS, served as static files)
- `tests/` — JS tests using `node:test` + `node:assert/strict`. Run via `node tests/run.js`.
- Background scheduled desktop checks live in `focus-guard-server`, not in the browser page. The UI controls `/scheduled-detect`; the server persists state in `AppData\Local\FocusGuard\scheduled-detect.json`.
- `focus-guard-server` handles each HTTP connection on its own thread so long AI `/detect` calls do not block `/health`. AI judgement records are persisted in `AppData\Local\FocusGuard\ai-records.json`; the server keeps the latest 1000 records for summaries while the desktop UI renders the latest 20 records and estimates daily/hourly productive, distracting, idle/no-change, and window/title minutes from the history. Original screenshots are not persisted by default.
- Policy settings for focus mode, high-risk domains, and allowlist rules live in `AppData\Local\FocusGuard\policy-config.json`. The desktop UI reads/writes `/policy-config`; the browser extension syncs this endpoint with `chrome.storage.local.config` so rules added from the Web UI and unknown-site prompt stay consistent.
- Privacy settings live in `AppData\Local\FocusGuard\privacy-config.json`. Cloud providers default to redacted/metadata-only analysis: if the optional OCR redactor is unavailable, `/detect` sends process/window title only. The optional local OCR redactor entrypoint is `tools/privacy_redactor.py` and expects CnOCR or EasyOCR plus Pillow when enabled. Manual screenshot analysis forces CnOCR redaction, stores only the redacted preview image in `ai-records.json`, and never persists the original screenshot. `FOCUS_GUARD_REDACTOR_PYTHON` can point to the conda/venv Python that has CnOCR installed, and `FOCUS_GUARD_CNOCR_MODEL_DIR` can point to `models\doc-densenet_lite_136-gru`. Run `python tools\verify_cnocr_redactor.py` to smoke-test the local CnOCR sidecar.
- Desktop detection is layered: local safe-signal extraction first, metadata-only cloud text AI second, and redacted/local screenshot only as a fallback. Cloud text AI should receive safe signals such as `code_tool`, `search`, `technical_research`, `bilibili`, and title classes rather than raw private text.

## Binaries

| Binary | Purpose | Port |
|--------|---------|------|
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
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-server --release
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-native-host --release
```

For normal Windows use, prefer `start.bat`. It runs an incremental release build, relaunches itself hidden, starts `focus-guard-server` and the static UI in the background, opens `http://localhost:3000`, writes logs under `logs\`, and exits. If `FOCUS_GUARD_REDACTOR_PYTHON` is unset and `E:\Software\miniConda3\envs\cnocr\python.exe` exists, it uses that dedicated CnOCR env for manual screenshot redaction. Use `stop.bat` to stop the background server/UI processes. For script debugging, run `start.bat --worker` to execute the worker path directly.

### 3. Load Chrome extension
- `chrome://extensions` → Developer mode → Load unpacked → select `extension/` folder

### 4. Open desktop UI
- `python3 -m http.server 3000 --bind 0.0.0.0 --directory desktop/`
- Browse to `http://localhost:3000`

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

# Background scheduled desktop checks
Invoke-RestMethod -Uri "http://127.0.0.1:3001/scheduled-detect" -Method GET
Invoke-RestMethod -Uri "http://127.0.0.1:3001/scheduled-detect" -Method POST -Body '{"enabled":true,"interval_minutes":5}' -ContentType "application/json"

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

`shared/policy.js`, `extension/background.js`, and `src-tauri/src/lib.rs` all implement domain matching (`matches_host_rule` / `matchesHostRule`), host normalization (`strip_www` / `stripWww`), and allowlist evaluation. Changes to matching behavior must be made in **all three** files to stay consistent.

## Rust Notes

- CI runs `cargo clippy -- -D warnings` — fix all warnings before pushing.
- `read_foreground_window()` returns `None` on non-Windows; `read_visible_windows()` returns an empty list on non-Windows; `capture_screen_thumbnail_base64()` returns `None` on non-Windows. Uses `#[cfg(windows)]` / `#[cfg(not(windows))]` for platform-specific paths.
- Default `/detect` uses foreground/visible-window metadata and does not capture screenshots. Screenshot capture is reserved for explicit `manual_screenshot:true` requests or local visual debugging.
- Browser extension AI detection may send low-sensitivity `page_metadata` such as site, page type, title class, and classification hints. Do not send full HTML, body text, comments, danmaku, recommendations, chat content, or account data.
- Screenshot uses `SetProcessDPIAware()` for full resolution capture on high-DPI displays.
- Server binds to `0.0.0.0:3001` (not `127.0.0.1`) so WSL can reach it.
- `reqwest` with `blocking` feature used for outgoing HTTPS API calls.

## AI Configuration

- Supports both local llama.cpp and remote APIs (OpenAI format).
- Provider configs saved in `AppData\Local\FocusGuard\providers.json`.
- System prompt **must** start with `/no_think` for Qwen3 models.
- AI config is set in three places: `src-tauri/src/lib.rs` (`LocalAiConfig::default()`), `desktop/app.js` (`DEFAULT_LOCAL_AI`), and `src-tauri/src/ai_analyzer.rs`.
- Screenshot analysis prompt must instruct model to analyze ENTIRE screen, not just foreground window, but default cloud analysis should remain metadata-only.

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

No known compile-blocking P0 at the moment. `focus-guard-server` currently passes `cargo check`, release build, and targeted server unit tests.

### P1 - Important

1. **扩展到后端 CORS 端到端**: 扩展的 `triggerAiDetect` 通过 `fetch("http://127.0.0.1:3001/detect")` 调用服务器；server 已返回 CORS headers，但仍需在 Chrome/Edge service worker 中端到端验证。
2. **分屏检测 AI 准确性**: 4B 小模型在分屏场景（左视频右学习）下仍可能误判为 study。需要更强的 prompt 或换用更大的视觉模型。
3. **强制干预流程**: `interference.js` 和 `interference.css` 已创建，但尚未完整测试。扩展的 `scripting.insertCSS` + `scripting.executeScript` 注入遮罩流程需要端到端验证。
4. **强制关闭页面**: `chrome.tabs.remove(tabId)` 可以关闭标签页，但 `interference.js` 中的 `close_current_tab` 消息处理需要验证是否能正确关闭页面。

### P2 - Nice to Have

5. **深色模式切换**: CSS 使用 `[data-theme="dark"]` 和 `@media (prefers-color-scheme: dark)` 双重机制，但需验证手动切换是否正常工作。
6. **Curl 解析更多样例**: `parse_curl` 已覆盖 `Authorization: Bearer`、`api-key` header、JSON body model、`--data-raw`、inline `--data=`；后续可继续添加供应商真实导出的 curl 样例。
7. **WSL 无法直连 Windows**: WSL 通过 `172.21.208.1:3001` 连接 Windows 超时。需要确认防火墙规则是否正确生效。
8. **后台定时巡检 UX**: 后端已能在 UI 关闭后定时巡检并弹提醒；后续可考虑把最近一次后台结果做成更明确的 UI 时间戳和确认按钮。

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
