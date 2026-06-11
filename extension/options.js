const form = document.getElementById("settings-form");
const focusMode = document.getElementById("focus-mode");
const defaultMinutes = document.getElementById("default-minutes");
const highRiskDomains = document.getElementById("high-risk-domains");
const allowlistRules = document.getElementById("allowlist-rules");
const quickUrl = document.getElementById("quick-url");
const addQuickControl = document.getElementById("add-quick-control");
const addQuickAllow = document.getElementById("add-quick-allow");
const undoLastRule = document.getElementById("undo-last-rule");
const status = document.getElementById("settings-status");

init();

async function init() {
  const response = await chrome.runtime.sendMessage({ type: "get_config" });
  const config = response?.config ?? {};

  focusMode.checked = config.focusMode !== false;
  defaultMinutes.value = config.defaultMinutes ?? 20;
  highRiskDomains.value = (config.highRiskDomains ?? []).join("\n");
  allowlistRules.value = (config.allowlistRules ?? []).join("\n");
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
