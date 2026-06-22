import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

function parseAnalysisResult(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.category === "string" && typeof parsed.confidence === "number") {
      return {
        category: parsed.category,
        confidence: parsed.confidence,
        description: parsed.description || "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

test("tauri config names the desktop assistant", async () => {
  const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));

  assert.equal(config.productName, "Focus Guard");
  assert.equal(config.identifier, "com.focus-guard.desktop");
});

test("desktop UI exposes monitored apps, domains, export, and session review controls", async () => {
  const html = await readFile("desktop/index.html", "utf8");
  const js = await readFile("desktop/app.js", "utf8");

  assert.match(html, /monitored-apps/);
  assert.match(html, /high-risk-domains/);
  assert.match(html, /allowlist-rules/);
  assert.match(js, /loadPolicyConfig/);
  assert.match(js, /savePolicyConfig/);
  assert.match(js, /\/policy-config/);
  assert.match(html, /export-csv/);
  assert.match(html, /activity-log/);
  assert.match(html, /image-preview/);
  assert.match(html, /image-preview-frame/);
  assert.match(html, /image-preview-img/);
  assert.match(html, /intervention-modal/);
  assert.match(html, /intervention-submit-btn/);
  assert.match(html, /productive-time/);
  assert.match(html, /distracting-time/);
  assert.match(html, /AI 判断记录/);
  assert.match(html, /最新在顶部/);
  assert.match(html, /专注总结/);
  assert.match(html, /summary-daily/);
  assert.match(html, /summary-hourly/);
  assert.match(html, /summary-targets/);
});

test("desktop UI exposes optional local AI settings", async () => {
  const html = await readFile("desktop/index.html", "utf8");
  const js = await readFile("desktop/app.js", "utf8");

  assert.match(html, /local-ai-enabled/);
  assert.match(html, /pe-base-url/);
  assert.match(html, /pe-model/);
  assert.match(html, /pe-api-key/);
  assert.match(html, /api-key-config-card/);
  assert.match(html, /pe-save-btn/);
  assert.match(html, /pe-change-key-btn/);
  assert.match(html, /pe-fetch-models-btn/);
  assert.match(html, /pe-test-btn/);
  assert.match(html, /detect-now/);
  assert.match(html, /detect-screenshot/);
  assert.match(html, /手动截图分析/);
  assert.match(html, /scheduled-detect-enabled/);
  assert.match(html, /scheduled-detect-interval/);
  assert.match(html, /scheduled-detect-status/);
  assert.match(html, /后台定时巡检/);
  assert.match(js, /ep-20260617210329-lsz4k/);
  assert.match(js, /ark\.cn-beijing\.volces\.com/);
  assert.match(js, /loadApiConfig/);
  assert.match(js, /renderApiKeyConfigCard/);
  assert.match(js, /aria-expanded/);
  assert.match(js, /refreshBackendStatus/);
  assert.match(js, /backendFailureCount >= 3/);
  assert.match(js, /AbortSignal\.timeout\(5000\)/);
  assert.match(js, /loadAiRecords/);
  assert.match(js, /\/ai-records/);
  assert.match(js, /data\.warning/);
  assert.match(js, /已保留当前模型/);
  assert.match(js, /loadScheduledDetectConfig/);
  assert.match(js, /saveScheduledDetectConfig/);
  assert.match(js, /\/scheduled-detect/);
  assert.match(js, /response\.status === 409/);
  assert.match(js, /检测正在进行/);
  assert.match(js, /requestScheduledNotificationPermission/);
  assert.match(js, /notifyScheduledDistraction/);
  assert.match(js, /new Notification/);
  assert.match(js, /后台巡检/);
  assert.match(js, /skip_browser/);
  assert.match(js, /isBrowserProcess/);
  assert.match(js, /chrome\.exe/);
  assert.match(js, /MAX_AI_DISPLAY_RECORDS/);
  assert.match(js, /aiRecordImages/);
  assert.match(js, /renderAiRecordShot/);
  assert.match(js, /setupImagePreview/);
  assert.match(js, /setupInterventionModal/);
  assert.match(js, /openInterventionModal\(result\)/);
  assert.match(js, /INTERVENTION_ALLOW_MINUTES = 5/);
  assert.match(js, /activeInterventionAllow/);
  assert.match(js, /validate_reason/);
  assert.match(js, /fitImagePreviewToStage/);
  assert.match(js, /addEventListener\("dblclick"/);
  assert.match(js, /zoomImagePreviewAt/);
  assert.match(js, /resetImagePreviewZoom/);
  assert.match(js, /event\.target === overlay/);
  assert.match(js, /preview-shot-btn/);
  assert.match(js, /addEventListener\("wheel"/);
  assert.match(js, /pointerdown/);
  assert.match(js, /Escape/);
  assert.match(js, /screenshot_base64/);
  assert.match(js, /privacyRecordLabel/);
  assert.match(js, /detectPrivacyHint/);
  assert.match(js, /detectionStageLabel/);
  assert.match(js, /manual_screenshot/);
  assert.match(js, /manualScreenshot \? "cnocr"/);
  assert.match(js, /manualScreenshot \? 600000 : 90000/);
  assert.match(js, /截图分析仍在处理中/);
  assert.match(js, /visibleWindowCount/);
  assert.match(js, /formatWindowSignals/);
  assert.match(js, /saveCategoryRule/);
  assert.match(js, /\/category-rules/);
  assert.match(js, /category-rule-save/);
  assert.match(js, /\/privacy-config/);
  assert.match(js, /\/ai-records\/clear-screenshots/);
  assert.match(html, /privacy-mode/);
  assert.match(html, /analysis-strategy/);
  assert.match(html, /ocr-backend/);
  assert.match(html, /clear-screenshots/);
  assert.match(js, /formatBytes/);
  assert.match(js, /recordAiJudgement/);
  assert.match(js, /normalizeAiCategory\(result\.category/);
  assert.match(js, /entertainment/);
  assert.match(js, /const isDistracting = result\.category === "distracting"/);
  assert.match(js, /recomputeFocusStatsFromRecords/);
  assert.match(js, /focusStats/);
  assert.match(js, /aiSummaries/);
  assert.match(js, /recomputeAiSummaries/);
  assert.match(js, /renderSummaries/);
  assert.match(js, /summaryCategoryKey/);
  assert.match(js, /detailRows/);
  assert.match(js, /今日语义分类用时/);
  assert.match(html, /自动脱敏截图细分分类/);
  assert.match(js, /renderDetectionPipeline/);
  assert.match(js, /renderLiveDetectionPipeline/);
  assert.match(js, /renderLiveDetectionPipeline\(options\)/);
  assert.match(js, /redactionPipelineLabel/);
  assert.match(js, /isSameDesktopSnapshot/);
  assert.match(js, /summary-targets/);
  assert.match(js, /summary-segment-productive/);
  assert.match(js, /renderPieChart/);
  assert.match(js, /summary-period-btn/);
  assert.match(js, /openChartPreview/);
  assert.match(js, /row\.minutes > 10/);
  assert.match(js, /getNewestFirstAiRecords/);
  assert.match(js, /new Date\(b\.timestamp\)\.getTime\(\) - new Date\(a\.timestamp\)\.getTime\(\)/);
  assert.match(js, /container\.scrollTop = 0/);
  assert.match(js, /function normalizeStoredAiRecord/);
  assert.match(js, /function normalizeStringArray/);
  assert.match(js, /parsed\.aiRecords\.map\(normalizeStoredAiRecord\)/);
  assert.match(js, /normalizeStoredAiRecord\(rawRecord\)/);
});

test("desktop server exposes foreground lookup and background scheduled checks", async () => {
  const server = await readFile("src-tauri/src/bin/server.rs", "utf8");
  const analyzer = await readFile("src-tauri/src/ai_analyzer.rs", "utf8");

  assert.match(server, /"GET", "\/foreground"/);
  assert.match(server, /"GET", "\/ai-records"/);
  assert.match(server, /"GET", "\/privacy-config"/);
  assert.match(server, /"POST", "\/privacy-config"/);
  assert.match(server, /"GET", "\/policy-config"/);
  assert.match(server, /"POST", "\/policy-config"/);
  assert.match(server, /"GET", "\/category-rules"/);
  assert.match(server, /"POST", "\/category-rules"/);
  assert.match(server, /"POST", "\/ai-records\/clear-screenshots"/);
  assert.match(server, /"GET", "\/scheduled-detect"/);
  assert.match(server, /"POST", "\/scheduled-detect"/);
  assert.match(server, /409 Conflict/);
  assert.match(server, /fn handle_foreground/);
  assert.match(await readFile("src-tauri/src/screenshot.rs", "utf8"), /MAX_SCREENSHOT_EDGE: u32 = 1280/);
  assert.match(server, /thread::spawn\(move \|\| handle_connection\(stream\)\)/);
  assert.match(server, /fn route_request/);
  assert.match(server, /screenshot_base64/);
  assert.match(server, /redaction_status/);
  assert.match(server, /redaction_error/);
  assert.match(server, /detection_stage/);
  assert.match(server, /input_scope/);
  assert.match(server, /visible_window_count/);
  assert.match(server, /window_signals/);
  assert.match(server, /extract_safe_signals/);
  assert.match(server, /extract_window_signals/);
  assert.match(server, /match_category_rule/);
  assert.match(server, /metadata_only/);
  assert.match(server, /read_visible_windows/);
  assert.match(server, /prepare_screenshot_for_ai/);
  assert.match(server, /if !manual_screenshot/);
  assert.match(server, /privacy\.ocr_backend = "cnocr"/);
  assert.match(server, /privacy\.privacy_mode = "redacted_cloud"/);
  assert.match(server, /redaction_unavailable/);
  assert.match(server, /ai-records\.json/);
  assert.match(server, /append_ai_record/);
  assert.match(server, /MAX_AI_RECORDS: usize = 1000/);
  assert.match(server, /fn start_scheduled_detection_worker/);
  assert.match(server, /fn handle_update_scheduled_detect/);
  assert.match(server, /scheduled-detect\.json/);
  assert.match(server, /DETECT_LOCK/);
  assert.match(server, /ReminderType::Notification/);
  assert.match(server, /last_alert_at_ms/);
  assert.match(server, /should_send_scheduled_alert/);
  assert.match(server, /read_foreground_window/);
  assert.match(server, /skip_browser/);
  assert.match(server, /fn is_browser_process/);
  assert.match(await readFile("extension/background.js", "utf8"), /browser_context/);
  assert.match(await readFile("extension/background.js", "utf8"), /page_metadata/);
  assert.match(await readFile("extension/background.js", "utf8"), /getPageMetadata/);
  assert.doesNotMatch(await readFile("extension/background.js", "utf8"), /document\.body\.innerText|outerHTML/);
  assert.match(server, /哔哩哔哩/);
  assert.match(server, /classify_window_summaries/);
  assert.doesNotMatch(server, /browser-title/);
  assert.match(server, /中文简短解释/);
  assert.match(server, /llm_request_endpoint/);
  assert.match(server, /llm_models_endpoint/);
  assert.match(server, /models_fallback_response/);
  assert.match(server, /!response\.contains\("\\"approved\\""\)/);
  assert.match(analyzer, /description in Simplified Chinese/);
});

test("extension interference approves with a five minute session and does not auto-close on rejection", async () => {
  const js = await readFile("extension/interference.js", "utf8");
  const background = await readFile("extension/background.js", "utf8");
  const desktop = await readFile("desktop/app.js", "utf8");

  assert.match(js, /ALLOW_MINUTES = 5/);
  assert.match(js, /type: "submit_intent"/);
  assert.match(js, /minutes: ALLOW_MINUTES/);
  assert.doesNotMatch(js, /页面将被关闭/);
  assert.doesNotMatch(js, /setTimeout\(\(\) => \{\s*chrome\.runtime\.sendMessage\(\{ type: "close_current_tab" \}\)/);
  assert.match(background, /grantedMinutes/);
  assert.doesNotMatch(background, /10 分钟到了/);
  assert.doesNotMatch(desktop, /pendingInterference/);
  assert.doesNotMatch(background, /pendingInterference/);
});

test("windows start and stop scripts support background service control", async () => {
  const start = await readFile("start.bat", "utf8");
  const stop = await readFile("stop.bat", "utf8");

  assert.match(start, /--worker/);
  assert.match(start, /WindowStyle Hidden/);
  assert.match(start, /START_LOG=.*start\.log/);
  assert.match(start, /FOCUS_GUARD_REDACTOR_PYTHON/);
  assert.match(start, /envs\\cnocr\\python\.exe/);
  assert.match(start, /FOCUS_GUARD_CNOCR_MODEL_DIR/);
  assert.doesNotMatch(start, /pause >nul/);
  assert.match(stop, /focus-guard-server/);
  assert.match(stop, /Get-NetTCPConnection/);
  assert.match(stop, /OwningProcess/);
  assert.match(stop, /3000/);
  assert.match(stop, /3001/);
});

test("repository ignores local secrets and runtime config files", async () => {
  const gitignore = await readFile(".gitignore", "utf8");
  const readme = await readFile("README.md", "utf8");
  const agents = await readFile("AGENTS.md", "utf8");

  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^providers\.json$/m);
  assert.match(gitignore, /^scheduled-detect\.json$/m);
  assert.match(gitignore, /^ai-records\.json$/m);
  assert.match(readme, /不要提交 API Key/);
  assert.match(readme, /重置 Key/);
  assert.match(agents, /No known compile-blocking P0/);
  assert.doesNotMatch(agents, /server\.rs 编译错误/);
  assert.doesNotMatch(agents, /post_json.*应清理/);
});

test("escapeHtml escapes ampersand", () => {
  assert.equal(escapeHtml("a & b"), "a &amp; b");
});

test("escapeHtml escapes angle brackets", () => {
  assert.equal(escapeHtml("<div>"), "&lt;div&gt;");
});

test("escapeHtml escapes quotes", () => {
  assert.equal(escapeHtml('He said "hello"'), "He said &quot;hello&quot;");
  assert.equal(escapeHtml("it's fine"), "it&#039;s fine");
});

test("escapeHtml handles empty string", () => {
  assert.equal(escapeHtml(""), "");
});

test("escapeHtml handles non-string input via String coercion", () => {
  assert.equal(escapeHtml(123), "123");
  assert.equal(escapeHtml(null), "null");
  assert.equal(escapeHtml(undefined), "undefined");
});

test("escapeHtml handles string with no special characters", () => {
  assert.equal(escapeHtml("hello world"), "hello world");
});

test("parseAnalysisResult extracts valid JSON with category and confidence", () => {
  const text = 'Here is the analysis: {"category": "video", "confidence": 0.85}';
  const result = parseAnalysisResult(text);

  assert.deepEqual(result, {
    category: "video",
    confidence: 0.85,
    description: "",
  });
});

test("parseAnalysisResult includes description when present", () => {
  const text = '{"category": "social", "confidence": 0.9, "description": "scrolling feed"}';
  const result = parseAnalysisResult(text);

  assert.deepEqual(result, {
    category: "social",
    confidence: 0.9,
    description: "scrolling feed",
  });
});

test("parseAnalysisResult returns null for empty string", () => {
  assert.equal(parseAnalysisResult(""), null);
});

test("parseAnalysisResult returns null for text with no JSON object", () => {
  assert.equal(parseAnalysisResult("no json here"), null);
});

test("parseAnalysisResult returns null for JSON without category", () => {
  assert.equal(parseAnalysisResult('{"confidence": 0.5}'), null);
});

test("parseAnalysisResult returns null for JSON without confidence", () => {
  assert.equal(parseAnalysisResult('{"category": "video"}'), null);
});

test("parseAnalysisResult returns null for invalid JSON", () => {
  assert.equal(parseAnalysisResult("{not valid json}"), null);
});

test("parseAnalysisResult returns null for malformed JSON object", () => {
  assert.equal(parseAnalysisResult('{"category": "video", "confidence": }'), null);
});
