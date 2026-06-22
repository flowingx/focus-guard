use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use focus_guard_desktop::{
    capture_screen_thumbnail_base64, classify_context, read_foreground_window, read_visible_windows,
    reminder::{Reminder, ReminderType},
    AiContext, LocalAiConfig,
};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct Provider {
    id: String,
    name: String,
    base_url: String,
    api_key: String,
    models: Vec<String>,
    selected_model: String,
    latency_ms: Option<u64>,
    active: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct ProviderConfig {
    providers: Vec<Provider>,
    active_provider_id: Option<String>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            providers: vec![Provider {
                id: "doubao".to_string(),
                name: "豆包 (Doubao)".to_string(),
                base_url: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
                api_key: std::env::var("FG_AI_API_KEY").unwrap_or_default(),
                models: vec!["ep-20260617210329-lsz4k".to_string()],
                selected_model: "ep-20260617210329-lsz4k".to_string(),
                latency_ms: None,
                active: true,
            }],
            active_provider_id: Some("doubao".to_string()),
        }
    }
}

static PROVIDERS: Mutex<Option<ProviderConfig>> = Mutex::new(None);
static AI_CONFIG: Mutex<Option<AiConfig>> = Mutex::new(None);
static SCHEDULED_DETECT: Mutex<Option<ScheduledDetectConfig>> = Mutex::new(None);
static AI_RECORDS: Mutex<Option<Vec<AiRecord>>> = Mutex::new(None);
static PRIVACY_CONFIG: Mutex<Option<PrivacyConfig>> = Mutex::new(None);
static CATEGORY_RULES: Mutex<Option<Vec<CategoryRule>>> = Mutex::new(None);
static POLICY_CONFIG: Mutex<Option<PolicyConfig>> = Mutex::new(None);
static DETECT_LOCK: Mutex<()> = Mutex::new(());
const MAX_AI_RECORDS: usize = 1000;
const MAX_CATEGORY_RULES: usize = 200;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(default)]
struct ScheduledDetectConfig {
    enabled: bool,
    interval_minutes: u64,
    next_run_at_ms: u64,
    last_run_at_ms: u64,
    last_completed_at_ms: u64,
    last_status: String,
    last_error: Option<String>,
    last_alert_at_ms: u64,
    last_category: Option<String>,
    last_reason: Option<String>,
    last_process_name: Option<String>,
    last_window_title: Option<String>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
struct AiRecord {
    id: String,
    timestamp_ms: u64,
    source: String,
    category: String,
    confidence: f64,
    reason: String,
    process_name: String,
    window_title: String,
    has_screenshot: bool,
    screenshot_bytes: usize,
    screenshot_base64: Option<String>,
    privacy_mode: String,
    redaction_status: String,
    redaction_error: String,
    screenshot_redacted: bool,
    screenshot_persisted: bool,
    semantic_category: String,
    privacy_risk: String,
    detection_stage: String,
    input_scope: String,
    browser_domain: String,
    browser_title: String,
    visible_window_count: usize,
    window_signals: Vec<String>,
    window_summaries: Vec<WindowSignalSummary>,
    page_site: String,
    page_url_kind: String,
    page_hints: Vec<String>,
    error: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(default)]
struct PrivacyConfig {
    privacy_mode: String,
    analysis_strategy: String,
    ocr_backend: String,
    screenshot_retention: String,
    risky_window_policy: String,
    auto_semantic_visual: bool,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
struct CategoryRule {
    id: String,
    process_name: String,
    title_class: String,
    browser_domain: String,
    window_signals: Vec<String>,
    page_site: String,
    page_url_kind: String,
    page_hints: Vec<String>,
    semantic_category: String,
    category: String,
    suggested_action: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct PolicyConfig {
    focus_mode: bool,
    high_risk_domains: Vec<String>,
    allowlist_rules: Vec<String>,
    default_minutes: u64,
}

impl Default for ScheduledDetectConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_minutes: 5,
            next_run_at_ms: 0,
            last_run_at_ms: 0,
            last_completed_at_ms: 0,
            last_status: "idle".to_string(),
            last_error: None,
            last_alert_at_ms: 0,
            last_category: None,
            last_reason: None,
            last_process_name: None,
            last_window_title: None,
        }
    }
}

impl Default for PrivacyConfig {
    fn default() -> Self {
        Self {
            privacy_mode: "redacted_cloud".to_string(),
            analysis_strategy: "balanced".to_string(),
            ocr_backend: "none".to_string(),
            screenshot_retention: "none".to_string(),
            risky_window_policy: "title_only".to_string(),
            auto_semantic_visual: true,
        }
    }
}

impl Default for PolicyConfig {
    fn default() -> Self {
        Self {
            focus_mode: true,
            high_risk_domains: vec![
                "*.bilibili.*".to_string(),
                "*.youtube.*".to_string(),
                "*.douyin.*".to_string(),
                "*.tiktok.*".to_string(),
                "*.kuaishou.*".to_string(),
                "*.zhihu.*".to_string(),
                "*.weibo.*".to_string(),
                "*.xiaohongshu.*".to_string(),
                "*.douban.*".to_string(),
                "tieba.baidu.com".to_string(),
                "*.hupu.*".to_string(),
                "*.reddit.*".to_string(),
                "*.x.com".to_string(),
                "*.twitter.*".to_string(),
                "*.netflix.*".to_string(),
                "*.iqiyi.*".to_string(),
                "*.youku.*".to_string(),
                "*.mgtv.*".to_string(),
                "*.twitch.*".to_string(),
                "*.huya.*".to_string(),
                "*.douyu.*".to_string(),
                "*.nga.*".to_string(),
                "*.steamcommunity.*".to_string(),
            ],
            allowlist_rules: vec![
                "www.doubao.com".to_string(),
                "tongyi.com".to_string(),
                "qianwen.aliyun.com".to_string(),
                "copilot.microsoft.com".to_string(),
                "claude.ai".to_string(),
                "perplexity.ai".to_string(),
                "poe.com".to_string(),
                "phind.com".to_string(),
                "you.com".to_string(),
                "metaso.cn".to_string(),
                "xinghuo.xfyun.cn".to_string(),
            ],
            default_minutes: 20,
        }
    }
}

#[derive(Clone, Debug)]
struct AiConfig {
    mode: String,
    endpoint: String,
    model: String,
    api_key: String,
}

fn config_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("FocusGuard")
        .join("providers.json")
}

fn scheduled_detect_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("FocusGuard")
        .join("scheduled-detect.json")
}

fn ai_records_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("FocusGuard")
        .join("ai-records.json")
}

fn privacy_config_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("FocusGuard")
        .join("privacy-config.json")
}

fn category_rules_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("FocusGuard")
        .join("category-rules.json")
}

fn policy_config_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("FocusGuard")
        .join("policy-config.json")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn clamp_interval_minutes(value: u64) -> u64 {
    value.clamp(1, 120)
}

fn interval_ms(minutes: u64) -> u64 {
    clamp_interval_minutes(minutes) * 60_000
}

fn load_providers() -> ProviderConfig {
    let guard = PROVIDERS.lock().unwrap();
    if let Some(ref cfg) = *guard {
        return cfg.clone();
    }
    drop(guard);

    let path = config_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<ProviderConfig>(&content) {
            let mut guard = PROVIDERS.lock().unwrap();
            *guard = Some(cfg.clone());
            return cfg;
        }
    }

    let default = ProviderConfig::default();
    let mut guard = PROVIDERS.lock().unwrap();
    *guard = Some(default.clone());
    default
}

fn save_providers(cfg: &ProviderConfig) {
    let path = config_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let _ = std::fs::write(&path, json);
    }
    let mut guard = PROVIDERS.lock().unwrap();
    *guard = Some(cfg.clone());
}

fn load_scheduled_detect() -> ScheduledDetectConfig {
    let guard = SCHEDULED_DETECT.lock().unwrap();
    if let Some(ref cfg) = *guard {
        return cfg.clone();
    }
    drop(guard);

    let path = scheduled_detect_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(mut cfg) = serde_json::from_str::<ScheduledDetectConfig>(&content) {
            cfg.interval_minutes = clamp_interval_minutes(cfg.interval_minutes);
            let mut guard = SCHEDULED_DETECT.lock().unwrap();
            *guard = Some(cfg.clone());
            return cfg;
        }
    }

    let default = ScheduledDetectConfig::default();
    let mut guard = SCHEDULED_DETECT.lock().unwrap();
    *guard = Some(default.clone());
    default
}

fn save_scheduled_detect(cfg: &ScheduledDetectConfig) {
    let path = scheduled_detect_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let _ = std::fs::write(&path, json);
    }
    let mut guard = SCHEDULED_DETECT.lock().unwrap();
    *guard = Some(cfg.clone());
}

fn load_privacy_config() -> PrivacyConfig {
    let guard = PRIVACY_CONFIG.lock().unwrap();
    if let Some(ref cfg) = *guard {
        return cfg.clone();
    }
    drop(guard);

    let path = privacy_config_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(mut cfg) = serde_json::from_str::<PrivacyConfig>(&content) {
            normalize_privacy_config(&mut cfg);
            let mut guard = PRIVACY_CONFIG.lock().unwrap();
            *guard = Some(cfg.clone());
            return cfg;
        }
    }

    let default = PrivacyConfig::default();
    let mut guard = PRIVACY_CONFIG.lock().unwrap();
    *guard = Some(default.clone());
    default
}

fn save_privacy_config(cfg: &PrivacyConfig) {
    let path = privacy_config_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let _ = std::fs::write(&path, json);
    }
    let mut guard = PRIVACY_CONFIG.lock().unwrap();
    *guard = Some(cfg.clone());
}

fn normalize_privacy_config(cfg: &mut PrivacyConfig) {
    if !matches!(
        cfg.privacy_mode.as_str(),
        "local_only" | "redacted_cloud" | "confirm_each_upload"
    ) {
        cfg.privacy_mode = "redacted_cloud".to_string();
    }
    if !matches!(
        cfg.analysis_strategy.as_str(),
        "private_first" | "balanced" | "visual_first_local" | "manual_confirm_visual"
    ) {
        cfg.analysis_strategy = "balanced".to_string();
    }
    if !matches!(
        cfg.ocr_backend.as_str(),
        "none" | "cnocr" | "easyocr" | "presidio"
    ) {
        cfg.ocr_backend = "none".to_string();
    }
    if !matches!(
        cfg.screenshot_retention.as_str(),
        "none" | "redacted_preview_only" | "24h"
    ) {
        cfg.screenshot_retention = "none".to_string();
    }
    if !matches!(
        cfg.risky_window_policy.as_str(),
        "title_only" | "blur_sensitive_regions" | "ask_every_time"
    ) {
        cfg.risky_window_policy = "title_only".to_string();
    }
}

fn load_ai_records() -> Vec<AiRecord> {
    let guard = AI_RECORDS.lock().unwrap();
    if let Some(ref records) = *guard {
        return records.clone();
    }
    drop(guard);

    let path = ai_records_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(mut records) = serde_json::from_str::<Vec<AiRecord>>(&content) {
            records = records
                .into_iter()
                .rev()
                .take(MAX_AI_RECORDS)
                .collect::<Vec<_>>();
            records.reverse();
            let mut guard = AI_RECORDS.lock().unwrap();
            *guard = Some(records.clone());
            return records;
        }
    }

    let mut guard = AI_RECORDS.lock().unwrap();
    *guard = Some(Vec::new());
    Vec::new()
}

fn save_ai_records(records: &[AiRecord]) {
    let path = ai_records_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(records) {
        let _ = std::fs::write(&path, json);
    }
    let mut guard = AI_RECORDS.lock().unwrap();
    *guard = Some(records.to_vec());
}

fn load_category_rules() -> Vec<CategoryRule> {
    let guard = CATEGORY_RULES.lock().unwrap();
    if let Some(ref rules) = *guard {
        return rules.clone();
    }
    drop(guard);

    let path = category_rules_path();
    let mut rules = if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str::<Vec<CategoryRule>>(&content).unwrap_or_default()
    } else {
        Vec::new()
    };
    if rules.len() > MAX_CATEGORY_RULES {
        rules.truncate(MAX_CATEGORY_RULES);
    }
    let mut guard = CATEGORY_RULES.lock().unwrap();
    *guard = Some(rules.clone());
    rules
}

fn save_category_rules(rules: &[CategoryRule]) {
    let path = category_rules_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(rules) {
        let _ = std::fs::write(&path, json);
    }
    let mut guard = CATEGORY_RULES.lock().unwrap();
    *guard = Some(rules.to_vec());
}

fn load_policy_config() -> PolicyConfig {
    let guard = POLICY_CONFIG.lock().unwrap();
    if let Some(ref config) = *guard {
        return config.clone();
    }
    drop(guard);

    let path = policy_config_path();
    let mut config = if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str::<PolicyConfig>(&content).unwrap_or_default()
    } else {
        PolicyConfig::default()
    };
    normalize_policy_config(&mut config);
    let mut guard = POLICY_CONFIG.lock().unwrap();
    *guard = Some(config.clone());
    config
}

fn save_policy_config(config: &PolicyConfig) {
    let path = policy_config_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(config) {
        let _ = std::fs::write(&path, json);
    }
    let mut guard = POLICY_CONFIG.lock().unwrap();
    *guard = Some(config.clone());
}

fn normalize_policy_config(config: &mut PolicyConfig) {
    config.high_risk_domains = clean_policy_rules(&config.high_risk_domains);
    config.allowlist_rules = clean_policy_rules(&config.allowlist_rules);
    if config.default_minutes == 0 {
        config.default_minutes = 20;
    }
}

fn clean_policy_rules(values: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    for value in values {
        let clean = value.trim();
        if !clean.is_empty() && !result.iter().any(|existing| existing == clean) {
            result.push(clean.to_string());
        }
    }
    result
}

fn append_ai_record(record: AiRecord) {
    let mut records = load_ai_records();
    records.push(record);
    if records.len() > MAX_AI_RECORDS {
        records = records.split_off(records.len() - MAX_AI_RECORDS);
    }
    save_ai_records(&records);
}

fn get_ai_config() -> AiConfig {
    let guard = AI_CONFIG.lock().unwrap();
    if let Some(config) = guard.clone() {
        return config;
    }
    drop(guard);

    let providers = load_providers();
    if let Some(active_id) = providers.active_provider_id.as_deref() {
        if let Some(provider) = providers
            .providers
            .iter()
            .find(|provider| provider.id == active_id)
        {
            return AiConfig {
                mode: if provider.base_url.contains("127.0.0.1")
                    || provider.base_url.contains("localhost")
                {
                    "local".to_string()
                } else {
                    "api".to_string()
                },
                endpoint: provider.base_url.clone(),
                model: provider.selected_model.clone(),
                api_key: provider.api_key.clone(),
            };
        }
    }

    AiConfig {
        mode: "api".to_string(),
        endpoint: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
        model: "ep-20260617210329-lsz4k".to_string(),
        api_key: std::env::var("FG_AI_API_KEY").unwrap_or_default(),
    }
}

fn persist_ai_config(ai: &AiConfig) {
    let mut providers = load_providers();
    let active_id = providers.active_provider_id.clone();

    if let Some(id) = active_id {
        if let Some(provider) = providers
            .providers
            .iter_mut()
            .find(|provider| provider.id == id)
        {
            provider.base_url = ai.endpoint.clone();
            provider.selected_model = ai.model.clone();
            provider.api_key = ai.api_key.clone();
            if provider.models.is_empty() && !ai.model.is_empty() {
                provider.models.push(ai.model.clone());
            }
            save_providers(&providers);
            return;
        }
    }

    let id = "custom".to_string();
    providers.providers.push(Provider {
        id: id.clone(),
        name: "自定义 API".to_string(),
        base_url: ai.endpoint.clone(),
        api_key: ai.api_key.clone(),
        models: if ai.model.is_empty() {
            Vec::new()
        } else {
            vec![ai.model.clone()]
        },
        selected_model: ai.model.clone(),
        latency_ms: None,
        active: true,
    });
    providers.active_provider_id = Some(id);
    save_providers(&providers);
}

fn start_scheduled_detection_worker() {
    thread::spawn(|| loop {
        thread::sleep(Duration::from_secs(2));

        let due = {
            let mut cfg = load_scheduled_detect();
            if !cfg.enabled {
                false
            } else {
                let now = now_ms();
                if cfg.next_run_at_ms == 0 || cfg.next_run_at_ms <= now {
                    cfg.interval_minutes = clamp_interval_minutes(cfg.interval_minutes);
                    cfg.last_run_at_ms = now;
                    cfg.next_run_at_ms = now + interval_ms(cfg.interval_minutes);
                    cfg.last_status = "running".to_string();
                    cfg.last_error = None;
                    save_scheduled_detect(&cfg);
                    true
                } else {
                    false
                }
            }
        };

        if !due {
            continue;
        }

        let detection = handle_detect(true, "scheduled", "{}");
        let mut cfg = load_scheduled_detect();
        cfg.last_completed_at_ms = now_ms();
        match detection {
            Ok(json) => {
                apply_scheduled_result(&mut cfg, &json);
            }
            Err(error) => {
                if error == "detect already running" {
                    cfg.last_status = "busy".to_string();
                    cfg.last_error = None;
                } else {
                    cfg.last_status = "error".to_string();
                    cfg.last_error = Some(error);
                }
            }
        }
        let should_alert = should_send_scheduled_alert(&cfg);
        if should_alert {
            cfg.last_alert_at_ms = now_ms();
        }
        save_scheduled_detect(&cfg);
        if should_alert {
            notify_scheduled_distraction(&cfg);
        }
    });
}

fn apply_scheduled_result(cfg: &mut ScheduledDetectConfig, json: &str) {
    cfg.last_error = None;

    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        cfg.last_status = "error".to_string();
        cfg.last_error = Some("invalid detection result".to_string());
        return;
    };

    cfg.last_category = value
        .get("category")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    cfg.last_reason = value
        .get("reason")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    cfg.last_process_name = value
        .get("process_name")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    cfg.last_window_title = value
        .get("window_title")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    if value
        .get("skipped")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        cfg.last_status = "skipped".to_string();
        return;
    }

    if let Some(error) = value.get("error").and_then(|v| v.as_str()) {
        cfg.last_status = "error".to_string();
        cfg.last_error = Some(error.to_string());
        return;
    }

    match cfg
        .last_category
        .as_deref()
        .map(normalize_detection_category)
        .as_deref()
    {
        Some("distracting") => cfg.last_status = "distracting".to_string(),
        _ => cfg.last_status = "ok".to_string(),
    }
}

fn should_send_scheduled_alert(cfg: &ScheduledDetectConfig) -> bool {
    should_send_scheduled_alert_at(cfg, now_ms())
}

fn should_send_scheduled_alert_at(cfg: &ScheduledDetectConfig, now: u64) -> bool {
    if cfg.last_status != "distracting" {
        return false;
    }
    let cooldown_ms = interval_ms(cfg.interval_minutes).max(300_000);
    now.saturating_sub(cfg.last_alert_at_ms) >= cooldown_ms
}

fn notify_scheduled_distraction(cfg: &ScheduledDetectConfig) {
    let process = cfg
        .last_process_name
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or("当前应用");
    let reason = cfg
        .last_reason
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or("AI 定时巡检判断当前内容可能分心");
    let message = format!(
        "检测到摸鱼行为\n\n应用: {process}\n原因: {reason}\n\n浏览器网页仍由扩展处理，后台巡检只提醒非浏览器应用。"
    );

    thread::spawn(move || {
        let reminder = Reminder::new(ReminderType::Notification);
        let _ = reminder.send(&message);
    });
}

fn main() {
    #[cfg(windows)]
    unsafe {
        #[link(name = "user32")]
        extern "system" {
            fn SetProcessDPIAware() -> i32;
        }
        let _ = SetProcessDPIAware();
    }

    let port = std::env::var("FG_SERVER_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);

    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).unwrap();
    eprintln!("Focus Guard server listening on http://0.0.0.0:{port}");
    start_scheduled_detection_worker();

    for stream in listener.incoming() {
        let Ok(stream) = stream else {
            continue;
        };
        thread::spawn(move || handle_connection(stream));
    }
}

fn handle_connection(mut stream: std::net::TcpStream) {
    let Ok(reader_stream) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(reader_stream);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }

    let mut content_length: usize = 0;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).is_err() {
            break;
        }
        let trimmed = header.trim().to_string();
        if trimmed.is_empty() {
            break;
        }
        if let Some(val) = trimmed.strip_prefix("Content-Length:") {
            content_length = val.trim().parse().unwrap_or(0);
        }
    }

    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        let _ = reader.read_exact(&mut body);
    }

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    let method = parts.first().copied().unwrap_or("");
    let path = parts.get(1).copied().unwrap_or("/");

    if method == "OPTIONS" {
        let cors = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Max-Age: 86400\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(cors.as_bytes());
        return;
    }

    let (status, response_body) = route_request(method, path, &body);
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{response_body}",
        response_body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn route_request(method: &str, path: &str, body: &[u8]) -> (&'static str, String) {
    match (method, path) {
        ("GET", "/health") => ("200 OK", r#"{"ok":true}"#.to_string()),
        ("GET", "/foreground") => ("200 OK", handle_foreground()),
        ("GET", "/ai-records") => ("200 OK", handle_get_ai_records()),
        ("POST", "/ai-records/clear-screenshots") => match handle_clear_ai_record_screenshots() {
            Ok(json) => ("200 OK", json),
            Err(e) => (
                "500 Internal Server Error",
                format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
            ),
        },
        ("GET", "/scheduled-detect") => ("200 OK", handle_get_scheduled_detect()),
        ("POST", "/scheduled-detect") => {
            let body_str = String::from_utf8_lossy(body).to_string();
            match handle_update_scheduled_detect(&body_str) {
                Ok(json) => ("200 OK", json),
                Err(e) => (
                    "500 Internal Server Error",
                    format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
                ),
            }
        }
        ("GET", "/providers") => {
            let cfg = load_providers();
            match serde_json::to_string(&cfg) {
                Ok(json) => ("200 OK", json),
                Err(_) => (
                    "500 Internal Server Error",
                    r#"{"error":"serialize failed"}"#.to_string(),
                ),
            }
        }
        ("POST", "/providers") => {
            let body_str = String::from_utf8_lossy(body).to_string();
            match handle_add_provider(&body_str) {
                Ok(json) => ("200 OK", json),
                Err(e) => (
                    "500 Internal Server Error",
                    format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
                ),
            }
        }
        ("PUT", "/providers") => {
            let body_str = String::from_utf8_lossy(body).to_string();
            match handle_update_provider(&body_str) {
                Ok(json) => ("200 OK", json),
                Err(e) => (
                    "500 Internal Server Error",
                    format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
                ),
            }
        }
        ("DELETE", p) if p.starts_with("/providers/") => {
            let id = p.trim_start_matches("/providers/");
            match handle_delete_provider(id) {
                Ok(json) => ("200 OK", json),
                Err(e) => (
                    "500 Internal Server Error",
                    format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
                ),
            }
        }
        ("POST", "/providers/test-all") => match handle_test_all_providers() {
            Ok(json) => ("200 OK", json),
            Err(e) => (
                "500 Internal Server Error",
                format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
            ),
        },
        ("POST", "/providers/select") => {
            let body_str = String::from_utf8_lossy(body).to_string();
            match handle_select_provider(&body_str) {
                Ok(json) => ("200 OK", json),
                Err(e) => (
                    "500 Internal Server Error",
                    format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
                ),
            }
        }
        ("POST", "/providers/test") => {
            let body_str = String::from_utf8_lossy(body).to_string();
            match handle_test_single_provider(&body_str) {
                Ok(json) => ("200 OK", json),
                Err(e) => (
                    "500 Internal Server Error",
                    format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
                ),
            }
        }
        ("POST", "/parse-config") => {
            let body_str = String::from_utf8_lossy(body).to_string();
            let text = extract_json_string(&body_str, "text").unwrap_or_default();
            match handle_parse_config(&text) {
                Ok(json) => ("200 OK", json),
                Err(e) => (
                    "500 Internal Server Error",
                    format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
                ),
            }
        }
        ("GET", "/config") => {
            let cfg = get_ai_config();
            let json = format!(
                r#"{{"mode":"{}","endpoint":"{}","model":"{}","hasApiKey":{}}}"#,
                json_esc(&cfg.mode),
                json_esc(&cfg.endpoint),
                json_esc(&cfg.model),
                !cfg.api_key.is_empty()
            );
            ("200 OK", json)
        }
        ("POST", "/config") => {
            let body_str = String::from_utf8_lossy(body).to_string();
            let current = get_ai_config();
            let mode = extract_json_string(&body_str, "mode").unwrap_or(current.mode);
            let endpoint = extract_json_string(&body_str, "endpoint").unwrap_or(current.endpoint);
            let model = extract_json_string(&body_str, "model").unwrap_or(current.model);
            let api_key = extract_json_string(&body_str, "api_key").unwrap_or(current.api_key);
            let next = AiConfig {
                mode,
                endpoint,
                model,
                api_key,
            };
            let mut guard = AI_CONFIG.lock().unwrap();
            *guard = Some(next.clone());
            drop(guard);
            persist_ai_config(&next);
            ("200 OK", r#"{"ok":true}"#.to_string())
        }
        ("GET", "/policy-config") => {
            let cfg = load_policy_config();
            match serde_json::to_string(&cfg) {
                Ok(json) => ("200 OK", json),
                Err(_) => (
                    "500 Internal Server Error",
                    r#"{"error":"serialize failed"}"#.to_string(),
                ),
            }
        }
        ("POST", "/policy-config") => {
            let body_str = String::from_utf8_lossy(body).to_string();
            match handle_update_policy_config(&body_str) {
                Ok(json) => ("200 OK", json),
                Err(e) => (
                    "400 Bad Request",
                    format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
                ),
            }
        }
        ("GET", "/privacy-config") => {
            let cfg = load_privacy_config();
            match serde_json::to_string(&cfg) {
                Ok(json) => ("200 OK", json),
                Err(_) => (
                    "500 Internal Server Error",
                    r#"{"error":"serialize failed"}"#.to_string(),
                ),
            }
        }
        ("POST", "/privacy-config") => {
            let body_str = String::from_utf8_lossy(body).to_string();
            match handle_update_privacy_config(&body_str) {
                Ok(json) => ("200 OK", json),
                Err(e) => (
                    "500 Internal Server Error",
                    format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
                ),
            }
        }
        ("GET", "/category-rules") => {
            let rules = load_category_rules();
            match serde_json::to_string(&serde_json::json!({ "rules": rules })) {
                Ok(json) => ("200 OK", json),
                Err(_) => (
                    "500 Internal Server Error",
                    r#"{"error":"serialize failed"}"#.to_string(),
                ),
            }
        }
        ("POST", "/category-rules") => {
            let body_str = String::from_utf8_lossy(body).to_string();
            match handle_add_category_rule(&body_str) {
                Ok(json) => ("200 OK", json),
                Err(e) => (
                    "500 Internal Server Error",
                    format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
                ),
            }
        }
        ("GET", "/models") | ("POST", "/models") => {
            let cfg = get_ai_config();
            let models_url = focus_guard_desktop::llm_models_endpoint(&cfg.endpoint);
            let api_key = cfg.api_key.clone();
            match fetch_models(&models_url, &api_key) {
                Ok(json) => {
                    let models = model_ids_from_response(&json);
                    if models.is_empty() {
                        models_fallback_response(&cfg.model, Some("模型列表未返回可用模型，已保留当前模型"))
                    } else {
                        ("200 OK", models_response_json(&models, None))
                    }
                }
                Err(e) => models_fallback_response(&cfg.model, Some(&e)),
            }
        }
        ("POST", "/test-model") => {
            let body_str = String::from_utf8_lossy(body).to_string();
            let model = extract_json_string(&body_str, "model").unwrap_or_default();
            let cfg = get_ai_config();
            match test_model(&cfg, &model) {
                Ok(json) => ("200 OK", json),
                Err(e) => (
                    "500 Internal Server Error",
                    format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
                ),
            }
        }
        ("POST", "/detect") => {
            let body_str = String::from_utf8_lossy(body).to_string();
            if body_str.contains("\"validate_reason\":true") {
                match handle_validate_reason(&body_str) {
                    Ok(json) => ("200 OK", json),
                    Err(e) => (
                        "500 Internal Server Error",
                        format!(r#"{{"error":"{}"}}"#, json_esc(&e)),
                    ),
                }
            } else {
                let source = extract_json_string(&body_str, "source").unwrap_or_else(|| {
                    if body_str.contains("\"skip_browser\":true") {
                        "scheduled".to_string()
                    } else {
                        "manual".to_string()
                    }
                });
                match handle_detect(body_str.contains("\"skip_browser\":true"), &source, &body_str) {
                    Ok(json) => ("200 OK", json),
                    Err(e) => {
                        let status = if e == "detect already running" {
                            "409 Conflict"
                        } else {
                            "500 Internal Server Error"
                        };
                        (status, format!(r#"{{"error":"{}"}}"#, json_esc(&e)))
                    }
                }
            }
        }
        _ => ("404 Not Found", r#"{"error":"not_found"}"#.to_string()),
    }
}

fn handle_add_provider(body: &str) -> Result<String, String> {
    let name = extract_json_string(body, "name").unwrap_or_else(|| "未命名".to_string());
    let base_url = extract_json_string(body, "base_url").unwrap_or_default();
    let api_key = extract_json_string(body, "api_key").unwrap_or_default();

    if base_url.is_empty() {
        return Err("base_url is required".to_string());
    }

    let id = format!(
        "p_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let provider = Provider {
        id: id.clone(),
        name,
        base_url,
        api_key,
        models: Vec::new(),
        selected_model: String::new(),
        latency_ms: None,
        active: true,
    };

    let mut cfg = load_providers();
    cfg.providers.push(provider);
    save_providers(&cfg);

    Ok(format!(r#"{{"ok":true,"id":"{}"}}"#, id))
}

fn handle_foreground() -> String {
    if let Some(foreground) = read_foreground_window() {
        return format!(
            r#"{{"ok":true,"process_name":"{}","window_title":"{}"}}"#,
            json_esc(&foreground.process_name),
            json_esc(&foreground.window_title)
        );
    }

    r#"{"ok":false,"process_name":"","window_title":""}"#.to_string()
}

fn handle_get_ai_records() -> String {
    let records = load_ai_records();
    serde_json::json!({
        "ok": true,
        "records": records,
    })
    .to_string()
}

fn handle_clear_ai_record_screenshots() -> Result<String, String> {
    let mut records = load_ai_records();
    let mut cleared = 0usize;
    for record in &mut records {
        if record.screenshot_base64.take().is_some() {
            cleared += 1;
        }
        record.screenshot_persisted = false;
        record.screenshot_bytes = 0;
    }
    save_ai_records(&records);
    Ok(serde_json::json!({
        "ok": true,
        "cleared": cleared,
    })
    .to_string())
}

fn handle_get_scheduled_detect() -> String {
    let mut cfg = load_scheduled_detect();
    cfg.interval_minutes = clamp_interval_minutes(cfg.interval_minutes);
    if cfg.enabled && cfg.next_run_at_ms == 0 {
        cfg.next_run_at_ms = now_ms() + interval_ms(cfg.interval_minutes);
        save_scheduled_detect(&cfg);
    }
    serde_json::to_string(&cfg).unwrap_or_else(|_| r#"{"enabled":false}"#.to_string())
}

fn handle_update_scheduled_detect(body: &str) -> Result<String, String> {
    let value = serde_json::from_str::<serde_json::Value>(body)
        .map_err(|error| format!("invalid json: {error}"))?;

    let mut cfg = load_scheduled_detect();
    if let Some(enabled) = value.get("enabled").and_then(|v| v.as_bool()) {
        cfg.enabled = enabled;
    }
    if let Some(interval) = value.get("interval_minutes").and_then(|v| v.as_u64()) {
        cfg.interval_minutes = clamp_interval_minutes(interval);
    }

    cfg.next_run_at_ms = if cfg.enabled {
        now_ms() + interval_ms(cfg.interval_minutes)
    } else {
        0
    };
    if !cfg.enabled {
        cfg.last_status = "idle".to_string();
    }

    save_scheduled_detect(&cfg);
    serde_json::to_string(&cfg).map_err(|error| format!("serialize failed: {error}"))
}

fn handle_update_privacy_config(body: &str) -> Result<String, String> {
    let value = serde_json::from_str::<serde_json::Value>(body)
        .map_err(|error| format!("invalid json: {error}"))?;
    let mut cfg = load_privacy_config();

    if let Some(value) = value.get("privacy_mode").and_then(|v| v.as_str()) {
        cfg.privacy_mode = value.to_string();
    }
    if let Some(value) = value.get("analysis_strategy").and_then(|v| v.as_str()) {
        cfg.analysis_strategy = value.to_string();
    }
    if let Some(value) = value.get("ocr_backend").and_then(|v| v.as_str()) {
        cfg.ocr_backend = value.to_string();
    }
    if let Some(value) = value.get("screenshot_retention").and_then(|v| v.as_str()) {
        cfg.screenshot_retention = value.to_string();
    }
    if let Some(value) = value.get("risky_window_policy").and_then(|v| v.as_str()) {
        cfg.risky_window_policy = value.to_string();
    }
    if let Some(value) = value.get("auto_semantic_visual").and_then(|v| v.as_bool()) {
        cfg.auto_semantic_visual = value;
    }

    normalize_privacy_config(&mut cfg);
    save_privacy_config(&cfg);
    serde_json::to_string(&cfg).map_err(|error| format!("serialize failed: {error}"))
}

fn handle_update_policy_config(body: &str) -> Result<String, String> {
    let mut cfg =
        serde_json::from_str::<PolicyConfig>(body).map_err(|error| format!("invalid json: {error}"))?;
    normalize_policy_config(&mut cfg);
    save_policy_config(&cfg);
    serde_json::to_string(&cfg).map_err(|error| format!("serialize failed: {error}"))
}

fn handle_update_provider(body: &str) -> Result<String, String> {
    let id = extract_json_string(body, "id").ok_or("id required")?;
    let mut cfg = load_providers();

    if let Some(p) = cfg.providers.iter_mut().find(|p| p.id == id) {
        if let Some(name) = extract_json_string(body, "name") {
            p.name = name;
        }
        if let Some(url) = extract_json_string(body, "base_url") {
            p.base_url = url;
        }
        if let Some(key) = extract_json_string(body, "api_key") {
            p.api_key = key;
        }
        if let Some(model) = extract_json_string(body, "selected_model") {
            p.selected_model = model;
        }
        if let Some(models_str) = extract_json_string(body, "models") {
            p.models = models_str
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
        save_providers(&cfg);
        Ok(r#"{"ok":true}"#.to_string())
    } else {
        Err("provider not found".to_string())
    }
}

fn handle_parse_config(text: &str) -> Result<String, String> {
    let mut results: Vec<serde_json::Value> = Vec::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if line.to_lowercase().contains("curl ") {
            if let Some((base_url, api_key, model)) = parse_curl(line) {
                results.push(serde_json::json!({
                    "base_url": base_url,
                    "api_key": api_key,
                    "model": model,
                    "source": "curl",
                }));
            }
        }

        if line.contains("base_url") || line.contains("BASE_URL") {
            if let Some(url) = extract_toml_value(line) {
                let api_key = find_nearby_key(text, line);
                let model = find_nearby_model(text, line);
                results.push(serde_json::json!({
                    "base_url": url,
                    "api_key": api_key,
                    "model": model,
                    "source": "toml",
                }));
            }
        }

        if line.contains("OPENAI_API_KEY") || line.contains("ANTHROPIC_AUTH_TOKEN") {
            if let Some(key) = extract_json_value(line) {
                let base_url = find_nearby_url(text, line);
                let model = find_nearby_model(text, line);
                results.push(serde_json::json!({
                    "base_url": base_url,
                    "api_key": key,
                    "model": model,
                    "source": "json",
                }));
            }
        }

        if line.contains("ANTHROPIC_BASE_URL") || line.contains("OPENAI_BASE_URL") {
            if let Some(url) = extract_json_value(line) {
                let key = find_nearby_key(text, line);
                let model = find_nearby_model(text, line);
                results.push(serde_json::json!({
                    "base_url": url,
                    "api_key": key,
                    "model": model,
                    "source": "json",
                }));
            }
        }
    }

    results.dedup_by(|a, b| {
        a.get("base_url") == b.get("base_url") && a.get("api_key") == b.get("api_key")
    });

    if results.is_empty() {
        return Err("无法从配置中识别 API 地址和密钥".to_string());
    }

    Ok(serde_json::json!({ "ok": true, "configs": results }).to_string())
}

fn parse_curl(curl: &str) -> Option<(String, String, String)> {
    let mut base_url = String::new();
    let mut api_key = String::new();
    let mut model = String::new();

    let args = shell_split(curl);
    let mut i = 0;
    while i < args.len() {
        let p = args[i].as_str();
        if p == "curl" {
            i += 1;
            continue;
        }
        if base_url.is_empty() && looks_like_url(p) {
            base_url = p.to_string();
        }
        if (p == "-H" || p == "--header") && i + 1 < args.len() {
            let header = &args[i + 1];
            let lower = header.to_lowercase();
            if lower.contains("authorization")
                || lower.contains("bearer")
                || lower.contains("api-key")
                || lower.contains("x-api-key")
            {
                let key = header
                    .split_once(':')
                    .map(|x| x.1)
                    .unwrap_or("")
                    .trim()
                    .trim_start_matches("Bearer")
                    .trim_start_matches("bearer")
                    .trim()
                    .trim_matches('\'')
                    .trim_matches('"');
                if !key.is_empty() {
                    api_key = key.to_string();
                }
            }
        }
        if matches!(p, "-d" | "--data" | "--data-raw" | "--data-binary") && i + 1 < args.len() {
            model = extract_model_from_curl_data(&args[i + 1]).unwrap_or(model);
        } else if let Some(data) = p
            .strip_prefix("-d")
            .or_else(|| p.strip_prefix("--data="))
            .or_else(|| p.strip_prefix("--data-raw="))
            .or_else(|| p.strip_prefix("--data-binary="))
        {
            model = extract_model_from_curl_data(data).unwrap_or(model);
        }
        i += 1;
    }
    if base_url.is_empty() {
        return None;
    }
    let base = base_url
        .trim_end_matches('/')
        .trim_end_matches("/v1/chat/completions")
        .trim_end_matches("/v1")
        .trim_end_matches('/');
    Some((base.to_string(), api_key, model))
}

fn looks_like_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn extract_model_from_curl_data(data: &str) -> Option<String> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
        if let Some(model) = value.get("model").and_then(|v| v.as_str()) {
            if !model.is_empty() {
                return Some(model.to_string());
            }
        }
    }

    let marker = data.find("model")?;
    let rest = &data[marker..];
    let colon = rest.find(':')?;
    let after = rest[colon + 1..].trim_start();
    let value = after
        .trim_matches('"')
        .trim_matches('\'')
        .split([',', '}', ' '])
        .next()?
        .trim_matches('"')
        .trim_matches('\'');
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn shell_split(s: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\'' && !in_double {
            in_single = !in_single;
        } else if c == '"' && !in_single {
            in_double = !in_double;
        } else if c == '\\' && !in_single && i + 1 < chars.len() {
            i += 1;
            current.push(chars[i]);
        } else if c.is_whitespace() && !in_single && !in_double {
            if !current.is_empty() {
                result.push(current.clone());
                current.clear();
            }
        } else {
            current.push(c);
        }
        i += 1;
    }
    if !current.is_empty() {
        result.push(current);
    }
    result
}

fn extract_toml_value(line: &str) -> Option<String> {
    let parts: Vec<&str> = line.splitn(2, '=').collect();
    if parts.len() < 2 {
        return None;
    }
    let val = parts[1]
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim_matches(',');
    if val.is_empty() || val == "true" || val == "false" || val.starts_with('#') {
        return None;
    }
    Some(val.to_string())
}

fn extract_json_value(line: &str) -> Option<String> {
    let parts: Vec<&str> = line.splitn(2, ':').collect();
    if parts.len() < 2 {
        return None;
    }
    let val = parts[1]
        .trim()
        .trim_matches('"')
        .trim_matches(',')
        .trim_matches('}');
    if val.is_empty() {
        return None;
    }
    Some(val.to_string())
}

fn find_nearby_key(text: &str, _current_line: &str) -> String {
    for line in text.lines() {
        let l = line.trim();
        if l.contains("OPENAI_API_KEY")
            || l.contains("ANTHROPIC_AUTH_TOKEN")
            || l.contains("Authorization")
        {
            if let Some(v) = extract_json_value(l) {
                if !v.is_empty() && v.starts_with("sk-") {
                    return v;
                }
            }
            if l.contains("Bearer ") {
                if let Some(pos) = l.find("Bearer ") {
                    let key = &l[pos + 7..];
                    let key = key.trim_matches('"').trim_matches('\'');
                    if !key.is_empty() {
                        return key.to_string();
                    }
                }
            }
        }
        if l.contains("api_key") || l.contains("API_KEY") {
            if let Some(v) = extract_toml_value(l) {
                if !v.is_empty() {
                    return v;
                }
            }
        }
    }
    String::new()
}

fn find_nearby_url(text: &str, _current_line: &str) -> String {
    for line in text.lines() {
        let l = line.trim();
        if l.contains("base_url") || l.contains("BASE_URL") {
            if let Some(v) = extract_toml_value(l) {
                if v.starts_with("http") {
                    return v;
                }
            }
            if let Some(v) = extract_json_value(l) {
                if v.starts_with("http") {
                    return v;
                }
            }
        }
    }
    String::new()
}

fn find_nearby_model(text: &str, _current_line: &str) -> String {
    for line in text.lines() {
        let l = line.trim();
        if l.contains("model") && !l.contains("provider") && !l.contains("MODEL") {
            if let Some(v) = extract_toml_value(l) {
                if !v.is_empty() && !v.starts_with("http") {
                    return v;
                }
            }
        }
        if l.contains("ANTHROPIC_MODEL") || l.contains("OPENAI_MODEL") {
            if let Some(v) = extract_json_value(l) {
                if !v.is_empty() {
                    return v;
                }
            }
        }
    }
    String::new()
}

fn handle_delete_provider(id: &str) -> Result<String, String> {
    let mut cfg = load_providers();
    let before = cfg.providers.len();
    cfg.providers.retain(|p| p.id != id);
    if cfg.providers.len() == before {
        return Err("provider not found".to_string());
    }
    if cfg.active_provider_id.as_deref() == Some(id) {
        cfg.active_provider_id = cfg.providers.first().map(|p| p.id.clone());
    }
    save_providers(&cfg);
    Ok(r#"{"ok":true}"#.to_string())
}

fn handle_select_provider(body: &str) -> Result<String, String> {
    let id = extract_json_string(body, "id").ok_or("id required")?;
    let mut cfg = load_providers();

    if !cfg.providers.iter().any(|p| p.id == id) {
        return Err("provider not found".to_string());
    }

    cfg.active_provider_id = Some(id.clone());

    if let Some(p) = cfg.providers.iter().find(|p| p.id == id) {
        let mut ai = AI_CONFIG.lock().unwrap();
        *ai = Some(AiConfig {
            mode: if p.base_url.contains("127.0.0.1") || p.base_url.contains("localhost") {
                "local".to_string()
            } else {
                "api".to_string()
            },
            endpoint: p.base_url.clone(),
            model: p.selected_model.clone(),
            api_key: p.api_key.clone(),
        });
    }

    save_providers(&cfg);
    Ok(r#"{"ok":true}"#.to_string())
}

fn handle_test_single_provider(body: &str) -> Result<String, String> {
    let (base_url, api_key) = if let Some(id) = extract_json_string(body, "id") {
        let cfg = load_providers();
        let p = cfg
            .providers
            .iter()
            .find(|p| p.id == id)
            .ok_or("not found")?;
        (p.base_url.clone(), p.api_key.clone())
    } else {
        let base_url = extract_json_string(body, "base_url").ok_or("base_url or id required")?;
        let api_key = extract_json_string(body, "api_key").unwrap_or_default();
        (base_url, api_key)
    };

    let models_url = focus_guard_desktop::llm_models_endpoint(&base_url);

    let start = std::time::Instant::now();
    let models_resp = fetch_models(&models_url, &api_key).unwrap_or_default();
    let latency = start.elapsed().as_millis() as u64;

    let models = model_ids_from_response(&models_resp);

    if let Some(id) = extract_json_string(body, "id") {
        let mut cfg = load_providers();
        if let Some(p) = cfg.providers.iter_mut().find(|p| p.id == id) {
            p.models = models.clone();
            p.latency_ms = Some(latency);
            if p.selected_model.is_empty() {
                p.selected_model = models.first().cloned().unwrap_or_default();
            }
        }
        save_providers(&cfg);
    }

    Ok(format!(
        r#"{{"ok":true,"latency_ms":{},"models":{}}}"#,
        latency,
        serde_json::to_string(&models).unwrap_or_else(|_| "[]".to_string())
    ))
}

fn handle_test_all_providers() -> Result<String, String> {
    let mut cfg = load_providers();
    let mut results: Vec<serde_json::Value> = Vec::new();

    for provider in &mut cfg.providers {
        let models_url = focus_guard_desktop::llm_models_endpoint(&provider.base_url);

        let start = std::time::Instant::now();
        let models_resp = fetch_models(&models_url, &provider.api_key).unwrap_or_default();
        let latency = start.elapsed().as_millis() as u64;

        let models = model_ids_from_response(&models_resp);

        provider.models = models.clone();
        provider.latency_ms = Some(latency);
        if provider.selected_model.is_empty() {
            provider.selected_model = models.first().cloned().unwrap_or_default();
        }

        results.push(serde_json::json!({
            "id": provider.id,
            "name": provider.name,
            "latency_ms": latency,
            "model_count": models.len(),
            "models": models,
        }));
    }

    results.sort_by_key(|r| {
        r.get("latency_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(u64::MAX)
    });

    if let Some(fastest) = results.first() {
        if let Some(id) = fastest.get("id").and_then(|v| v.as_str()) {
            cfg.active_provider_id = Some(id.to_string());
            if let Some(p) = cfg.providers.iter().find(|p| p.id == id) {
                let mut ai = AI_CONFIG.lock().unwrap();
                *ai = Some(AiConfig {
                    mode: if p.base_url.contains("127.0.0.1") || p.base_url.contains("localhost") {
                        "local".to_string()
                    } else {
                        "api".to_string()
                    },
                    endpoint: p.base_url.clone(),
                    model: p.selected_model.clone(),
                    api_key: p.api_key.clone(),
                });
            }
        }
    }

    save_providers(&cfg);

    Ok(serde_json::json!({
        "ok": true,
        "results": results,
        "active_id": cfg.active_provider_id,
    })
    .to_string())
}

#[derive(Clone, Debug)]
struct PreparedScreenshot {
    ai_screenshot_base64: Option<String>,
    response_screenshot_base64: Option<String>,
    persisted_screenshot_base64: Option<String>,
    has_screenshot: bool,
    screenshot_bytes: usize,
    privacy_mode: String,
    redaction_status: String,
    redaction_error: String,
    screenshot_redacted: bool,
    screenshot_persisted: bool,
    privacy_risk: String,
}

#[derive(Clone, Debug, Default)]
struct BrowserContext {
    domain: String,
    title_class: String,
    page_metadata: PageMetadata,
}

#[derive(Clone, Debug, Default)]
struct PageMetadata {
    site: String,
    url_kind: String,
    title_class: String,
    content_hints: Vec<String>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct WindowSignalSummary {
    process_name: String,
    title_class: String,
    signals: Vec<String>,
    is_foreground: bool,
}

#[derive(Clone, Debug)]
struct DetectionClassification {
    category: String,
    confidence: f32,
    reason: String,
    suggested_action: String,
    semantic_category: String,
    privacy_risk: String,
    needs_visual: bool,
    error: Option<String>,
}

impl DetectionClassification {
    fn from_ai(value: focus_guard_desktop::AiClassification) -> Self {
        Self {
            category: normalize_detection_category(&value.category),
            confidence: value.confidence,
            reason: value.reason,
            suggested_action: value.suggested_action,
            semantic_category: value.semantic_category.unwrap_or_default(),
            privacy_risk: value.privacy_risk.unwrap_or_else(|| "low".to_string()),
            needs_visual: value.needs_visual,
            error: value.error,
        }
    }
}

fn normalize_detection_category(category: &str) -> String {
    match category {
        "study" | "work" | "productive" => "productive".to_string(),
        "entertainment" | "distraction" | "distracting" => "distracting".to_string(),
        "unknown" => "unknown".to_string(),
        other => other.to_string(),
    }
}

#[derive(Clone, Debug)]
struct RuleClassification {
    category: &'static str,
    confidence: f32,
    reason: &'static str,
    suggested_action: &'static str,
    semantic_category: &'static str,
}

#[derive(Clone, Debug)]
struct DetectionOutcome {
    classification: DetectionClassification,
    prepared: PreparedScreenshot,
    detection_stage: String,
    input_scope: String,
    browser_context: BrowserContext,
    safe_signals: Vec<String>,
    visible_window_count: usize,
    window_signals: Vec<String>,
    window_summaries: Vec<WindowSignalSummary>,
}

fn prepare_screenshot_for_ai(
    ai: &AiConfig,
    privacy: &PrivacyConfig,
    foreground: &focus_guard_desktop::ForegroundWindow,
    screenshot_b64: Option<String>,
) -> PreparedScreenshot {
    let is_local = is_local_ai(ai);
    let has_original = screenshot_b64.is_some();
    let original_len = screenshot_b64.as_ref().map(|s| s.len()).unwrap_or(0);
    let risky = is_risky_window(foreground);

    let mut prepared = PreparedScreenshot {
        ai_screenshot_base64: None,
        response_screenshot_base64: None,
        persisted_screenshot_base64: None,
        has_screenshot: false,
        screenshot_bytes: 0,
        privacy_mode: privacy.privacy_mode.clone(),
        redaction_status: "skipped".to_string(),
        redaction_error: String::new(),
        screenshot_redacted: false,
        screenshot_persisted: false,
        privacy_risk: if risky { "high" } else { "low" }.to_string(),
    };

    let Some(original) = screenshot_b64 else {
        prepared.redaction_status = "unavailable".to_string();
        return prepared;
    };

    if is_local {
        prepared.ai_screenshot_base64 = Some(original.clone());
        prepared.response_screenshot_base64 = Some(original);
        prepared.has_screenshot = has_original;
        prepared.screenshot_bytes = original_len;
        prepared.redaction_status = "local_raw".to_string();
        prepared.privacy_risk = if risky { "medium" } else { "low" }.to_string();
        return prepared;
    }

    if privacy.privacy_mode == "local_only" {
        prepared.redaction_status = "local_only_title_only".to_string();
        return prepared;
    }

    if privacy.privacy_mode == "confirm_each_upload" {
        prepared.redaction_status = "confirm_required_title_only".to_string();
        return prepared;
    }

    if risky && privacy.risky_window_policy != "blur_sensitive_regions" {
        prepared.redaction_status = "risky_title_only".to_string();
        return prepared;
    }

    if privacy.ocr_backend == "none" {
        prepared.redaction_status = "redaction_unavailable".to_string();
        return prepared;
    }

    match redact_screenshot_with_sidecar(&privacy.ocr_backend, &original, risky) {
        Ok(redacted) => {
            let redacted_len = redacted.len();
            let persist_redacted = matches!(
                privacy.screenshot_retention.as_str(),
                "none" | "redacted_preview_only" | "24h"
            );
            prepared.ai_screenshot_base64 = Some(redacted.clone());
            prepared.response_screenshot_base64 = Some(redacted.clone());
            prepared.persisted_screenshot_base64 = if persist_redacted {
                Some(redacted)
            } else {
                None
            };
            prepared.has_screenshot = true;
            prepared.screenshot_bytes = redacted_len;
            prepared.redaction_status = "success".to_string();
            prepared.screenshot_redacted = true;
            prepared.screenshot_persisted = persist_redacted;
            prepared.privacy_risk = if risky { "medium" } else { "low" }.to_string();
        }
        Err(error) => {
            prepared.redaction_status = "redaction_unavailable".to_string();
            prepared.redaction_error = error;
        }
    }

    prepared
}

fn is_local_ai(ai: &AiConfig) -> bool {
    ai.mode == "local" || ai.endpoint.contains("127.0.0.1") || ai.endpoint.contains("localhost")
}

fn is_risky_window(foreground: &focus_guard_desktop::ForegroundWindow) -> bool {
    let process = foreground.process_name.to_ascii_lowercase();
    let title = foreground.window_title.to_ascii_lowercase();
    let risky_processes = [
        "qq.exe",
        "wechat.exe",
        "weixin.exe",
        "wxwork.exe",
        "telegram.exe",
        "outlook.exe",
        "thunderbird.exe",
        "mail.exe",
        "1password.exe",
        "bitwarden.exe",
        "keeper.exe",
        "keepass",
    ];
    let risky_titles = [
        "qq",
        "微信",
        "wechat",
        "telegram",
        "outlook",
        "gmail",
        "mail",
        "邮箱",
        "登录",
        "login",
        "密码",
        "password",
        "支付",
        "银行",
        "bank",
        "身份证",
        "api key",
        "token",
    ];

    risky_processes.iter().any(|needle| process.contains(needle))
        || risky_titles.iter().any(|needle| title.contains(needle))
}

fn redact_screenshot_with_sidecar(
    backend: &str,
    screenshot_b64: &str,
    redact_all_text: bool,
) -> Result<String, String> {
    let script = std::env::var_os("FOCUS_GUARD_REDACTOR_SCRIPT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("tools").join("privacy_redactor.py"));
    if !script.exists() {
        return Err("privacy redactor script not found".to_string());
    }

    let python = std::env::var_os("FOCUS_GUARD_REDACTOR_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("python"));
    let cnocr_model_dir = std::env::var_os("FOCUS_GUARD_CNOCR_MODEL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("models").join("doc-densenet_lite_136-gru"));

    let mut command = Command::new(python);
    command.arg(&script).arg("--backend").arg(backend);
    if backend == "cnocr" {
        command
            .arg("--cnocr-model-dir")
            .arg(cnocr_model_dir);
    }
    if redact_all_text {
        command.arg("--redact-all-text");
    }

    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("redactor unavailable: {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        let input = serde_json::json!({ "image_base64": screenshot_b64 }).to_string();
        stdin
            .write_all(input.as_bytes())
            .map_err(|error| format!("redactor stdin failed: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("redactor failed: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("redactor exited with error: {}", stderr.trim()));
    }

    let value = serde_json::from_slice::<serde_json::Value>(&output.stdout)
        .map_err(|error| format!("invalid redactor output: {error}"))?;
    if value.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(value
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("redaction failed")
            .to_string());
    }
    value
        .get("image_base64")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "redactor returned no image".to_string())
}

fn browser_context_from_body(body: &str) -> BrowserContext {
    let value = serde_json::from_str::<serde_json::Value>(body).unwrap_or_default();
    let Some(ctx) = value.get("browser_context") else {
        return BrowserContext::default();
    };
    let domain = ctx
        .get("domain")
        .and_then(|v| v.as_str())
        .map(normalize_domain)
        .unwrap_or_default();
    let title = ctx.get("title").and_then(|v| v.as_str()).unwrap_or_default();
    let page_metadata = ctx
        .get("page_metadata")
        .map(page_metadata_from_value)
        .unwrap_or_default();
    BrowserContext {
        domain,
        title_class: title_class(title),
        page_metadata,
    }
}

fn page_metadata_from_value(value: &serde_json::Value) -> PageMetadata {
    let site = value
        .get("site")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .collect::<String>();
    let url_kind = value
        .get("url_kind")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .collect::<String>();
    let title_class = value
        .get("title_class")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .collect::<String>();
    let content_hints = value
        .get("content_hints")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| {
                    item.chars()
                        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
                        .collect::<String>()
                })
                .filter(|item| !item.is_empty())
                .take(12)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    PageMetadata {
        site,
        url_kind,
        title_class,
        content_hints,
    }
}

fn normalize_domain(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("www.")
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '.' || *ch == '-')
        .collect::<String>()
        .to_ascii_lowercase()
}

fn title_class(title: &str) -> String {
    let lower = title.to_ascii_lowercase();
    if contains_any(title, &["剪辑", "搞笑", "娱乐", "游戏", "直播", "番剧", "综艺"])
        || contains_any(&lower, &["clip", "game", "gaming", "live", "stream", "anime"])
    {
        "entertainment_title".to_string()
    } else if contains_any(title, &["课程", "教程", "网课", "概率", "统计", "编译原理", "数学", "学习"])
        || contains_any(&lower, &["course", "tutorial", "lecture", "math", "compiler"])
    {
        "study_title".to_string()
    } else if contains_any(title, &["报错", "错误", "修复", "解决", "搜索"])
        || contains_any(&lower, &["error", "fix", "could not", "stackoverflow", "github"])
    {
        "research_title".to_string()
    } else if contains_any(title, &["聊天", "群聊", "私聊", "消息"]) {
        "message_title".to_string()
    } else {
        "generic_title".to_string()
    }
}

fn extract_safe_signals(
    foreground: &focus_guard_desktop::ForegroundWindow,
    browser: &BrowserContext,
) -> Vec<String> {
    let mut signals = Vec::new();
    let domain = browser.domain.as_str();

    add_window_signals(
        &mut signals,
        &foreground.process_name,
        &foreground.window_title,
    );

    if is_browser_process(&foreground.process_name) {
        signals.push("browser".to_string());
    }
    if !domain.is_empty() {
        if domain.contains("bilibili") {
            signals.push("bilibili".to_string());
        }
        if ["youtube", "douyin", "tiktok", "netflix", "twitch"]
            .iter()
            .any(|needle| domain.contains(needle))
        {
            signals.push("video_site".to_string());
        }
        if ["google", "bing", "baidu", "sogou"]
            .iter()
            .any(|needle| domain.contains(needle))
        {
            signals.push("search".to_string());
        }
        if domain.contains("github") || domain.contains("stackoverflow") || domain.contains("docs.")
        {
            signals.push("developer_reference".to_string());
        }
    }
    add_page_metadata_signals(&mut signals, &browser.page_metadata);

    signals.sort();
    signals.dedup();
    signals
}

fn extract_window_signals(windows: &[focus_guard_desktop::WindowSnapshot]) -> Vec<String> {
    let mut signals = Vec::new();
    for window in windows.iter().take(32) {
        add_window_signals(&mut signals, &window.process_name, &window.window_title);
    }
    signals.sort();
    signals.dedup();
    signals
}

fn add_window_signals(signals: &mut Vec<String>, process_name: &str, window_title: &str) {
    let process = process_name.to_ascii_lowercase();
    let title = window_title.to_ascii_lowercase();
    let raw_title = window_title;

    if ["codex", "code.exe", "cursor", "rustrover", "idea64", "devenv", "terminal"]
        .iter()
        .any(|needle| process.contains(needle))
    {
        signals.push("code_tool".to_string());
    }
    if ["typora", "obsidian", "onenote", "word"].iter().any(|needle| process.contains(needle)) {
        signals.push("document_tool".to_string());
    }
    if ["foxit", "acrobat", "sumatrapdf", "pdf", "zotero"]
        .iter()
        .any(|needle| process.contains(needle))
    {
        signals.push("document_tool".to_string());
        signals.push("pdf_reader".to_string());
    }
    if ["qq.exe", "wechat.exe", "weixin.exe", "telegram.exe"]
        .iter()
        .any(|needle| process.contains(needle))
        || contains_any(raw_title, &["QQ", "微信", "群聊", "私聊"])
    {
        signals.push("message_app".to_string());
    }
    if title.contains("bilibili") || raw_title.contains("哔哩哔哩") {
        signals.push("bilibili".to_string());
    }
    if ["youtube", "douyin", "tiktok", "netflix", "twitch"]
        .iter()
        .any(|needle| title.contains(needle))
    {
        signals.push("video_site".to_string());
    }
    if raw_title.contains("搜索") || title.contains("search") {
        signals.push("search".to_string());
    }
    if contains_any(raw_title, &["课程", "教程", "网课", "概率", "统计", "编译原理", "数学", "学习"])
        || contains_any(&title, &["course", "tutorial", "lecture", "math", "compiler"])
    {
        signals.push("study_signal".to_string());
    }
    if contains_any(raw_title, &["剪辑", "搞笑", "娱乐", "游戏", "直播", "番剧", "综艺"])
        || contains_any(&title, &["clip", "game", "gaming", "live", "stream", "anime"])
    {
        signals.push("entertainment_signal".to_string());
    }
    if contains_any(raw_title, &["报错", "错误", "修复", "解决"])
        || contains_any(&title, &["error", "fix", "could not", "driver", "github", "stackoverflow"])
    {
        signals.push("technical_research".to_string());
    }
    if title.contains("gemini") || title.contains("chatgpt") || title.contains("claude") {
        signals.push("ai_tool".to_string());
    }
}

fn add_page_metadata_signals(signals: &mut Vec<String>, metadata: &PageMetadata) {
    if !metadata.site.is_empty() {
        signals.push(format!("site_{}", metadata.site));
    }
    if !metadata.url_kind.is_empty() {
        signals.push(format!("url_kind_{}", metadata.url_kind));
    }
    if !metadata.title_class.is_empty() && metadata.title_class != "generic_title" {
        signals.push(metadata.title_class.clone());
    }
    for hint in &metadata.content_hints {
        signals.push(hint.clone());
        if matches!(
            hint.as_str(),
            "course_hint" | "tutorial_hint" | "lecture_hint" | "study_hint"
        ) {
            signals.push("study_signal".to_string());
        }
        if matches!(
            hint.as_str(),
            "anime_hint" | "bangumi_hint" | "game_hint" | "live_hint" | "clip_hint"
        ) {
            signals.push("entertainment_signal".to_string());
        }
    }
}

fn browser_signal_summary(
    foreground: &focus_guard_desktop::ForegroundWindow,
    browser: &BrowserContext,
) -> Option<WindowSignalSummary> {
    if browser.domain.is_empty() {
        return None;
    }
    let mut signals = Vec::new();
    if browser.domain.contains("bilibili") || browser.page_metadata.site == "bilibili" {
        signals.push("bilibili".to_string());
    }
    add_page_metadata_signals(&mut signals, &browser.page_metadata);
    if browser.title_class != "generic_title" {
        signals.push(browser.title_class.clone());
    }
    signals.sort();
    signals.dedup();
    if signals.is_empty() {
        return None;
    }
    Some(WindowSignalSummary {
        process_name: foreground.process_name.clone(),
        title_class: if browser.page_metadata.title_class.is_empty() {
            browser.title_class.clone()
        } else {
            browser.page_metadata.title_class.clone()
        },
        signals,
        is_foreground: true,
    })
}

fn window_signal_summaries(
    windows: &[focus_guard_desktop::WindowSnapshot],
) -> Vec<WindowSignalSummary> {
    windows
        .iter()
        .take(32)
        .filter_map(|window| {
            let mut signals = Vec::new();
            add_window_signals(&mut signals, &window.process_name, &window.window_title);
            signals.sort();
            signals.dedup();
            if signals.is_empty() {
                return None;
            }
            Some(WindowSignalSummary {
                process_name: window.process_name.clone(),
                title_class: title_class(&window.window_title),
                signals,
                is_foreground: window.is_foreground,
            })
        })
        .collect()
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn classify_safe_signals(signals: &[String]) -> Option<RuleClassification> {
    let has = |needle: &str| signals.iter().any(|signal| signal == needle);
    if has("video_site") && has("entertainment_signal") {
        return Some(RuleClassification {
            category: "distracting",
            confidence: 0.92,
            reason: "本地信号显示当前是视频娱乐网站内容。",
            suggested_action: "intent_required",
            semantic_category: "其他",
        });
    }
    if has("code_tool") {
        return Some(RuleClassification {
            category: "productive",
            confidence: 0.9,
            reason: "本地信号显示当前使用代码开发工具。",
            suggested_action: "none",
            semantic_category: "写代码",
        });
    }
    if has("search") && (has("technical_research") || has("developer_reference")) {
        return Some(RuleClassification {
            category: "productive",
            confidence: 0.86,
            reason: "本地信号显示当前在搜索技术问题或查阅开发资料。",
            suggested_action: "none",
            semantic_category: "查资料",
        });
    }
    None
}

fn classify_window_summaries(summaries: &[WindowSignalSummary]) -> Option<RuleClassification> {
    for summary in summaries {
        let has = |needle: &str| summary.signals.iter().any(|signal| signal == needle);
        if has("bilibili") && (has("anime_hint") || has("bangumi_hint") || has("game_hint") || has("live_hint") || has("clip_hint") || summary.title_class == "entertainment_title") {
            return Some(RuleClassification {
                category: "distracting",
                confidence: 0.94,
                reason: "同一 B站标签页显示为动漫、番剧、直播、剪辑、游戏或娱乐内容。",
                suggested_action: "intent_required",
                semantic_category: "B站娱乐视频",
            });
        }
        if has("bilibili") && (has("course_hint") || has("tutorial_hint") || has("lecture_hint") || has("study_hint") || summary.title_class == "study_title") {
            return Some(RuleClassification {
                category: "productive",
                confidence: 0.9,
                reason: "同一 B站标签页显示为课程、教程、网课或学习内容。",
                suggested_action: "none",
                semantic_category: "B站网课",
            });
        }
    }

    for summary in summaries {
        if summary.is_foreground
            && summary
                .signals
                .iter()
                .any(|signal| signal == "message_app")
        {
            return Some(RuleClassification {
                category: "distracting",
                confidence: 0.82,
                reason: "当前前台窗口是聊天或消息应用，需要说明是否与工作学习相关。",
                suggested_action: "intent_required",
                semantic_category: "回消息",
            });
        }
    }

    None
}

fn semantic_category_to_category(semantic_category: &str) -> (&'static str, &'static str) {
    match semantic_category {
        "B站娱乐视频" | "回消息" => ("distracting", "intent_required"),
        "其他" | "待归类" => ("unknown", "none"),
        _ => ("productive", "none"),
    }
}

fn handle_add_category_rule(body: &str) -> Result<String, String> {
    let value = serde_json::from_str::<serde_json::Value>(body).map_err(|e| e.to_string())?;
    let process_name = value
        .get("process_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let window_title = value
        .get("window_title")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let browser_domain = value
        .get("browser_domain")
        .and_then(|v| v.as_str())
        .map(normalize_domain)
        .unwrap_or_default();
    let page_site = value
        .get("page_site")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let page_url_kind = value
        .get("page_url_kind")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let page_hints = value
        .get("page_hints")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let semantic_category = value
        .get("semantic_category")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    if process_name.is_empty() || semantic_category.is_empty() {
        return Err("process_name and semantic_category are required".to_string());
    }

    let window_signals = value
        .get("window_signals")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let (category, suggested_action) = semantic_category_to_category(&semantic_category);
    let rule = CategoryRule {
        id: format!("{}-category-rule", now_ms()),
        process_name,
        title_class: title_class(window_title),
        browser_domain,
        window_signals,
        page_site,
        page_url_kind,
        page_hints,
        semantic_category,
        category: category.to_string(),
        suggested_action: suggested_action.to_string(),
    };

    let mut rules = load_category_rules();
    rules.retain(|existing| {
        !(existing.process_name == rule.process_name
            && existing.title_class == rule.title_class
            && existing.browser_domain == rule.browser_domain)
    });
    rules.insert(0, rule.clone());
    if rules.len() > MAX_CATEGORY_RULES {
        rules.truncate(MAX_CATEGORY_RULES);
    }
    save_category_rules(&rules);
    Ok(serde_json::json!({ "ok": true, "rule": rule }).to_string())
}

fn match_category_rule(
    foreground: &focus_guard_desktop::ForegroundWindow,
    browser: &BrowserContext,
    safe_signals: &[String],
    window_signals: &[String],
) -> Option<CategoryRule> {
    let process = foreground.process_name.to_ascii_lowercase();
    let current_title_class = title_class(&foreground.window_title);
    let rules = load_category_rules();
    rules.into_iter().find(|rule| {
        if rule.process_name != process {
            return false;
        }
        let title_matches = rule.title_class == current_title_class;
        let domain_matches =
            !rule.browser_domain.is_empty() && rule.browser_domain == browser.domain;
        let page_site_matches =
            !rule.page_site.is_empty() && rule.page_site == browser.page_metadata.site;
        let page_kind_matches = !rule.page_url_kind.is_empty()
            && rule.page_url_kind != "unknown"
            && rule.page_url_kind == browser.page_metadata.url_kind;
        let page_hint_matches = !rule.page_hints.is_empty()
            && rule
                .page_hints
                .iter()
                .any(|hint| browser.page_metadata.content_hints.iter().any(|item| item == hint));
        let page_matches = page_hint_matches || page_kind_matches || (page_site_matches && page_kind_matches);
        let signal_matches = !rule.window_signals.is_empty()
            && rule.window_signals.iter().any(|signal| {
                safe_signals.iter().any(|item| item == signal)
                    || window_signals.iter().any(|item| item == signal)
            });
        if is_browser_process(&rule.process_name) {
            return page_matches || (!matches!(current_title_class.as_str(), "generic_title") && title_matches);
        }
        title_matches || domain_matches || page_matches || signal_matches
    })
}

fn category_rule_to_detection(rule: CategoryRule) -> DetectionClassification {
    DetectionClassification {
        category: rule.category,
        confidence: 0.98,
        reason: format!("已命中你保存的本地分类规则：{}", rule.semantic_category),
        suggested_action: rule.suggested_action,
        semantic_category: rule.semantic_category,
        privacy_risk: "none".to_string(),
        needs_visual: false,
        error: None,
    }
}

fn rule_to_detection(rule: RuleClassification) -> DetectionClassification {
    DetectionClassification {
        category: rule.category.to_string(),
        confidence: rule.confidence,
        reason: rule.reason.to_string(),
        suggested_action: rule.suggested_action.to_string(),
        semantic_category: rule.semantic_category.to_string(),
        privacy_risk: "low".to_string(),
        needs_visual: false,
        error: None,
    }
}

fn empty_prepared_screenshot(privacy: &PrivacyConfig, status: &str) -> PreparedScreenshot {
    PreparedScreenshot {
        ai_screenshot_base64: None,
        response_screenshot_base64: None,
        persisted_screenshot_base64: None,
        has_screenshot: false,
        screenshot_bytes: 0,
        privacy_mode: privacy.privacy_mode.clone(),
        redaction_status: status.to_string(),
        redaction_error: String::new(),
        screenshot_redacted: false,
        screenshot_persisted: false,
        privacy_risk: "low".to_string(),
    }
}

fn should_run_manual_visual(body: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value.get("manual_screenshot").and_then(|v| v.as_bool()))
        == Some(true)
}

fn ocr_backend_override_from_body(body: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(body).ok()?;
    let backend = value.get("ocr_backend").and_then(|v| v.as_str())?.trim();
    if matches!(backend, "cnocr" | "easyocr" | "presidio") {
        Some(backend.to_string())
    } else {
        None
    }
}

fn ai_config_from(ai: &AiConfig) -> LocalAiConfig {
    LocalAiConfig {
        enabled: true,
        endpoint: focus_guard_desktop::llm_request_endpoint(&ai.endpoint),
        model: ai.model.clone(),
        api_key: ai.api_key.clone(),
        ..LocalAiConfig::default()
    }
}

fn run_layered_detection(
    ai: &AiConfig,
    privacy: &PrivacyConfig,
    foreground: &focus_guard_desktop::ForegroundWindow,
    browser: BrowserContext,
    visible_windows: &[focus_guard_desktop::WindowSnapshot],
    manual_screenshot: bool,
) -> DetectionOutcome {
    let mut safe_signals = extract_safe_signals(foreground, &browser);
    let window_signals = extract_window_signals(visible_windows);
    let mut window_summaries = window_signal_summaries(visible_windows);
    if let Some(summary) = browser_signal_summary(foreground, &browser) {
        window_summaries.push(summary);
    }
    safe_signals.extend(window_signals.iter().cloned());
    safe_signals.sort();
    safe_signals.dedup();

    if !manual_screenshot {
        if let Some(rule) =
            match_category_rule(foreground, &browser, &safe_signals, &window_signals)
        {
            return DetectionOutcome {
                classification: category_rule_to_detection(rule),
                prepared: empty_prepared_screenshot(privacy, "user_rule_no_screenshot"),
                detection_stage: "rule".to_string(),
                input_scope: "metadata_only".to_string(),
                browser_context: browser,
                safe_signals,
                visible_window_count: visible_windows.len(),
                window_signals,
                window_summaries,
            };
        }

        if let Some(rule) = classify_window_summaries(&window_summaries) {
            return DetectionOutcome {
                classification: rule_to_detection(rule),
                prepared: empty_prepared_screenshot(privacy, "rule_no_screenshot"),
                detection_stage: "rule".to_string(),
                input_scope: "metadata_only".to_string(),
                browser_context: browser,
                safe_signals,
                visible_window_count: visible_windows.len(),
                window_signals,
                window_summaries,
            };
        }

        if let Some(rule) = classify_safe_signals(&safe_signals) {
            return DetectionOutcome {
                classification: rule_to_detection(rule),
                prepared: empty_prepared_screenshot(privacy, "rule_no_screenshot"),
                detection_stage: "rule".to_string(),
                input_scope: "metadata_only".to_string(),
                browser_context: browser,
                safe_signals,
                visible_window_count: visible_windows.len(),
                window_signals,
                window_summaries,
            };
        }
    }

    let text_context = AiContext {
        process_name: foreground.process_name.clone(),
        window_title: redact_window_title_for_ai(&foreground.window_title),
        screenshot_base64: None,
        browser_domain: if browser.domain.is_empty() {
            None
        } else {
            Some(browser.domain.clone())
        },
        browser_title: if browser.title_class.is_empty() {
            None
        } else {
            Some(browser.title_class.clone())
        },
        safe_signals: safe_signals.clone(),
    };
    let ai_config = ai_config_from(ai);
    let mut classification =
        DetectionClassification::from_ai(classify_context(&ai_config, &text_context));
    let mut prepared = empty_prepared_screenshot(privacy, "metadata_only");
    let mut detection_stage = "text_ai".to_string();
    let mut input_scope = "metadata_only".to_string();

    if manual_screenshot
        || should_auto_refine_semantic_visual(
            privacy,
            foreground,
            &classification,
            false,
            semantic_visual_refined_age_ms(foreground),
        )
    {
        let screenshot_b64 = capture_screen_thumbnail_base64();
        prepared = prepare_screenshot_for_ai(ai, privacy, foreground, screenshot_b64);
        if prepared.ai_screenshot_base64.is_some() {
            let visual_context = AiContext {
                process_name: foreground.process_name.clone(),
                window_title: redact_window_title_for_ai(&foreground.window_title),
                screenshot_base64: prepared.ai_screenshot_base64.clone(),
                browser_domain: if browser.domain.is_empty() {
                    None
                } else {
                    Some(browser.domain.clone())
                },
                browser_title: if browser.title_class.is_empty() {
                    None
                } else {
                    Some(browser.title_class.clone())
                },
                safe_signals: safe_signals.clone(),
            };
            classification =
                DetectionClassification::from_ai(classify_context(&ai_config, &visual_context));
            if prepared.screenshot_redacted {
                detection_stage = if manual_screenshot {
                    "redacted_screenshot".to_string()
                } else {
                    "semantic_redacted_screenshot".to_string()
                };
                input_scope = "redacted_screenshot".to_string();
            } else {
                detection_stage = if manual_screenshot {
                    "local_screenshot".to_string()
                } else {
                    "semantic_local_screenshot".to_string()
                };
                input_scope = "local_raw_screenshot".to_string();
            }
        } else {
            classification.needs_visual = true;
            detection_stage = if manual_screenshot {
                "manual_needed".to_string()
            } else {
                "semantic_visual_failed".to_string()
            };
        }
    } else if classification.needs_visual
        || classification.category == "unknown"
        || classification.confidence < 0.65
    {
        classification.needs_visual = true;
        detection_stage = "manual_needed".to_string();
    }

    DetectionOutcome {
        classification,
        prepared,
        detection_stage,
        input_scope,
        browser_context: browser,
        safe_signals,
        visible_window_count: visible_windows.len(),
        window_signals,
        window_summaries,
    }
}

fn semantic_visual_refined_age_ms(foreground: &focus_guard_desktop::ForegroundWindow) -> u64 {
    let now = now_ms();
    load_ai_records()
        .iter()
        .rev()
        .find(|record| {
            record.process_name == foreground.process_name
                && record.window_title == foreground.window_title
                && record.detection_stage.starts_with("semantic_")
        })
        .map(|record| now.saturating_sub(record.timestamp_ms))
        .unwrap_or(0)
}

fn should_auto_refine_semantic_visual(
    privacy: &PrivacyConfig,
    foreground: &focus_guard_desktop::ForegroundWindow,
    classification: &DetectionClassification,
    manual_screenshot: bool,
    last_refined_age_ms: u64,
) -> bool {
    if manual_screenshot
        || !privacy.auto_semantic_visual
        || privacy.analysis_strategy == "private_first"
        || privacy.analysis_strategy == "manual_confirm_visual"
        || privacy.privacy_mode == "confirm_each_upload"
    {
        return false;
    }
    if last_refined_age_ms > 0 && last_refined_age_ms < 300_000 {
        return false;
    }
    if classification.category == "distracting" {
        return false;
    }
    let semantic = classification.semantic_category.trim();
    if semantic.is_empty() || matches!(semantic, "待归类" | "其他") {
        return true;
    }
    let title = foreground.window_title.to_ascii_lowercase();
    let generic_title = title == "google gemini - google chrome"
        || title == "chatgpt - google chrome"
        || title.contains("google gemini")
        || title.contains("chatgpt")
        || foreground.window_title.contains("搜索&替换")
        || foreground.window_title == "unknown";
    generic_title
}

fn redact_window_title_for_ai(title: &str) -> String {
    title_class(title)
}

fn handle_detect(skip_browser: bool, source: &str, body: &str) -> Result<String, String> {
    let _guard = DETECT_LOCK
        .try_lock()
        .map_err(|_| "detect already running".to_string())?;

    let foreground =
        read_foreground_window().unwrap_or_else(|| focus_guard_desktop::ForegroundWindow {
            process_id: 0,
            process_name: "unknown".into(),
            window_title: "unknown".into(),
    });

    if skip_browser && is_browser_process(&foreground.process_name) {
        append_ai_record(AiRecord {
            id: format!("{}-skipped", now_ms()),
            timestamp_ms: now_ms(),
            source: source.to_string(),
            category: "skipped".to_string(),
            confidence: 1.0,
            reason: "browser handled by extension".to_string(),
            process_name: foreground.process_name.clone(),
            window_title: foreground.window_title.clone(),
            has_screenshot: false,
            screenshot_bytes: 0,
            screenshot_base64: None,
            error: None,
            detection_stage: "rule".to_string(),
            input_scope: "metadata_only".to_string(),
            visible_window_count: 0,
            window_signals: Vec::new(),
            window_summaries: Vec::new(),
            page_hints: Vec::new(),
            ..AiRecord::default()
        });
        return Ok(format!(
            r#"{{"skipped":true,"skip_reason":"browser","category":"skipped","confidence":1,"reason":"browser handled by extension","suggested_action":"none","process_name":"{}","window_title":"{}","has_screenshot":false,"screenshot_bytes":0,"detection_stage":"rule","input_scope":"metadata_only","visible_window_count":0,"window_signals":[],"window_summaries":[],"page_site":"","page_url_kind":"","page_hints":[],"error":null}}"#,
            json_esc(&foreground.process_name),
            json_esc(&foreground.window_title)
        ));
    }

    let ai = get_ai_config();
    let manual_screenshot = should_run_manual_visual(body);
    let mut privacy = load_privacy_config();
    if manual_screenshot {
        privacy.privacy_mode = "redacted_cloud".to_string();
        privacy.ocr_backend = "cnocr".to_string();
        privacy.risky_window_policy = "blur_sensitive_regions".to_string();
    } else if let Some(ocr_backend) = ocr_backend_override_from_body(body) {
        privacy.ocr_backend = ocr_backend;
    }
    if privacy.auto_semantic_visual && privacy.ocr_backend == "none" {
        privacy.ocr_backend = "cnocr".to_string();
    }
    let browser_context = browser_context_from_body(body);
    let visible_windows = read_visible_windows();
    let outcome = run_layered_detection(
        &ai,
        &privacy,
        &foreground,
        browser_context,
        &visible_windows,
        manual_screenshot,
    );
    let classification = outcome.classification.clone();
    let prepared = outcome.prepared;

    append_ai_record(AiRecord {
        id: format!("{}-{}", now_ms(), source),
        timestamp_ms: now_ms(),
        source: source.to_string(),
        category: classification.category.clone(),
        confidence: f64::from(classification.confidence),
        reason: classification.reason.clone(),
        process_name: foreground.process_name.clone(),
        window_title: foreground.window_title.clone(),
        has_screenshot: prepared.has_screenshot,
        screenshot_bytes: prepared.screenshot_bytes,
        screenshot_base64: prepared.persisted_screenshot_base64.clone(),
        privacy_mode: prepared.privacy_mode.clone(),
        redaction_status: prepared.redaction_status.clone(),
        redaction_error: prepared.redaction_error.clone(),
        screenshot_redacted: prepared.screenshot_redacted,
        screenshot_persisted: prepared.screenshot_persisted,
        semantic_category: classification.semantic_category.clone(),
        privacy_risk: if classification.privacy_risk.is_empty() {
            prepared.privacy_risk.clone()
        } else {
            classification.privacy_risk.clone()
        },
        detection_stage: outcome.detection_stage.clone(),
        input_scope: outcome.input_scope.clone(),
        browser_domain: outcome.browser_context.domain.clone(),
        browser_title: outcome.browser_context.title_class.clone(),
        visible_window_count: outcome.visible_window_count,
        window_signals: outcome.window_signals.clone(),
        window_summaries: outcome.window_summaries.clone(),
        page_site: outcome.browser_context.page_metadata.site.clone(),
        page_url_kind: outcome.browser_context.page_metadata.url_kind.clone(),
        page_hints: outcome.browser_context.page_metadata.content_hints.clone(),
        error: classification.error.clone(),
    });

    Ok(serde_json::json!({
        "category": classification.category,
        "confidence": classification.confidence,
        "reason": classification.reason,
        "suggested_action": classification.suggested_action,
        "process_name": foreground.process_name,
        "window_title": foreground.window_title,
        "has_screenshot": prepared.has_screenshot,
        "screenshot_bytes": prepared.screenshot_bytes,
        "screenshot_base64": prepared.response_screenshot_base64,
        "privacy_mode": prepared.privacy_mode,
        "redaction_status": prepared.redaction_status,
        "redaction_error": prepared.redaction_error,
        "screenshot_redacted": prepared.screenshot_redacted,
        "screenshot_persisted": prepared.screenshot_persisted,
        "semantic_category": classification.semantic_category,
        "privacy_risk": if classification.privacy_risk.is_empty() { prepared.privacy_risk } else { classification.privacy_risk },
        "needs_visual": classification.needs_visual,
        "detection_stage": outcome.detection_stage,
        "input_scope": outcome.input_scope,
        "browser_domain": outcome.browser_context.domain,
        "browser_title": outcome.browser_context.title_class,
        "safe_signals": outcome.safe_signals,
        "visible_window_count": outcome.visible_window_count,
        "window_signals": outcome.window_signals,
        "window_summaries": outcome.window_summaries,
        "page_site": outcome.browser_context.page_metadata.site,
        "page_url_kind": outcome.browser_context.page_metadata.url_kind,
        "page_hints": outcome.browser_context.page_metadata.content_hints,
        "error": classification.error,
    })
    .to_string())
}

fn is_browser_process(process_name: &str) -> bool {
    matches!(
        process_name.to_ascii_lowercase().as_str(),
        "chrome.exe" | "msedge.exe" | "firefox.exe" | "brave.exe" | "opera.exe" | "vivaldi.exe"
    )
}

fn handle_validate_reason(body: &str) -> Result<String, String> {
    let reason = extract_json_string(body, "reason").unwrap_or_default();
    let target = extract_json_string(body, "target").unwrap_or_default();

    if reason.is_empty() {
        return Ok(r#"{"approved":false,"message":"请输入理由"}"#.to_string());
    }

    let prompt = format!(
        "You are Focus Guard, a focus assistant. A user was detected procrastinating on {}. They gave this reason: \"{}\"\n\nIs this a legitimate reason to take a break? Reply with ONLY JSON: {{\"approved\": true/false, \"message\": \"中文简短解释\"}}\n\nKeep JSON field names in English, but write message in Simplified Chinese.\n\nLegitimate reasons: studying on that site, research, looking up information, educational content.\nNot legitimate: bored, just browsing, killing time, no specific purpose.",
        json_esc(&target), json_esc(&reason)
    );

    let config = get_ai_config();
    let ai_config = LocalAiConfig {
        enabled: true,
        endpoint: focus_guard_desktop::llm_request_endpoint(&config.endpoint),
        model: config.model,
        api_key: config.api_key,
        ..LocalAiConfig::default()
    };
    let fake_context = AiContext {
        process_name: "validation".to_string(),
        window_title: prompt,
        screenshot_base64: None,
        browser_domain: None,
        browser_title: None,
        safe_signals: Vec::new(),
    };

    let request_json = focus_guard_desktop::local_ai_request_json(&ai_config, &fake_context);
    match focus_guard_desktop::classify_context_from_llm_response_raw(&request_json, &ai_config) {
        Ok(response) => {
            if !response.contains("\"approved\"") {
                return Ok(r#"{"approved":true,"message":"验证服务不可用，已放行"}"#.to_string());
            }
            let approved =
                response.contains("\"approved\":true") || response.contains("\"approved\": true");
            let message = extract_json_string(&response, "message").unwrap_or_else(|| {
                if approved {
                    "理由通过".to_string()
                } else {
                    "理由不合理".to_string()
                }
            });
            Ok(format!(
                r#"{{"approved":{},"message":"{}"}}"#,
                approved,
                json_esc(&message)
            ))
        }
        Err(_) => Ok(r#"{"approved":true,"message":"验证服务不可用，已放行"}"#.to_string()),
    }
}

fn fetch_models(url: &str, api_key: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(url);
    if !api_key.is_empty() {
        req = req.bearer_auth(api_key);
    }

    let resp = req.send().map_err(|e| format!("request failed: {}", e))?;
    let status = resp.status();
    let body = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "upstream HTTP {}: {}",
            status.as_u16(),
            compact_upstream_error(&body)
        ));
    }
    Ok(body)
}

fn model_ids_from_response(body: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return Vec::new();
    };

    let items = value
        .get("data")
        .or_else(|| value.get("models"))
        .and_then(|v| v.as_array());

    let Some(items) = items else {
        return Vec::new();
    };

    let mut models = Vec::new();
    for item in items {
        if let Some(id) = item.as_str().or_else(|| item.get("id").and_then(|id| id.as_str())) {
            if !id.is_empty() && !models.iter().any(|model| model == id) {
                models.push(id.to_string());
            }
        }
    }
    models
}

fn models_fallback_response(model: &str, warning: Option<&str>) -> (&'static str, String) {
    if model.trim().is_empty() {
        return (
            "502 Bad Gateway",
            format!(
                r#"{{"error":"{}"}}"#,
                json_esc(warning.unwrap_or("model list unavailable"))
            ),
        );
    }

    (
        "200 OK",
        models_response_json(
            &[model.trim().to_string()],
            Some(warning.unwrap_or("模型列表不可用，已保留当前模型")),
        ),
    )
}

fn models_response_json(models: &[String], warning: Option<&str>) -> String {
    let data = models
        .iter()
        .map(|model| format!(r#"{{"id":"{}"}}"#, json_esc(model)))
        .collect::<Vec<_>>()
        .join(",");
    match warning {
        Some(message) => format!(
            r#"{{"data":[{}],"warning":"{}"}}"#,
            data,
            json_esc(message)
        ),
        None => format!(r#"{{"data":[{}]}}"#, data),
    }
}

fn compact_upstream_error(body: &str) -> String {
    let parsed = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(|v| v.as_str())
                .or_else(|| value.get("message").and_then(|v| v.as_str()))
                .or_else(|| value.get("error").and_then(|v| v.as_str()))
                .map(str::to_string)
        });
    let text = parsed.unwrap_or_else(|| body.trim().to_string());
    text.chars().take(240).collect::<String>()
}

fn test_model(config: &AiConfig, model: &str) -> Result<String, String> {
    let url = focus_guard_desktop::llm_request_endpoint(&config.endpoint);
    let body_json = if url.contains("/responses") {
        let body = serde_json::json!({
            "model": model,
            "input": [{"role": "user", "content": [{"type": "input_text", "text": "Say hi in 5 words"}]}],
            "max_output_tokens": 20,
            "temperature": 0.1,
        });
        body
    } else {
        let body = serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": "Say hi in 5 words"}],
            "max_tokens": 20,
            "temperature": 0.1,
        });
        body
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.post(&url).json(&body_json);
    if !config.api_key.is_empty() {
        req = req.bearer_auth(&config.api_key);
    }

    let resp = req.send().map_err(|e| format!("request failed: {}", e))?;
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Ok(format!(
            r#"{{"ok":false,"error":"upstream HTTP {}: {}"}}"#,
            status.as_u16(),
            json_esc(&compact_upstream_error(&text))
        ));
    }

    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(content) = extract_llm_text_from_response(&v) {
            return Ok(format!(
                r#"{{"ok":true,"response":"{}","model":"{}"}}"#,
                json_esc(content),
                json_esc(model)
            ));
        }
        if let Some(err) = v
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
        {
            return Ok(format!(r#"{{"ok":false,"error":"{}"}}"#, json_esc(err)));
        }
    }

    Ok(format!(
        r#"{{"ok":false,"error":"unexpected response: {}"}}"#,
        json_esc(&compact_upstream_error(&text))
    ))
}

fn extract_llm_text_from_response(value: &serde_json::Value) -> Option<&str> {
    if let Some(text) = value.get("output_text").and_then(|v| v.as_str()) {
        return Some(text);
    }
    if let Some(text) = value
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
    {
        return Some(text);
    }
    if let Some(text) = value
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("text"))
        .and_then(|c| c.as_str())
    {
        return Some(text);
    }
    if let Some(output) = value.get("output").and_then(|o| o.as_array()) {
        for item in output {
            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                return Some(text);
            }
            if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                for part in content {
                    if let Some(text) = part
                        .get("text")
                        .or_else(|| part.get("output_text"))
                        .and_then(|t| t.as_str())
                    {
                        return Some(text);
                    }
                }
            }
        }
    }
    None
}

fn extract_json_string(json: &str, field: &str) -> Option<String> {
    let key = format!("\"{}\":\"", field);
    let start = json.find(&key)? + key.len();
    let rest = &json[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn json_esc(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheduled_result_marks_distracting_outputs() {
        let mut cfg = ScheduledDetectConfig::default();

        apply_scheduled_result(
            &mut cfg,
            r#"{"category":"distracting","reason":"video feed","process_name":"Doubao.exe","window_title":"Feed","error":null}"#,
        );

        assert_eq!(cfg.last_status, "distracting");
        assert_eq!(cfg.last_category.as_deref(), Some("distracting"));
        assert_eq!(cfg.last_reason.as_deref(), Some("video feed"));
        assert_eq!(cfg.last_process_name.as_deref(), Some("Doubao.exe"));
        assert_eq!(cfg.last_window_title.as_deref(), Some("Feed"));
        assert_eq!(cfg.last_error, None);
    }

    #[test]
    fn scheduled_result_marks_browser_skips_without_alert_category() {
        let mut cfg = ScheduledDetectConfig::default();

        apply_scheduled_result(
            &mut cfg,
            r#"{"skipped":true,"category":"skipped","reason":"browser handled by extension","process_name":"chrome.exe"}"#,
        );

        assert_eq!(cfg.last_status, "skipped");
        assert_eq!(cfg.last_category.as_deref(), Some("skipped"));
        assert_eq!(cfg.last_process_name.as_deref(), Some("chrome.exe"));
        assert_eq!(cfg.last_error, None);
    }

    #[test]
    fn scheduled_result_preserves_ai_errors() {
        let mut cfg = ScheduledDetectConfig::default();

        apply_scheduled_result(
            &mut cfg,
            r#"{"category":"unknown","error":"api_error: 401"}"#,
        );

        assert_eq!(cfg.last_status, "error");
        assert_eq!(cfg.last_error.as_deref(), Some("api_error: 401"));
    }

    #[test]
    fn safe_signal_rules_classify_technical_search_as_research() {
        let foreground = focus_guard_desktop::ForegroundWindow {
            process_id: 1,
            process_name: "chrome.exe".to_string(),
            window_title: "throttlestop出现报错：could not start driver - Google 搜索 - Google Chrome".to_string(),
        };
        let browser = BrowserContext {
            domain: "google.com".to_string(),
            title_class: "research_title".to_string(),
            page_metadata: PageMetadata::default(),
        };
        let signals = extract_safe_signals(&foreground, &browser);
        let rule = classify_safe_signals(&signals).expect("technical search should match a rule");

        assert_eq!(rule.category, "productive");
        assert_eq!(rule.semantic_category, "查资料");
    }

    #[test]
    fn safe_signal_rules_classify_codex_as_coding() {
        let foreground = focus_guard_desktop::ForegroundWindow {
            process_id: 1,
            process_name: "Codex.exe".to_string(),
            window_title: "Codex".to_string(),
        };
        let signals = extract_safe_signals(&foreground, &BrowserContext::default());
        let rule = classify_safe_signals(&signals).expect("code tool should match a rule");

        assert_eq!(rule.category, "productive");
        assert_eq!(rule.semantic_category, "写代码");
    }

    #[test]
    fn bilibili_generic_title_does_not_classify_without_hints() {
        let summaries = vec![WindowSignalSummary {
            process_name: "chrome.exe".to_string(),
            title_class: "generic_title".to_string(),
            signals: vec!["bilibili".to_string()],
            is_foreground: true,
        }];

        assert!(classify_window_summaries(&summaries).is_none());
    }

    #[test]
    fn bilibili_entertainment_hint_classifies_same_tab_only() {
        let summaries = vec![WindowSignalSummary {
            process_name: "chrome.exe".to_string(),
            title_class: "generic_title".to_string(),
            signals: vec!["bilibili".to_string(), "anime_hint".to_string()],
            is_foreground: true,
        }];
        let rule = classify_window_summaries(&summaries).expect("same-tab anime hint should match");

        assert_eq!(rule.category, "distracting");
        assert_eq!(rule.semantic_category, "B站娱乐视频");
    }

    #[test]
    fn bilibili_study_hint_classifies_same_tab_only() {
        let summaries = vec![WindowSignalSummary {
            process_name: "chrome.exe".to_string(),
            title_class: "generic_title".to_string(),
            signals: vec!["bilibili".to_string(), "course_hint".to_string()],
            is_foreground: true,
        }];
        let rule = classify_window_summaries(&summaries).expect("same-tab course hint should match");

        assert_eq!(rule.category, "productive");
        assert_eq!(rule.semantic_category, "B站网课");
    }

    #[test]
    fn bilibili_and_pdf_study_signals_do_not_cross_contaminate() {
        let summaries = vec![
            WindowSignalSummary {
                process_name: "chrome.exe".to_string(),
                title_class: "generic_title".to_string(),
                signals: vec!["bilibili".to_string()],
                is_foreground: true,
            },
            WindowSignalSummary {
                process_name: "FoxitPDFEditor.exe".to_string(),
                title_class: "study_title".to_string(),
                signals: vec!["pdf_reader".to_string(), "study_signal".to_string()],
                is_foreground: false,
            },
        ];

        assert!(classify_window_summaries(&summaries).is_none());
    }

    #[test]
    fn visible_window_signals_classify_pdf_course_context() {
        let windows = vec![focus_guard_desktop::WindowSnapshot {
            process_id: 2,
            process_name: "FoxitPDFEditor.exe".to_string(),
            window_title: "Lecture_15-中间代码生成（1） - 福昕高级PDF编辑器".to_string(),
            is_foreground: false,
        }];
        let signals = extract_window_signals(&windows);

        assert!(signals.iter().any(|signal| signal == "pdf_reader"));
        assert!(signals.iter().any(|signal| signal == "study_signal"));
    }

    #[test]
    fn non_foreground_message_window_does_not_override_current_activity() {
        let summaries = vec![WindowSignalSummary {
            process_name: "qq.exe".to_string(),
            title_class: "generic_title".to_string(),
            signals: vec!["message_app".to_string()],
            is_foreground: false,
        }];

        assert!(classify_window_summaries(&summaries).is_none());
    }

    #[test]
    fn foreground_message_window_requires_intent() {
        let summaries = vec![WindowSignalSummary {
            process_name: "qq.exe".to_string(),
            title_class: "generic_title".to_string(),
            signals: vec!["message_app".to_string()],
            is_foreground: true,
        }];
        let rule = classify_window_summaries(&summaries).expect("foreground QQ should require intent");

        assert_eq!(rule.category, "distracting");
        assert_eq!(rule.suggested_action, "intent_required");
    }

    #[test]
    fn category_rule_maps_semantic_category_to_policy_category() {
        assert_eq!(
            semantic_category_to_category("B站娱乐视频"),
            ("distracting", "intent_required")
        );
        assert_eq!(semantic_category_to_category("学编译原理"), ("productive", "none"));
        assert_eq!(semantic_category_to_category("待归类"), ("unknown", "none"));
    }

    #[test]
    fn privacy_config_normalizes_invalid_values() {
        let mut cfg = PrivacyConfig {
            privacy_mode: "raw_cloud".to_string(),
            analysis_strategy: "always_visual".to_string(),
            ocr_backend: "unknown".to_string(),
            screenshot_retention: "forever".to_string(),
            risky_window_policy: "upload".to_string(),
            auto_semantic_visual: true,
        };

        normalize_privacy_config(&mut cfg);

        assert_eq!(cfg.privacy_mode, "redacted_cloud");
        assert_eq!(cfg.ocr_backend, "none");
        assert_eq!(cfg.screenshot_retention, "none");
        assert_eq!(cfg.risky_window_policy, "title_only");
    }

    #[test]
    fn cloud_without_ocr_uses_title_only_screenshot_policy() {
        let ai = AiConfig {
            mode: "api".to_string(),
            endpoint: "https://api.openai.com/v1".to_string(),
            model: "model".to_string(),
            api_key: "key".to_string(),
        };
        let privacy = PrivacyConfig::default();
        let foreground = focus_guard_desktop::ForegroundWindow {
            process_id: 1,
            process_name: "Code.exe".to_string(),
            window_title: "Focus Guard".to_string(),
        };

        let prepared = prepare_screenshot_for_ai(&ai, &privacy, &foreground, Some("abc".to_string()));

        assert_eq!(prepared.ai_screenshot_base64, None);
        assert_eq!(prepared.redaction_status, "redaction_unavailable");
        assert!(!prepared.screenshot_persisted);
    }

    #[test]
    fn semantic_visual_refinement_triggers_for_generic_gemini() {
        let privacy = PrivacyConfig {
            auto_semantic_visual: true,
            ..PrivacyConfig::default()
        };
        let foreground = focus_guard_desktop::ForegroundWindow {
            process_id: 1,
            process_name: "chrome.exe".to_string(),
            window_title: "Google Gemini - Google Chrome".to_string(),
        };
        let classification = DetectionClassification {
            category: "productive".to_string(),
            confidence: 0.8,
            reason: "标题过泛，无法判断具体学科".to_string(),
            suggested_action: "none".to_string(),
            semantic_category: "待归类".to_string(),
            privacy_risk: "low".to_string(),
            needs_visual: false,
            error: None,
        };

        assert!(should_auto_refine_semantic_visual(
            &privacy,
            &foreground,
            &classification,
            false,
            0
        ));
    }

    #[test]
    fn semantic_visual_refinement_skips_clear_coding_rule() {
        let privacy = PrivacyConfig {
            auto_semantic_visual: true,
            ..PrivacyConfig::default()
        };
        let foreground = focus_guard_desktop::ForegroundWindow {
            process_id: 1,
            process_name: "Codex.exe".to_string(),
            window_title: "Codex".to_string(),
        };
        let classification = DetectionClassification {
            category: "productive".to_string(),
            confidence: 0.95,
            reason: "本地信号显示当前使用代码开发工具".to_string(),
            suggested_action: "none".to_string(),
            semantic_category: "写代码".to_string(),
            privacy_risk: "low".to_string(),
            needs_visual: false,
            error: None,
        };

        assert!(!should_auto_refine_semantic_visual(
            &privacy,
            &foreground,
            &classification,
            false,
            0
        ));
    }

    #[test]
    fn local_model_can_use_screenshot_without_persisting_it() {
        let ai = AiConfig {
            mode: "local".to_string(),
            endpoint: "http://127.0.0.1:8080/v1".to_string(),
            model: "model".to_string(),
            api_key: "".to_string(),
        };
        let privacy = PrivacyConfig::default();
        let foreground = focus_guard_desktop::ForegroundWindow {
            process_id: 1,
            process_name: "Code.exe".to_string(),
            window_title: "Focus Guard".to_string(),
        };

        let prepared = prepare_screenshot_for_ai(&ai, &privacy, &foreground, Some("abc".to_string()));

        assert_eq!(prepared.ai_screenshot_base64.as_deref(), Some("abc"));
        assert_eq!(prepared.persisted_screenshot_base64, None);
        assert_eq!(prepared.redaction_status, "local_raw");
    }

    #[test]
    fn test_model_response_parser_accepts_responses_output_text() {
        let value = serde_json::json!({
            "output_text": "你好，测试成功"
        });

        assert_eq!(
            extract_llm_text_from_response(&value),
            Some("你好，测试成功")
        );
    }

    #[test]
    fn test_model_response_parser_accepts_output_content_text() {
        let value = serde_json::json!({
            "output": [{
                "type": "message",
                "content": [{
                    "type": "output_text",
                    "text": "hello from responses"
                }]
            }]
        });

        assert_eq!(
            extract_llm_text_from_response(&value),
            Some("hello from responses")
        );
    }

    #[test]
    fn test_model_response_parser_accepts_chat_completions() {
        let value = serde_json::json!({
            "choices": [{
                "message": {
                    "content": "hello from chat"
                }
            }]
        });

        assert_eq!(
            extract_llm_text_from_response(&value),
            Some("hello from chat")
        );
    }

    #[test]
    fn scheduled_alert_respects_cooldown() {
        let mut cfg = ScheduledDetectConfig {
            interval_minutes: 1,
            last_status: "distracting".to_string(),
            last_alert_at_ms: 1_000,
            ..ScheduledDetectConfig::default()
        };

        assert!(!should_send_scheduled_alert_at(&cfg, 240_000));
        assert!(should_send_scheduled_alert_at(&cfg, 301_000));

        cfg.interval_minutes = 10;
        assert!(!should_send_scheduled_alert_at(&cfg, 590_000));
        assert!(should_send_scheduled_alert_at(&cfg, 601_000));
    }

    #[test]
    fn scheduled_alert_ignores_non_distracting_statuses() {
        let cfg = ScheduledDetectConfig {
            interval_minutes: 1,
            last_status: "ok".to_string(),
            last_alert_at_ms: 0,
            ..ScheduledDetectConfig::default()
        };

        assert!(!should_send_scheduled_alert_at(&cfg, 1_000_000));
    }

    #[test]
    fn model_endpoint_normalization_handles_common_base_urls() {
        assert_eq!(
            focus_guard_desktop::llm_models_endpoint("https://ark.cn-beijing.volces.com/api/v3"),
            "https://ark.cn-beijing.volces.com/api/v3/models"
        );
        assert_eq!(
            focus_guard_desktop::llm_models_endpoint(
                "https://ark.cn-beijing.volces.com/api/v3/responses"
            ),
            "https://ark.cn-beijing.volces.com/api/v3/models"
        );
        assert_eq!(
            focus_guard_desktop::llm_models_endpoint("https://api.openai.com"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            focus_guard_desktop::llm_models_endpoint("https://api.openai.com/v1"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            focus_guard_desktop::llm_models_endpoint(
                "https://api.openai.com/v1/chat/completions"
            ),
            "https://api.openai.com/v1/models"
        );
    }

    #[test]
    fn model_fallback_returns_current_model_with_warning() {
        let (status, body) =
            models_fallback_response("ep-current", Some("upstream HTTP 404: not found"));

        assert_eq!(status, "200 OK");
        assert!(body.contains(r#""id":"ep-current""#));
        assert!(body.contains(r#""warning":"upstream HTTP 404: not found""#));
    }

    #[test]
    fn model_ids_parse_openai_and_string_lists() {
        assert_eq!(
            model_ids_from_response(r#"{"data":[{"id":"model-a"},{"id":"model-b"}]}"#),
            vec!["model-a".to_string(), "model-b".to_string()]
        );
        assert_eq!(
            model_ids_from_response(r#"{"models":["model-a","model-a","model-c"]}"#),
            vec!["model-a".to_string(), "model-c".to_string()]
        );
    }

    #[test]
    fn parse_curl_extracts_bearer_key_and_model_from_json_body() {
        let parsed = parse_curl(
            r#"curl https://api.example.test/v1/chat/completions -H "Authorization: Bearer test-key-000000000000" -H "Content-Type: application/json" -d '{"model":"model-alpha","messages":[{"role":"user","content":"hi"}]}'"#,
        )
        .expect("curl should parse");

        assert_eq!(parsed.0, "https://api.example.test");
        assert_eq!(parsed.1, "test-key-000000000000");
        assert_eq!(parsed.2, "model-alpha");
    }

    #[test]
    fn parse_curl_extracts_api_key_header_and_data_raw_model() {
        let parsed = parse_curl(
            r#"curl -X POST "https://ark.example.test/api/v3/responses" --header "api-key: test-key-111111111111" --data-raw '{"model":"model-beta","input":"hello"}'"#,
        )
        .expect("curl should parse");

        assert_eq!(parsed.0, "https://ark.example.test/api/v3/responses");
        assert_eq!(parsed.1, "test-key-111111111111");
        assert_eq!(parsed.2, "model-beta");
    }

    #[test]
    fn parse_curl_extracts_inline_data_model() {
        let parsed = parse_curl(
            r#"curl "https://local.example.test/v1" -H "x-api-key: test-key-222222222222" --data='{"model":"model-gamma"}'"#,
        )
        .expect("curl should parse");

        assert_eq!(parsed.0, "https://local.example.test");
        assert_eq!(parsed.1, "test-key-222222222222");
        assert_eq!(parsed.2, "model-gamma");
    }
}
