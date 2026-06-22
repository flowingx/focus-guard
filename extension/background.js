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
const POLICY_CONFIG_URL = "http://127.0.0.1:3001/policy-config";
const AI_DETECT_URL = "http://127.0.0.1:3001/detect";
const AI_DETECT_ALARM = "ai_periodic_detect";
const AI_DETECT_COOLDOWN_MS = 30_000;
const POLICY_SYNC_COOLDOWN_MS = 2_000;
let lastAiDetectTime = 0;
let lastPolicySyncTime = 0;
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

  chrome.alarms.create(AI_DETECT_ALARM, { periodInMinutes: 5 });
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

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0 || !details.url.startsWith("http")) {
    return;
  }
  await triggerAiDetect("page_load");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AI_DETECT_ALARM) {
    await triggerAiDetect("periodic");
    return;
  }

  if (!alarm.name.startsWith("session:")) {
    return;
  }

  const target = alarm.name.slice("session:".length);
  const { config = {}, sessions = {}, activityLog = [] } = await chrome.storage.local.get([
    "config",
    "sessions",
    "activityLog",
  ]);
  const session = sessions[target];

  if (!session || session.expiresAt > Date.now()) {
    return;
  }

  if (isAllowlistedTarget(target, config)) {
    delete sessions[target];
    await chrome.storage.local.set({ sessions });
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
  const grantedMinutes = Math.max(
    1,
    Math.round(((session.expiresAt ?? Date.now()) - (session.startedAt ?? Date.now())) / 60_000),
  );

  if (session.expiryAction === "close_tab" && session.tabId) {
    await safeTabRemove(session.tabId);
  }

  if (session.expiryAction === "check_in") {
    const checkInUrl = chrome.runtime.getURL(
      `expired.html?target=${encodeURIComponent(target)}&reason=${encodeURIComponent(
        session.reason,
      )}&url=${encodeURIComponent(session.originalUrl ?? "")}`,
    );

    await safeTabCreate({ url: checkInUrl, active: true });
  }

  chrome.notifications.create(`expired:${target}:${Date.now()}`, {
    type: "basic",
    iconUrl: "notification-icon.png",
    title: "Focus Guard",
    message:
      session.expiryAction === "check_in"
        ? `${grantedMinutes} 分钟到了：${session.reason}。你现在还在学习吗？`
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
    const nextConfig = {
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
    };
    await chrome.storage.local.set({ config: nextConfig });
    await pushPolicyConfigToServer(nextConfig);
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

  if (message.type === "get_ai_detect_context") {
    const { aiDetectContext = null } = await chrome.storage.local.get("aiDetectContext");
    return aiDetectContext;
  }

  if (message.type === "validate_distraction_reason") {
    return validateDistractionReason(message.reason, message.target);
  }

  return { ok: false };
}

async function evaluateNavigation(url) {
  const host = normalizeHost(url);
  const target = `site:${host}`;
  await syncPolicyConfigFromServer();
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

async function syncPolicyConfigFromServer() {
  const now = Date.now();
  if (now - lastPolicySyncTime < POLICY_SYNC_COOLDOWN_MS) {
    return;
  }
  lastPolicySyncTime = now;

  try {
    const response = await fetch(POLICY_CONFIG_URL, {
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) return;
    const remote = await response.json();
    const { config = {} } = await chrome.storage.local.get("config");
    await chrome.storage.local.set({
      config: {
        ...config,
        focusMode: remote.focusMode !== false,
        defaultMinutes: validMinutes(remote.defaultMinutes, config.defaultMinutes ?? 20),
        highRiskDomains: cleanRuleList(
          remote.highRiskDomains,
          config.highRiskDomains ?? DEFAULT_HIGH_RISK_DOMAINS,
        ),
        allowlistRules: cleanRuleList(
          remote.allowlistRules,
          config.allowlistRules ?? DEFAULT_ALLOWLIST_RULES,
        ),
      },
    });
  } catch {
    // The desktop server is optional for extension-only use.
  }
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
    const nextConfig = {
      ...config,
      highRiskDomains: unique([...highRiskDomains, host]),
    };
    await chrome.storage.local.set({
      config: nextConfig,
      lastRuleChange: {
        list: "highRiskDomains",
        rule: host,
        timestamp: Date.now(),
      },
    });
    await pushPolicyConfigToServer(nextConfig);

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
    const nextConfig = {
      ...config,
      allowlistRules: unique([...allowlistRules, host]),
    };
    await chrome.storage.local.set({
      config: nextConfig,
      lastRuleChange: {
        list: "allowlistRules",
        rule: host,
        timestamp: Date.now(),
      },
    });
    await pushPolicyConfigToServer(nextConfig);

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

function isAllowlistedTarget(target, config) {
  if (!target?.startsWith("site:")) {
    return false;
  }
  const host = target.slice("site:".length);
  return isAllowlistedSite(host, configWithDefaults(config).allowlistRules);
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

async function pushPolicyConfigToServer(config) {
  try {
    const withDefaults = configWithDefaults(config);
    await fetch(POLICY_CONFIG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        focusMode: withDefaults.focusMode,
        highRiskDomains: withDefaults.highRiskDomains,
        allowlistRules: withDefaults.allowlistRules,
        defaultMinutes: withDefaults.defaultMinutes,
      }),
      signal: AbortSignal.timeout(1200),
    });
  } catch {
    // The desktop server may be closed while the browser extension is still active.
  }
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

  if (cleanRule.startsWith("*") && cleanRule.endsWith("*")) {
    const token = cleanRule.slice(1, -1).replace(/^\.+|\.+$/g, "");
    return Boolean(token) && host.split(".").includes(token);
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

function classifyTitleText(text) {
  const value = String(text || "").toLowerCase();
  if (
    /剪辑|搞笑|娱乐|游戏|直播|番剧|动漫|综艺/.test(text || "") ||
    /(clip|game|gaming|live|stream|anime)/.test(value)
  ) {
    return "entertainment_title";
  }
  if (
    /课程|教程|网课|公开课|讲座|概率|统计|编译原理|数学|学习/.test(text || "") ||
    /(course|tutorial|lecture|math|compiler)/.test(value)
  ) {
    return "study_title";
  }
  return "generic_title";
}

function normalizeAiCategory(category) {
  const value = String(category || "unknown").toLowerCase();
  if (value === "distraction") return "distracting";
  if (["study", "work", "productive"].includes(value)) return "productive";
  if (["distracting", "entertainment"].includes(value)) return "distracting";
  return value;
}

function bilibiliUrlKind(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path.startsWith("/video/") || /^\/BV/i.test(path)) return "video";
    if (path.startsWith("/bangumi/")) return "bangumi";
    if (parsed.hostname.includes("live.bilibili.com")) return "live";
    if (path.startsWith("/search")) return "search";
    if (path === "/" || path === "") return "home";
  } catch {}
  return "unknown";
}

function hintsFromText(text) {
  const hints = new Set();
  const value = String(text || "").toLowerCase();
  if (/课程|教程|网课|公开课|讲座|课堂|学习/.test(text || "")) hints.add("course_hint");
  if (/教程|教学|tutorial/.test(value) || /教程|教学/.test(text || "")) hints.add("tutorial_hint");
  if (/lecture/.test(value) || /讲座|公开课/.test(text || "")) hints.add("lecture_hint");
  if (/概率|统计|编译原理|数学|考试|试卷/.test(text || "")) hints.add("study_hint");
  if (/动漫|动画|番剧/.test(text || "")) hints.add("anime_hint");
  if (/番剧/.test(text || "")) hints.add("bangumi_hint");
  if (/游戏|game|gaming/.test(value) || /游戏/.test(text || "")) hints.add("game_hint");
  if (/直播|live|stream/.test(value) || /直播/.test(text || "")) hints.add("live_hint");
  if (/剪辑|搞笑|鬼畜|clip/.test(value) || /剪辑|搞笑|鬼畜/.test(text || "")) hints.add("clip_hint");
  return [...hints].slice(0, 8);
}

async function getPageMetadata(tab) {
  let parsed;
  try {
    parsed = new URL(tab.url);
  } catch {
    return { site: "", url_kind: "unknown", title_class: classifyTitleText(tab.title || ""), content_hints: [] };
  }

  const isBilibili = parsed.hostname.includes("bilibili.com");
  const metadata = {
    site: isBilibili ? "bilibili" : "",
    url_kind: isBilibili ? bilibiliUrlKind(tab.url) : "unknown",
    title_class: classifyTitleText(tab.title || ""),
    content_hints: hintsFromText(tab.title || ""),
  };

  if (!isBilibili || !tab.id) return metadata;

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const pickText = (selector) => {
          const node = document.querySelector(selector);
          return node ? String(node.textContent || node.content || "").slice(0, 160) : "";
        };
        return {
          title: document.title,
          description: document.querySelector('meta[name="description"]')?.content?.slice(0, 200) || "",
          category: [
            pickText(".video-data .a-crumbs"),
            pickText(".firstchannel-tag"),
            pickText(".channel-name"),
            pickText(".media-info .media-right .media-desc"),
          ]
            .filter(Boolean)
            .join(" "),
        };
      },
    });
    const value = result?.result || {};
    const hintText = [value.title, value.description, value.category].filter(Boolean).join(" ");
    metadata.title_class = classifyTitleText(value.title || tab.title || "");
    metadata.content_hints = [...new Set([...metadata.content_hints, ...hintsFromText(hintText)])].slice(0, 8);
  } catch {
    // Some pages block script injection; title and URL metadata are enough.
  }

  return metadata;
}

async function triggerAiDetect(source) {
  const now = Date.now();
  if (now - lastAiDetectTime < AI_DETECT_COOLDOWN_MS) {
    return;
  }
  lastAiDetectTime = now;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.url || !tab.url.startsWith("http")) {
      return;
    }
    const pageMetadata = await getPageMetadata(tab);

    const response = await fetch(AI_DETECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        browser_context: {
          domain: new URL(tab.url).hostname,
          title: tab.title || "",
          page_metadata: pageMetadata,
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      return;
    }

    const result = await response.json();

    if (result.error) {
      return;
    }

    const category = normalizeAiCategory(result.category);
    const isDistracting = category === "distracting";

    if (isDistracting) {
      await chrome.storage.local.set({
        aiDetectContext: {
          tabId: tab.id,
          target: `site:${new URL(tab.url).hostname}`,
          reason: result.reason,
          category,
          confidence: result.confidence,
        },
      });

      await chrome.scripting.insertCSS({
        files: ["interference.css"],
        target: { tabId: tab.id },
      });
      await chrome.scripting.executeScript({
        files: ["interference.js"],
        target: { tabId: tab.id },
      });
    }

    const { aiDetectLog = [] } = await chrome.storage.local.get("aiDetectLog");
    aiDetectLog.push({
      timestamp: now,
      source,
      category,
      confidence: result.confidence,
      reason: result.reason,
      process: result.process_name,
      window: result.window_title,
    });
    if (aiDetectLog.length > 200) {
      aiDetectLog.splice(0, aiDetectLog.length - 200);
    }
    await chrome.storage.local.set({ aiDetectLog });
  } catch {
    // Server not running or network error — silently ignore.
  }
}

async function validateDistractionReason(reason, target) {
  try {
    const response = await fetch(AI_DETECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ validate_reason: true, reason, target }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return { approved: true };
    }

    const result = await response.json();
    return {
      approved: result.approved ?? true,
      message: result.message ?? "",
    };
  } catch {
    return { approved: true };
  }
}
