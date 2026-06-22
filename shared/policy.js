export const DEFAULT_HIGH_RISK_DOMAINS = [
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

export const DEFAULT_ALLOWLIST_RULES = [
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

export const DEFAULT_INTENT_PRESETS = {
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

const VIDEO_DOMAINS = new Set([
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
]);

export function createPolicyState(config = {}) {
  return {
    highRiskDomains: config.highRiskDomains ?? [...DEFAULT_HIGH_RISK_DOMAINS],
    allowlistRules: config.allowlistRules ?? [...DEFAULT_ALLOWLIST_RULES],
    monitoredApps: config.monitoredApps ?? [
      "WeChat.exe",
      "QQ.exe",
      "Doubao.exe",
      "doubao.exe",
    ],
    defaultMinutes: config.defaultMinutes ?? 20,
    intentPresets: config.intentPresets ?? DEFAULT_INTENT_PRESETS,
    candidatesByTarget: {},
    sessions: [],
    activityLog: [],
  };
}

export function isHighRiskDomain(urlOrDomain, domains = DEFAULT_HIGH_RISK_DOMAINS) {
  const host = normalizeHost(urlOrDomain);
  return domains.some((domain) => matchesHostRule(host, domain));
}

export function isAllowlistedSite(urlOrDomain, rules = DEFAULT_ALLOWLIST_RULES) {
  const host = normalizeHost(urlOrDomain);
  return rules.some((rule) => matchesHostRule(host, rule));
}

export function evaluateSiteOpen(state, event) {
  const domain = normalizeHost(event.url);
  const target = `site:${domain}`;
  const activeSession = findActiveSession(state, target, event.now ?? Date.now());

  if (isAllowlistedSite(domain, state.allowlistRules)) {
    return { action: "allow", target, reason: "allowlist" };
  }

  if (activeSession) {
    return { action: "allow", target, session: activeSession };
  }

  if (!isHighRiskDomain(domain, state.highRiskDomains)) {
    return { action: event.focusMode === false ? "allow" : "unknown_review", target };
  }

  return {
    action: "intent_required",
    target,
    candidates: getVisibleCandidates(state, target),
  };
}

export function evaluateAppFocus(state, event) {
  const target = `app:${event.processName}`;
  const activeSession = findActiveSession(state, target, event.now ?? Date.now());

  if (activeSession) {
    return { action: "allow", target, session: activeSession };
  }

  if (!state.monitoredApps.includes(event.processName)) {
    return { action: "allow", target };
  }

  return {
    action: "intent_required",
    target,
    candidates: getVisibleCandidates(state, target),
  };
}

export function recordIntentCandidate(
  state,
  target,
  reason,
  minutes,
  now = Date.now(),
  options = {},
) {
  if (typeof now === "object") {
    options = now;
    now = Date.now();
  }

  const cleanReason = reason.trim();

  if (!cleanReason) {
    throw new Error("Reason is required");
  }

  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error("Duration must be a positive number of minutes");
  }

  const candidates = state.candidatesByTarget[target] ?? [];
  const existing = candidates.find((candidate) => candidate.reason === cleanReason);

  if (existing) {
    existing.minutes = minutes;
    existing.useCount += 1;
    existing.lastUsedAt = now;
    existing.category = options.category ?? existing.category ?? "study";
    existing.expiryAction =
      options.expiryAction ?? existing.expiryAction ?? expiryActionForCategory(existing.category);
    return existing;
  }

  const candidate = {
    reason: cleanReason,
    minutes,
    category: options.category ?? "study",
    expiryAction: options.expiryAction ?? expiryActionForCategory(options.category ?? "study"),
    source: "saved",
    useCount: 1,
    createdAt: now,
    lastUsedAt: now,
  };

  candidates.push(candidate);
  state.candidatesByTarget[target] = candidates;
  return candidate;
}

export function selectIntentCandidate(state, target, reason, now = Date.now()) {
  const candidates = state.candidatesByTarget[target] ?? [];
  const candidate = candidates.find((item) => item.reason === reason);

  if (!candidate) {
    throw new Error(`Unknown intent candidate: ${reason}`);
  }

  candidate.useCount += 1;
  candidate.lastUsedAt = now;

  const session = {
    target,
    reason: candidate.reason,
    category: candidate.category ?? "study",
    expiryAction: candidate.expiryAction ?? expiryActionForCategory(candidate.category ?? "study"),
    startedAt: now,
    expiresAt: now + candidate.minutes * 60 * 1000,
    outcome: "active",
  };

  state.sessions.push(session);
  state.activityLog.push({
    timestamp: now,
    type: "intent_selected",
    target,
    reason: candidate.reason,
    category: session.category,
    expiryAction: session.expiryAction,
    grantedMinutes: candidate.minutes,
  });

  return session;
}

export function submitCustomIntent(
  state,
  target,
  reason,
  minutes,
  options = {},
  now = Date.now(),
) {
  if (options.saveCandidate ?? true) {
    recordIntentCandidate(state, target, reason, minutes, now);
  }

  const session = {
    target,
    reason: reason.trim(),
    category: options.category ?? "study",
    expiryAction: options.expiryAction ?? expiryActionForCategory(options.category ?? "study"),
    startedAt: now,
    expiresAt: now + minutes * 60 * 1000,
    outcome: "active",
  };

  state.sessions.push(session);
  state.activityLog.push({
    timestamp: now,
    type: "intent_submitted",
    target,
    reason: session.reason,
    category: session.category,
    expiryAction: session.expiryAction,
    grantedMinutes: minutes,
    savedCandidate: options.saveCandidate ?? true,
  });

  return session;
}

export function expireSessions(state, now = Date.now()) {
  const expired = [];

  for (const session of state.sessions) {
    if (session.outcome === "active" && session.expiresAt <= now) {
      session.outcome = "expired";
      expired.push(session);
      state.activityLog.push({
        timestamp: now,
        type: "session_expired",
        target: session.target,
        reason: session.reason,
      });
    }
  }

  return expired;
}

export function getVisibleCandidates(state, target) {
  const saved = state.candidatesByTarget[target] ?? [];
  const presetGroup = presetGroupForTarget(target);
  const presets = presetGroup ? state.intentPresets[presetGroup] ?? [] : [];
  const byReason = new Map();

  for (const preset of presets) {
    byReason.set(preset.reason, { ...preset });
  }

  for (const candidate of saved) {
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

function findActiveSession(state, target, now) {
  return state.sessions.find(
    (session) =>
      session.target === target && session.outcome === "active" && session.expiresAt > now,
  );
}

function normalizeHost(urlOrDomain) {
  try {
    const host = new URL(urlOrDomain).hostname;
    return stripWww(host.toLowerCase());
  } catch {
    return stripWww(String(urlOrDomain).toLowerCase());
  }
}

function stripWww(host) {
  return host.startsWith("www.") ? host.slice(4) : host;
}

function presetGroupForTarget(target) {
  const domain = target.startsWith("site:") ? target.slice("site:".length) : "";

  if (!domain) {
    return null;
  }

  if (
    [...VIDEO_DOMAINS].some((videoDomain) => matchesHostRule(domain, videoDomain))
  ) {
    return "video";
  }

  return "social";
}

function expiryActionForCategory(category) {
  return category === "play" ? "close_tab" : "check_in";
}

function matchesHostRule(host, rule) {
  const cleanRule = stripWww(String(rule).toLowerCase().trim());

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
