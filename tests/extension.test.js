import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";

test("extension manifest targets Chrome and Edge with Manifest V3", async () => {
  const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Focus Guard");
  assert.equal(manifest.permissions.includes("storage"), true);
  assert.equal(manifest.permissions.includes("nativeMessaging"), true);
  assert.equal(manifest.permissions.includes("alarms"), true);
  assert.equal(manifest.permissions.includes("notifications"), true);
  assert.equal(manifest.background.service_worker, "background.js");
});

test("extension interstitial contains saved candidates and other intent controls", async () => {
  const html = await readFile("extension/interstitial.html", "utf8");

  assert.match(html, /candidate-list/);
  assert.match(html, /custom-reason/);
  assert.match(html, /intent-category/);
  assert.match(html, /custom-minutes/);
  assert.match(html, /save-candidate/);
});

test("extension schedules expiry alarms and desktop notifications", async () => {
  const background = await readFile("extension/background.js", "utf8");

  assert.match(background, /chrome\.alarms\.create/);
  assert.match(background, /chrome\.alarms\.onAlarm\.addListener/);
  assert.match(background, /chrome\.notifications\.create/);
  assert.match(background, /safeTabRemove/);
  assert.match(background, /safeTabUpdate/);
  assert.match(background, /expired\.html/);
  assert.match(background, /chrome\.tabs\.create/);
  assert.match(background, /notification-icon\.png/);
  assert.match(background, /check_in/);
});

test("extension uses a PNG notification icon that Chrome can load", async () => {
  const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
  const icon = await stat("extension/notification-icon.png");

  assert.equal(manifest.icons["128"], "notification-icon.png");
  assert.equal(icon.size > 0, true);
});

test("extension exposes an in-browser expiry page for forceful check-ins", async () => {
  const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
  const html = await readFile("extension/expired.html", "utf8");
  const js = await readFile("extension/expired.js", "utf8");

  assert.equal(
    manifest.web_accessible_resources[0].resources.includes("expired.html"),
    true,
  );
  assert.match(html, /continue-study/);
  assert.match(html, /finish-session/);
  assert.match(js, /extend_session/);
  assert.match(js, /minutes: 5/);
  assert.match(html, /再给 5 分钟/);
  assert.doesNotMatch(html, /再给 10 分钟/);
  assert.match(js, /close_expired_page/);
  assert.doesNotMatch(js, /location\.href = originalUrl/);
});

test("extension never stores destructive close-tab expiry actions for default intents", async () => {
  const background = await readFile("extension/background.js", "utf8");
  const interstitial = await readFile("extension/interstitial.js", "utf8");

  assert.doesNotMatch(background, /expiryAction: "close_tab"/);
  assert.doesNotMatch(interstitial, /return category === "play" \? "close_tab"/);
});

test("extension exposes an unknown-site review page", async () => {
  const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
  const html = await readFile("extension/unknown.html", "utf8");
  const js = await readFile("extension/unknown.js", "utf8");
  const toast = await readFile("extension/unknown-toast.js", "utf8");

  assert.equal(
    manifest.web_accessible_resources[0].resources.includes("unknown.html"),
    true,
  );
  assert.equal(manifest.content_scripts[0].js.includes("unknown-toast.js"), true);
  assert.match(html, /add-control/);
  assert.match(html, /allow-once/);
  assert.match(html, /ignore-site/);
  assert.match(js, /add_unknown_site_decision/);
  assert.match(js, /temporary/);
  assert.match(toast, /show_unknown_site_prompt/);
  assert.match(toast, /attachShadow/);
  assert.match(toast, /add_unknown_site_decision/);
  assert.match(toast, /setTimeout/);
});

test("extension options page edits high-risk and allowlist rules", async () => {
  const html = await readFile("extension/options.html", "utf8");
  const js = await readFile("extension/options.js", "utf8");
  const background = await readFile("extension/background.js", "utf8");

  assert.match(html, /high-risk-domains/);
  assert.match(html, /allowlist-rules/);
  assert.match(html, /focus-mode/);
  assert.match(html, /save-config/);
  assert.match(html, /quick-url/);
  assert.match(html, /add-quick-control/);
  assert.match(html, /add-quick-allow/);
  assert.match(html, /undo-last-rule/);
  assert.match(html, /ai-detect-log/);
  assert.match(html, /check-ai-health/);
  assert.match(html, /run-ai-detect/);
  assert.match(html, /clear-ai-log/);
  assert.match(html, /options\.js/);
  assert.match(js, /get_config/);
  assert.match(js, /save_config/);
  assert.match(js, /undo_last_rule_change/);
  assert.match(js, /get_ai_detect_log/);
  assert.match(js, /check_ai_server_health/);
  assert.match(js, /run_ai_detect_now/);
  assert.match(js, /clear_ai_detect_log/);
  assert.match(js, /formatAiDetectLogEntry/);
  assert.match(js, /aiDetectStatusMessage/);
  assert.match(js, /aiHealthStatusMessage/);
  assert.match(js, /服务正常/);
  assert.match(js, /服务不可用/);
  assert.match(js, /没有可检测的网页标签/);
  assert.match(js, /已显示干预/);
  assert.match(js, /服务端错误/);
  assert.match(js, /splitLines/);
  assert.match(js, /ruleFromInput/);
  assert.match(js, /new URL/);
  assert.match(background, /get_config/);
  assert.match(background, /save_config/);
  assert.match(background, /lastRuleChange/);
  assert.match(background, /undo_last_rule_change/);
  assert.match(background, /get_ai_detect_log/);
  assert.match(background, /check_ai_server_health/);
  assert.match(background, /AI_HEALTH_URL/);
  assert.match(background, /run_ai_detect_now/);
  assert.match(background, /preferAnyHttpTab/);
  assert.match(background, /no_http_tab/);
  assert.match(background, /clear_ai_detect_log/);
});

test("extension UI follows browser light and dark color schemes", async () => {
  const css = await readFile("extension/interstitial.css", "utf8");

  assert.match(css, /color-scheme: light dark/);
  assert.match(css, /--bg/);
  assert.match(css, /--panel/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /#1f2029/);
  assert.match(css, /#282a36/);
  assert.match(css, /#ff5555/);
  assert.match(css, /#bd93f9/);
});

test("extension defines default video presets with play and study categories", async () => {
  const background = await readFile("extension/background.js", "utf8");

  assert.match(background, /DEFAULT_INTENT_PRESETS/);
  assert.match(background, /放松 5 分钟/);
  assert.doesNotMatch(background, /放松 10 分钟/);
  assert.match(background, /看网课\/学习视频/);
  assert.match(background, /category: "play"/);
  assert.match(background, /category: "study"/);
});

test("extension defines allowlist rules for schools, search engines, and AI tools", async () => {
  const background = await readFile("extension/background.js", "utf8");

  assert.match(background, /DEFAULT_ALLOWLIST_RULES/);
  assert.match(background, /\*\.edu/);
  assert.match(background, /\*\.edu\.cn/);
  assert.match(background, /gemini\.google\.com/);
  assert.match(background, /yuanbao\.tencent\.com/);
  assert.match(background, /chatgpt\.com/);
  assert.match(background, /chatglm\.cn/);
  assert.match(background, /isAllowlistedSite/);
});

test("extension reviews unknown sites before adding them to high-risk or allowlist rules", async () => {
  const background = await readFile("extension/background.js", "utf8");

  assert.match(background, /const highRisk = isHighRiskDomain/);
  assert.match(background, /unknown_review/);
  assert.match(background, /show_unknown_site_prompt/);
  assert.match(background, /chrome\.tabs\.sendMessage/);
  assert.match(background, /chrome\.tabs\.onUpdated/);
  assert.match(background, /add_unknown_site_decision/);
  assert.match(background, /temporaryAllows/);
  assert.match(background, /highRiskDomains/);
  assert.match(background, /allowlistRules/);
});

test("extension swallows missing native messaging host errors", async () => {
  const background = await readFile("extension/background.js", "utf8");

  assert.match(background, /sendNativeMessage/);
  assert.match(background, /chrome\.runtime\.lastError/);
});

test("extension AI detect fetch matches server CORS contract", async () => {
  const background = await readFile("extension/background.js", "utf8");
  const server = await readFile("src-tauri/src/bin/server.rs", "utf8");

  assert.match(background, /const AI_DETECT_URL = "http:\/\/127\.0\.0\.1:3001\/detect"/);
  assert.match(background, /method: "POST"/);
  assert.match(background, /"Content-Type": "application\/json"/);
  assert.match(background, /browser_only:\s*true/);

  assert.match(server, /\("OPTIONS", _\)/);
  assert.match(server, /Access-Control-Allow-Origin: \*/);
  assert.match(server, /Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS/);
  assert.match(server, /Access-Control-Allow-Headers: Content-Type/);
  assert.match(server, /\("POST", "\/detect"\)/);
});

test("extension records AI detect failures for debugging", async () => {
  const background = await readFile("extension/background.js", "utf8");

  assert.match(background, /async function recordAiDetectLog/);
  assert.match(background, /aiDetectLog\.length > 200/);
  assert.match(background, /status: "http_error"/);
  assert.match(background, /status: "server_error"/);
  assert.match(background, /status: "inject_failed"/);
  assert.match(background, /status: "request_failed"/);
  assert.match(background, /status: isDistracting \? "interference_shown" : "ok"/);
});

test("interference approval creates a temporary AI allow before dismissing overlay", async () => {
  const js = await readFile("extension/interference.js", "utf8");

  assert.match(js, /type: "validate_distraction_reason"/);
  assert.match(js, /type: "approve_ai_intervention"/);
  assert.doesNotMatch(js, /type: "submit_intent"/);
  assert.match(js, /const ALLOW_MINUTES = 5/);
  assert.match(js, /minutes: ALLOW_MINUTES/);
  assert.doesNotMatch(js, /saveCandidate: false/);
  assert.match(js, /放行失败，请重试/);
  assert.match(js, /overlay\.remove/);
});

test("close current tab reports failures but intervention pages do not use it", async () => {
  const background = await readFile("extension/background.js", "utf8");
  const interference = await readFile("extension/interference.js", "utf8");
  const expiredHtml = await readFile("extension/expired.html", "utf8");
  const expiredJs = await readFile("extension/expired.js", "utf8");

  assert.match(background, /error: "tab_not_found"/);
  assert.match(background, /error: "tab_close_failed"/);
  assert.match(background, /return true/);
  assert.match(background, /return false/);
  assert.doesNotMatch(interference, /关闭失败，请手动关闭此标签页/);
  assert.match(expiredHtml, /expired-status/);
  assert.doesNotMatch(expiredJs, /关闭失败，请手动关闭此标签页/);
  assert.doesNotMatch(interference, /type: "close_current_tab"/);
  assert.doesNotMatch(expiredJs, /type: "close_current_tab"/);
});

test("extension rejects invalid intent session messages at the background boundary", async () => {
  const background = await readFile("extension/background.js", "utf8");

  assert.match(background, /target_required/);
  assert.match(background, /reason_required/);
  assert.match(background, /minutes_must_be_positive/);
  assert.match(background, /if \(!result\.ok\)/);
  assert.match(background, /return storeIntent\(message, sender\)/);
});
