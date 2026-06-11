import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("tauri config names the desktop assistant", async () => {
  const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));

  assert.equal(config.productName, "Focus Guard");
  assert.equal(config.identifier, "com.focus-guard.desktop");
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
  assert.match(html, /local-ai-endpoint/);
  assert.match(html, /local-ai-model/);
  assert.match(html, /local-ai-sample-interval/);
  assert.match(html, /local-ai-confidence-threshold/);
  assert.match(html, /test-local-ai/);
  assert.match(js, /qwen2\.5vl:3b/);
  assert.match(js, /127\.0\.0\.1:11434\/api\/generate/);
});
