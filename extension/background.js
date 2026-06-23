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
      reason: "放松 5 分钟",
      minutes: 5,
      category: "play",
      expiryAction: "check_in",
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
      expiryAction: "check_in",
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
      reason: "放松 5 分钟",
      minutes: 5,
      category: "play",
      expiryAction: "check_in",
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
const AI_DETECT_URL = "http://127.0.0.1:3001/detect";
const AI_HEALTH_URL = "http://127.0.0.1:3001/health";
const AI_DETECT_ALARM = "ai_periodic_detect";
const AI_DETECT_COOLDOWN_MS = 30_000;
let lastAiDetectTime = 0;
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

  const grantedMinutes = Math.max(
    1,
    Math.round(((session.expiresAt ?? Date.now()) - (session.startedAt ?? Date.now())) / 60_000),
  );
  const checkInUrl = chrome.runtime.getURL(
    `expired.html?target=${encodeURIComponent(target)}&reason=${encodeURIComponent(
      session.reason,
    )}&url=${encodeURIComponent(session.originalUrl ?? "")}`,
  );

  await safeTabCreate({ url: checkInUrl, active: true });

  chrome.notifications.create(`expired:${target}:${Date.now()}`, {
    type: "basic",
    iconUrl: "notification-icon.png",
    title: "Focus Guard",
    message: `${grantedMinutes} 分钟到了：${session.reason}。你现在还需要继续吗？`,
    priority: 2,
  });

  notifyDesktop({
    type: "session_expired",
    target,
    reason: session.reason,
  });
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes.pendingInterference) return;
  const ctx = changes.pendingInterference.newValue;
  if (!ctx || !ctx.reason) return;

  await chrome.storage.local.remove("pendingInterference");

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.url || !tab.url.startsWith("http")) return;

    await chrome.storage.local.set({
      aiDetectContext: {
        tabId: tab.id,
        target: `site:${new URL(tab.url).hostname}`,
        reason: ctx.reason,
        category: ctx.category,
        confidence: ctx.confidence,
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
  } catch {}
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
    const result = await storeIntent(message, sender);
    if (!result.ok) {
      return result;
    }
    notifyDesktop({
      type: "intent_submitted",
      target: message.target,
      reason: message.reason,
      minutes: message.minutes,
    });
    return { ok: true };
  }

  if (message.type === "extend_session") {
    return storeIntent(message, sender);
  }

  if (message.type === "approve_ai_intervention") {
    return storeAiInterventionAllow(message);
  }

  if (message.type === "close_expired_page") {
    if (!sender?.tab?.id) {
      return { ok: false, error: "tab_not_found" };
    }

    const closed = await safeTabRemove(sender.tab.id);
    return closed ? { ok: true } : { ok: false, error: "tab_close_failed" };
  }

  if (message.type === "close_current_tab") {
    if (!sender?.tab?.id) {
      return { ok: false, error: "tab_not_found" };
    }

    const closed = await safeTabRemove(sender.tab.id);
    return closed ? { ok: true } : { ok: false, error: "tab_close_failed" };
  }

  if (message.type === "add_unknown_site_decision") {
    return addUnknownSiteDecision(message);
  }

  if (message.type === "get_ai_detect_context") {
    const { aiDetectContext = null } = await chrome.storage.local.get("aiDetectContext");
    return aiDetectContext;
  }

  if (message.type === "get_ai_detect_log") {
    const { aiDetectLog = [] } = await chrome.storage.local.get("aiDetectLog");
    return { log: aiDetectLog.slice(-20).reverse() };
  }

  if (message.type === "clear_ai_detect_log") {
    await chrome.storage.local.set({ aiDetectLog: [] });
    return { ok: true };
  }

  if (message.type === "run_ai_detect_now") {
    const result = await triggerAiDetect("manual", { force: true, preferAnyHttpTab: true });
    return { ok: true, ...result };
  }

  if (message.type === "check_ai_server_health") {
    return checkAiServerHealth();
  }

  if (message.type === "validate_distraction_reason") {
    return validateDistractionReason(message.reason, message.target);
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
  const target = String(message.target ?? "").trim();
  if (!target) return { ok: false, error: "target_required" };
  const reason = String(message.reason ?? "").trim();
  if (!reason) return { ok: false, error: "reason_required" };
  const minutes = Number(message.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { ok: false, error: "minutes_must_be_positive" };
  }
  const category = message.category ?? "study";
  const expiryAction = normalizeExpiryAction(message.expiryAction ?? expiryActionForCategory(category));

  if (message.saveCandidate) {
    const targetCandidates = candidates[target] ?? [];
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

    candidates[target] = targetCandidates;
  }

  const expiresAt = now + minutes * 60 * 1000;

  sessions[target] = {
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
    target,
    reason,
    category,
    expiryAction,
    grantedMinutes: minutes,
  });

  await chrome.storage.local.set({ candidates, sessions, activityLog });
  chrome.alarms.create(`session:${target}`, { when: expiresAt });
  return { ok: true };
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

async function storeAiInterventionAllow(message) {
  const { aiInterventionAllows = {}, aiDetectContext = null, activityLog = [] } =
    await chrome.storage.local.get(["aiInterventionAllows", "aiDetectContext", "activityLog"]);
  const now = Date.now();
  const target = String(message.target || aiDetectContext?.target || "").trim();
  const reason = String(message.reason || "").trim();
  const minutes = validMinutes(message.minutes, 5);
  if (!target || !reason) return { ok: false };

  aiInterventionAllows[target] = now + minutes * 60 * 1000;
  activityLog.push({
    timestamp: now,
    type: "ai_intervention_approved",
    target,
    reason,
    grantedMinutes: minutes,
  });

  await chrome.storage.local.set({
    aiInterventionAllows,
    aiDetectContext: null,
    activityLog,
  });
  return { ok: true };
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
  return "check_in";
}

function normalizeExpiryAction(action) {
  return "check_in";
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
    return true;
  } catch {
    // The user may have already closed the tab before the expiry alarm fires.
    return false;
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

async function recordAiDetectLog(entry) {
  try {
    const { aiDetectLog = [] } = await chrome.storage.local.get("aiDetectLog");
    aiDetectLog.push(entry);
    if (aiDetectLog.length > 200) {
      aiDetectLog.splice(0, aiDetectLog.length - 200);
    }
    await chrome.storage.local.set({ aiDetectLog });
  } catch {
    // Detection logging should never break browsing or intervention flow.
  }
}

async function recordAiDetectResult(entry) {
  await recordAiDetectLog(entry);
  return entry;
}

async function triggerAiDetect(source, options = {}) {
  const now = Date.now();
  if (!options.force && now - lastAiDetectTime < AI_DETECT_COOLDOWN_MS) {
    return { status: "cooldown" };
  }
  lastAiDetectTime = now;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    let tab = tabs[0];
    if (options.preferAnyHttpTab && (!tab?.url || !tab.url.startsWith("http"))) {
      const windowTabs = await chrome.tabs.query({ currentWindow: true });
      tab = windowTabs.find((candidate) => candidate.url?.startsWith("http"));
    }
    if (!tab || !tab.url || !tab.url.startsWith("http")) {
      if (options.preferAnyHttpTab) {
        return recordAiDetectResult({
          timestamp: now,
          source,
          status: "no_http_tab",
          error: "No detectable http tab in the current window",
        });
      }
      return { status: "no_http_tab" };
    }

    const target = `site:${new URL(tab.url).hostname}`;
    const { config = {} } = await chrome.storage.local.get("config");
    if (isAllowlistedSite(new URL(tab.url).hostname, configWithDefaults(config).allowlistRules)) {
      return { status: "allowlist" };
    }

    const { aiInterventionAllows = {} } = await chrome.storage.local.get("aiInterventionAllows");
    if (aiInterventionAllows[target] > now) {
      return { status: "temporary_allow" };
    }
    if (aiInterventionAllows[target]) {
      delete aiInterventionAllows[target];
      await chrome.storage.local.set({ aiInterventionAllows });
    }

    const response = await fetch(AI_DETECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        browser_only: true,
        browser_context: {
          domain: new URL(tab.url).hostname,
          title: tab.title || "",
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      return recordAiDetectResult({
        timestamp: now,
        source,
        status: "http_error",
        error: `HTTP ${response.status}`,
      });
    }

    const result = await response.json();

    if (result.error) {
      return recordAiDetectResult({
        timestamp: now,
        source,
        status: "server_error",
        error: result.error,
        process: result.process_name,
        window: result.window_title,
      });
    }

    const isDistracting = result.category === "distracting" || result.category === "distraction";

    if (isDistracting) {
      await chrome.storage.local.set({
        aiDetectContext: {
          tabId: tab.id,
          target,
          reason: result.reason,
          category: result.category,
          confidence: result.confidence,
        },
      });

      try {
        await chrome.scripting.insertCSS({
          files: ["interference.css"],
          target: { tabId: tab.id },
        });
        await chrome.scripting.executeScript({
          files: ["interference.js"],
          target: { tabId: tab.id },
        });
      } catch (error) {
        return recordAiDetectResult({
          timestamp: now,
          source,
          status: "inject_failed",
          error: error?.message ?? "Failed to inject interference overlay",
          category: result.category,
          confidence: result.confidence,
          reason: result.reason,
          process: result.process_name,
          window: result.window_title,
        });
      }
    }

    return recordAiDetectResult({
      timestamp: now,
      source,
      status: isDistracting ? "interference_shown" : "ok",
      category: result.category,
      confidence: result.confidence,
      reason: result.reason,
      process: result.process_name,
      window: result.window_title,
    });
  } catch (error) {
    return recordAiDetectResult({
      timestamp: now,
      source,
      status: "request_failed",
      error: error?.message ?? "AI detect request failed",
    });
  }
}

async function checkAiServerHealth() {
  try {
    const response = await fetch(AI_HEALTH_URL, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const result = await response.json();
    return result.ok === true
      ? { ok: true }
      : { ok: false, error: "Server health response was not ok" };
  } catch (error) {
    return { ok: false, error: error?.message ?? "Health check failed" };
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
