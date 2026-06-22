import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_HIGH_RISK_DOMAINS,
  DEFAULT_INTENT_PRESETS,
  DEFAULT_ALLOWLIST_RULES,
  createPolicyState,
  evaluateAppFocus,
  evaluateSiteOpen,
  isHighRiskDomain,
  isAllowlistedSite,
  recordIntentCandidate,
  selectIntentCandidate,
  submitCustomIntent,
  expireSessions,
  getVisibleCandidates,
} from "../shared/policy.js";

test("zhihu is included in the default high-risk domain list", () => {
  assert.equal(DEFAULT_HIGH_RISK_DOMAINS.includes("*.zhihu.*"), true);
  assert.equal(isHighRiskDomain("https://www.zhihu.com/question/123"), true);
});

test("high-risk matching supports wildcard site-name rules without substring false positives", () => {
  assert.equal(isHighRiskDomain("https://m.bilibili.tv/video/123", ["*.bilibili.*"]), true);
  assert.equal(isHighRiskDomain("https://www.bilibili.com/video/123", ["*.bilibili.*"]), true);
  assert.equal(isHighRiskDomain("https://notbilibili.com/feed", ["*.bilibili.*"]), false);
  assert.equal(isHighRiskDomain("https://learning.youtube-nocookie.com", ["youtube"]), false);
  assert.equal(isHighRiskDomain("https://music.youtube.com", ["youtube"]), true);
});

test("allowlist supports school suffixes, search engines, and AI research tools", () => {
  assert.equal(DEFAULT_ALLOWLIST_RULES.includes("*.edu"), true);
  assert.equal(DEFAULT_ALLOWLIST_RULES.includes("*.edu.cn"), true);
  assert.equal(isAllowlistedSite("https://cs.stanford.edu/course", DEFAULT_ALLOWLIST_RULES), true);
  assert.equal(isAllowlistedSite("https://lib.tsinghua.edu.cn", DEFAULT_ALLOWLIST_RULES), true);
  assert.equal(isAllowlistedSite("https://gemini.google.com/app", DEFAULT_ALLOWLIST_RULES), true);
  assert.equal(isAllowlistedSite("https://yuanbao.tencent.com/chat", DEFAULT_ALLOWLIST_RULES), true);
  assert.equal(isAllowlistedSite("https://chatgpt.com", DEFAULT_ALLOWLIST_RULES), true);
  assert.equal(isAllowlistedSite("https://chatglm.cn", DEFAULT_ALLOWLIST_RULES), true);
});

test("allowlist wins over focus-mode unknown-site prompting", () => {
  const state = createPolicyState();

  const decision = evaluateSiteOpen(state, {
    url: "https://gemini.google.com/app",
    focusMode: true,
  });

  assert.deepEqual(decision, {
    action: "allow",
    target: "site:gemini.google.com",
    reason: "allowlist",
  });
});

test("exact allowlist rules do not accidentally allow distracting subdomains", () => {
  assert.equal(isAllowlistedSite("https://baidu.com", ["=baidu.com"]), true);
  assert.equal(isAllowlistedSite("https://tieba.baidu.com", ["=baidu.com"]), false);
});

test("allowlist supports user-entered contains wildcard rules for localhost", () => {
  assert.equal(isAllowlistedSite("http://localhost:3000", ["*localhost*"]), true);
  assert.equal(isAllowlistedSite("http://foo.localhost:3000", ["*localhost*"]), true);
  assert.equal(isAllowlistedSite("https://notlocalhost.com", ["*localhost*"]), false);
});

test("unknown sites ask whether to add them during focus mode", () => {
  const state = createPolicyState();

  assert.equal(
    evaluateSiteOpen(state, {
      url: "https://example-learning-resource.edu/page",
      focusMode: false,
    }).action,
    "allow",
  );

  assert.equal(
    evaluateSiteOpen(state, {
      url: "https://new-distraction.test/feed",
      focusMode: true,
    }).action,
    "unknown_review",
  );
});

test("video sites include default play and study presets before custom candidates", () => {
  const state = createPolicyState();
  const decision = evaluateSiteOpen(state, {
    url: "https://www.bilibili.com/video/BV123",
    focusMode: true,
  });

  assert.deepEqual(
    decision.candidates.map((candidate) => [
      candidate.reason,
      candidate.category,
      candidate.minutes,
      candidate.expiryAction,
    ]),
    [
      ["放松 10 分钟", "play", 10, "close_tab"],
      ["看网课/学习视频", "study", 10, "check_in"],
      ["觉得无聊，先停一下", "play", 5, "close_tab"],
    ],
  );
  assert.equal(DEFAULT_INTENT_PRESETS.video.length, 3);
});

test("saved candidates can override matching default preset text", () => {
  const state = createPolicyState();
  const target = "site:bilibili.com";
  recordIntentCandidate(state, target, "看网课/学习视频", 30, 1000, {
    category: "study",
    expiryAction: "check_in",
  });

  const decision = evaluateSiteOpen(state, {
    url: "https://bilibili.com/video/BV123",
    focusMode: true,
  });

  const studyCandidate = decision.candidates.find(
    (candidate) => candidate.reason === "看网课/学习视频",
  );

  assert.equal(studyCandidate.minutes, 30);
  assert.equal(studyCandidate.source, "saved");
});

test("saved intent candidates are shown with a maximum of three visible options", () => {
  const state = createPolicyState();
  const target = "app:Doubao.exe";

  recordIntentCandidate(state, target, "查课程资料", 20, 1000);
  recordIntentCandidate(state, target, "看论文讨论", 30, 2000);
  recordIntentCandidate(state, target, "确认报错解决方案", 15, 3000);
  recordIntentCandidate(state, target, "随便看看", 5, 4000);
  selectIntentCandidate(state, target, "查课程资料", 5000);
  selectIntentCandidate(state, target, "查课程资料", 6000);

  const decision = evaluateAppFocus(state, {
    processName: "Doubao.exe",
  });

  assert.equal(decision.action, "intent_required");
  assert.deepEqual(
    decision.candidates.map((candidate) => candidate.reason),
    ["查课程资料", "随便看看", "确认报错解决方案"],
  );
});

test("selecting a candidate starts a session and records expiry", () => {
  const state = createPolicyState();
  const target = "site:bilibili.com";

  recordIntentCandidate(state, target, "看数据库讲解", 20, 1000);

  const session = selectIntentCandidate(state, target, "看数据库讲解", 2000);

  assert.equal(session.target, target);
  assert.equal(session.reason, "看数据库讲解");
  assert.equal(session.expiresAt, 20 * 60 * 1000 + 2000);

  const expired = expireSessions(state, 20 * 60 * 1000 + 2001);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].outcome, "expired");
});

test("submitCustomIntent creates a session and saves the candidate by default", () => {
  const state = createPolicyState();
  const now = 1000;

  const session = submitCustomIntent(state, "site:bilibili.com", "写作业", 30, {}, now);

  assert.equal(session.target, "site:bilibili.com");
  assert.equal(session.reason, "写作业");
  assert.equal(session.expiresAt, now + 30 * 60 * 1000);
  assert.equal(session.outcome, "active");
  assert.equal(state.sessions.length, 1);
  assert.equal(state.activityLog.length, 1);
  assert.equal(state.activityLog[0].type, "intent_submitted");
  assert.equal(state.candidatesByTarget["site:bilibili.com"].length, 1);
});

test("submitCustomIntent with saveCandidate false skips saving to candidates", () => {
  const state = createPolicyState();
  const now = 1000;

  const session = submitCustomIntent(state, "site:bilibili.com", "临时看看", 10, { saveCandidate: false }, now);

  assert.equal(state.candidatesByTarget["site:bilibili.com"], undefined);
  assert.equal(state.sessions.length, 1);
  assert.equal(session.reason, "临时看看");
});

test("submitCustomIntent rejects zero minutes via recordIntentCandidate", () => {
  const state = createPolicyState();

  assert.throws(
    () => submitCustomIntent(state, "site:bilibili.com", "测试", 0, {}, 1000),
    { message: "Duration must be a positive number of minutes" },
  );
});

test("submitCustomIntent rejects negative minutes via recordIntentCandidate", () => {
  const state = createPolicyState();

  assert.throws(
    () => submitCustomIntent(state, "site:bilibili.com", "测试", -5, {}, 1000),
    { message: "Duration must be a positive number of minutes" },
  );
});

test("submitCustomIntent rejects empty reason via recordIntentCandidate", () => {
  const state = createPolicyState();

  assert.throws(
    () => submitCustomIntent(state, "site:bilibili.com", "  ", 10, {}, 1000),
    { message: "Reason is required" },
  );
});

test("matchesHostRule handles *.com suffix rules", () => {
  assert.equal(isHighRiskDomain("https://www.reddit.com", ["*.com"]), true);
  assert.equal(isHighRiskDomain("https://example.co.uk", ["*.com"]), false);
});

test("matchesHostRule handles *.co.uk suffix rules", () => {
  assert.equal(isAllowlistedSite("https://www.cam.ac.uk", ["*.ac.uk"]), true);
  assert.equal(isHighRiskDomain("https://www.bbc.co.uk", ["*.co.uk"]), true);
  assert.equal(isHighRiskDomain("https://www.bbc.com", ["*.co.uk"]), false);
});

test("matchesHostRule handles exact match (=prefix) with subdomain mismatch", () => {
  assert.equal(isAllowlistedSite("https://baidu.com", ["=baidu.com"]), true);
  assert.equal(isAllowlistedSite("https://tieba.baidu.com", ["=baidu.com"]), false);
  assert.equal(isAllowlistedSite("https://www.baidu.com", ["=baidu.com"]), true);
  assert.equal(isAllowlistedSite("https://m.baidu.com", ["=baidu.com"]), false);
});

test("matchesHostRule handles empty rule gracefully", () => {
  assert.equal(isHighRiskDomain("https://example.com", [""]), false);
  assert.equal(isAllowlistedSite("https://example.com", [""]), false);
  assert.equal(isHighRiskDomain("https://example.com", []), false);
});

test("matchesHostRule handles *.token.* wildcard with token in domain", () => {
  assert.equal(isHighRiskDomain("https://www.youtube.com", ["*.youtube.*"]), true);
  assert.equal(isHighRiskDomain("https://m.youtube.com", ["*.youtube.*"]), true);
  assert.equal(isHighRiskDomain("https://youtube.com", ["*.youtube.*"]), true);
  assert.equal(isHighRiskDomain("https://notyoutube.com", ["*.youtube.*"]), false);
});

test("getVisibleCandidates returns empty array for non-video non-social target", () => {
  const state = createPolicyState();
  const candidates = getVisibleCandidates(state, "app:Notepad.exe");

  assert.deepEqual(candidates, []);
});

test("getVisibleCandidates merges presets and saved candidates, capped at 3", () => {
  const state = createPolicyState();
  const target = "site:bilibili.com";

  recordIntentCandidate(state, target, "查资料", 15, 1000);
  recordIntentCandidate(state, target, "看纪录片", 20, 2000);
  recordIntentCandidate(state, target, "放松一下", 5, 3000);

  const candidates = getVisibleCandidates(state, target);

  assert.ok(candidates.length <= 3);
  assert.equal(candidates.length, 3);

  const presetCount = candidates.filter((c) => c.source === "preset").length;
  const savedCount = candidates.filter((c) => c.source === "saved").length;
  assert.ok(presetCount + savedCount === 3);
});

test("getVisibleCandidates deduplicates saved over preset by same reason", () => {
  const state = createPolicyState();
  const target = "site:bilibili.com";

  recordIntentCandidate(state, target, "放松 10 分钟", 30, 1000);

  const candidates = getVisibleCandidates(state, target);
  const relaxed = candidates.find((c) => c.reason === "放松 10 分钟");

  assert.equal(relaxed.minutes, 30);
  assert.equal(relaxed.source, "saved");
});

test("expireSessions preserves active sessions and only expires past-due ones", () => {
  const state = createPolicyState();
  const now = 1000;
  const target = "site:bilibili.com";

  recordIntentCandidate(state, target, "看网课/学习视频", 10, now - 100);
  selectIntentCandidate(state, target, "看网课/学习视频", now);
  recordIntentCandidate(state, target, "放松 10 分钟", 10, now - 50);
  selectIntentCandidate(state, target, "放松 10 分钟", now + 100);

  const firstExpires = state.sessions[0].expiresAt;

  const expired = expireSessions(state, firstExpires + 1);

  assert.equal(expired.length, 1);
  assert.equal(expired[0].reason, "看网课/学习视频");
  assert.equal(expired[0].outcome, "expired");

  assert.equal(state.sessions[1].outcome, "active");
});

test("expireSessions returns empty when no sessions are expired", () => {
  const state = createPolicyState();
  const now = 1000;
  const target = "site:bilibili.com";

  recordIntentCandidate(state, target, "看网课/学习视频", 10, now - 100);
  selectIntentCandidate(state, target, "看网课/学习视频", now);

  const expired = expireSessions(state, now + 1);

  assert.equal(expired.length, 0);
  assert.equal(state.sessions[0].outcome, "active");
});

test("expireSessions handles empty session list", () => {
  const state = createPolicyState();

  const expired = expireSessions(state, Date.now());

  assert.deepEqual(expired, []);
});

test("findActiveSession returns active session via evaluateSiteOpen", () => {
  const state = createPolicyState();
  const now = 1000;
  const target = "site:bilibili.com";

  recordIntentCandidate(state, target, "看网课/学习视频", 10, now - 100);
  selectIntentCandidate(state, target, "看网课/学习视频", now);

  const decision = evaluateSiteOpen(state, {
    url: "https://www.bilibili.com/video/BV123",
    focusMode: true,
    now: now + 1000,
  });

  assert.equal(decision.action, "allow");
  assert.equal(decision.session.reason, "看网课/学习视频");
});

test("findActiveSession skips expired sessions via evaluateSiteOpen", () => {
  const state = createPolicyState();
  const now = 1000;
  const target = "site:bilibili.com";

  recordIntentCandidate(state, target, "看网课/学习视频", 10, now - 100);
  selectIntentCandidate(state, target, "看网课/学习视频", now);

  const expiresAt = state.sessions[0].expiresAt;

  const decision = evaluateSiteOpen(state, {
    url: "https://www.bilibili.com/video/BV123",
    focusMode: true,
    now: expiresAt + 1,
  });

  assert.equal(decision.action, "intent_required");
});

test("findActiveSession returns null when no session exists via evaluateAppFocus", () => {
  const state = createPolicyState();

  const decision = evaluateAppFocus(state, {
    processName: "Doubao.exe",
    now: 1000,
  });

  assert.equal(decision.action, "intent_required");
});

test("normalizeHost strips www prefix and lowercases via isHighRiskDomain", () => {
  assert.equal(isHighRiskDomain("https://WWW.Bilibili.COM/video", ["*.bilibili.*"]), true);
  assert.equal(isHighRiskDomain("https://www.Zhihu.com/question", ["*.zhihu.*"]), true);
  assert.equal(isHighRiskDomain("Bilibili.com", ["*.bilibili.*"]), true);
});

test("normalizeHost handles bare domain without protocol via isAllowlistedSite", () => {
  assert.equal(isAllowlistedSite("chatgpt.com", ["chatgpt.com"]), true);
  assert.equal(isAllowlistedSite("www.chatgpt.com", ["chatgpt.com"]), true);
  assert.equal(isAllowlistedSite("ChatGPT.COM", ["chatgpt.com"]), true);
});
