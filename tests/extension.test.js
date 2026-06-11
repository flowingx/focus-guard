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
  assert.match(js, /close_current_tab/);
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
  assert.match(html, /options\.js/);
  assert.match(js, /get_config/);
  assert.match(js, /save_config/);
  assert.match(js, /undo_last_rule_change/);
  assert.match(js, /splitLines/);
  assert.match(js, /ruleFromInput/);
  assert.match(js, /new URL/);
  assert.match(background, /get_config/);
  assert.match(background, /save_config/);
  assert.match(background, /lastRuleChange/);
  assert.match(background, /undo_last_rule_change/);
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
  assert.match(background, /放松 10 分钟/);
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
