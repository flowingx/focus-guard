const DEFAULT_HIGH_RISK_DOMAINS = [
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

const DEFAULT_INTENT_PRESETS = {
  video: [
    {
      reason: "放松 10 分钟",
      minutes: 10,
      category: "play",
      expiryAction: "close_tab",
      source: "preset",
    },
    {
      reason: "看网课/学习视频",
      minutes: 10,
      category: "study",
      expiryAction: "check_in",
      source: "preset",
    },
    {
      reason: "觉得无聊，先停一下",
      minutes: 5,
      category: "play",
      expiryAction: "close_tab",
      source: "preset",
    },
  ],
  social: [
    {
      reason: "查资料/找答案",
      minutes: 20,
      category: "study",
      expiryAction: "check_in",
      source: "preset",
    },
    {
      reason: "放松 10 分钟",
      minutes: 10,
      category: "play",
      expiryAction: "close_tab",
      source: "preset",
    },
    {
      reason: "找灵感",
      minutes: 15,
      category: "study",
      expiryAction: "check_in",
      source: "preset",
    },
  ],
};

const VIDEO_DOMAINS = [
  "*.bilibili.*",
  "*.youtube.*",
  "*.douyin.*",
  "*.tiktok.*",
  "*.kuaishou.*",
  "*.netflix.*",
  "*.iqiyi.*",
  "*.youku.*",
  "*.mgtv.*",
  "*.twitch.*",
  "*.huya.*",
  "*.douyu.*",
];

const NATIVE_HOST = "com.focus_guard.desktop";
const TEMPORARY_ALLOW_MINUTES = 30;
const pendingUnknownPrompts = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["config", "sessions", "candidates"]);
  const config = current.config ?? {};

  await chrome.storage.local.set({
    config: {
      focusMode: config.focusMode ?? true,
      highRiskDomains: unique([...(config.highRiskDomains ?? []), ...DEFAULT_HIGH_RISK_DOMAINS]),
      allowlistRules: unique([...(config.allowlistRules ?? []), ...DEFAULT_ALLOWLIST_RULES]),
      defaultMinutes: config.defaultMinutes ?? 20,
    },
    sessions: current.sessions ?? {},
    candidates: current.candidates ?? {},
  });
});

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0 || !details.url.startsWith("http")) {
    return;
  }

  const decision = await evaluateNavigation(details.url);

  if (decision.action === "intent_required") {
    pendingUnknownPrompts.delete(details.tabId);
    const redirectUrl = chrome.runtime.getURL(
      `interstitial.html?target=${encodeURIComponent(decision.target)}&url=${encodeURIComponent(details.url)}`,
    );
    await safeTabUpdate(details.tabId, { url: redirectUrl });
  }

  if (decision.action === "unknown_review") {
    pendingUnknownPrompts.set(details.tabId, {
      target: decision.target,
      originalUrl: details.url,
    });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete" || !pendingUnknownPrompts.has(tabId)) {
    return;
  }

  const prompt = pendingUnknownPrompts.get(tabId);
  pendingUnknownPrompts.delete(tabId);

  await safeTabSendMessage(tabId, {
    type: "show_unknown_site_prompt",
    ...prompt,
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith("session:")) {
    return;
  }

  const target = alarm.name.slice("session:".length);
  const { sessions = {}, activityLog = [] } = await chrome.storage.local.get([
    "sessions",
    "activityLog",
  ]);
  const session = sessions[target];

  if (!session || session.expiresAt > Date.now()) {
    return;
  }

  activityLog.push({
    timestamp: Date.now(),
    type: "session_expired",
    target,
    reason: session.reason,
    grantedMinutes: Math.round((session.expiresAt - session.startedAt) / 60_000),
  });
  delete sessions[target];

  await chrome.storage.local.set({ sessions, activityLog });

  if (session.expiryAction === "close_tab" && session.tabId) {
    await safeTabRemove(session.tabId);
  }

  if (session.expiryAction === "check_in") {
    const checkInUrl = chrome.runtime.getURL(
      `expired.html?target=${encodeURIComponent(target)}&reason=${encodeURIComponent(
        session.reason,
      )}&url=${encodeURIComponent(session.originalUrl ?? "")}`,
    );

    if (session.tabId) {
      await safeTabUpdate(session.tabId, { url: checkInUrl, active: true });
    } else {
      await safeTabCreate({ url: checkInUrl, active: true });
    }
  }

  chrome.notifications.create(`expired:${target}:${Date.now()}`, {
    type: "basic",
    iconUrl: "notification-icon.png",
    title: "Focus Guard",
    message:
      session.expiryAction === "check_in"
        ? `10 分钟到了：${session.reason}。你现在还在学习吗？`
        : `休息时间到了：${session.reason}。我会帮你关掉这个标签页。`,
    priority: 2,
  });

  notifyDesktop({
    type: "session_expired",
    target,
    reason: session.reason,
  });
});

async function handleMessage(message, sender) {
  if (message.type === "get_intent_prompt") {
    const { candidates = {} } = await chrome.storage.local.get("candidates");
    return {
      candidates: visibleCandidates(message.target, candidates[message.target] ?? []),
      defaultMinutes: 20,
    };
  }

  if (message.type === "get_config") {
    const { config = {} } = await chrome.storage.local.get("config");
    return { config: configWithDefaults(config) };
  }

  if (message.type === "save_config") {
    const { config = {} } = await chrome.storage.local.get("config");
    await chrome.storage.local.set({
      config: {
        ...config,
        focusMode: message.config?.focusMode !== false,
        defaultMinutes: validMinutes(message.config?.defaultMinutes, config.defaultMinutes ?? 20),
        highRiskDomains: cleanRuleList(
          message.config?.highRiskDomains,
          config.highRiskDomains ?? DEFAULT_HIGH_RISK_DOMAINS,
        ),
        allowlistRules: cleanRuleList(
          message.config?.allowlistRules,
          config.allowlistRules ?? DEFAULT_ALLOWLIST_RULES,
        ),
      },
    });
    return { ok: true };
  }

  if (message.type === "undo_last_rule_change") {
    return undoLastRuleChange();
  }

  if (message.type === "submit_intent") {
    await storeIntent(message, sender);
    notifyDesktop({
      type: "intent_submitted",
      target: message.target,
      reason: message.reason,
      minutes: message.minutes,
    });
    return { ok: true };
  }

  if (message.type === "extend_session") {
    await storeIntent(message, sender);
    return { ok: true };
  }

  if (message.type === "close_current_tab") {
    if (sender?.tab?.id) {
      await safeTabRemove(sender.tab.id);
    }

    return { ok: true };
  }

  if (message.type === "add_unknown_site_decision") {
    return addUnknownSiteDecision(message);
  }

  return { ok: false };
}

async function evaluateNavigation(url) {
  const host = normalizeHost(url);
  const target = `site:${host}`;
  const { config, sessions = {}, temporaryAllows = {} } = await chrome.storage.local.get([
    "config",
    "sessions",
    "temporaryAllows",
  ]);
  const now = Date.now();

  const allowlistRules = config?.allowlistRules ?? DEFAULT_ALLOWLIST_RULES;

  if (isAllowlistedSite(host, allowlistRules)) {
    return { action: "allow", target, reason: "allowlist" };
  }

  if (sessions[target]?.expiresAt > now) {
    return { action: "allow", target };
  }

  if (temporaryAllows[host] > now) {
    return { action: "allow", target, reason: "temporary_allow" };
  }

  if (temporaryAllows[host]) {
    delete temporaryAllows[host];
    await chrome.storage.local.set({ temporaryAllows });
  }

  const highRiskDomains = config?.highRiskDomains ?? DEFAULT_HIGH_RISK_DOMAINS;
  const highRisk = isHighRiskDomain(host, highRiskDomains);

  if (!highRisk) {
    return {
      action: config?.focusMode === false ? "allow" : "unknown_review",
      target,
    };
  }

  return { action: "intent_required", target };
}

async function addUnknownSiteDecision(message) {
  const host = siteHostFromMessage(message);

  if (!host) {
    return { ok: false };
  }

  const target = message.target ?? `site:${host}`;
  const originalUrl = message.originalUrl ?? "";
  const fromToast = message.source === "toast";
  const current = await chrome.storage.local.get(["config", "temporaryAllows"]);
  const config = current.config ?? {};
  const temporaryAllows = current.temporaryAllows ?? {};

  if (message.decision === "control") {
    const highRiskDomains = config.highRiskDomains ?? DEFAULT_HIGH_RISK_DOMAINS;
    await chrome.storage.local.set({
      config: {
        ...config,
        highRiskDomains: unique([...highRiskDomains, host]),
      },
      lastRuleChange: {
        list: "highRiskDomains",
        rule: host,
        timestamp: Date.now(),
      },
    });

    return {
      ok: true,
      nextUrl: fromToast
        ? null
        : chrome.runtime.getURL(
            `interstitial.html?target=${encodeURIComponent(target)}&url=${encodeURIComponent(originalUrl)}`,
          ),
    };
  }

  if (message.decision === "ignore") {
    const allowlistRules = config.allowlistRules ?? DEFAULT_ALLOWLIST_RULES;
    await chrome.storage.local.set({
      config: {
        ...config,
        allowlistRules: unique([...allowlistRules, host]),
      },
      lastRuleChange: {
        list: "allowlistRules",
        rule: host,
        timestamp: Date.now(),
      },
    });

    return { ok: true, nextUrl: fromToast ? null : originalUrl };
  }

  if (message.decision === "temporary") {
    await chrome.storage.local.set({
      temporaryAllows: {
        ...temporaryAllows,
        [host]: Date.now() + TEMPORARY_ALLOW_MINUTES * 60 * 1000,
      },
    });

    return { ok: true, nextUrl: fromToast ? null : originalUrl };
  }

  return { ok: false };
}

async function undoLastRuleChange() {
  const { config = {}, lastRuleChange } = await chrome.storage.local.get([
    "config",
    "lastRuleChange",
  ]);

  if (!lastRuleChange?.list || !lastRuleChange?.rule) {
    return { ok: false };
  }

  const currentRules = config[lastRuleChange.list] ?? [];

  await chrome.storage.local.set({
    config: {
      ...config,
      [lastRuleChange.list]: currentRules.filter((rule) => rule !== lastRuleChange.rule),
    },
    lastRuleChange: null,
  });

  return { ok: true, rule: lastRuleChange.rule };
}

async function storeIntent(message, sender) {
  const { candidates = {}, sessions = {}, activityLog = [] } = await chrome.storage.local.get([
    "candidates",
    "sessions",
    "activityLog",
  ]);
  const now = Date.now();
  const reason = String(message.reason ?? "").trim();
  if (!reason) return { ok: false };
  const minutes = Number(message.minutes);
  const category = message.category ?? "study";
  const expiryAction = message.expiryAction ?? expiryActionForCategory(category);

  if (message.saveCandidate) {
    const targetCandidates = candidates[message.target] ?? [];
    const existing = targetCandidates.find((candidate) => candidate.reason === reason);

    if (existing) {
      existing.minutes = minutes;
      existing.useCount += 1;
      existing.lastUsedAt = now;
      existing.category = category;
      existing.expiryAction = expiryAction;
    } else {
      targetCandidates.push({
        reason,
        minutes,
        category,
        expiryAction,
        source: "saved",
        useCount: 1,
        createdAt: now,
        lastUsedAt: now,
      });
    }

    candidates[message.target] = targetCandidates;
  }

  const expiresAt = now + minutes * 60 * 1000;

  sessions[message.target] = {
    reason,
    category,
    expiryAction,
    originalUrl: message.originalUrl,
    tabId: sender?.tab?.id,
    startedAt: now,
    expiresAt,
  };

  activityLog.push({
    timestamp: now,
    type: "intent_submitted",
    target: message.target,
    reason,
    category,
    expiryAction,
    grantedMinutes: minutes,
  });

  await chrome.storage.local.set({ candidates, sessions, activityLog });
  chrome.alarms.create(`session:${message.target}`, { when: expiresAt });
}

function visibleCandidates(target, candidates) {
  const group = presetGroupForTarget(target);
  const presets = group ? DEFAULT_INTENT_PRESETS[group] : [];
  const byReason = new Map();

  for (const preset of presets) {
    byReason.set(preset.reason, { ...preset });
  }

  for (const candidate of candidates) {
    byReason.set(candidate.reason, {
      category: "study",
      expiryAction: "check_in",
      source: "saved",
      ...candidate,
    });
  }

  return [...byReason.values()]
    .sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === "preset" ? -1 : 1;
      }

      if (right.useCount !== left.useCount) {
        return (right.useCount ?? 0) - (left.useCount ?? 0);
      }

      return (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0);
    })
    .slice(0, 3);
}

function isHighRiskDomain(host, domains) {
  return domains.some((domain) => matchesHostRule(host, domain));
}

function isAllowlistedSite(host, rules) {
  return rules.some((rule) => matchesHostRule(host, rule));
}

function normalizeHost(url) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

function siteHostFromMessage(message) {
  if (message.originalUrl) {
    return normalizeHost(message.originalUrl);
  }

  if (message.target?.startsWith("site:")) {
    return message.target.slice("site:".length);
  }

  return "";
}

function presetGroupForTarget(target) {
  const domain = target.startsWith("site:") ? target.slice("site:".length) : "";

  if (!domain) {
    return null;
  }

  if (
    VIDEO_DOMAINS.some((videoDomain) => matchesHostRule(domain, videoDomain))
  ) {
    return "video";
  }

  return "social";
}

function expiryActionForCategory(category) {
  return category === "play" ? "close_tab" : "check_in";
}

function unique(values) {
  return [...new Set(values)];
}

function configWithDefaults(config) {
  return {
    focusMode: config.focusMode ?? true,
    highRiskDomains: config.highRiskDomains ?? DEFAULT_HIGH_RISK_DOMAINS,
    allowlistRules: config.allowlistRules ?? DEFAULT_ALLOWLIST_RULES,
    defaultMinutes: config.defaultMinutes ?? 20,
  };
}

function cleanRuleList(values, fallback) {
  if (!Array.isArray(values)) {
    return fallback;
  }

  const cleaned = values.map((value) => String(value).trim()).filter(Boolean);
  return unique(cleaned);
}

function validMinutes(value, fallback) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : fallback;
}

function matchesHostRule(host, rule) {
  const cleanRule = String(rule).toLowerCase().trim().replace(/^www\./, "");

  if (!cleanRule) {
    return false;
  }

  if (cleanRule.startsWith("=")) {
    return host === cleanRule.slice(1);
  }

  if (cleanRule.startsWith("*.") && !cleanRule.endsWith(".*")) {
    const suffix = cleanRule.slice(2);
    return host.endsWith(`.${suffix}`);
  }

  if (cleanRule.startsWith("*.") && cleanRule.endsWith(".*")) {
    const token = cleanRule.slice(2, -2);
    return host.split(".").includes(token);
  }

  if (!cleanRule.includes(".")) {
    return host.split(".").includes(cleanRule);
  }

  return host === cleanRule || host.endsWith(`.${cleanRule}`);
}

async function safeTabUpdate(tabId, updateProperties) {
  try {
    await chrome.tabs.update(tabId, updateProperties);
  } catch {
    // The tab can disappear while webNavigation or an alarm handler is still running.
  }
}

async function safeTabRemove(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // The user may have already closed the tab before the expiry alarm fires.
  }
}

async function safeTabCreate(createProperties) {
  try {
    await chrome.tabs.create(createProperties);
  } catch {
    // Chrome can reject tab creation while the browser is shutting down.
  }
}

async function safeTabSendMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Some pages cannot receive content-script messages, and unknown-site review is non-blocking.
  }
}

function notifyDesktop(message) {
  try {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message, () => {
      // Reading lastError prevents Chrome from surfacing an expected error when
      // the optional desktop native host has not been installed yet.
      void chrome.runtime.lastError;
    });
  } catch {
    // The extension still works with browser-local storage if the desktop helper is not installed.
  }
}
