const DEFAULT_DOMAINS = [
  "*.bilibili.*",
  "*.youtube.*",
  "*.douyin.*",
  "*.tiktok.*",
  "*.kuaishou.*",
  "*.zhihu.*",
  "*.weibo.*",
  "*.xiaohongshu.*",
  "*.douban.*",
  "tieba.baidu.com",
  "*.hupu.*",
  "*.reddit.*",
  "x.com",
  "*.twitter.*",
  "*.netflix.*",
  "*.iqiyi.*",
  "*.youku.*",
  "*.mgtv.*",
  "*.twitch.*",
  "*.huya.*",
  "*.douyu.*",
  "*.nga.*",
  "*.steamcommunity.*",
];

const DEFAULT_APPS = ["WeChat.exe", "QQ.exe", "Doubao.exe", "doubao.exe"];

const DEFAULT_LOCAL_AI = {
  enabled: false,
  endpoint: "http://127.0.0.1:8080",
  model: "Qwen3-4B-Q4_K_M.gguf",
  sampleIntervalSeconds: 30,
  confidenceThreshold: 0.75,
};

const DEFAULT_ALLOWLIST_RULES = [
  "*.edu",
  "*.edu.cn",
  "*.ac.*",
  "*.google.*",
  "*.bing.*",
  "*.duckduckgo.*",
  "*.ecosia.*",
  "*.yandex.*",
  "search.yahoo.com",
  "www.sogou.com",
  "www.so.com",
  "=baidu.com",
  "=www.baidu.com",
  "=m.baidu.com",
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "yuanbao.tencent.com",
  "chatglm.cn",
  "kimi.moonshot.cn",
  "chat.deepseek.com",
  "www.doubao.com",
  "tongyi.com",
  "qianwen.aliyun.com",
  "copilot.microsoft.com",
  "claude.ai",
  "perplexity.ai",
  "poe.com",
  "phind.com",
  "you.com",
  "metaso.cn",
  "xinghuo.xfyun.cn",
];

const state = loadState();

render();

document.getElementById("toggle-focus").addEventListener("click", () => {
  state.focusMode = !state.focusMode;
  saveState();
  render();
});

document.getElementById("high-risk-domains").addEventListener("change", (event) => {
  state.highRiskDomains = splitLines(event.target.value);
  saveState();
});

document.getElementById("monitored-apps").addEventListener("change", (event) => {
  state.monitoredApps = splitLines(event.target.value);
  saveState();
});

document.getElementById("allowlist-rules").addEventListener("change", (event) => {
  state.allowlistRules = splitLines(event.target.value);
  saveState();
});

document.getElementById("local-ai-enabled").addEventListener("change", (event) => {
  state.localAi.enabled = event.target.checked;
  saveState();
  render();
});

document.getElementById("local-ai-endpoint").addEventListener("change", (event) => {
  state.localAi.endpoint = event.target.value.trim() || DEFAULT_LOCAL_AI.endpoint;
  saveState();
  render();
});

document.getElementById("local-ai-model").addEventListener("change", (event) => {
  state.localAi.model = event.target.value.trim() || DEFAULT_LOCAL_AI.model;
  saveState();
  render();
});

document.getElementById("local-ai-sample-interval").addEventListener("change", (event) => {
  state.localAi.sampleIntervalSeconds = clampNumber(event.target.value, 5, 600, 30);
  saveState();
  render();
});

document.getElementById("local-ai-confidence-threshold").addEventListener("change", (event) => {
  state.localAi.confidenceThreshold = clampNumber(event.target.value, 0, 1, 0.75);
  saveState();
  render();
});

document.getElementById("test-local-ai").addEventListener("click", async () => {
  await testLocalAi();
});

document.getElementById("detect-now").addEventListener("click", async () => {
  await detectProcrastination();
});

function setupInlineInput(config) {
  const { addBtnId, inputRowId, inputId, confirmId, cancelId, placeholder, onAdd } = config;
  const addBtn = document.getElementById(addBtnId);
  const inputRow = document.getElementById(inputRowId);
  const input = document.getElementById(inputId);
  const confirmBtn = document.getElementById(confirmId);
  const cancelBtn = document.getElementById(cancelId);

  function show() {
    inputRow.classList.remove("hidden");
    input.value = "";
    input.focus();
  }

  function hide() {
    inputRow.classList.add("hidden");
  }

  function confirm() {
    const value = input.value.trim();
    if (value) {
      onAdd(value);
      hide();
    }
  }

  addBtn.addEventListener("click", show);
  confirmBtn.addEventListener("click", confirm);
  cancelBtn.addEventListener("click", hide);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirm();
    if (e.key === "Escape") hide();
  });
}

setupInlineInput({
  addBtnId: "add-domain",
  inputRowId: "domain-input-row",
  inputId: "domain-input",
  confirmId: "domain-confirm",
  cancelId: "domain-cancel",
  onAdd: (value) => {
    state.highRiskDomains = unique([...state.highRiskDomains, value]);
    saveState();
    render();
  },
});

setupInlineInput({
  addBtnId: "add-app",
  inputRowId: "app-input-row",
  inputId: "app-input",
  confirmId: "app-confirm",
  cancelId: "app-cancel",
  onAdd: (value) => {
    state.monitoredApps = unique([...state.monitoredApps, value]);
    saveState();
    render();
  },
});

setupInlineInput({
  addBtnId: "add-allowlist-rule",
  inputRowId: "rule-input-row",
  inputId: "rule-input",
  confirmId: "rule-confirm",
  cancelId: "rule-cancel",
  onAdd: (value) => {
    state.allowlistRules = unique([...state.allowlistRules, value]);
    saveState();
    render();
  },
});

document.getElementById("export-csv").addEventListener("click", () => {
  download("focus-guard-activity.csv", toCsv(state.activityLog), "text/csv");
});

document.getElementById("export-json").addEventListener("click", () => {
  download(
    "focus-guard-activity.json",
    JSON.stringify(state.activityLog, null, 2),
    "application/json",
  );
});

function render() {
  document.getElementById("focus-state").textContent = state.focusMode
    ? "专注模式开启"
    : "专注模式关闭";
  document.getElementById("high-risk-domains").value = state.highRiskDomains.join("\n");
  document.getElementById("monitored-apps").value = state.monitoredApps.join("\n");
  document.getElementById("allowlist-rules").value = state.allowlistRules.join("\n");
  document.getElementById("local-ai-enabled").checked = state.localAi.enabled;
  document.getElementById("local-ai-endpoint").value = state.localAi.endpoint;
  document.getElementById("local-ai-model").value = state.localAi.model;
  document.getElementById("local-ai-sample-interval").value = state.localAi.sampleIntervalSeconds;
  document.getElementById("local-ai-confidence-threshold").value = state.localAi.confidenceThreshold;
  renderLocalAiStatus();
  renderActivity();
}

function renderLocalAiStatus() {
  const status = document.getElementById("local-ai-status");
  const dot = document.getElementById("ai-status-dot");
  const stateText = state.localAi.status ?? (state.localAi.enabled ? "待测试" : "未启用");
  status.textContent = stateText;

  dot.className = "status-dot";
  if (stateText.includes("已连接")) {
    status.className = "pill ok-pill";
    dot.classList.add("connected");
  } else if (stateText === "测试中...") {
    status.className = "pill muted-pill";
    dot.classList.add("testing");
  } else if (stateText === "输出异常" || stateText === "未连接") {
    status.className = "pill muted-pill";
    dot.classList.add("error");
  } else {
    status.className = "pill muted-pill";
  }
}

function renderActivity() {
  const container = document.getElementById("activity-log");

  if (state.activityLog.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="24" r="23" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/>
          <path d="M24 16v12M24 32v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <p class="empty-title">暂无活动记录</p>
        <p class="empty-hint">当检测到高风险网站或应用的使用时，记录会显示在这里。</p>
      </div>`;
    return;
  }

  container.innerHTML = state.activityLog
    .slice()
    .reverse()
    .map(
      (record) => `<div class="activity-row">
        <span>${new Date(record.timestamp).toLocaleString()}</span>
        <strong>${escapeHtml(record.target)}</strong>
        <span>${escapeHtml(record.reason)}</span>
        <span>${record.minutes} 分钟</span>
      </div>`,
    )
    .join("");
}

function loadState() {
  const stored = localStorage.getItem("focus-guard-state");

  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      return {
        ...parsed,
        highRiskDomains: parsed.highRiskDomains ?? DEFAULT_DOMAINS,
        allowlistRules: parsed.allowlistRules ?? DEFAULT_ALLOWLIST_RULES,
        monitoredApps: parsed.monitoredApps ?? DEFAULT_APPS,
        activityLog: parsed.activityLog ?? [],
        localAi: { ...DEFAULT_LOCAL_AI, ...(parsed.localAi ?? {}) },
      };
    } catch {
      localStorage.removeItem("focus-guard-state");
    }
  }

  return {
    focusMode: true,
    highRiskDomains: DEFAULT_DOMAINS,
    allowlistRules: DEFAULT_ALLOWLIST_RULES,
    monitoredApps: DEFAULT_APPS,
    activityLog: [],
    localAi: { ...DEFAULT_LOCAL_AI },
  };
}

function saveState() {
  if (state.activityLog.length > 500) {
    state.activityLog = state.activityLog.slice(-500);
  }
  localStorage.setItem("focus-guard-state", JSON.stringify(state));
}

function splitLines(value) {
  return unique(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function unique(values) {
  return [...new Set(values)];
}

function toCsv(records) {
  const header = "timestamp,target,reason,minutes\n";
  const rows = records
    .map((record) => {
      return [record.timestamp, record.target, record.reason, record.minutes]
        .map(csvCell)
        .join(",");
    })
    .join("\n");

  return `${header}${rows}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function testLocalAi() {
  state.localAi.status = "测试中...";
  renderLocalAiStatus();

  try {
    const url = `${state.localAi.endpoint}/v1/chat/completions`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: state.localAi.model,
        messages: [
          {
            role: "user",
            content: "Reply with exactly: {\"status\":\"ok\",\"model\":\"your_name\"}",
          },
        ],
        stream: false,
        max_tokens: 64,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content ?? "";
    const model = payload.model || state.localAi.model;
    state.localAi.status = content.includes("ok") ? `已连接 (${model})` : "输出异常";
  } catch {
    state.localAi.status = "未连接";
  }

  saveState();
  renderLocalAiStatus();
}

async function detectProcrastination() {
  const resultBox = document.getElementById("detect-result");
  resultBox.classList.remove("hidden");
  resultBox.className = "detect-result";
  resultBox.innerHTML = `
    <div class="detect-loading">
      <div class="spinner"></div>
      <span>正在截图分析当前桌面...</span>
    </div>
  `;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const response = await fetch("http://127.0.0.1:3001/detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const result = await response.json();

    if (result.error) {
      resultBox.className = "detect-result warn";
      resultBox.innerHTML = `
        <div class="detect-card">
          <div class="detect-icon warn">⚠️</div>
          <div class="detect-info">
            <strong>检测失败</strong>
            <p class="detect-reason">${escapeHtml(result.error)}</p>
          </div>
        </div>
      `;
      return;
    }

    const isDistracting =
      result.category === "distracting" || result.category === "distraction";
    const confidence = Math.round((result.confidence || 0) * 100);
    const windowInfo = result.process_name
      ? `${result.process_name} — ${result.window_title}`
      : "";

    if (isDistracting) {
      resultBox.className = "detect-result danger";
      resultBox.innerHTML = `
        <div class="detect-card">
          <div class="detect-icon danger">🚨</div>
          <div class="detect-info">
            <strong>检测到摸鱼行为</strong>
            <p class="detect-reason">${escapeHtml(result.reason || "")}</p>
            <div class="detect-meta">
              <span class="tag tag-danger">${escapeHtml(result.category)}</span>
              <span>置信度: ${confidence}%</span>
              <span>建议: ${result.suggested_action === "intent_required" ? "需要输入意图" : "观察中"}</span>
            </div>
            ${windowInfo ? `<p class="detect-window">${escapeHtml(windowInfo)}</p>` : ""}
            ${result.has_screenshot ? `<p class="detect-hint">截图已发送给 AI 分析 (${result.screenshot_bytes} bytes base64)</p>` : ""}
          </div>
        </div>
      `;
    } else {
      resultBox.className = "detect-result ok";
      resultBox.innerHTML = `
        <div class="detect-card">
          <div class="detect-icon ok">✅</div>
          <div class="detect-info">
            <strong>专注状态正常</strong>
            <p class="detect-reason">${escapeHtml(result.reason || "")}</p>
            <div class="detect-meta">
              <span class="tag tag-ok">${escapeHtml(result.category)}</span>
              <span>置信度: ${confidence}%</span>
            </div>
            ${windowInfo ? `<p class="detect-window">${escapeHtml(windowInfo)}</p>` : ""}
            ${result.has_screenshot ? `<p class="detect-hint">截图已发送给 AI 分析 (${result.screenshot_bytes} bytes base64)</p>` : ""}
          </div>
        </div>
      `;
    }
  } catch (error) {
    const msg =
      error.name === "AbortError"
        ? "请求超时，focus-guard-server 可能未运行"
        : error.message?.includes("fetch")
          ? "无法连接 focus-guard-server，请先在 Windows 上运行: cargo run --bin focus-guard-server"
          : error.message || "未知错误";

    resultBox.className = "detect-result warn";
    resultBox.innerHTML = `
      <div class="detect-card">
        <div class="detect-icon warn">⚠️</div>
        <div class="detect-info">
          <strong>AI 服务不可用</strong>
          <p class="detect-reason">${escapeHtml(msg)}</p>
          <p class="detect-hint">确保 focus-guard-server 在 Windows 上运行（端口 3001），且 llama-server 在 WSL 端口 8080 运行</p>
        </div>
      </div>
    `;
  }
}

function parseAnalysisResult(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.category === "string" && typeof parsed.confidence === "number") {
      return {
        category: parsed.category,
        confidence: parsed.confidence,
        description: parsed.description || "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

function isStructuredAiOutput(value) {
  return parseAnalysisResult(value) !== null;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}
