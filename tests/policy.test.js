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
  expireSessions,
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
