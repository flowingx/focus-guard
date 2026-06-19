const form = document.getElementById("settings-form");
const focusMode = document.getElementById("focus-mode");
const defaultMinutes = document.getElementById("default-minutes");
const highRiskDomains = document.getElementById("high-risk-domains");
const allowlistRules = document.getElementById("allowlist-rules");
const quickUrl = document.getElementById("quick-url");
const addQuickControl = document.getElementById("add-quick-control");
const addQuickAllow = document.getElementById("add-quick-allow");
const undoLastRule = document.getElementById("undo-last-rule");
const checkAiHealth = document.getElementById("check-ai-health");
const runAiDetect = document.getElementById("run-ai-detect");
const clearAiLog = document.getElementById("clear-ai-log");
const aiDetectLog = document.getElementById("ai-detect-log");
const status = document.getElementById("settings-status");

init();

async function init() {
  const response = await chrome.runtime.sendMessage({ type: "get_config" });
  const config = response?.config ?? {};

  focusMode.checked = config.focusMode !== false;
  defaultMinutes.value = config.defaultMinutes ?? 20;
  highRiskDomains.value = (config.highRiskDomains ?? []).join("\n");
  allowlistRules.value = (config.allowlistRules ?? []).join("\n");
  await loadAiDetectLog();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  await chrome.runtime.sendMessage({
    type: "save_config",
    config: {
      focusMode: focusMode.checked,
      defaultMinutes: Number(defaultMinutes.value),
      highRiskDomains: splitLines(highRiskDomains.value),
      allowlistRules: splitLines(allowlistRules.value),
    },
  });

  status.textContent = "已保存";
  setTimeout(() => {
    status.textContent = "";
  }, 1600);
});

addQuickControl.addEventListener("click", () => {
  addRuleToTextarea(highRiskDomains, ruleFromInput(quickUrl.value));
});

addQuickAllow.addEventListener("click", () => {
  addRuleToTextarea(allowlistRules, ruleFromInput(quickUrl.value));
});

undoLastRule.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "undo_last_rule_change" });

  if (response?.ok) {
    status.textContent = `已撤销 ${response.rule}`;
    await init();
    return;
  }

  status.textContent = "没有可撤销的新网站分类";
});

checkAiHealth.addEventListener("click", async () => {
  status.textContent = "正在检查服务...";
  const response = await chrome.runtime.sendMessage({ type: "check_ai_server_health" });
  status.textContent = aiHealthStatusMessage(response);
});

runAiDetect.addEventListener("click", async () => {
  status.textContent = "正在检测...";
  const response = await chrome.runtime.sendMessage({ type: "run_ai_detect_now" });
  await loadAiDetectLog();
  status.textContent = aiDetectStatusMessage(response);
});

clearAiLog.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear_ai_detect_log" });
  await loadAiDetectLog();
  status.textContent = "AI 检测日志已清空";
});

async function loadAiDetectLog() {
  const response = await chrome.runtime.sendMessage({ type: "get_ai_detect_log" });
  const log = response?.log ?? [];

  if (!log.length) {
    aiDetectLog.textContent = "暂无检测记录";
    return;
  }

  aiDetectLog.textContent = log.map(formatAiDetectLogEntry).join("\n");
}

function formatAiDetectLogEntry(entry) {
  const time = entry.timestamp
    ? new Date(entry.timestamp).toLocaleString()
    : "unknown time";
  const bits = [
    time,
    entry.source,
    entry.status,
    entry.error,
    entry.category,
    entry.confidence == null ? "" : `confidence=${entry.confidence}`,
    entry.reason,
    entry.process,
    entry.window,
  ];

  return bits.filter(Boolean).join(" | ");
}

function aiDetectStatusMessage(result) {
  if (!result?.ok) {
    return "检测失败";
  }

  if (result.status === "ok") {
    return "检测完成：未触发干预";
  }

  if (result.status === "interference_shown") {
    return "检测完成：已显示干预";
  }

  if (result.status === "no_http_tab") {
    return "没有可检测的网页标签";
  }

  if (result.status === "server_error") {
    return `检测完成：服务端错误 ${result.error ?? ""}`.trim();
  }

  if (result.status === "http_error" || result.status === "request_failed") {
    return `检测完成：请求失败 ${result.error ?? ""}`.trim();
  }

  if (result.status === "inject_failed") {
    return `检测完成：干预注入失败 ${result.error ?? ""}`.trim();
  }

  return "检测完成";
}

function aiHealthStatusMessage(result) {
  if (result?.ok) {
    return "服务正常";
  }

  return `服务不可用 ${result?.error ?? ""}`.trim();
}

function splitLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function addRuleToTextarea(textarea, rule) {
  if (!rule) {
    return;
  }

  const rules = splitLines(textarea.value);

  if (!rules.includes(rule)) {
    rules.push(rule);
    textarea.value = rules.join("\n");
  }

  quickUrl.value = "";
  status.textContent = `已添加 ${rule}，记得保存规则`;
}

function ruleFromInput(value) {
  const cleanValue = value.trim();

  if (!cleanValue) {
    return "";
  }

  const urlLike = /^[a-z][a-z0-9+.-]*:\/\//i.test(cleanValue)
    ? cleanValue
    : `https://${cleanValue}`;

  try {
    return stripWww(new URL(urlLike).hostname.toLowerCase());
  } catch {
    return stripWww(cleanValue.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0].toLowerCase());
  }
}

function stripWww(host) {
  return host.startsWith("www.") ? host.slice(4) : host;
}
