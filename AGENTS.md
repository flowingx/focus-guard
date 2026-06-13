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
```bash
cargo build --manifest-path src-tauri/Cargo.toml --release
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-server --release
cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-native-host --release
```

### 3. Load Chrome extension
- `chrome://extensions` → Developer mode → Load unpacked → select `extension/` folder

### 4. Open desktop UI
- `python3 -m http.server 3000 --bind 0.0.0.0 --directory desktop/`
- Browse to `http://localhost:3000`

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
