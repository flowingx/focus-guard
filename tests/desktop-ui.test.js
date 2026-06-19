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
  assert.equal(config.identifier, "com.focusguard.app");
});

test("desktop UI exposes monitored apps, domains, export, and session review controls", async () => {
  const html = await readFile("desktop/index.html", "utf8");

  assert.match(html, /monitored-apps/);
  assert.match(html, /high-risk-domains/);
  assert.match(html, /allowlist-rules/);
  assert.match(html, /export-csv/);
  assert.match(html, /activity-log/);
});

test("desktop UI exposes optional local AI settings", async () => {
  const html = await readFile("desktop/index.html", "utf8");
  const js = await readFile("desktop/app.js", "utf8");

  assert.match(html, /local-ai-enabled/);
  assert.match(html, /pe-api-key/);
  assert.match(html, /pe-save-btn/);
  assert.match(html, /detect-now/);
  assert.match(js, /ep-20260617210329-lsz4k/);
  assert.match(js, /ark\.cn-beijing\.volces\.com/);
  assert.match(js, /loadApiKey/);
});

test("desktop detect shows API key prompt for missing key errors", async () => {
  const js = await readFile("desktop/app.js", "utf8");

  assert.match(js, /missing_api_key/);
  assert.match(js, /api-key-row/);
  assert.match(js, /pe-save-btn/);
  assert.match(js, /请在上方输入 API Key 并点击保存/);
});

test("default AI configuration does not ship with an API key", async () => {
  const files = [
    "desktop/app.js",
    "src-tauri/src/bin/server.rs",
    "src-tauri/src/lib.rs",
    "AI-CONFIG.md",
    "AGENTS.md",
  ];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, /ark-[A-Za-z0-9-]{20,}/, file);
  }
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
