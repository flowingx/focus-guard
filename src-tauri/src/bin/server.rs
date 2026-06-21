use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use focus_guard_desktop::{
    capture_screen_thumbnail_base64, classify_context, read_foreground_window,
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
static DETECT_LOCK: Mutex<()> = Mutex::new(());
const MAX_AI_RECORDS: usize = 1000;

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

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
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
    error: Option<String>,
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

        let detection = handle_detect(true, "scheduled");
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

    match cfg.last_category.as_deref() {
        Some("distracting") | Some("distraction") => cfg.last_status = "distracting".to_string(),
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
                match handle_detect(body_str.contains("\"skip_browser\":true"), &source) {
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

fn handle_detect(skip_browser: bool, source: &str) -> Result<String, String> {
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
        if let Some(result) = classify_browser_title(&foreground.window_title) {
            append_ai_record(AiRecord {
                id: format!("{}-browser-title", now_ms()),
                timestamp_ms: now_ms(),
                source: source.to_string(),
                category: result.category.to_string(),
                confidence: result.confidence,
                reason: result.reason.to_string(),
                process_name: foreground.process_name.clone(),
                window_title: foreground.window_title.clone(),
                has_screenshot: false,
                screenshot_bytes: 0,
                screenshot_base64: None,
                error: None,
            });
            return Ok(format!(
                r#"{{"category":"{}","confidence":{},"reason":"{}","suggested_action":"{}","process_name":"{}","window_title":"{}","has_screenshot":false,"screenshot_bytes":0,"screenshot_base64":null,"error":null}}"#,
                json_esc(result.category),
                result.confidence,
                json_esc(result.reason),
                json_esc(result.suggested_action),
                json_esc(&foreground.process_name),
                json_esc(&foreground.window_title)
            ));
        }

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
        });
        return Ok(format!(
            r#"{{"skipped":true,"skip_reason":"browser","category":"skipped","confidence":1,"reason":"browser handled by extension","suggested_action":"none","process_name":"{}","window_title":"{}","has_screenshot":false,"screenshot_bytes":0,"error":null}}"#,
            json_esc(&foreground.process_name),
            json_esc(&foreground.window_title)
        ));
    }

    let screenshot_b64 = capture_screen_thumbnail_base64();

    let context = AiContext {
        process_name: foreground.process_name.clone(),
        window_title: foreground.window_title.clone(),
        screenshot_base64: screenshot_b64.clone(),
    };

    let config = {
        let ai = get_ai_config();
        LocalAiConfig {
            enabled: true,
            endpoint: focus_guard_desktop::llm_request_endpoint(&ai.endpoint),
            model: ai.model,
            api_key: ai.api_key,
            ..LocalAiConfig::default()
        }
    };
    let classification = classify_context(&config, &context);

    let screenshot_len = screenshot_b64.as_ref().map(|s| s.len()).unwrap_or(0);
    append_ai_record(AiRecord {
        id: format!("{}-{}", now_ms(), source),
        timestamp_ms: now_ms(),
        source: source.to_string(),
        category: classification.category.clone(),
        confidence: f64::from(classification.confidence),
        reason: classification.reason.clone(),
        process_name: foreground.process_name.clone(),
        window_title: foreground.window_title.clone(),
        has_screenshot: screenshot_b64.is_some(),
        screenshot_bytes: screenshot_len,
        screenshot_base64: screenshot_b64.clone(),
        error: classification.error.clone(),
    });

    let result = format!(
        r#"{{"category":"{}","confidence":{},"reason":"{}","suggested_action":"{}","process_name":"{}","window_title":"{}","has_screenshot":{},"screenshot_bytes":{},"screenshot_base64":{},"error":{}}}"#,
        json_esc(&classification.category),
        classification.confidence,
        json_esc(&classification.reason),
        json_esc(&classification.suggested_action),
        json_esc(&foreground.process_name),
        json_esc(&foreground.window_title),
        screenshot_b64.is_some(),
        screenshot_len,
        match &screenshot_b64 {
            Some(image) => format!("\"{}\"", json_esc(image)),
            None => "null".to_string(),
        },
        match &classification.error {
            Some(e) => format!("\"{}\"", json_esc(e)),
            None => "null".to_string(),
        }
    );

    Ok(result)
}

fn is_browser_process(process_name: &str) -> bool {
    matches!(
        process_name.to_ascii_lowercase().as_str(),
        "chrome.exe" | "msedge.exe" | "firefox.exe" | "brave.exe" | "opera.exe" | "vivaldi.exe"
    )
}

struct BrowserTitleClassification {
    category: &'static str,
    confidence: f64,
    reason: &'static str,
    suggested_action: &'static str,
}

fn classify_browser_title(window_title: &str) -> Option<BrowserTitleClassification> {
    let title = window_title.to_ascii_lowercase();
    let distracting_tokens = [
        "bilibili",
        "哔哩哔哩",
        "youtube",
        "douyin",
        "抖音",
        "tiktok",
        "netflix",
        "twitch",
        "直播",
        "剪辑",
        "搞笑",
        "娱乐",
        "游戏",
        "番剧",
        "动画",
        "短视频",
    ];

    if distracting_tokens
        .iter()
        .any(|token| title.contains(&token.to_ascii_lowercase()))
    {
        return Some(BrowserTitleClassification {
            category: "distracting",
            confidence: 0.9,
            reason: "浏览器窗口标题已经显示为视频、娱乐、直播、游戏或短视频相关内容，后台巡检按摸鱼处理。",
            suggested_action: "intent_required",
        });
    }

    None
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
    let text = resp.text().map_err(|e| e.to_string())?;

    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(content) = v
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
        {
            return Ok(format!(
                r#"{{"ok":true,"response":"{}","model":"{}"}}"#,
                json_esc(content),
                json_esc(model)
            ));
        }
        if let Some(output) = v.get("output").and_then(|o| o.as_array()) {
            for item in output {
                if item.get("type").and_then(|t| t.as_str()) == Some("message") {
                    if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                        for part in content {
                            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                                return Ok(format!(
                                    r#"{{"ok":true,"response":"{}","model":"{}"}}"#,
                                    json_esc(text),
                                    json_esc(model)
                                ));
                            }
                        }
                    }
                }
            }
        }
        if let Some(err) = v
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
        {
            return Ok(format!(r#"{{"ok":false,"error":"{}"}}"#, json_esc(err)));
        }
    }

    Ok(r#"{"ok":false,"error":"unexpected response"}"#.to_string())
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
    fn browser_title_classifier_flags_obvious_entertainment() {
        let result =
            classify_browser_title("“把头抬起来，你可是top1！”_哔哩哔哩bilibili_剪辑 - Google Chrome")
                .expect("bilibili clip title should be classified");

        assert_eq!(result.category, "distracting");
        assert_eq!(result.suggested_action, "intent_required");
        assert!(result.reason.contains("浏览器窗口标题"));
    }

    #[test]
    fn browser_title_classifier_leaves_unclear_titles_to_extension() {
        assert!(classify_browser_title("Focus Guard - Google Chrome").is_none());
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
