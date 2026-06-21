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

const DEFAULT_SCHEDULED_DETECT = {
  enabled: false,
  intervalMinutes: 5,
  nextRunAt: 0,
  lastRunAt: 0,
  lastCompletedAt: 0,
  lastSeenCompletedAt: 0,
  lastStatus: "idle",
};

const MAX_AI_DISPLAY_RECORDS = 20;
const INTERVENTION_ALLOW_MINUTES = 5;
const INTERVENTION_PRESETS = ["放松 5 分钟", "查资料/找答案", "看网课/学习视频", "找灵感"];
const SERVER = "http://127.0.0.1:3001";
const MASKED_KEY = "••••••••";
const PIE_COLORS = ["#0a84ff", "#ff453a", "#30d158", "#ff9f0a", "#64d2ff", "#bf5af2", "#ffd60a", "#8e8e93"];
let serverHealth = "checking";
let backendFailureCount = 0;
let detectInFlight = false;
let currentIntervention = null;
const aiRecordImages = new Map();
const imagePreview = {
  open: false,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  startOffsetX: 0,
  startOffsetY: 0,
  fitScale: 1,
  zoomed: false,
  mode: "image",
};

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
loadAiRecords();
loadScheduledDetectConfig();
refreshBackendStatus();
setInterval(refreshBackendStatus, 3000);
setInterval(loadAiRecords, 15000);
setInterval(loadScheduledDetectConfig, 15000);
setInterval(renderScheduledDetectStatus, 30000);

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

document.getElementById("scheduled-detect-enabled").addEventListener("change", async (event) => {
  state.scheduledDetect.enabled = event.target.checked;
  if (state.scheduledDetect.enabled) {
    requestScheduledNotificationPermission();
  }
  saveState();
  renderScheduledDetectStatus();
  await saveScheduledDetectConfig();
});

document.getElementById("scheduled-detect-interval").addEventListener("change", async (event) => {
  state.scheduledDetect.intervalMinutes = clampIntervalMinutes(event.target.value);
  event.target.value = state.scheduledDetect.intervalMinutes;
  saveState();
  renderScheduledDetectStatus();
  await saveScheduledDetectConfig();
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
    if (data.warning && models.length > 0) {
      state.localAi.status = "已保留当前模型";
      showDetectMessage("warn", "模型列表不可用", data.warning);
    } else {
      state.localAi.status = models.length > 0 ? `已拉取 ${models.length} 个模型` : "未返回模型";
    }
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
  download("focus-guard-ai-records.csv", toCsv(state.aiRecords), "text/csv");
});

document.getElementById("export-json").addEventListener("click", () => {
  download(
    "focus-guard-ai-records.json",
    JSON.stringify(state.aiRecords, null, 2),
    "application/json",
  );
});

setupImagePreview();
setupInterventionModal();

function render() {
  document.getElementById("focus-state").textContent = state.focusMode
    ? "专注模式开启"
    : "专注模式关闭";
  document.getElementById("high-risk-domains").value = state.highRiskDomains.join("\n");
  document.getElementById("monitored-apps").value = state.monitoredApps.join("\n");
  document.getElementById("allowlist-rules").value = state.allowlistRules.join("\n");
  document.getElementById("local-ai-enabled").checked = state.localAi.enabled;
  document.getElementById("scheduled-detect-enabled").checked = state.scheduledDetect.enabled;
  document.getElementById("scheduled-detect-interval").value = state.scheduledDetect.intervalMinutes;
  renderLocalAiStatus();
  renderScheduledDetectStatus();
  renderActivity();
  renderSummaries();
}

async function refreshBackendStatus() {
  const previous = serverHealth;
  if (previous !== "connected") {
    serverHealth = "checking";
    renderLocalAiStatus();
  }

  try {
    const resp = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(5000) });
    const payload = await resp.json();
    if (resp.ok && payload.ok) {
      backendFailureCount = 0;
      serverHealth = "connected";
    } else {
      backendFailureCount += 1;
    }
  } catch {
    backendFailureCount += 1;
  }

  if (backendFailureCount >= 3) {
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

function clampIntervalMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SCHEDULED_DETECT.intervalMinutes;
  return Math.min(120, Math.max(1, parsed));
}

async function loadScheduledDetectConfig() {
  try {
    const resp = await fetch(`${SERVER}/scheduled-detect`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    applyScheduledDetectConfig(data, { notify: true });
  } catch {
    renderScheduledDetectStatus();
  }
}

async function saveScheduledDetectConfig() {
  try {
    const resp = await fetch(`${SERVER}/scheduled-detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: state.scheduledDetect.enabled,
        interval_minutes: clampIntervalMinutes(state.scheduledDetect.intervalMinutes),
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    applyScheduledDetectConfig(data, { notify: false });
  } catch {
    showDetectMessage("warn", "定时巡检未保存", "后端服务未连接，设置暂时只保存在当前页面");
    renderScheduledDetectStatus();
  }
}

async function loadAiRecords() {
  try {
    const resp = await fetch(`${SERVER}/ai-records`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    applyServerAiRecords(data.records || []);
  } catch {
    renderActivity();
  }
}

function applyServerAiRecords(records) {
  aiRecordImages.clear();
  state.aiRecords = records.map((record) => {
    const mapped = {
      id: record.id,
      timestamp: new Date(Number(record.timestamp_ms || Date.now())).toISOString(),
      source: record.source || "scheduled",
      category: normalizeAiCategory(record.category || "unknown"),
      confidence: Number(record.confidence || 0),
      processName: record.process_name || "desktop",
      windowTitle: record.window_title || "",
      reason: record.reason || record.error || "AI 未返回原因",
      error: record.error || "",
      hasScreenshot: Boolean(record.has_screenshot),
      screenshotBytes: Number(record.screenshot_bytes || 0),
    };
    if (record.screenshot_base64) {
      aiRecordImages.set(mapped.id, record.screenshot_base64);
    }
    return mapped;
  });
  recomputeFocusStatsFromRecords();
  recomputeAiSummaries();
  pruneAiRecordImages();
  saveState();
  renderActivity();
  renderSummaries();
}

function applyScheduledDetectConfig(data, options = {}) {
  const previousSeen = state.scheduledDetect.lastSeenCompletedAt || 0;
  const completedAt = Number(data.last_completed_at_ms || 0);

  state.scheduledDetect.enabled = Boolean(data.enabled);
  state.scheduledDetect.intervalMinutes = clampIntervalMinutes(data.interval_minutes);
  state.scheduledDetect.nextRunAt = Number(data.next_run_at_ms || 0);
  state.scheduledDetect.lastRunAt = Number(data.last_run_at_ms || 0);
  state.scheduledDetect.lastCompletedAt = completedAt;
  state.scheduledDetect.lastStatus = data.last_status || "idle";
  state.scheduledDetect.lastCategory = data.last_category || "";
  state.scheduledDetect.lastReason = data.last_reason || "";
  state.scheduledDetect.lastProcessName = data.last_process_name || "";
  state.scheduledDetect.lastWindowTitle = data.last_window_title || "";
  state.scheduledDetect.lastError = data.last_error || "";
  state.scheduledDetect.lastSeenCompletedAt = Math.max(previousSeen, completedAt);

  const result = {
    category: state.scheduledDetect.lastCategory,
    reason: state.scheduledDetect.lastReason,
    process_name: state.scheduledDetect.lastProcessName,
    window_title: state.scheduledDetect.lastWindowTitle,
  };
  const isNewDistracting =
    options.notify &&
    completedAt > previousSeen &&
    state.scheduledDetect.lastStatus === "distracting";
  const isNewCompleted = options.notify && completedAt > previousSeen;
  if (isNewCompleted && state.scheduledDetect.lastStatus !== "running") {
    loadAiRecords();
  }
  if (isNewDistracting) {
    notifyScheduledDistraction(result);
  }

  saveState();
  document.getElementById("scheduled-detect-enabled").checked = state.scheduledDetect.enabled;
  document.getElementById("scheduled-detect-interval").value = state.scheduledDetect.intervalMinutes;
  renderScheduledDetectStatus();
}

function renderScheduledDetectStatus() {
  const status = document.getElementById("scheduled-detect-status");
  if (!status) return;

  if (!state.scheduledDetect.enabled) {
    status.textContent = "未启用";
    status.className = "pill muted-pill";
    return;
  }

  if (detectInFlight) {
    status.textContent = "正在巡检...";
    status.className = "pill muted-pill";
    return;
  }

  if (state.scheduledDetect.lastStatus === "running") {
    status.textContent = "后台正在巡检...";
    status.className = "pill muted-pill";
    return;
  }

  if (state.scheduledDetect.lastStatus === "busy") {
    status.textContent = "后台巡检等待中";
    status.className = "pill muted-pill";
    return;
  }

  if (state.scheduledDetect.lastStatus === "distracting") {
    status.textContent = "后台巡检：最近检测到摸鱼";
    status.className = "pill warn-pill";
    return;
  }

  if (state.scheduledDetect.lastStatus === "error") {
    status.textContent = "后台巡检失败";
    status.className = "pill muted-pill";
    return;
  }

  const remainingMs = Math.max(0, (state.scheduledDetect.nextRunAt || 0) - Date.now());
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  status.textContent = `后台巡检，下次约 ${remainingMinutes} 分钟后`;
  status.className = "pill ok-pill";
}

function recordAiJudgement(result, options = {}) {
  const timestamp = options.timestamp
    ? new Date(options.timestamp).toISOString()
    : new Date().toISOString();
  const category = normalizeAiCategory(result.category || "unknown");
  const id = `${Date.parse(timestamp) || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (result.screenshot_base64) {
    aiRecordImages.set(id, result.screenshot_base64);
  }
  state.aiRecords.push({
    id,
    timestamp,
    source: options.source || "manual",
    category,
    confidence: Number(result.confidence || 0),
    processName: result.process_name || "desktop",
    windowTitle: result.window_title || "",
    reason: result.reason || result.error || "AI 未返回原因",
    error: result.error || "",
    hasScreenshot: Boolean(result.has_screenshot),
    screenshotBytes: Number(result.screenshot_bytes || 0),
  });
  pruneAiRecordImages();
  recomputeFocusStatsFromRecords();
  recomputeAiSummaries();
  saveState();
  renderActivity();
  renderSummaries();
}

function pruneAiRecordImages() {
  const liveIds = new Set(
    getNewestFirstAiRecords()
      .slice(0, MAX_AI_DISPLAY_RECORDS)
      .map((record) => record.id),
  );
  for (const id of aiRecordImages.keys()) {
    if (!liveIds.has(id)) {
      aiRecordImages.delete(id);
    }
  }
}

function normalizeAiCategory(category) {
  const value = String(category || "unknown").toLowerCase();
  if (value === "distraction") return "distracting";
  if (["study", "work", "productive"].includes(value)) return "productive";
  if (["distracting", "entertainment"].includes(value)) return "distracting";
  return value;
}

function recomputeFocusStatsFromRecords() {
  const minutesPerRecord = clampIntervalMinutes(state.scheduledDetect.intervalMinutes || 1);
  state.focusStats.productiveMinutes = 0;
  state.focusStats.distractingMinutes = 0;
  for (const record of getNewestFirstAiRecords().slice(0, MAX_AI_DISPLAY_RECORDS)) {
    if (record.category === "productive") {
      state.focusStats.productiveMinutes += minutesPerRecord;
    } else if (record.category === "distracting") {
      state.focusStats.distractingMinutes += minutesPerRecord;
    }
  }
}

function recomputeAiSummaries() {
  const hourly = new Map();
  const daily = new Map();
  const targets = new Map();
  const hourlyTargets = new Map();
  const dailyTargets = new Map();
  const records = [...state.aiRecords].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const fallbackMinutes = clampIntervalMinutes(state.scheduledDetect.intervalMinutes || 1);

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const at = new Date(record.timestamp);
    if (Number.isNaN(at.getTime())) continue;

    const next = records[index + 1];
    const nextAt = next ? new Date(next.timestamp) : null;
    const measuredMinutes =
      nextAt && !Number.isNaN(nextAt.getTime())
        ? Math.max(0, Math.round((nextAt.getTime() - at.getTime()) / 60000))
        : fallbackMinutes;
    const minutes = Math.min(fallbackMinutes, measuredMinutes || fallbackMinutes);
    const status = classifySummaryRecord(record, next);
    const hourKey = `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:00`;
    const dayKey = `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;

    addSummaryMinutes(hourly, hourKey, status, minutes);
    addSummaryMinutes(daily, dayKey, status, minutes);

    if (record.windowTitle && status !== "idle") {
      const key = `${record.processName || "unknown"} — ${record.windowTitle}`;
      targets.set(key, (targets.get(key) || 0) + minutes);
      addTargetMinutes(hourlyTargets, hourKey, key, minutes);
      addTargetMinutes(dailyTargets, dayKey, key, minutes);
    }
  }

  state.aiSummaries.hourly = [...hourly.entries()].map(([label, value]) => ({
    label,
    ...value,
    targets: targetRows(hourlyTargets.get(label)),
  }));
  state.aiSummaries.daily = [...daily.entries()].map(([label, value]) => ({
    label,
    ...value,
    targets: targetRows(dailyTargets.get(label)),
  }));
  state.aiSummaries.targets = [...targets.entries()]
    .map(([label, minutes]) => ({ label, minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 8);
}

function classifySummaryRecord(record, next) {
  if (next && isSameDesktopSnapshot(record, next)) return "idle";
  if (record.category === "productive") return "productive";
  if (record.category === "distracting") return "distracting";
  return "neutral";
}

function isSameDesktopSnapshot(left, right) {
  return (
    left.processName === right.processName &&
    left.windowTitle === right.windowTitle &&
    left.category === right.category &&
    left.reason === right.reason
  );
}

function addSummaryMinutes(map, key, status, minutes) {
  const summary = map.get(key) || {
    productive: 0,
    distracting: 0,
    neutral: 0,
    idle: 0,
    total: 0,
  };
  summary[status] += minutes;
  summary.total += minutes;
  map.set(key, summary);
}

function addTargetMinutes(periodMap, periodKey, targetKey, minutes) {
  const targets = periodMap.get(periodKey) || new Map();
  targets.set(targetKey, (targets.get(targetKey) || 0) + minutes);
  periodMap.set(periodKey, targets);
}

function targetRows(map) {
  if (!map) return [];
  return [...map.entries()]
    .map(([label, minutes]) => ({ label, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function requestScheduledNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  Notification.requestPermission().catch(() => {});
}

function notifyScheduledDistraction(result) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const title = "Focus Guard 检测到摸鱼";
  const process = result.process_name || "当前应用";
  const reason = result.reason || "AI 定时巡检判断当前内容可能分心";
  new Notification(title, {
    body: `${process}: ${reason}`,
    tag: "focus-guard-scheduled-detection",
  });
}

function isBrowserProcess(processName) {
  const name = String(processName || "").toLowerCase();
  return [
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "opera.exe",
    "vivaldi.exe",
  ].includes(name);
}

function renderActivity() {
  const container = document.getElementById("activity-log");
  renderFocusTotals();

  const displayRecords = getNewestFirstAiRecords().slice(0, MAX_AI_DISPLAY_RECORDS);

  if (displayRecords.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="24" r="23" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/>
          <path d="M24 16v12M24 32v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <p class="empty-title">暂无 AI 判断记录</p>
        <p class="empty-hint">手动检测或后台巡检完成后，最近 20 次分析会显示在这里。</p>
      </div>`;
    return;
  }

  container.innerHTML = displayRecords
    .map(
      (record) => `<div class="ai-record-row ${record.category}">
        <div class="ai-record-shot">
          ${renderAiRecordShot(record)}
        </div>
        <div class="ai-record-time">${new Date(record.timestamp).toLocaleString()}</div>
        <div class="ai-record-main">
          <div class="ai-record-title">
            <strong>${escapeHtml(record.processName)}</strong>
            <span>${escapeHtml(record.windowTitle || "")}</span>
          </div>
          <p>${escapeHtml(record.reason)}</p>
          <div class="ai-record-meta">
            <span class="tag ${record.category === "distracting" ? "tag-danger" : record.category === "productive" ? "tag-ok" : ""}">${escapeHtml(record.category)}</span>
            <span>${record.source === "scheduled" ? "后台巡检" : "手动检测"}</span>
            ${record.confidence ? `<span>置信度 ${Math.round(record.confidence * 100)}%</span>` : ""}
            ${record.hasScreenshot ? `<span>截图 ${formatBytes(record.screenshotBytes)}</span>` : ""}
          </div>
        </div>
      </div>`,
    )
    .join("");
  container.scrollTop = 0;
}

function getNewestFirstAiRecords() {
  return [...state.aiRecords].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

function renderAiRecordShot(record) {
  const image = aiRecordImages.get(record.id);
  if (image) {
    return `<button type="button" class="preview-shot-btn" data-record-id="${escapeHtml(record.id)}" aria-label="预览截图"><img src="data:image/png;base64,${image}" alt="desktop screenshot" /></button>`;
  }
  return `<div class="shot-placeholder">${record.hasScreenshot ? "截图已分析" : "无截图"}</div>`;
}

function setupImagePreview() {
  const log = document.getElementById("activity-log");
  const overlay = document.getElementById("image-preview");
  const frame = document.getElementById("image-preview-frame");
  const stage = document.getElementById("image-preview-stage");
  const img = document.getElementById("image-preview-img");
  const chart = document.getElementById("image-preview-chart");
  const closeBtn = document.getElementById("image-preview-close");
  const hourly = document.getElementById("summary-hourly");

  log.addEventListener("click", (event) => {
    const button = event.target.closest(".preview-shot-btn");
    if (!button) return;
    const image = aiRecordImages.get(button.dataset.recordId);
    if (image) openImagePreview(image);
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeImagePreview();
  });
  frame.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  closeBtn.addEventListener("click", closeImagePreview);

  hourly.addEventListener("click", (event) => {
    const button = event.target.closest(".summary-period-btn");
    if (!button) return;
    const item = state.aiSummaries.hourly.find((row) => row.label === button.dataset.summaryLabel);
    if (item) openChartPreview(`${item.label} 应用/窗口用时`, item.targets || []);
  });

  stage.addEventListener("wheel", (event) => {
    if (!imagePreview.open || imagePreview.mode !== "image") return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    imagePreview.scale = clamp(imagePreview.scale + direction * 0.15, 0.5, 4);
    imagePreview.zoomed = imagePreview.scale > imagePreview.fitScale + 0.05;
    renderImagePreviewTransform();
  }, { passive: false });

  stage.addEventListener("dblclick", (event) => {
    if (!imagePreview.open || imagePreview.mode !== "image") return;
    event.preventDefault();
    if (imagePreview.zoomed) {
      resetImagePreviewZoom();
      return;
    }
    zoomImagePreviewAt(event.clientX, event.clientY);
  });

  stage.addEventListener("pointerdown", (event) => {
    if (!imagePreview.open || imagePreview.mode !== "image") return;
    imagePreview.dragging = true;
    imagePreview.dragStartX = event.clientX;
    imagePreview.dragStartY = event.clientY;
    imagePreview.startOffsetX = imagePreview.offsetX;
    imagePreview.startOffsetY = imagePreview.offsetY;
    stage.classList.add("is-dragging");
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener("pointermove", (event) => {
    if (!imagePreview.dragging) return;
    imagePreview.offsetX = imagePreview.startOffsetX + event.clientX - imagePreview.dragStartX;
    imagePreview.offsetY = imagePreview.startOffsetY + event.clientY - imagePreview.dragStartY;
    renderImagePreviewTransform();
  });

  stage.addEventListener("pointerup", () => {
    imagePreview.dragging = false;
    stage.classList.remove("is-dragging");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && imagePreview.open) {
      closeImagePreview();
    }
  });

  function openImagePreview(image) {
    imagePreview.open = true;
    imagePreview.mode = "image";
    imagePreview.scale = 1;
    imagePreview.offsetX = 0;
    imagePreview.offsetY = 0;
    imagePreview.dragging = false;
    imagePreview.zoomed = false;
    chart.hidden = true;
    chart.innerHTML = "";
    img.hidden = false;
    img.src = `data:image/png;base64,${image}`;
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    img.onload = fitImagePreviewToStage;
  }

  function closeImagePreview() {
    imagePreview.open = false;
    imagePreview.dragging = false;
    imagePreview.mode = "image";
    stage.classList.remove("is-dragging");
    img.removeAttribute("src");
    img.hidden = false;
    chart.hidden = true;
    chart.innerHTML = "";
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }

  function renderImagePreviewTransform() {
    img.style.transform = `translate(calc(-50% + ${imagePreview.offsetX}px), calc(-50% + ${imagePreview.offsetY}px)) scale(${imagePreview.scale})`;
  }

  function fitImagePreviewToStage() {
    const widthRatio = stage.clientWidth / img.naturalWidth;
    const heightRatio = stage.clientHeight / img.naturalHeight;
    imagePreview.fitScale = Math.min(widthRatio, heightRatio, 1);
    resetImagePreviewZoom();
  }

  function resetImagePreviewZoom() {
    imagePreview.scale = imagePreview.fitScale;
    imagePreview.offsetX = 0;
    imagePreview.offsetY = 0;
    imagePreview.zoomed = false;
    renderImagePreviewTransform();
  }

  function zoomImagePreviewAt(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    const pointX = clientX - rect.left - rect.width / 2;
    const pointY = clientY - rect.top - rect.height / 2;
    const targetScale = Math.min(Math.max(imagePreview.fitScale * 2.2, 1.5), 4);
    const oldScale = imagePreview.scale || imagePreview.fitScale || 1;
    const contentX = (pointX - imagePreview.offsetX) / oldScale;
    const contentY = (pointY - imagePreview.offsetY) / oldScale;
    imagePreview.offsetX = pointX - contentX * targetScale;
    imagePreview.offsetY = pointY - contentY * targetScale;
    imagePreview.scale = targetScale;
    imagePreview.zoomed = true;
    renderImagePreviewTransform();
  }

  function openChartPreview(title, rows) {
    imagePreview.open = true;
    imagePreview.mode = "chart";
    imagePreview.dragging = false;
    img.hidden = true;
    img.removeAttribute("src");
    chart.hidden = false;
    chart.innerHTML = renderPieChart(title, rows, { large: true });
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
  }
}

function setupInterventionModal() {
  const presets = document.getElementById("intervention-presets");
  const input = document.getElementById("intervention-input");
  const submit = document.getElementById("intervention-submit-btn");
  const focus = document.getElementById("intervention-focus-btn");

  presets.innerHTML = INTERVENTION_PRESETS.map(
    (preset) => `<button type="button" class="intervention-preset" data-preset="${escapeHtml(preset)}">${escapeHtml(preset)}</button>`,
  ).join("");

  presets.addEventListener("click", (event) => {
    const button = event.target.closest(".intervention-preset");
    if (!button) return;
    input.value = button.dataset.preset || "";
    input.focus();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit.click();
  });

  focus.addEventListener("click", () => {
    closeInterventionModal();
    showDetectMessage("warn", "请回到专注", "这次没有放行，下一次检测到摸鱼会再次提醒。");
  });

  submit.addEventListener("click", submitInterventionReason);
}

function openInterventionModal(result) {
  const modal = document.getElementById("intervention-modal");
  const input = document.getElementById("intervention-input");
  const status = document.getElementById("intervention-status");
  const reason = document.getElementById("intervention-reason");
  const windowInfo = document.getElementById("intervention-window");

  currentIntervention = {
    key: interventionKey(result),
    reason: result.reason || "AI 判断你当前可能在摸鱼",
    processName: result.process_name || "",
    windowTitle: result.window_title || "",
    category: result.category || "distracting",
  };

  reason.textContent = currentIntervention.reason;
  windowInfo.textContent = [currentIntervention.processName, currentIntervention.windowTitle]
    .filter(Boolean)
    .join(" — ");
  input.value = "";
  status.textContent = "";
  status.className = "intervention-status";
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  input.focus();
}

function closeInterventionModal() {
  const modal = document.getElementById("intervention-modal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  currentIntervention = null;
}

async function submitInterventionReason() {
  const input = document.getElementById("intervention-input");
  const status = document.getElementById("intervention-status");
  const submit = document.getElementById("intervention-submit-btn");
  const intervention = currentIntervention;
  const reason = input.value.trim();

  if (!intervention) return;
  if (!reason) {
    input.focus();
    return;
  }

  submit.disabled = true;
  submit.textContent = "审核中...";
  status.textContent = "AI 正在审核你的解释...";
  status.className = "intervention-status";

  try {
    const resp = await fetch(`${SERVER}/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        validate_reason: true,
        reason,
        target: `${intervention.processName} — ${intervention.windowTitle}`,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data = resp.ok ? await resp.json() : { approved: true, message: "验证服务不可用，已放行" };

    if (data.approved ?? true) {
      grantInterventionAllow(intervention.key, reason, data.message || "理由通过");
      status.textContent = `理由通过，已放行 ${INTERVENTION_ALLOW_MINUTES} 分钟`;
      status.className = "intervention-status approved";
      setTimeout(closeInterventionModal, 600);
    } else {
      status.textContent = data.message || "理由不合理，请回到专注或重新填写。";
      status.className = "intervention-status rejected";
    }
  } catch {
    grantInterventionAllow(intervention.key, reason, "验证服务不可用，已放行");
    status.textContent = `验证服务不可用，已放行 ${INTERVENTION_ALLOW_MINUTES} 分钟`;
    status.className = "intervention-status approved";
    setTimeout(closeInterventionModal, 600);
  } finally {
    submit.disabled = false;
    submit.textContent = "提交给 AI 审核";
  }
}

function grantInterventionAllow(key, reason, message) {
  const until = Date.now() + INTERVENTION_ALLOW_MINUTES * 60 * 1000;
  state.interventionAllowUntil = { key, reason, message, until };
  saveState();
  showDetectMessage(
    "ok",
    "已临时放行",
    `${message || "理由通过"}。放行至 ${new Date(until).toLocaleTimeString()}。`,
  );
}

function activeInterventionAllow(result) {
  const allow = state.interventionAllowUntil;
  if (!allow || allow.key !== interventionKey(result) || Number(allow.until || 0) <= Date.now()) {
    return null;
  }
  return allow;
}

function interventionKey(result) {
  return [
    result.process_name || result.processName || "unknown",
    result.window_title || result.windowTitle || "",
    result.category || "distracting",
  ].join("::");
}

function renderFocusTotals() {
  const productive = document.getElementById("productive-time");
  const distracting = document.getElementById("distracting-time");
  if (!productive || !distracting) return;
  productive.textContent = formatMinutes(state.focusStats.productiveMinutes);
  distracting.textContent = formatMinutes(state.focusStats.distractingMinutes);
}

function renderSummaries() {
  const daily = document.getElementById("summary-daily");
  const hourly = document.getElementById("summary-hourly");
  const targets = document.getElementById("summary-targets");
  if (!daily || !hourly || !targets) return;

  const todayKey = todayLabel();
  const today = state.aiSummaries.daily.find((item) => item.label === todayKey) || emptySummary();
  daily.innerHTML = `
    <div class="summary-card"><span>今日专注</span><strong>${formatMinutes(today.productive)}</strong></div>
    <div class="summary-card"><span>今日摸鱼</span><strong>${formatMinutes(today.distracting)}</strong></div>
    <div class="summary-card"><span>未使用/无变化</span><strong>${formatMinutes(today.idle)}</strong></div>
    <div class="summary-card"><span>已统计</span><strong>${formatMinutes(today.total)}</strong></div>
  `;

  const recentHours = state.aiSummaries.hourly.slice(-6).reverse();
  hourly.innerHTML = renderSummaryRows("最近小时", recentHours);
  targets.innerHTML = renderPieChart("今日应用/窗口用时", today.targets || state.aiSummaries.targets || []);
}

function renderSummaryRows(emptyTitle, rows) {
  if (!rows.length) {
    return `<div class="summary-row"><span>${emptyTitle}</span><strong>暂无记录</strong><span>0 分钟</span></div>`;
  }
  return rows
    .map((row) => {
      const activeTotal = Math.max(row.total || 0, 1);
      const idle = (row.idle || 0) + (row.neutral || 0);
      const productivePercent = Math.round(((row.productive || 0) / activeTotal) * 100);
      const distractingPercent = Math.round(((row.distracting || 0) / activeTotal) * 100);
      const idlePercent = Math.max(0, 100 - productivePercent - distractingPercent);
      return `<div class="summary-row">
        <button type="button" class="summary-period-btn" data-summary-label="${escapeHtml(row.label)}">${escapeHtml(row.label)}</button>
        <div class="summary-stack" aria-label="专注、摸鱼、空闲比例">
          <div class="summary-segment summary-segment-productive" style="width:${productivePercent}%"></div>
          <div class="summary-segment summary-segment-distracting" style="width:${distractingPercent}%"></div>
          <div class="summary-segment summary-segment-idle" style="width:${idlePercent}%"></div>
        </div>
        <span>专注 ${formatMinutes(row.productive)} / 摸鱼 ${formatMinutes(row.distracting)} / 空闲 ${formatMinutes(idle)}</span>
      </div>`;
    })
    .join("") + renderSummaryLegend();
}

function renderSummaryLegend() {
  return `<div class="summary-legend">
    <span><i style="background:#0a84ff"></i>专注</span>
    <span><i style="background:#ff453a"></i>摸鱼</span>
    <span><i style="background:#8e8e93"></i>空闲/离开/未知</span>
  </div>`;
}

function renderPieChart(title, rows, options = {}) {
  const filtered = (rows || []).filter((row) => row.minutes > 10);
  if (!filtered.length) {
    return `<div class="empty-state">
      <p class="empty-title">${escapeHtml(title)}</p>
      <p class="empty-hint">暂无超过 10 分钟的应用/窗口记录。</p>
    </div>`;
  }

  const total = filtered.reduce((sum, row) => sum + row.minutes, 0);
  const radius = 72;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const slices = filtered
    .map((row, index) => {
      const length = (row.minutes / total) * circumference;
      const color = PIE_COLORS[index % PIE_COLORS.length];
      const slice = `<circle class="pie-slice" cx="100" cy="100" r="${radius}" stroke="${color}" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"></circle>`;
      offset += length;
      return slice;
    })
    .join("");

  const legend = filtered
    .map((row, index) => {
      const color = PIE_COLORS[index % PIE_COLORS.length];
      const percent = Math.round((row.minutes / total) * 100);
      return `<div class="pie-legend-row">
        <i style="background:${color}"></i>
        <span>${escapeHtml(row.label)}</span>
        <strong>${formatMinutes(row.minutes)} · ${percent}%</strong>
      </div>`;
    })
    .join("");

  return `<div class="pie-card ${options.large ? "pie-card-large" : ""}">
    <div>
      <h3>${escapeHtml(title)}</h3>
      <svg class="pie-svg" viewBox="0 0 200 200" role="img" aria-label="${escapeHtml(title)}">
        <circle class="pie-ring-bg" cx="100" cy="100" r="${radius}"></circle>
        ${slices}
      </svg>
    </div>
    <div class="pie-legend">${legend}</div>
  </div>`;
}

function todayLabel() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function emptySummary() {
  return { productive: 0, distracting: 0, neutral: 0, idle: 0, total: 0, targets: [] };
}

function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours <= 0) return `${mins} 分钟`;
  return `${hours} 小时 ${mins} 分钟`;
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
        aiRecords: parsed.aiRecords ?? [],
        aiSummaries: {
          hourly: [],
          daily: [],
          targets: [],
          ...(parsed.aiSummaries ?? {}),
        },
        interventionAllowUntil: parsed.interventionAllowUntil ?? null,
        focusStats: {
          productiveMinutes: 0,
          distractingMinutes: 0,
          ...(parsed.focusStats ?? {}),
        },
        localAi: { ...DEFAULT_LOCAL_AI, ...(parsed.localAi ?? {}) },
        scheduledDetect: { ...DEFAULT_SCHEDULED_DETECT, ...(parsed.scheduledDetect ?? {}) },
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
    aiRecords: [],
    aiSummaries: {
      hourly: [],
      daily: [],
      targets: [],
    },
    interventionAllowUntil: null,
    focusStats: {
      productiveMinutes: 0,
      distractingMinutes: 0,
    },
    localAi: { ...DEFAULT_LOCAL_AI },
    scheduledDetect: { ...DEFAULT_SCHEDULED_DETECT },
  };
}

function saveState() {
  if (state.activityLog.length > 500) {
    state.activityLog = state.activityLog.slice(-500);
  }
  state.aiRecords = state.aiRecords ?? [];
  state.aiSummaries = {
    hourly: [],
    daily: [],
    targets: [],
    ...(state.aiSummaries ?? {}),
  };
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
  const header = "timestamp,source,category,confidence,processName,windowTitle,reason,screenshotBytes\n";
  const rows = records
    .map((record) => {
      return [
        record.timestamp,
        record.source,
        record.category,
        record.confidence,
        record.processName,
        record.windowTitle,
        record.reason,
        record.screenshotBytes,
      ]
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

async function detectProcrastination(options = {}) {
  if (detectInFlight) {
    if (!options.silent) {
      showDetectMessage("warn", "检测进行中", "上一轮桌面分析还没有结束");
    }
    return null;
  }

  detectInFlight = true;
  try {
    return await runDetectProcrastination(options);
  } finally {
    detectInFlight = false;
    renderScheduledDetectStatus();
  }
}

async function runDetectProcrastination(options = {}) {
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
      body: JSON.stringify({
        skip_browser: options.source === "scheduled",
        source: options.source || "manual",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 409 || err.error === "detect already running") {
        showDetectMessage(
          "warn",
          "检测正在进行",
          "后台定时巡检正在截图分析当前桌面，请稍等这轮完成后再手动检测。",
        );
        renderScheduledDetectStatus();
        return;
      }
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const result = await response.json();

    if (result.skipped) {
      recordAiJudgement(result, { source: options.source || "manual" });
      loadAiRecords();
      showDetectMessage("ok", "跳过浏览器巡检", "浏览器网页由扩展负责拦截，定时巡检只处理非浏览器应用");
      return result;
    }

    if (result.error) {
      recordAiJudgement(result, { source: options.source || "manual" });
      loadAiRecords();
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
            ${result.has_screenshot ? `<p class="detect-hint">截图已捕获 (${formatBytes(result.screenshot_bytes)})，但 AI 返回错误</p>` : ""}
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
    recordAiJudgement(result, { source: options.source || "manual" });

    if (isDistracting) {
      const activeAllow = activeInterventionAllow(result);
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
            ${result.has_screenshot ? `<p class="detect-hint">截图已发送给 AI 分析 (${formatBytes(result.screenshot_bytes)} base64)</p>` : ""}
            ${activeAllow ? `<p class="detect-hint">已临时放行至 ${new Date(activeAllow.until).toLocaleTimeString()}</p>` : ""}
          </div>
        </div>
      `;

      if (activeAllow) {
        loadAiRecords();
        return result;
      }

      openInterventionModal(result);

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
      if (options.source === "scheduled") {
        notifyScheduledDistraction(result);
      }
      loadAiRecords();
      return result;
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
            ${result.has_screenshot ? `<p class="detect-hint">截图已发送给 AI 分析 (${formatBytes(result.screenshot_bytes)} base64)</p>` : ""}
          </div>
        </div>
      `;
      loadAiRecords();
      return result;
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
