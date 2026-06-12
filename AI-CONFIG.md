# AI 配置 — 每次开发前必须读取

> ⚠️ 这个文件记录了 AI 功能的正确配置。任何涉及 AI 的改动前必须先读取此文件。

## 服务器信息

- **运行地址**: `http://127.0.0.1:8080`
- **API 格式**: OpenAI 兼容 (`/v1/chat/completions`)
- **模型名**: `Qwen3-4B-Q4_K_M.gguf`（不是 `Qwen/Qwen3-VL-4B-Instruct-GGUF`）
- **启动方式**: `llama-server` 进程，需要手动启动

## 关键配置项

| 配置项 | 正确值 | 错误值（不要用） |
|--------|--------|-----------------|
| 端点 | `http://127.0.0.1:8080/v1/chat/completions` | `http://127.0.0.1:11434/api/generate` |
| 模型名 | `Qwen3-4B-Q4_K_M.gguf` | `Qwen/Qwen3-VL-4B-Instruct-GGUF` |
| 请求格式 | OpenAI chat completions (`messages` 数组) | Ollama generate (`prompt` 字段) |
| 响应解析 | `choices[0].message.content` | `response` 字段 |
| /no_think | system prompt 必须以 `/no_think` 开头，否则 Qwen3 thinking 模式会消耗所有 token，content 为空 | 不加会导致"输出异常" |

## 常见报错及原因

| 错误信息 | 原因 | 修复 |
|----------|------|------|
| "输出异常" | 模型名不匹配，服务器找不到模型 | 更新模型名为 `Qwen3-4B-Q4_K_M.gguf` |
| content 为空 | Qwen3 thinking 模式开启 | 请求中加 `"extra_body":{"enable_thinking":false}` |
| HTTP 404 | 端点路径错误 | 确保是 `/v1/chat/completions` 不是 `/api/generate` |
| 连接拒绝 | llama-server 未启动 | 手动启动 llama-server |

## 需要同步修改的文件

1. `src-tauri/src/lib.rs` — `LocalAiConfig::default()` 中的 model 字段
2. `desktop/app.js` — `DEFAULT_LOCAL_AI` 中的 model 字段
3. `src-tauri/src/ai_analyzer.rs` — `AiAnalyzer::default()` 中的 model 字段（如果启用）

## 验证命令

```powershell
# 检查服务器是否运行
Invoke-RestMethod -Uri "http://127.0.0.1:8080/v1/models"

# 测试 API 调用
$body = '{"model":"Qwen3-4B-Q4_K_M.gguf","messages":[{"role":"user","content":"Say hi"}],"max_tokens":10}'
Invoke-RestMethod -Uri "http://127.0.0.1:8080/v1/chat/completions" -Method POST -Body $body -ContentType "application/json"
```
