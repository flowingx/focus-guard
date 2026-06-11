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
  endpoint: "http://127.0.0.1:11434/api/generate",
  model: "qwen2.5vl:3b",
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

document.getElementById("add-domain").addEventListener("click", () => {
  const value = prompt("添加网站域名，例如 zhihu.com");

  if (value) {
    state.highRiskDomains = unique([...state.highRiskDomains, value.trim()]);
    saveState();
    render();
  }
});

document.getElementById("add-app").addEventListener("click", () => {
  const value = prompt("添加进程名，例如 WeChat.exe");

  if (value) {
    state.monitoredApps = unique([...state.monitoredApps, value.trim()]);
    saveState();
    render();
  }
});

document.getElementById("add-allowlist-rule").addEventListener("click", () => {
  const value = prompt("添加白名单规则，例如 *.edu.cn 或 gemini.google.com");

  if (value) {
    state.allowlistRules = unique([...state.allowlistRules, value.trim()]);
    saveState();
    render();
  }
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
  const stateText = state.localAi.status ?? (state.localAi.enabled ? "待测试" : "未启用");
  status.textContent = stateText;
  status.className = `pill ${stateText === "已连接" ? "ok-pill" : "muted-pill"}`;
}

function renderActivity() {
  const container = document.getElementById("activity-log");

  if (state.activityLog.length === 0) {
    container.innerHTML = '<p class="empty">还没有记录。打开高风险网站或应用后会出现在这里。</p>';
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
    const parsed = JSON.parse(stored);
    return {
      ...parsed,
      highRiskDomains: parsed.highRiskDomains ?? DEFAULT_DOMAINS,
      allowlistRules: parsed.allowlistRules ?? DEFAULT_ALLOWLIST_RULES,
      monitoredApps: parsed.monitoredApps ?? DEFAULT_APPS,
      activityLog: parsed.activityLog ?? [],
      localAi: { ...DEFAULT_LOCAL_AI, ...(parsed.localAi ?? {}) },
    };
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
  state.localAi.status = "测试中";
  renderLocalAiStatus();

  try {
    const response = await fetch(state.localAi.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: state.localAi.model,
        prompt:
          "Return JSON only. Classify this Focus Guard settings screen as study, work, entertainment, distracting, or unknown. Fields: category, confidence, reason, suggested_action.",
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    state.localAi.status = isStructuredAiOutput(payload.response) ? "已连接" : "输出异常";
  } catch {
    state.localAi.status = "未连接";
  }

  saveState();
  renderLocalAiStatus();
}

function isStructuredAiOutput(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed.category === "string" && typeof parsed.confidence === "number";
  } catch {
    return false;
  }
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
