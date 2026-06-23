import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadBackground(initialStorage = {}, options = {}) {
  const code = await readFile("extension/background.js", "utf8");
  const storage = structuredClone(initialStorage);
  const alarmCreates = [];
  const insertedCss = [];
  const executedScripts = [];
  const nativeMessages = [];
  const removedTabs = [];
  const createdTabs = [];
  const updatedTabs = [];
  const fetchCalls = [];
  const alarmListeners = [];
  let removeShouldFail = false;
  let scriptInjectionShouldFail = false;
  const activeTabs = options.activeTabs ?? [];
  const windowTabs = options.windowTabs ?? activeTabs;

  const listener = () => {};
  const chrome = {
    runtime: {
      lastError: null,
      getURL: (path) => `chrome-extension://focus-guard/${path}`,
      sendNativeMessage: (_host, message, callback) => {
        nativeMessages.push(message);
        callback?.();
      },
      onInstalled: { addListener: listener },
      onMessage: { addListener: listener },
    },
    webNavigation: {
      onBeforeNavigate: { addListener: listener },
      onCompleted: { addListener: listener },
    },
    tabs: {
      onUpdated: { addListener: listener },
      async query(queryInfo) {
        if (queryInfo?.active) {
          return activeTabs;
        }
        return windowTabs;
      },
      async update(tabId, properties) {
        updatedTabs.push({ tabId, properties });
      },
      async create(properties) {
        createdTabs.push(properties);
      },
      async remove(tabId) {
        if (removeShouldFail) {
          throw new Error("tab gone");
        }
        removedTabs.push(tabId);
      },
      async sendMessage() {},
    },
    alarms: {
      create: (name, info) => alarmCreates.push({ name, info }),
      onAlarm: { addListener: (callback) => alarmListeners.push(callback) },
    },
    notifications: {
      create: listener,
    },
    scripting: {
      async insertCSS(details) {
        if (scriptInjectionShouldFail) {
          throw new Error("cannot inject");
        }
        insertedCss.push(details);
      },
      async executeScript(details) {
        if (scriptInjectionShouldFail) {
          throw new Error("cannot inject");
        }
        executedScripts.push(details);
      },
    },
    storage: {
      onChanged: { addListener: listener },
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          }
          if (typeof keys === "string") {
            return { [keys]: storage[keys] };
          }
          return { ...keys, ...storage };
        },
        async set(values) {
          Object.assign(storage, values);
        },
        async remove(key) {
          delete storage[key];
        },
      },
    },
  };

  const context = {
    AbortSignal,
    Date,
    Error,
    Map,
    Number,
    Set,
    String,
    URL,
    chrome,
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      if (options.fetch) {
        return options.fetch(url, init);
      }
      return fetch(url, init);
    },
    structuredClone,
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: "extension/background.js" });

  return {
    context,
    storage,
    alarmCreates,
    insertedCss,
    executedScripts,
    createdTabs,
    updatedTabs,
    fetchCalls,
    nativeMessages,
    removedTabs,
    alarmListeners,
    failTabRemove() {
      removeShouldFail = true;
    },
    failScriptInjection() {
      scriptInjectionShouldFail = true;
    },
  };
}

test("background submit_intent persists a session, alarm, and desktop notification", async () => {
  const harness = await loadBackground({
    candidates: {},
    sessions: {},
    activityLog: [],
  });

  const response = await harness.context.handleMessage(
    {
      type: "submit_intent",
      target: "site:bilibili.com",
      reason: "看课程",
      minutes: 10,
      category: "study",
      expiryAction: "check_in",
      originalUrl: "https://www.bilibili.com/video/BV1",
      saveCandidate: true,
    },
    { tab: { id: 42 } },
  );

  assert.equal(response.ok, true);
  assert.equal(harness.storage.sessions["site:bilibili.com"].reason, "看课程");
  assert.equal(harness.storage.sessions["site:bilibili.com"].tabId, 42);
  assert.equal(harness.storage.candidates["site:bilibili.com"][0].reason, "看课程");
  assert.equal(harness.storage.activityLog[0].type, "intent_submitted");
  assert.equal(harness.alarmCreates[0].name, "session:site:bilibili.com");
  assert.equal(harness.nativeMessages[0].type, "intent_submitted");
});

test("background rejects invalid intent messages before mutating storage", async () => {
  const harness = await loadBackground({
    candidates: {},
    sessions: {},
    activityLog: [],
  });

  const response = await harness.context.handleMessage(
    {
      type: "submit_intent",
      target: "site:bilibili.com",
      reason: "   ",
      minutes: 10,
    },
    { tab: { id: 7 } },
  );

  assert.equal(response.ok, false);
  assert.equal(response.error, "reason_required");
  assert.deepEqual(harness.storage.sessions, {});
  assert.deepEqual(harness.alarmCreates, []);
  assert.deepEqual(harness.nativeMessages, []);
});

test("background close_current_tab reports tab removal success and failure", async () => {
  const harness = await loadBackground();

  const closed = await harness.context.handleMessage(
    { type: "close_current_tab" },
    { tab: { id: 9 } },
  );
  assert.equal(closed.ok, true);
  assert.deepEqual(harness.removedTabs, [9]);

  const missingTab = await harness.context.handleMessage({ type: "close_current_tab" }, {});
  assert.equal(missingTab.ok, false);
  assert.equal(missingTab.error, "tab_not_found");

  harness.failTabRemove();
  const closeFailed = await harness.context.handleMessage(
    { type: "close_current_tab" },
    { tab: { id: 10 } },
  );
  assert.equal(closeFailed.ok, false);
  assert.equal(closeFailed.error, "tab_close_failed");
});

test("background expired sessions open a reminder without removing or replacing the original tab", async () => {
  const now = Date.now();
  const harness = await loadBackground({
    sessions: {
      "site:gemini.google.com": {
        reason: "那是开会的链接",
        category: "study",
        expiryAction: "close_tab",
        originalUrl: "https://gemini.google.com/app",
        tabId: 88,
        startedAt: now - 5 * 60 * 1000,
        expiresAt: now - 1000,
      },
    },
    activityLog: [],
  });

  await harness.alarmListeners[0]({ name: "session:site:gemini.google.com" });

  assert.deepEqual(harness.removedTabs, []);
  assert.deepEqual(harness.updatedTabs, []);
  assert.equal(harness.createdTabs.length, 1);
  assert.match(harness.createdTabs[0].url, /expired\.html/);
});

test("background AI intervention approval creates a temporary allow without a session alarm", async () => {
  const harness = await loadBackground({
    aiDetectContext: { target: "site:gemini.google.com" },
    aiInterventionAllows: {},
    activityLog: [],
  });

  const response = await harness.context.handleMessage({
    type: "approve_ai_intervention",
    reason: "那是开会的链接",
    minutes: 5,
  }, {});

  assert.equal(response.ok, true);
  assert.equal(harness.storage.aiDetectContext, null);
  assert.equal(harness.storage.aiInterventionAllows["site:gemini.google.com"] > Date.now(), true);
  assert.equal(harness.storage.activityLog[0].type, "ai_intervention_approved");
  assert.deepEqual(harness.alarmCreates, []);
  assert.equal(harness.storage.sessions, undefined);
});

test("background exposes recent AI detect logs and can clear them", async () => {
  const aiDetectLog = Array.from({ length: 25 }, (_value, index) => ({
    timestamp: index + 1,
    status: `status-${index + 1}`,
  }));
  const harness = await loadBackground({ aiDetectLog });

  const response = await harness.context.handleMessage({ type: "get_ai_detect_log" }, {});

  assert.equal(response.log.length, 20);
  assert.equal(response.log[0].status, "status-25");
  assert.equal(response.log[19].status, "status-6");

  const cleared = await harness.context.handleMessage({ type: "clear_ai_detect_log" }, {});

  assert.equal(cleared.ok, true);
  assert.equal(harness.storage.aiDetectLog.length, 0);
});

test("background checks AI server health", async () => {
  const healthy = await loadBackground(
    {},
    {
      fetch: async () => ({
        ok: true,
        async json() {
          return { ok: true };
        },
      }),
    },
  );

  const ok = await healthy.context.handleMessage({ type: "check_ai_server_health" }, {});

  assert.equal(ok.ok, true);
  assert.equal(healthy.fetchCalls[0].url, "http://127.0.0.1:3001/health");
  assert.equal(healthy.fetchCalls[0].init.method, "GET");

  const httpFailure = await loadBackground(
    {},
    {
      fetch: async () => ({
        ok: false,
        status: 503,
        async json() {
          return { ok: false };
        },
      }),
    },
  );

  const failed = await httpFailure.context.handleMessage({ type: "check_ai_server_health" }, {});

  assert.equal(failed.ok, false);
  assert.equal(failed.error, "HTTP 503");
});

test("background reports AI server health request failures", async () => {
  const harness = await loadBackground(
    {},
    {
      fetch: async () => {
        throw new Error("connection refused");
      },
    },
  );

  const response = await harness.context.handleMessage({ type: "check_ai_server_health" }, {});

  assert.equal(response.ok, false);
  assert.equal(response.error, "connection refused");
});

test("background manual AI detect bypasses the automatic cooldown", async () => {
  const harness = await loadBackground(
    { aiDetectLog: [] },
    {
      activeTabs: [{ id: 98, url: "https://www.zhihu.com/question/2" }],
      fetch: async () => ({
        ok: true,
        async json() {
          return {
            category: "study",
            confidence: 0.7,
            reason: "阅读资料",
            process_name: "chrome.exe",
            window_title: "Zhihu",
          };
        },
      }),
    },
  );

  await harness.context.triggerAiDetect("test");
  const response = await harness.context.handleMessage({ type: "run_ai_detect_now" }, {});

  assert.equal(response.ok, true);
  assert.equal(response.status, "ok");
  assert.equal(harness.fetchCalls.length, 2);
  assert.equal(harness.storage.aiDetectLog[0].source, "test");
  assert.equal(harness.storage.aiDetectLog[1].source, "manual");
});

test("background manual AI detect falls back to a current-window http tab", async () => {
  const harness = await loadBackground(
    { aiDetectLog: [] },
    {
      activeTabs: [{ id: 1, url: "chrome-extension://focus-guard/options.html" }],
      windowTabs: [
        { id: 1, url: "chrome-extension://focus-guard/options.html" },
        { id: 102, url: "https://www.bilibili.com/video/BV2" },
      ],
      fetch: async () => ({
        ok: true,
        async json() {
          return {
            category: "study",
            confidence: 0.8,
            reason: "网课",
            process_name: "chrome.exe",
            window_title: "Bilibili",
          };
        },
      }),
    },
  );

  const response = await harness.context.handleMessage({ type: "run_ai_detect_now" }, {});

  assert.equal(response.ok, true);
  assert.equal(response.status, "ok");
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.storage.aiDetectLog[0].source, "manual");
  assert.equal(harness.storage.aiDetectLog[0].status, "ok");
});

test("background manual AI detect records when no http tab is available", async () => {
  const harness = await loadBackground(
    { aiDetectLog: [] },
    {
      activeTabs: [{ id: 1, url: "chrome-extension://focus-guard/options.html" }],
      windowTabs: [{ id: 1, url: "chrome-extension://focus-guard/options.html" }],
    },
  );

  const response = await harness.context.handleMessage({ type: "run_ai_detect_now" }, {});

  assert.equal(response.ok, true);
  assert.equal(response.status, "no_http_tab");
  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.storage.aiDetectLog[0].status, "no_http_tab");
  assert.equal(harness.storage.aiDetectLog[0].source, "manual");
});

test("background triggerAiDetect injects interference overlay for distracting results", async () => {
  const harness = await loadBackground(
    { aiDetectLog: [] },
    {
      activeTabs: [{ id: 99, url: "https://www.bilibili.com/video/BV1" }],
      fetch: async () => ({
        ok: true,
        async json() {
          return {
            category: "distracting",
            confidence: 0.92,
            reason: "正在刷视频",
            process_name: "chrome.exe",
            window_title: "Bilibili",
          };
        },
      }),
    },
  );

  await harness.context.triggerAiDetect("test");

  assert.equal(harness.fetchCalls[0].url, "http://127.0.0.1:3001/detect");
  assert.equal(harness.fetchCalls[0].init.method, "POST");
  const body = JSON.parse(harness.fetchCalls[0].init.body);
  assert.equal(body.browser_only, true);
  assert.equal(body.browser_context.domain, "www.bilibili.com");
  assert.equal(harness.storage.aiDetectContext.tabId, 99);
  assert.equal(harness.storage.aiDetectContext.target, "site:www.bilibili.com");
  assert.equal(harness.storage.aiDetectContext.reason, "正在刷视频");
  assert.equal(harness.insertedCss[0].files[0], "interference.css");
  assert.equal(harness.insertedCss[0].target.tabId, 99);
  assert.equal(harness.executedScripts[0].files[0], "interference.js");
  assert.equal(harness.executedScripts[0].target.tabId, 99);
  assert.equal(harness.storage.aiDetectLog[0].status, "interference_shown");
});

test("background triggerAiDetect skips allowlisted browser tabs", async () => {
  const harness = await loadBackground(
    {
      config: { allowlistRules: ["gemini.google.com"] },
      aiDetectLog: [],
    },
    {
      activeTabs: [{ id: 103, url: "https://gemini.google.com/app", title: "Gemini" }],
      fetch: async () => {
        throw new Error("allowlisted tabs should not call detect");
      },
    },
  );

  const response = await harness.context.triggerAiDetect("test", { force: true });

  assert.equal(response.status, "allowlist");
  assert.equal(harness.fetchCalls.length, 0);
  assert.deepEqual(harness.insertedCss, []);
  assert.deepEqual(harness.executedScripts, []);
});

test("background triggerAiDetect logs server errors without injecting overlay", async () => {
  const harness = await loadBackground(
    { aiDetectLog: [] },
    {
      activeTabs: [{ id: 100, url: "https://www.zhihu.com/question/1" }],
      fetch: async () => ({
        ok: true,
        async json() {
          return {
            error: "missing_api_key",
            process_name: "chrome.exe",
            window_title: "Zhihu",
          };
        },
      }),
    },
  );

  await harness.context.triggerAiDetect("test");

  assert.equal(harness.storage.aiDetectContext, undefined);
  assert.deepEqual(harness.insertedCss, []);
  assert.deepEqual(harness.executedScripts, []);
  assert.equal(harness.storage.aiDetectLog[0].status, "server_error");
  assert.equal(harness.storage.aiDetectLog[0].error, "missing_api_key");
});

test("background triggerAiDetect logs injection failures with model context", async () => {
  const harness = await loadBackground(
    { aiDetectLog: [] },
    {
      activeTabs: [{ id: 101, url: "https://www.youtube.com/watch?v=1" }],
      fetch: async () => ({
        ok: true,
        async json() {
          return {
            category: "distraction",
            confidence: 0.88,
            reason: "娱乐网站",
            process_name: "chrome.exe",
            window_title: "YouTube",
          };
        },
      }),
    },
  );
  harness.failScriptInjection();

  await harness.context.triggerAiDetect("test");

  assert.equal(harness.executedScripts.length, 0);
  assert.equal(harness.storage.aiDetectLog[0].status, "inject_failed");
  assert.equal(harness.storage.aiDetectLog[0].error, "cannot inject");
  assert.equal(harness.storage.aiDetectLog[0].reason, "娱乐网站");
  assert.equal(harness.storage.aiDetectLog[0].window, "YouTube");
});

test("background validateDistractionReason allows when server validation is unavailable", async () => {
  const httpFailure = await loadBackground(
    {},
    {
      fetch: async () => ({
        ok: false,
        status: 500,
        async json() {
          throw new Error("no body");
        },
      }),
    },
  );

  const failed = await httpFailure.context.handleMessage({
    type: "validate_distraction_reason",
    reason: "查资料",
    target: "site:bilibili.com",
  });

  assert.equal(failed.approved, true);

  const missingKey = await loadBackground(
    {},
    {
      fetch: async () => ({
        ok: true,
        async json() {
          return { approved: true, message: "验证服务未配置，已放行" };
        },
      }),
    },
  );

  const allowed = await missingKey.context.handleMessage({
    type: "validate_distraction_reason",
    reason: "看课程",
    target: "site:bilibili.com",
  });

  assert.equal(allowed.approved, true);
  assert.equal(allowed.message, "验证服务未配置，已放行");
});
