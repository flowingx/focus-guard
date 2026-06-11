# Focus Guard

Focus Guard is a Windows-first focus guard MVP with two parts:

- A Chrome/Edge Manifest V3 extension that pauses high-risk websites until the user states an intent.
- A Rust desktop helper core with Windows foreground-window monitoring and Chrome Native Messaging framing.

The first version uses soft reminders and time-boxed sessions. It does not force-kill apps or try to infer intent with AI.

## What Works

- Default high-risk domains include Bilibili, YouTube, Douyin, Zhihu, Xiaohongshu, Weibo, Reddit, Twitch, Huya, Douyu, and more.
- High-risk site matching supports wildcard site-name rules such as `*.bilibili.*`, so country/TLD variants still match while unrelated domains such as `notbilibili.com` do not.
- Allowlist rules bypass focus prompts. Defaults include school suffixes (`*.edu`, `*.edu.cn`), search engines, and common AI research tools such as ChatGPT, Gemini, Tencent Yuanbao, ChatGLM, Kimi, DeepSeek, Doubao, Tongyi/Qwen, Copilot, Claude, Perplexity, Poe, Phind, You.com, Metaso, and iFlytek Spark.
- Exact allowlist rules can use `=domain`, for example `=baidu.com`, so search homepages can be allowed without allowing distracting subdomains such as Tieba.
- High-risk visits ask for a custom reason and duration.
- Unknown sites that are not allowlisted show a non-blocking in-page prompt instead of redirecting to a guard page. Choosing ignore adds that site to the allowlist.
- Unknown sites can also be allowed temporarily for 30 minutes without changing the high-risk or allowlist rules.
- The extension options page can edit focus mode, default duration, high-risk rules, and allowlist rules.
- High-risk sites also show default intent presets before custom input.
- Video sites start with three presets: `放松 10 分钟` (play, closes tab on expiry), `看网课/学习视频` (study, asks whether you are still studying), and `觉得无聊，先停一下` (play, closes tab on expiry).
- Later visits show up to three saved/default intent candidates and an "Other" path.
- Extension sessions expire through Chrome alarms and notifications.
- Rust core evaluates monitored apps such as WeChat, QQ, and Doubao.
- Rust core can read the Windows foreground process/window snapshot.
- Native host appends desktop-side activity records to `%LOCALAPPDATA%\FocusGuard\activity.jsonl`.
- Activity can be exported from the desktop UI as CSV/JSON.

## Run Tests

```powershell
npm test
npm run test:rust
```

## Load the Extension

1. Open Chrome or Edge.
2. Go to `chrome://extensions` or `edge://extensions`.
3. Enable developer mode.
4. Choose "Load unpacked".
5. Select the `extension` folder.

## Build the Native Host

```powershell
cargo build --manifest-path src-tauri/Cargo.toml --bin focus-guard-native-host
```

After building, update `extension/native-messaging-host.example.json` with the absolute path to `focus-guard-native-host.exe`, then register that manifest in the Chrome/Edge native messaging host registry location.

## Desktop UI

The current desktop UI is in `desktop/index.html`. It is shaped for a Tauri shell through `src-tauri/tauri.conf.json`, while the Rust core is kept dependency-light so tests can run without downloading Tauri packages.

## Current MVP Limits

- The extension can run standalone with browser-local storage if the native host is not registered.
- The Rust native host processes one Chrome Native Messaging payload per invocation, which matches Chrome's native-host launch model.
- The first version is intentionally soft-blocking. It warns, time-boxes, records, and reminds rather than forcibly closing apps.
