use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;

use focus_guard_desktop::{
    capture_screen_thumbnail_base64, classify_context, read_foreground_window, AiContext,
    LocalAiConfig,
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
                id: "local".to_string(),
                name: "本地模型".to_string(),
                base_url: "http://127.0.0.1:8080".to_string(),
                api_key: String::new(),
                models: vec!["Qwen3VL-4B-Instruct-Q4_K_M.gguf".to_string()],
                selected_model: "Qwen3VL-4B-Instruct-Q4_K_M.gguf".to_string(),
                latency_ms: None,
                active: true,
            }],
            active_provider_id: Some("local".to_string()),
        }
    }
}

static PROVIDERS: Mutex<Option<ProviderConfig>> = Mutex::new(None);
static AI_CONFIG: Mutex<Option<AiConfig>> = Mutex::new(None);

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

fn get_ai_config() -> AiConfig {
    let guard = AI_CONFIG.lock().unwrap();
    guard.clone().unwrap_or(AiConfig {
        mode: "local".to_string(),
        endpoint: "http://127.0.0.1:8080".to_string(),
        model: "Qwen3VL-4B-Instruct-Q4_K_M.gguf".to_string(),
        api_key: String::new(),
    })
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

    for stream in listener.incoming() {
        let Ok(mut stream) = stream else {
            continue;
        };
        let mut reader = BufReader::new(stream.try_clone().unwrap());

        let mut request_line = String::new();
        if reader.read_line(&mut request_line).is_err() {
            continue;
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

        let (status, response_body) = match (method, path) {
            ("OPTIONS", _) => {
                let cors = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Max-Age: 86400\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = stream.write_all(cors.as_bytes());
                continue;
            }
            ("GET", "/health") => ("200 OK", r#"{"ok":true}"#.to_string()),

            ("GET", "/providers") => {
                let cfg = load_providers();
                match serde_json::to_string(&cfg) {
                    Ok(json) => ("200 OK", json),
                    Err(_) => ("500 Internal Server Error", r#"{"error":"serialize failed"}"#.to_string()),
                }
            }
            ("POST", "/providers") => {
                let body_str = String::from_utf8_lossy(&body).to_string();
                match handle_add_provider(&body_str) {
                    Ok(json) => ("200 OK", json),
                    Err(e) => ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, json_esc(&e))),
                }
            }
            ("PUT", "/providers") => {
                let body_str = String::from_utf8_lossy(&body).to_string();
                match handle_update_provider(&body_str) {
                    Ok(json) => ("200 OK", json),
                    Err(e) => ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, json_esc(&e))),
                }
            }
            ("DELETE", p) if p.starts_with("/providers/") => {
                let id = p.trim_start_matches("/providers/");
                match handle_delete_provider(id) {
                    Ok(json) => ("200 OK", json),
                    Err(e) => ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, json_esc(&e))),
                }
            }
            ("POST", "/providers/test-all") => {
                match handle_test_all_providers() {
                    Ok(json) => ("200 OK", json),
                    Err(e) => ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, json_esc(&e))),
                }
            }
            ("POST", "/providers/select") => {
                let body_str = String::from_utf8_lossy(&body).to_string();
                match handle_select_provider(&body_str) {
                    Ok(json) => ("200 OK", json),
                    Err(e) => ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, json_esc(&e))),
                }
            }
            ("POST", "/providers/test") => {
                let body_str = String::from_utf8_lossy(&body).to_string();
                match handle_test_single_provider(&body_str) {
                    Ok(json) => ("200 OK", json),
                    Err(e) => ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, json_esc(&e))),
                }
            }
            ("POST", "/parse-config") => {
                let body_str = String::from_utf8_lossy(&body).to_string();
                let text = extract_json_string(&body_str, "text").unwrap_or_default();
                match handle_parse_config(&text) {
                    Ok(json) => ("200 OK", json),
                    Err(e) => ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, json_esc(&e))),
                }
            }
            ("GET", "/config") => {
                let cfg = get_ai_config();
                let json = format!(
                    r#"{{"mode":"{}","endpoint":"{}","model":"{}","hasApiKey":{}}}"#,
                    json_esc(&cfg.mode), json_esc(&cfg.endpoint),
                    json_esc(&cfg.model), !cfg.api_key.is_empty()
                );
                ("200 OK", json)
            }
            ("POST", "/config") => {
                let body_str = String::from_utf8_lossy(&body).to_string();
                let mode = extract_json_string(&body_str, "mode").unwrap_or_else(|| "local".to_string());
                let endpoint = extract_json_string(&body_str, "endpoint").unwrap_or_else(|| "http://127.0.0.1:8080".to_string());
                let model = extract_json_string(&body_str, "model").unwrap_or_default();
                let api_key = extract_json_string(&body_str, "api_key").unwrap_or_default();
                let mut guard = AI_CONFIG.lock().unwrap();
                *guard = Some(AiConfig { mode, endpoint, model, api_key });
                ("200 OK", r#"{"ok":true}"#.to_string())
            }
            ("GET", "/models") | ("POST", "/models") => {
                let cfg = get_ai_config();
                let models_url = format!("{}/v1/models", cfg.endpoint.trim_end_matches('/'));
                let api_key = cfg.api_key.clone();
                match fetch_models(&models_url, &api_key) {
                    Ok(json) => ("200 OK", json),
                    Err(e) => ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, json_esc(&e))),
                }
            }
            ("POST", "/test-model") => {
                let body_str = String::from_utf8_lossy(&body).to_string();
                let model = extract_json_string(&body_str, "model").unwrap_or_default();
                let cfg = get_ai_config();
                match test_model(&cfg, &model) {
                    Ok(json) => ("200 OK", json),
                    Err(e) => ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, json_esc(&e))),
                }
            }
            ("POST", "/detect") => {
                let body_str = String::from_utf8_lossy(&body).to_string();
                if body_str.contains("\"validate_reason\":true") {
                    match handle_validate_reason(&body_str) {
                        Ok(json) => ("200 OK", json),
                        Err(e) => ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, json_esc(&e))),
                    }
                } else {
                    match handle_detect() {
                        Ok(json) => ("200 OK", json),
                        Err(e) => ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, json_esc(&e))),
                    }
                }
            }
            _ => ("404 Not Found", r#"{"error":"not_found"}"#.to_string()),
        };

        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{response_body}",
            response_body.len()
        );
        let _ = stream.write_all(response.as_bytes());
    }
}

fn handle_add_provider(body: &str) -> Result<String, String> {
    let name = extract_json_string(body, "name").unwrap_or_else(|| "未命名".to_string());
    let base_url = extract_json_string(body, "base_url").unwrap_or_default();
    let api_key = extract_json_string(body, "api_key").unwrap_or_default();

    if base_url.is_empty() {
        return Err("base_url is required".to_string());
    }

    let id = format!("p_{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());

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

fn handle_update_provider(body: &str) -> Result<String, String> {
    let id = extract_json_string(body, "id").ok_or("id required")?;
    let mut cfg = load_providers();

    if let Some(p) = cfg.providers.iter_mut().find(|p| p.id == id) {
        if let Some(name) = extract_json_string(body, "name") { p.name = name; }
        if let Some(url) = extract_json_string(body, "base_url") { p.base_url = url; }
        if let Some(key) = extract_json_string(body, "api_key") { p.api_key = key; }
        if let Some(model) = extract_json_string(body, "selected_model") { p.selected_model = model; }
        if let Some(models_str) = extract_json_string(body, "models") {
            p.models = models_str.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
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
        if line.is_empty() || line.starts_with('#') { continue; }

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
        if p == "curl" && i + 1 < args.len() && !args[i + 1].starts_with('-') {
            base_url = args[i + 1].clone();
        }
        if (p == "-H" || p == "--header") && i + 1 < args.len() {
            let header = &args[i + 1];
            let lower = header.to_lowercase();
            if lower.contains("authorization") || lower.contains("bearer") || lower.contains("api-key") {
                let key = header.splitn(2, ':').nth(1).unwrap_or("").trim()
                    .trim_start_matches("Bearer").trim_start_matches("bearer").trim();
                if !key.is_empty() { api_key = key.to_string(); }
            }
        }
        if (p == "-d" || p == "--data" || p == "-d'{") && i + 1 < args.len() {
            let data = &args[i + 1];
            if let Some(idx) = data.find("model") {
                let rest = &data[idx..];
                if let Some(cp) = rest.find(':') {
                    let after = rest[cp + 1..].trim_start();
                    let val = if after.starts_with('"') {
                        after[1..].find('"').map(|e| &after[1..e+1])
                    } else if after.starts_with('\'') {
                        after[1..].find('\'').map(|e| &after[1..e+1])
                    } else {
                        after.split(|c: char| c == ',' || c == '}' || c == ' ').next()
                    };
                    if let Some(v) = val {
                        if !v.is_empty() { model = v.to_string(); }
                    }
                }
            }
        }
        i += 1;
    }
    if base_url.is_empty() { return None; }
    let base = base_url.trim_end_matches('/').trim_end_matches("/v1/chat/completions").trim_end_matches("/v1").trim_end_matches('/');
    Some((base.to_string(), api_key, model))
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
    if !current.is_empty() { result.push(current); }
    result
}
        if (p == "-H" || p == "--header") && i + 1 < parts.len() {
            let header = parts[i + 1].trim_matches('\'').trim_matches('"');
            let lower = header.to_lowercase();
            if lower.contains("authorization") || lower.contains("bearer") || lower.contains("api-key") || lower.contains("x-api-key") {
                let after_colon = header.splitn(2, ':').nth(1).unwrap_or("").trim();
                let key = after_colon
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
        if (p == "-d" || p == "--data") && i + 1 < parts.len() {
            let data = parts[i + 1].trim_matches('\'').trim_matches('"');
            if let Some(idx) = data.find("model") {
                let rest = &data[idx..];
                if let Some(colon_pos) = rest.find(':') {
                    let after = &rest[colon_pos + 1..].trim_start();
                    if after.starts_with('"') {
                        let inner = &after[1..];
                        if let Some(end) = inner.find('"') {
                            model = inner[..end].to_string();
                        }
                    } else if after.starts_with('\'') {
                        let inner = &after[1..];
                        if let Some(end) = inner.find('\'') {
                            model = inner[..end].to_string();
                        }
                    }
                }
            }
        }
        i += 1;
    }
    if base_url.is_empty() { return None; }
    let base = base_url.trim_end_matches('/').trim_end_matches("/v1/chat/completions").trim_end_matches("/v1").trim_end_matches('/');
    Some((base.to_string(), api_key, model))
}

fn extract_toml_value(line: &str) -> Option<String> {
    let parts: Vec<&str> = line.splitn(2, '=').collect();
    if parts.len() < 2 { return None; }
    let val = parts[1].trim().trim_matches('"').trim_matches('\'').trim_matches(',');
    if val.is_empty() || val == "true" || val == "false" || val.starts_with('#') { return None; }
    Some(val.to_string())
}

fn extract_json_value(line: &str) -> Option<String> {
    let parts: Vec<&str> = line.splitn(2, ':').collect();
    if parts.len() < 2 { return None; }
    let val = parts[1].trim().trim_matches('"').trim_matches(',').trim_matches('}');
    if val.is_empty() { return None; }
    Some(val.to_string())
}

fn find_nearby_key(text: &str, _current_line: &str) -> String {
    for line in text.lines() {
        let l = line.trim();
        if l.contains("OPENAI_API_KEY") || l.contains("ANTHROPIC_AUTH_TOKEN") || l.contains("Authorization") {
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
            mode: if p.base_url.contains("127.0.0.1") || p.base_url.contains("localhost") { "local".to_string() } else { "api".to_string() },
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
        let p = cfg.providers.iter().find(|p| p.id == id).ok_or("not found")?;
        (p.base_url.clone(), p.api_key.clone())
    } else {
        let base_url = extract_json_string(body, "base_url").ok_or("base_url or id required")?;
        let api_key = extract_json_string(body, "api_key").unwrap_or_default();
        (base_url, api_key)
    };

    let base = base_url.trim_end_matches('/');
    let models_url = format!("{}/v1/models", base);

    let start = std::time::Instant::now();
    let models_resp = fetch_models(&models_url, &api_key).unwrap_or_default();
    let latency = start.elapsed().as_millis() as u64;

    let models: Vec<String> = serde_json::from_str::<serde_json::Value>(&models_resp)
        .ok()
        .and_then(|v| v.get("data").cloned())
        .and_then(|d| serde_json::from_value::<Vec<serde_json::Value>>(d).ok())
        .map(|list| list.iter().filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from)).collect())
        .unwrap_or_default();

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
        let base = provider.base_url.trim_end_matches('/');
        let models_url = format!("{}/v1/models", base);

        let start = std::time::Instant::now();
        let models_resp = fetch_models(&models_url, &provider.api_key).unwrap_or_default();
        let latency = start.elapsed().as_millis() as u64;

        let models: Vec<String> = serde_json::from_str::<serde_json::Value>(&models_resp)
            .ok()
            .and_then(|v| v.get("data").cloned())
            .and_then(|d| serde_json::from_value::<Vec<serde_json::Value>>(d).ok())
            .map(|list| list.iter().filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from)).collect())
            .unwrap_or_default();

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

    results.sort_by_key(|r| r.get("latency_ms").and_then(|v| v.as_u64()).unwrap_or(u64::MAX));

    if let Some(fastest) = results.first() {
        if let Some(id) = fastest.get("id").and_then(|v| v.as_str()) {
            cfg.active_provider_id = Some(id.to_string());
            if let Some(p) = cfg.providers.iter().find(|p| p.id == id) {
                let mut ai = AI_CONFIG.lock().unwrap();
                *ai = Some(AiConfig {
                    mode: if p.base_url.contains("127.0.0.1") || p.base_url.contains("localhost") { "local".to_string() } else { "api".to_string() },
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
    }).to_string())
}

fn handle_detect() -> Result<String, String> {
    let foreground = read_foreground_window().unwrap_or_else(|| {
        focus_guard_desktop::ForegroundWindow {
            process_id: 0,
            process_name: "unknown".into(),
            window_title: "unknown".into(),
        }
    });

    let screenshot_b64 = capture_screen_thumbnail_base64();

    if let Some(ref b64) = screenshot_b64 {
        if let Ok(data) = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            b64,
        ) {
            let _ = std::fs::write(r"C:\TestDir\last_screenshot.png", &data);
        }
    }

    let context = AiContext {
        process_name: foreground.process_name.clone(),
        window_title: foreground.window_title.clone(),
        screenshot_base64: screenshot_b64.clone(),
    };

    let config = {
        let ai = get_ai_config();
        LocalAiConfig {
            enabled: true,
            endpoint: format!("{}/v1/chat/completions", ai.endpoint.trim_end_matches('/')),
            model: ai.model,
            api_key: ai.api_key,
            ..LocalAiConfig::default()
        }
    };
    let classification = classify_context(&config, &context);

    let screenshot_len = screenshot_b64.as_ref().map(|s| s.len()).unwrap_or(0);

    let result = format!(
        r#"{{"category":"{}","confidence":{},"reason":"{}","suggested_action":"{}","process_name":"{}","window_title":"{}","has_screenshot":{},"screenshot_bytes":{}}}"#,
        json_esc(&classification.category),
        classification.confidence,
        json_esc(&classification.reason),
        json_esc(&classification.suggested_action),
        json_esc(&foreground.process_name),
        json_esc(&foreground.window_title),
        screenshot_b64.is_some(),
        screenshot_len,
    );

    Ok(result)
}

fn handle_validate_reason(body: &str) -> Result<String, String> {
    let reason = extract_json_string(body, "reason").unwrap_or_default();
    let target = extract_json_string(body, "target").unwrap_or_default();

    if reason.is_empty() {
        return Ok(r#"{"approved":false,"message":"请输入理由"}"#.to_string());
    }

    let prompt = format!(
        "You are Focus Guard, a focus assistant. A user was detected procrastinating on {}. They gave this reason: \"{}\"\n\nIs this a legitimate reason to take a break? Reply with ONLY JSON: {{\"approved\": true/false, \"message\": \"brief explanation\"}}\n\nLegitimate reasons: studying on that site, research, looking up information, educational content.\nNot legitimate: bored, just browsing, killing time, no specific purpose.",
        json_esc(&target), json_esc(&reason)
    );

    let config = get_ai_config();
    let ai_config = LocalAiConfig {
        enabled: true,
        endpoint: format!("{}/v1/chat/completions", config.endpoint.trim_end_matches('/')),
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
    match focus_guard_desktop::classify_context_from_llm_response_raw(&request_json) {
        Ok(response) => {
            let approved = response.contains("\"approved\":true") || response.contains("\"approved\": true");
            let message = extract_json_string(&response, "message").unwrap_or_else(|| {
                if approved { "理由通过".to_string() } else { "理由不合理".to_string() }
            });
            Ok(format!(r#"{{"approved":{},"message":"{}"}}"#, approved, json_esc(&message)))
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
    let body = resp.text().map_err(|e| e.to_string())?;
    Ok(body)
}

fn test_model(config: &AiConfig, model: &str) -> Result<String, String> {
    let base = config.endpoint.trim_end_matches('/');
    let url = format!("{}/v1/chat/completions", base);

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "Say hi in 5 words"}],
        "max_tokens": 20,
        "temperature": 0.1,
    });

    let mut req = client.post(&url).json(&body);
    if !config.api_key.is_empty() {
        req = req.bearer_auth(&config.api_key);
    }

    let resp = req.send().map_err(|e| format!("request failed: {}", e))?;
    let text = resp.text().map_err(|e| e.to_string())?;

    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(content) = v.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("message")).and_then(|m| m.get("content")).and_then(|c| c.as_str()) {
            return Ok(format!(r#"{{"ok":true,"response":"{}","model":"{}"}}"#, json_esc(content), json_esc(model)));
        }
        if let Some(err) = v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
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
