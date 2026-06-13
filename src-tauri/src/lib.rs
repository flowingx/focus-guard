use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub mod screenshot;
pub mod ai_analyzer;
pub mod focus_monitor;
pub mod reminder;

#[derive(Clone, Debug, PartialEq)]
pub struct AppMonitorConfig {
    pub monitored_apps: Vec<String>,
    pub allowlisted_apps: Vec<String>,
    pub allowlisted_domains: Vec<String>,
    pub default_minutes: u32,
    pub local_ai: LocalAiConfig,
}

impl Default for AppMonitorConfig {
    fn default() -> Self {
        Self {
            monitored_apps: vec![
                "WeChat.exe".to_string(),
                "QQ.exe".to_string(),
                "Doubao.exe".to_string(),
                "doubao.exe".to_string(),
            ],
            allowlisted_apps: vec!["Code.exe".to_string(), "devenv.exe".to_string()],
            allowlisted_domains: vec!["*.edu".to_string(), "*.edu.cn".to_string()],
            default_minutes: 20,
            local_ai: LocalAiConfig::default(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAiConfig {
    pub enabled: bool,
    pub endpoint: String,
    pub model: String,
    pub sample_interval_seconds: u32,
    pub confidence_threshold: f32,
    pub consecutive_hits_required: u32,
    pub cooldown_minutes: u32,
}

impl Default for LocalAiConfig {
    fn default() -> Self {
        let endpoint = std::env::var("FG_AI_ENDPOINT")
            .unwrap_or_else(|_| "http://127.0.0.1:8080/v1/chat/completions".to_string());
        let model = std::env::var("FG_AI_MODEL")
            .unwrap_or_else(|_| "Qwen3VL-4B-Instruct-Q4_K_M.gguf".to_string());
        Self {
            enabled: true,
            endpoint,
            model,
            sample_interval_seconds: 30,
            confidence_threshold: 0.75,
            consecutive_hits_required: 2,
            cooldown_minutes: 10,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct AppPolicyState {
    pub config: AppMonitorConfig,
    pub sessions: Vec<AppSession>,
    pub activity_log: Vec<ActivityRecord>,
    pub ai_targets: Vec<AiTargetState>,
}

impl AppPolicyState {
    pub fn new(config: AppMonitorConfig) -> Self {
        Self {
            config,
            sessions: Vec::new(),
            activity_log: Vec::new(),
            ai_targets: Vec::new(),
        }
    }

    pub fn record_activity(
        &mut self,
        timestamp_ms: u64,
        target: &str,
        reason: &str,
        granted_minutes: u32,
        outcome: &str,
    ) {
        self.activity_log.push(ActivityRecord {
            timestamp_ms,
            target: target.to_string(),
            reason: reason.to_string(),
            granted_minutes,
            outcome: outcome.to_string(),
        });
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct AiContext {
    pub process_name: String,
    pub window_title: String,
    pub screenshot_base64: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AiClassification {
    pub category: String,
    pub confidence: f32,
    pub reason: String,
    pub suggested_action: String,
}

impl AiClassification {
    pub fn unknown(reason: &str) -> Self {
        Self {
            category: "unknown".to_string(),
            confidence: 0.0,
            reason: reason.to_string(),
            suggested_action: "none".to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AiTargetState {
    pub target: String,
    pub consecutive_distracting_hits: u32,
    pub cooldown_until_ms: u64,
    pub last_seen_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppEvent {
    pub process_name: String,
    pub window_title: String,
    pub now_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppSession {
    pub target: String,
    pub reason: String,
    pub started_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActivityRecord {
    pub timestamp_ms: u64,
    pub target: String,
    pub reason: String,
    pub granted_minutes: u32,
    pub outcome: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    IntentRequired { target: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ForegroundWindow {
    pub process_id: u32,
    pub process_name: String,
    pub window_title: String,
}

pub fn evaluate_app_focus(state: &AppPolicyState, event: AppEvent) -> Decision {
    let target = format!("app:{}", event.process_name);

    if state
        .sessions
        .iter()
        .any(|session| session.target == target && session.expires_at_ms > event.now_ms)
    {
        return Decision::Allow;
    }

    if state
        .config
        .monitored_apps
        .iter()
        .any(|process_name| process_name == &event.process_name)
    {
        return Decision::IntentRequired { target };
    }

    Decision::Allow
}

pub fn apply_ai_policy(
    state: &mut AppPolicyState,
    target: &str,
    now_ms: u64,
    classification: &AiClassification,
) -> Decision {
    if !state.config.local_ai.enabled || is_target_allowlisted(&state.config, target) {
        return Decision::Allow;
    }

    let required_hits = state.config.local_ai.consecutive_hits_required.max(1);
    let threshold = state.config.local_ai.confidence_threshold;
    let cooldown_ms = state.config.local_ai.cooldown_minutes as u64 * 60_000;
    let target_state = ai_target_state_mut(&mut state.ai_targets, target);

    if target_state.cooldown_until_ms > now_ms {
        return Decision::Allow;
    }

    target_state.last_seen_ms = now_ms;

    if classification.category != "distracting" || classification.confidence < threshold {
        target_state.consecutive_distracting_hits = 0;
        return Decision::Allow;
    }

    target_state.consecutive_distracting_hits += 1;

    if target_state.consecutive_distracting_hits < required_hits {
        return Decision::Allow;
    }

    target_state.consecutive_distracting_hits = 0;
    target_state.cooldown_until_ms = now_ms + cooldown_ms;

    Decision::IntentRequired {
        target: target.to_string(),
    }
}

pub fn capture_context() -> Option<AiContext> {
    let foreground = read_foreground_window()?;

    Some(AiContext {
        process_name: foreground.process_name,
        window_title: foreground.window_title,
        screenshot_base64: capture_screen_thumbnail_base64(),
    })
}

pub fn classify_context(config: &LocalAiConfig, context: &AiContext) -> AiClassification {
    if !config.enabled {
        return AiClassification::unknown("local_ai_disabled");
    }

    let debug_msg = format!("[DEBUG] endpoint={} model={}\n", config.endpoint, config.model);
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(r"C:\TestDir\debug.log")
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(debug_msg.as_bytes())
        });

    match post_json(&config.endpoint, &local_ai_request_json(config, context)) {
        Ok(response) => {
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(r"C:\TestDir\debug.log")
                .and_then(|mut f| {
                    use std::io::Write;
                    f.write_all(format!("[DEBUG] response_len={}\n", response.len()).as_bytes())
                });
            classify_context_from_llm_response(&response)
        }
        Err(e) => {
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(r"C:\TestDir\debug.log")
                .and_then(|mut f| {
                    use std::io::Write;
                    f.write_all(format!("[DEBUG] error={}\n", e).as_bytes())
                });
            AiClassification::unknown("local_ai_unavailable")
        }
    }
}

pub fn local_ai_request_json(config: &LocalAiConfig, context: &AiContext) -> String {
    let title = if context.window_title.len() > 200 {
        &context.window_title[..200]
    } else {
        &context.window_title
    };
    let user_content = format!(
        "Process: {}. Window title: {}.",
        context.process_name, title
    );
    let system_msg = "/no_think\nYou are Focus Guard, a local-only desktop activity classifier. Classify the current Windows foreground context. Return JSON only with fields category, confidence, reason. Allowed category values: study, work, entertainment, distracting, unknown. Use distracting only when the user is likely killing time. Never include markdown or prose.";

    let content_array = if let Some(image) = &context.screenshot_base64 {
        format!(
            "[{{\"type\":\"text\",\"text\":\"{}\"}},{{\"type\":\"image_url\",\"image_url\":{{\"url\":\"data:image/png;base64,{}\"}}}}]",
            json_escape(&user_content),
            json_escape(image)
        )
    } else {
        format!("[{{\"type\":\"text\",\"text\":\"{}\"}}]", json_escape(&user_content))
    };

    format!(
        "{{\"model\":\"{}\",\"messages\":[{{\"role\":\"system\",\"content\":\"{}\"}},{{\"role\":\"user\",\"content\":{}}}],\"max_tokens\":300,\"temperature\":0.1}}",
        json_escape(&config.model),
        json_escape(system_msg),
        content_array
    )
}

pub fn classify_context_from_llm_response(response_json: &str) -> AiClassification {
    let model_text = match serde_json::from_str::<serde_json::Value>(response_json) {
        Ok(v) => {
            if let Some(content) = v
                .get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
            {
                content.to_string()
            } else if let Some(response) = v.get("response").and_then(|r| r.as_str()) {
                response.to_string()
            } else if let Some(reasoning) = v.get("reasoning_content").and_then(|r| r.as_str()) {
                reasoning.to_string()
            } else {
                response_json.trim().to_string()
            }
        }
        Err(_) => response_json.trim().to_string(),
    };
    parse_ai_classification(&model_text)
}

#[cfg(windows)]
pub fn read_foreground_window() -> Option<ForegroundWindow> {
    windows_foreground_window()
}

#[cfg(not(windows))]
pub fn read_foreground_window() -> Option<ForegroundWindow> {
    None
}

pub fn encode_native_message(json: &str) -> Vec<u8> {
    let bytes = json.as_bytes();
    let mut encoded = Vec::with_capacity(4 + bytes.len());
    encoded.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    encoded.extend_from_slice(bytes);
    encoded
}

pub fn decode_native_message(data: &[u8]) -> io::Result<String> {
    if data.len() < 4 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "message too short"));
    }
    let len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    if data.len() < 4 + len {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "message truncated"));
    }
    String::from_utf8(data[4..4 + len].to_vec())
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

pub fn handle_native_json(state: &mut AppPolicyState, json: &str, now_ms: u64) -> String {
    let message_type = json_string_field(json, "type");

    match message_type.as_deref() {
        Some("intent_submitted") => {
            let target = json_string_field(json, "target").unwrap_or_default();
            let reason = json_string_field(json, "reason").unwrap_or_default();
            let minutes = json_u32_field(json, "minutes").unwrap_or(state.config.default_minutes);

            state.sessions.push(AppSession {
                target: target.clone(),
                reason: reason.clone(),
                started_at_ms: now_ms,
                expires_at_ms: now_ms + minutes as u64 * 60_000,
            });
            state.record_activity(now_ms, &target, &reason, minutes, "started");

            "{\"ok\":true}".to_string()
        }
        Some("session_expired") => {
            let target = json_string_field(json, "target").unwrap_or_default();
            let reason = json_string_field(json, "reason").unwrap_or_default();
            state.record_activity(now_ms, &target, &reason, 0, "expired");

            "{\"ok\":true}".to_string()
        }
        _ => "{\"ok\":false,\"error\":\"unsupported_message\"}".to_string(),
    }
}

pub fn export_activity_csv(state: &AppPolicyState) -> String {
    let mut csv = String::from("timestamp_ms,target,reason,granted_minutes,outcome\n");

    for record in &state.activity_log {
        csv.push_str(&format!(
            "{},{},{},{},{}\n",
            record.timestamp_ms,
            csv_escape(&record.target),
            csv_escape(&record.reason),
            record.granted_minutes,
            csv_escape(&record.outcome)
        ));
    }

    csv
}

pub fn export_activity_json(state: &AppPolicyState) -> String {
    let records = state
        .activity_log
        .iter()
        .map(|record| {
            format!(
                "{{\"timestamp_ms\":{},\"target\":\"{}\",\"reason\":\"{}\",\"granted_minutes\":{},\"outcome\":\"{}\"}}",
                record.timestamp_ms,
                json_escape(&record.target),
                json_escape(&record.reason),
                record.granted_minutes,
                json_escape(&record.outcome)
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    format!("[{}]", records)
}

pub fn append_activity_jsonl(path: &Path, state: &AppPolicyState) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;

    if let Some(record) = state.activity_log.last() {
        writeln!(file, "{}", activity_record_json(record))?;
    }

    Ok(())
}

pub fn default_activity_log_path() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("FocusGuard")
        .join("activity.jsonl")
}

pub fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

pub fn json_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn activity_record_json(record: &ActivityRecord) -> String {
    format!(
        "{{\"timestamp_ms\":{},\"target\":\"{}\",\"reason\":\"{}\",\"granted_minutes\":{},\"outcome\":\"{}\"}}",
        record.timestamp_ms,
        json_escape(&record.target),
        json_escape(&record.reason),
        record.granted_minutes,
        json_escape(&record.outcome)
    )
}

pub fn is_target_allowlisted(config: &AppMonitorConfig, target: &str) -> bool {
    if let Some(process_name) = target.strip_prefix("app:") {
        return config
            .allowlisted_apps
            .iter()
            .any(|item| item.eq_ignore_ascii_case(process_name));
    }

    if let Some(domain) = target.strip_prefix("site:") {
        return config
            .allowlisted_domains
            .iter()
            .any(|rule| matches_host_rule(domain, rule));
    }

    false
}

fn ai_target_state_mut<'a>(states: &'a mut Vec<AiTargetState>, target: &str) -> &'a mut AiTargetState {
    if let Some(index) = states.iter().position(|state| state.target == target) {
        return &mut states[index];
    }

    states.push(AiTargetState {
        target: target.to_string(),
        consecutive_distracting_hits: 0,
        cooldown_until_ms: 0,
        last_seen_ms: 0,
    });

    states.last_mut().expect("ai target state was just inserted")
}

fn parse_ai_classification(json: &str) -> AiClassification {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else {
        return AiClassification::unknown("invalid_model_json");
    };

    let Some(category) = v.get("category").and_then(|c| c.as_str()).map(String::from) else {
        return AiClassification::unknown("invalid_model_json");
    };

    if !matches!(
        category.as_str(),
        "study" | "work" | "entertainment" | "distracting" | "unknown"
    ) {
        return AiClassification::unknown("invalid_model_category");
    }

    AiClassification {
        category,
        confidence: v.get("confidence").and_then(|c| c.as_f64()).unwrap_or(0.0) as f32,
        reason: v.get("reason").and_then(|r| r.as_str()).unwrap_or_default().to_string(),
        suggested_action: v.get("suggested_action")
            .and_then(|a| a.as_str())
            .unwrap_or("none")
            .to_string(),
    }
}

pub fn json_string_field(json: &str, field: &str) -> Option<String> {
    let key = format!("\"{}\":\"", field);
    let start = json.find(&key)? + key.len();
    let rest = &json[start..];
    read_json_string(rest)
}

pub fn json_u32_field(json: &str, field: &str) -> Option<u32> {
    let key = format!("\"{}\":", field);
    let start = json.find(&key)? + key.len();
    let rest = &json[start..];
    let digits = rest
        .chars()
        .take_while(|char| char.is_ascii_digit())
        .collect::<String>();

    digits.parse().ok()
}

pub fn json_u64_field(json: &str, field: &str) -> Option<u64> {
    let key = format!("\"{}\":", field);
    let start = json.find(&key)? + key.len();
    let rest = &json[start..];
    let digits = rest
        .chars()
        .take_while(|char| char.is_ascii_digit())
        .collect::<String>();

    digits.parse().ok()
}


fn read_json_string(value: &str) -> Option<String> {
    let mut result = String::new();
    let mut chars = value.chars();

    while let Some(char) = chars.next() {
        match char {
            '"' => return Some(result),
            '\\' => match chars.next()? {
                '"' => result.push('"'),
                '\\' => result.push('\\'),
                '/' => result.push('/'),
                'n' => result.push('\n'),
                'r' => result.push('\r'),
                't' => result.push('\t'),
                other => result.push(other),
            },
            other => result.push(other),
        }
    }

    None
}

pub fn matches_host_rule(host: &str, rule: &str) -> bool {
    let host = strip_www(&host.to_lowercase());
    let clean_rule = strip_www(&rule.to_lowercase());

    if clean_rule.is_empty() {
        return false;
    }

    if let Some(exact) = clean_rule.strip_prefix('=') {
        return host == exact;
    }

    if clean_rule.starts_with("*.") && !clean_rule.ends_with(".*") {
        let suffix = &clean_rule[2..];
        return host.ends_with(&format!(".{}", suffix));
    }

    if clean_rule.starts_with("*.") && clean_rule.ends_with(".*") {
        let token = &clean_rule[2..clean_rule.len() - 2];
        return host.split('.').any(|part| part == token);
    }

    if !clean_rule.contains('.') {
        return host.split('.').any(|part| part == clean_rule);
    }

    host == clean_rule || host.ends_with(&format!(".{}", clean_rule))
}

pub fn strip_www(host: &str) -> String {
    host.strip_prefix("www.").unwrap_or(host).trim().to_string()
}

fn post_json(endpoint: &str, body: &str) -> io::Result<String> {
    let (host, port, path) = parse_http_endpoint(endpoint)?;
    let mut stream = TcpStream::connect((host.as_str(), port))?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    stream.set_write_timeout(Some(Duration::from_secs(10)))?;

    let request = format!(
        "POST {} HTTP/1.1\r\nHost: {}:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        path,
        host,
        port,
        body.as_bytes().len(),
        body
    );
    stream.write_all(request.as_bytes())?;

    let mut response = String::new();
    stream.read_to_string(&mut response)?;

    let header_end = response.find("\r\n\r\n").unwrap_or(response.len());
    let status_line = response.lines().next().unwrap_or("");

    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);

    if status_code != 200 {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("HTTP {}: {}", status_line, status_code),
        ));
    }

    Ok(response[header_end..].trim().to_string())
}

pub fn parse_http_endpoint(endpoint: &str) -> io::Result<(String, u16, String)> {
    let without_scheme = endpoint.strip_prefix("http://").ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "only http endpoints are supported")
    })?;
    let (host_port, path) = without_scheme
        .split_once('/')
        .map(|(host_port, path)| (host_port, format!("/{}", path)))
        .unwrap_or((without_scheme, "/".to_string()));
    let (host, port) = host_port
        .split_once(':')
        .map(|(host, port)| (host.to_string(), port.parse().unwrap_or(80)))
        .unwrap_or((host_port.to_string(), 80));

    let host_lower = host.to_lowercase();
    if host_lower != "127.0.0.1" && host_lower != "localhost" {
        // Allow other hosts for cross-environment access (e.g. WSL to Windows)
    }

    Ok((host, port, path))
}

#[cfg(windows)]
pub fn capture_screen_thumbnail_base64() -> Option<String> {
    use crate::screenshot::ScreenshotCapture;
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;
    
    let capture = ScreenshotCapture::default();
    match capture.capture_current_window() {
        Ok(image_data) => Some(STANDARD.encode(&image_data)),
        Err(e) => {
            eprintln!("截图失败: {}", e);
            None
        }
    }
}

#[cfg(not(windows))]
pub fn capture_screen_thumbnail_base64() -> Option<String> {
    None
}

#[cfg(windows)]
fn windows_foreground_window() -> Option<ForegroundWindow> {
    use std::ffi::c_void;

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetForegroundWindow() -> isize;
        fn GetWindowTextW(hwnd: isize, lp_string: *mut u16, n_max_count: i32) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, process_id: *mut u32) -> u32;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
        fn QueryFullProcessImageNameW(
            process: *mut c_void,
            flags: u32,
            exe_name: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    unsafe {
        let hwnd = GetForegroundWindow();

        if hwnd == 0 {
            return None;
        }

        let mut process_id = 0_u32;
        GetWindowThreadProcessId(hwnd, &mut process_id);

        if process_id == 0 {
            return None;
        }

        let mut title_buffer = vec![0_u16; 512];
        let title_len = GetWindowTextW(hwnd, title_buffer.as_mut_ptr(), title_buffer.len() as i32);
        let window_title = if title_len > 0 {
            String::from_utf16_lossy(&title_buffer[..title_len as usize])
        } else {
            String::new()
        };

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);

        if process.is_null() {
            return Some(ForegroundWindow {
                process_id,
                process_name: String::new(),
                window_title,
            });
        }

        let mut path_buffer = vec![0_u16; 1024];
        let mut path_len = path_buffer.len() as u32;
        let process_name =
            if QueryFullProcessImageNameW(process, 0, path_buffer.as_mut_ptr(), &mut path_len) != 0
            {
                let full_path = String::from_utf16_lossy(&path_buffer[..path_len as usize]);
                full_path
                    .rsplit('\\')
                    .next()
                    .unwrap_or(&full_path)
                    .to_string()
            } else {
                String::new()
            };

        CloseHandle(process);

        Some(ForegroundWindow {
            process_id,
            process_name,
            window_title,
        })
    }
}
