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
  mode: "api",
  endpoint: "https://ark.cn-beijing.volces.com/api/v3",
  model: "ep-20260617210329-lsz4k",
  apiKey: "",
  apiBaseUrl: "https://api.openai.com",
  apiModel: "",
  sampleIntervalSeconds: 30,
  confidenceThreshold: 0.75,
};

const SERVER = "http://127.0.0.1:3001";
const MASKED_KEY = "••••••••";
let serverHealth = "checking";

function getFullEndpoint(base) {
  const url = (base || "").trim().replace(/\/+$/, "");
  if (url.includes("ark.cn-beijing.volces.com")) {
    if (url.endsWith("/responses")) return url;
    return url + "/responses";
  }
  if (url.endsWith("/v1/chat/completions")) return url;
  if (url.endsWith("/v1")) return url + "/chat/completions";
  return url + "/v1/chat/completions";
}

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

applyTheme(state.theme ?? "system");
render();
loadApiConfig();
refreshBackendStatus();
setInterval(refreshBackendStatus, 3000);

function applyTheme(theme) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    btn.textContent = isDark ? "☀️" : "🌙";
  }
}

document.getElementById("theme-toggle").addEventListener("click", () => {
  const current = state.theme ?? "system";
  const next = current === "light" ? "dark" : current === "dark" ? "system" : "light";
  state.theme = next;
  applyTheme(next);
  saveState();
});

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
  renderLocalAiStatus();
});

async function loadApiConfig() {
  try {
    const resp = await fetch(`${SERVER}/config`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    state.localAi.endpoint = data.endpoint || state.localAi.endpoint;
    state.localAi.model = data.model || state.localAi.model;
    state.localAi.mode = data.mode || state.localAi.mode;
    document.getElementById("pe-base-url").value = state.localAi.endpoint;
    document.getElementById("pe-model").value = state.localAi.model;
    document.getElementById("pe-api-key").value = data.hasApiKey ? MASKED_KEY : "";
    saveState();
    renderLocalAiStatus();
  } catch {
    renderLocalAiStatus();
  }
}

document.getElementById("pe-save-btn").addEventListener("click", async () => {
  await saveApiConfig({ showAlert: true });
});

document.getElementById("pe-change-key-btn").addEventListener("click", () => {
  const keyInput = document.getElementById("pe-api-key");
  keyInput.value = "";
  keyInput.placeholder = "输入新的 API Key";
  keyInput.focus();
});

document.getElementById("pe-fetch-models-btn").addEventListener("click", fetchModels);
document.getElementById("pe-test-btn").addEventListener("click", testApiConfig);

async function saveApiConfig(options = {}) {
  const endpoint = document.getElementById("pe-base-url").value.trim();
  const model = document.getElementById("pe-model").value.trim();
  const keyInput = document.getElementById("pe-api-key");
  const apiKey = keyInput.value.trim();

  if (!endpoint) {
    document.getElementById("pe-base-url").focus();
    return false;
  }
  if (!model) {
    document.getElementById("pe-model").focus();
    return false;
  }

  const payload = {
    mode: endpoint.includes("127.0.0.1") || endpoint.includes("localhost") ? "local" : "api",
    endpoint,
    model,
  };
  if (apiKey && apiKey !== MASKED_KEY) {
    payload.api_key = apiKey;
  }

  try {
    const resp = await fetch(`${SERVER}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.localAi.endpoint = endpoint;
    state.localAi.model = model;
    state.localAi.mode = payload.mode;
    state.localAi.enabled = true;
    document.getElementById("local-ai-enabled").checked = true;
    if (apiKey && apiKey !== MASKED_KEY) {
      keyInput.value = MASKED_KEY;
    }
    saveState();
    await refreshBackendStatus();
    renderLocalAiStatus();
    if (options.showAlert) {
      showDetectMessage("ok", "配置已保存", "Base URL、Model 和 API Key 已更新。");
    }
    return true;
  } catch (e) {
    showDetectMessage("warn", "保存失败", e.message || "无法连接后端服务");
    return false;
  }
}

async function fetchModels() {
  if (!(await saveApiConfig())) return;
  state.localAi.status = "拉取模型中...";
  renderLocalAiStatus();

  try {
    const resp = await fetch(`${SERVER}/models`, { signal: AbortSignal.timeout(15000) });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    const models = Array.isArray(data.data)
      ? data.data.map((item) => item.id).filter(Boolean)
      : [];
    renderModelOptions(models);
    if (models.length > 0 && !document.getElementById("pe-model").value.trim()) {
      document.getElementById("pe-model").value = models[0];
    }
    state.localAi.status = models.length > 0 ? `已拉取 ${models.length} 个模型` : "未返回模型";
  } catch (e) {
    state.localAi.status = "模型拉取失败";
    showDetectMessage("warn", "模型拉取失败", e.message || "请检查 Base URL 和 API Key");
  }
  saveState();
  renderLocalAiStatus();
}

async function testApiConfig() {
  if (!(await saveApiConfig())) return;
  const model = document.getElementById("pe-model").value.trim();
  state.localAi.status = "测试中...";
  renderLocalAiStatus();

  try {
    const resp = await fetch(`${SERVER}/test-model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || "模型测试失败");
    state.localAi.status = "API 已连接";
    showDetectMessage("ok", "API 测试通过", data.response || `${model} 可用`);
  } catch (e) {
    state.localAi.status = "API 失败";
    showDetectMessage("warn", "API 测试失败", e.message || "请检查 Key、Base URL 和 Model");
  }
  saveState();
  renderLocalAiStatus();
}

function renderModelOptions(models) {
  document.getElementById("pe-model-options").innerHTML = models
    .map((model) => `<option value="${escapeHtml(model)}"></option>`)
    .join("");
}

function render() {
  document.getElementById("focus-state").textContent = state.focusMode
    ? "专注模式开启"
    : "专注模式关闭";
  document.getElementById("high-risk-domains").value = state.highRiskDomains.join("\n");
  document.getElementById("monitored-apps").value = state.monitoredApps.join("\n");
  document.getElementById("allowlist-rules").value = state.allowlistRules.join("\n");
  document.getElementById("local-ai-enabled").checked = state.localAi.enabled;
  renderLocalAiStatus();
  renderActivity();
}

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
  renderLocalAiStatus();
  renderActivity();
}

async function refreshBackendStatus() {
  const previous = serverHealth;
  serverHealth = "checking";
  if (previous !== "connected") renderLocalAiStatus();

  try {
    const resp = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(1200) });
    const payload = await resp.json();
    serverHealth = resp.ok && payload.ok ? "connected" : "disconnected";
  } catch {
    serverHealth = "disconnected";
  }

  renderLocalAiStatus();
}

function renderLocalAiStatus() {
  const status = document.getElementById("local-ai-status");
  const dot = document.getElementById("ai-status-dot");
  const operationStatus = state.localAi.status;
  const stateText =
    operationStatus === "测试中..." || operationStatus === "拉取模型中..."
      ? operationStatus
      : serverHealth === "connected"
        ? "后端已连接"
        : serverHealth === "checking"
          ? "检查中..."
          : "后端未连接";

  status.textContent = stateText;

  dot.className = "status-dot";
  if (serverHealth === "connected" && !stateText.includes("失败")) {
    status.className = "pill ok-pill";
    dot.classList.add("connected");
  } else if (serverHealth === "checking" || stateText === "测试中..." || stateText === "拉取模型中...") {
    status.className = "pill muted-pill";
    dot.classList.add("testing");
  } else {
    status.className = "pill muted-pill";
    dot.classList.add("error");
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
  await saveApiConfig();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${SERVER}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    if (payload.ok) {
      state.localAi.status = "已连接";
    } else {
      state.localAi.status = "响应异常";
    }
  } catch {
    state.localAi.status = "未连接";
  }
  saveState();
  renderLocalAiStatus();
}

function focusApiConfig() {
  document.getElementById("pe-api-key").focus();
}

function showDetectMessage(kind, title, message) {
  const resultBox = document.getElementById("detect-result");
  const icon = kind === "ok" ? "✅" : kind === "danger" ? "🚨" : "⚠️";
  resultBox.classList.remove("hidden");
  resultBox.className = `detect-result ${kind}`;
  resultBox.innerHTML = `
    <div class="detect-card">
      <div class="detect-icon">${icon}</div>
      <div class="detect-info">
        <strong>${escapeHtml(title)}</strong>
        <p class="detect-reason">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

async function detectProcrastination() {
  const resultBox = document.getElementById("detect-result");
  resultBox.classList.remove("hidden");
  resultBox.className = "detect-result";

  try {
    await refreshBackendStatus();
    const healthCheck = await fetch(`${SERVER}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!healthCheck.ok) throw new Error("server down");
  } catch {
    resultBox.className = "detect-result warn";
    resultBox.innerHTML = `
      <div class="detect-card">
        <div class="detect-icon">⚠️</div>
        <div class="detect-info">
          <strong>服务未连接</strong>
          <p class="detect-reason">请先在 Windows 上启动 focus-guard-server（端口 3001）</p>
          <p class="detect-hint">cargo run --manifest-path src-tauri/Cargo.toml --bin focus-guard-server --release</p>
        </div>
      </div>
    `;
    return;
  }

  resultBox.innerHTML = `
    <div class="detect-loading">
      <div class="spinner"></div>
      <span>正在截图分析当前桌面...</span>
    </div>
  `;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    const response = await fetch(`${SERVER}/detect`, {
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
      const needsKey = result.error.includes("api_error") || result.error.includes("Unauthorized") || result.error.includes("401") || result.error.includes("invalid_model_json");
      if (needsKey) {
        focusApiConfig();
      }
      resultBox.className = "detect-result warn";
      resultBox.innerHTML = `
        <div class="detect-card">
          <div class="detect-icon warn">⚠️</div>
          <div class="detect-info">
            <strong>AI 分析失败</strong>
            <p class="detect-reason">${escapeHtml(result.error)}</p>
            ${needsKey ? '<p class="detect-hint">请在上方输入 API Key 并点击保存</p>' : ""}
            ${result.process_name ? `<p class="detect-window">${escapeHtml(result.process_name)} — ${escapeHtml(result.window_title || "")}</p>` : ""}
            ${result.has_screenshot ? `<p class="detect-hint">截图已捕获 (${result.screenshot_bytes} bytes)，但 AI 返回错误</p>` : ""}
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

      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          pendingInterference: {
            reason: result.reason || "AI 判断你当前可能在摸鱼",
            category: result.category,
            confidence: result.confidence,
            timestamp: Date.now(),
          },
        });
      }
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
          ? "无法连接 focus-guard-server，请先在 Windows 上运行"
          : error.message || "未知错误";

    const needsKey = msg.includes("服务未连接") || msg.includes("无法连接");
    if (needsKey) {
      focusApiConfig();
    }

    resultBox.className = "detect-result warn";
    resultBox.innerHTML = `
      <div class="detect-card">
        <div class="detect-icon warn">⚠️</div>
        <div class="detect-info">
          <strong>AI 服务不可用</strong>
          <p class="detect-reason">${escapeHtml(msg)}</p>
          <p class="detect-hint">确保 focus-guard-server 在运行（端口 3001），且已配置有效的 AI 供应商</p>
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
