use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;

use focus_guard_desktop::{
    capture_screen_thumbnail_base64, classify_context, read_foreground_window, AiContext,
    LocalAiConfig,
};

fn main() {
    let port = std::env::var("FG_SERVER_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);

    let listener = TcpListener::bind(format!("127.0.0.1:{port}")).unwrap();
    eprintln!("Focus Guard server listening on http://127.0.0.1:{port}");

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

        let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
        let method = parts.first().copied().unwrap_or("");
        let path = parts.get(1).copied().unwrap_or("/");

        let (status, response_body) = match (method, path) {
            ("GET", "/health") => {
                let fg = read_foreground_window();
                let body_json = format!(
                    r#"{{"ok":true,"foreground_window":{}}}"#,
                    match fg {
                        Some(w) => format!(
                            r#"{{"process_name":"{}","window_title":"{}"}}"#,
                            json_esc(&w.process_name),
                            json_esc(&w.window_title)
                        ),
                        None => "null".to_string(),
                    }
                );
                ("200 OK", body_json)
            }
            ("POST", "/detect") => match handle_detect() {
                Ok(json) => ("200 OK", json),
                Err(e) => {
                    let err_json = format!(r#"{{"error":"{}"}}"#, json_esc(&e));
                    ("500 Internal Server Error", err_json)
                }
            },
            _ => ("404 Not Found", r#"{"error":"not_found"}"#.to_string()),
        };

        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{response_body}",
            response_body.len()
        );
        let _ = stream.write_all(response.as_bytes());
    }
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

    let context = AiContext {
        process_name: foreground.process_name.clone(),
        window_title: foreground.window_title.clone(),
        screenshot_base64: screenshot_b64.clone(),
    };

    let config = LocalAiConfig::default();
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

fn json_esc(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}
