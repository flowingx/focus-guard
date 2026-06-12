# Focus Guard 专注守门员

[English](#english) | [中文](#中文)

## English

### Description

Focus Guard is a Windows-first focus guard application that helps you stay productive by soft-blocking distracting websites and monitoring desktop applications. It consists of a Chrome/Edge extension and a Rust desktop backend, working together to create a mindful browsing experience.

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Chrome/Edge   │     │  Native Host    │     │   Rust Backend  │     │   Desktop UI    │
│   Extension     │◄───►│  (Messaging)    │◄───►│   (Core Logic)  │◄───►│   (Tauri)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │                       │
        ▼                       ▼                       ▼                       ▼
   Interstitial           Windows API           Focus Monitor           Activity Log
   Options Page           Screenshot            AI Analysis            Settings Panel
   Content Scripts        Process Monitor       Reminder Engine         Export (CSV/JSON)
```

### Features

- **Smart Website Blocking**: Soft-blocks distracting sites with intent-based access
- **Intent Presets**: Customizable focus modes for different activities
- **Wildcard Domain Matching**: Supports patterns like `*.bilibili.*` for cross-TLD matching
- **Allowlist Rules**: Bypass focus prompts for productive sites (search engines, AI tools)
- **Desktop App Monitoring**: Tracks foreground applications (WeChat, QQ, etc.)
- **Local AI Analysis**: Optional screenshot analysis for enhanced focus detection
- **Activity Logging**: Records all focus sessions and interruptions
- **Cross-Platform**: Works on Windows with Chrome/Edge browsers

### Prerequisites

- **Node.js** (v18+ recommended)
- **Rust** (latest stable)
- **Chrome/Edge** browser with developer mode enabled
- **Windows 10/11** (for desktop monitoring features)

### Installation

#### 1. Clone the repository
```bash
git clone https://github.com/your-username/focus-guard.git
cd focus-guard
```

#### 2. Install dependencies
```bash
npm install
```

#### 3. Build the native host
```bash
cargo build --manifest-path src-tauri/Cargo.toml --bin focus-guard-native-host
```

#### 4. Load the extension
1. Open Chrome/Edge and navigate to `chrome://extensions` or `edge://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `extension` folder

#### 5. Register native messaging host
1. Copy `extension/native-messaging-host.example.json`
2. Update the `path` field with the absolute path to `focus-guard-native-host.exe`
3. Register the manifest in your browser's native messaging host location

### Development Setup

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run Rust tests
npm run test:rust

# Run all tests
npm run test:all
```

### Running Tests

```bash
# Run JavaScript tests
npm test

# Run Rust tests
cargo test --manifest-path src-tauri/Cargo.toml

# Run all tests
npm run test:all
```

### AI Setup (Optional)

Focus Guard supports optional local AI analysis for enhanced focus detection:

1. Install [llama.cpp](https://github.com/ggerganov/llama.cpp) or compatible server
2. Download the **Qwen3-VL-4B** model (or similar vision model)
3. Start the AI server with vision capabilities
4. Configure the endpoint in the Desktop UI settings panel

### Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 中文

### 项目描述

Focus Guard 是一个以 Windows 为核心的专注守门员应用，通过软性阻止干扰性网站和监控桌面应用程序来帮助你保持高效。它由 Chrome/Edge 扩展和 Rust 桌面后端组成，共同创建一个专注的浏览体验。

### 系统架构

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Chrome/Edge   │     │  原生主机        │     │   Rust 后端      │     │   桌面 UI       │
│   扩展          │◄───►│  (消息传递)      │◄───►│   (核心逻辑)     │◄───►│   (Tauri)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │                       │
        ▼                       ▼                       ▼                       ▼
   中间页面               Windows API            专注监控              活动日志
   选项页面               截图分析                AI 分析              设置面板
   内容脚本               进程监控                提醒引擎              导出 (CSV/JSON)
```

### 功能特点

- **智能网站阻止**：基于意图的软性阻止干扰性网站
- **意图预设**：针对不同活动的可自定义专注模式
- **通配符域名匹配**：支持 `*.bilibili.*` 等跨 TLD 匹配模式
- **白名单规则**：为生产力网站绕过专注提示（搜索引擎、AI 工具）
- **桌面应用监控**：跟踪前台应用程序（微信、QQ 等）
- **本地 AI 分析**：可选的截图分析，增强专注检测
- **活动记录**：记录所有专注会话和中断
- **跨平台支持**：支持 Windows 上的 Chrome/Edge 浏览器

### 环境要求

- **Node.js**（推荐 v18+）
- **Rust**（最新稳定版）
- **Chrome/Edge** 浏览器（需启用开发者模式）
- **Windows 10/11**（桌面监控功能）

### 安装步骤

#### 1. 克隆仓库
```bash
git clone https://github.com/your-username/focus-guard.git
cd focus-guard
```

#### 2. 安装依赖
```bash
npm install
```

#### 3. 构建原生主机
```bash
cargo build --manifest-path src-tauri/Cargo.toml --bin focus-guard-native-host
```

#### 4. 加载扩展
1. 打开 Chrome/Edge，访问 `chrome://extensions` 或 `edge://extensions`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"，选择 `extension` 文件夹

#### 5. 注册原生消息主机
1. 复制 `extension/native-messaging-host.example.json`
2. 更新 `path` 字段为 `focus-guard-native-host.exe` 的绝对路径
3. 将清单文件注册到浏览器的原生消息主机位置

### 开发环境设置

```bash
# 安装依赖
npm install

# 运行测试
npm test

# 运行 Rust 测试
npm run test:rust

# 运行所有测试
npm run test:all
```

### 运行测试

```bash
# 运行 JavaScript 测试
npm test

# 运行 Rust 测试
cargo test --manifest-path src-tauri/Cargo.toml

# 运行所有测试
npm run test:all
```

### AI 设置（可选）

Focus Guard 支持可选的本地 AI 分析，增强专注检测：

1. 安装 [llama.cpp](https://github.com/ggerganov/llama.cpp) 或兼容服务器
2. 下载 **Qwen3-VL-4B** 模型（或类似视觉模型）
3. 启动支持视觉能力的 AI 服务器
4. 在桌面 UI 设置面板中配置端点

### 贡献指南

1. Fork 仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m '添加惊人功能'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 创建 Pull Request

### 许可证

本项目采用 MIT 许可证 - 详情请查看 [LICENSE](LICENSE) 文件。