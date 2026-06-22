use focus_guard_desktop::{
    append_activity_jsonl, apply_ai_policy, classify_context_from_llm_response, csv_escape,
    decode_native_message, encode_native_message, evaluate_app_focus, export_activity_csv,
    handle_native_json, is_target_allowlisted, json_escape, local_ai_request_json,
    matches_host_rule, parse_http_endpoint, read_foreground_window, read_visible_windows, strip_www,
    AiClassification, AiContext, AppEvent, AppMonitorConfig, AppPolicyState, Decision,
    LocalAiConfig,
};

#[test]
fn monitored_apps_require_intent_before_access() {
    let state = AppPolicyState::new(AppMonitorConfig::default());
    let decision = evaluate_app_focus(
        &state,
        AppEvent {
            process_name: "WeChat.exe".to_string(),
            window_title: "微信".to_string(),
            now_ms: 1_000,
        },
    );

    assert_eq!(
        decision,
        Decision::IntentRequired {
            target: "app:WeChat.exe".to_string()
        }
    );
}

#[test]
fn unmonitored_apps_are_allowed() {
    let state = AppPolicyState::new(AppMonitorConfig::default());
    let decision = evaluate_app_focus(
        &state,
        AppEvent {
            process_name: "Code.exe".to_string(),
            window_title: "Focus Guard".to_string(),
            now_ms: 1_000,
        },
    );

    assert_eq!(decision, Decision::Allow);
}

#[test]
fn native_messages_are_encoded_with_a_little_endian_length_prefix() {
    let encoded = encode_native_message(r#"{"type":"intent_submitted"}"#);

    assert_eq!(&encoded[0..4], &(27_u32).to_le_bytes());
    assert_eq!(
        String::from_utf8(encoded[4..].to_vec()).unwrap(),
        r#"{"type":"intent_submitted"}"#
    );
}

#[test]
fn activity_can_be_exported_as_csv() {
    let mut state = AppPolicyState::new(AppMonitorConfig::default());
    state.record_activity(2_000, "app:Doubao.exe", "问编译原理概念", 20, "expired");

    let csv = export_activity_csv(&state);

    assert!(csv.contains("timestamp_ms,target,reason,granted_minutes,outcome"));
    assert!(csv.contains("2000,app:Doubao.exe,问编译原理概念,20,expired"));
}

#[test]
fn foreground_window_snapshot_is_safe_to_call() {
    let _ = read_foreground_window();
}

#[test]
fn visible_window_snapshot_is_safe_to_call() {
    let _ = read_visible_windows();
}

#[test]
fn native_intent_messages_are_recorded_in_activity_log() {
    let mut state = AppPolicyState::new(AppMonitorConfig::default());
    let response = handle_native_json(
        &mut state,
        r#"{"type":"intent_submitted","target":"site:zhihu.com","reason":"查课程资料","minutes":20}"#,
        3_000,
    );

    assert_eq!(response, r#"{"ok":true}"#);
    assert_eq!(state.activity_log.len(), 1);
    assert_eq!(state.activity_log[0].target, "site:zhihu.com");
    assert_eq!(state.activity_log[0].reason, "查课程资料");
    assert_eq!(state.activity_log[0].granted_minutes, 20);
}

#[test]
fn activity_records_can_be_appended_to_jsonl() {
    let mut state = AppPolicyState::new(AppMonitorConfig::default());
    state.record_activity(4_000, "site:bilibili.com", "看高数讲解", 25, "started");

    let path = std::env::temp_dir().join(format!(
        "focus_guard_activity_test_{}.jsonl",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);

    append_activity_jsonl(&path, &state).unwrap();

    let content = std::fs::read_to_string(&path).unwrap();
    assert!(content.contains(r#""target":"site:bilibili.com""#));
    assert!(content.contains(r#""reason":"看高数讲解""#));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn local_ai_is_disabled_by_default() {
    let config = LocalAiConfig::default();

    assert_eq!(config.enabled, true);
    assert_eq!(config.endpoint, "https://ark.cn-beijing.volces.com/api/v3");
    assert_eq!(config.model, "ep-20260617210329-lsz4k");
    assert_eq!(config.sample_interval_seconds, 30);
    assert_eq!(config.confidence_threshold, 0.75);
}

#[test]
fn ai_policy_requires_two_consecutive_distracting_hits() {
    let mut state = AppPolicyState::new(AppMonitorConfig::default());
    state.config.local_ai.enabled = true;
    let classification = AiClassification {
        category: "distracting".to_string(),
        confidence: 0.9,
        reason: "short video feed".to_string(),
        suggested_action: "intent_required".to_string(),
        ..AiClassification::unknown("")
    };

    let first = apply_ai_policy(&mut state, "app:Chrome.exe", 1_000, &classification);
    let second = apply_ai_policy(&mut state, "app:Chrome.exe", 31_000, &classification);

    assert_eq!(first, Decision::Allow);
    assert_eq!(
        second,
        Decision::IntentRequired {
            target: "app:Chrome.exe".to_string()
        }
    );
}

#[test]
fn ai_policy_ignores_allowlisted_targets_even_when_model_flags_them() {
    let mut state = AppPolicyState::new(AppMonitorConfig::default());
    state.config.local_ai.enabled = true;
    state.config.allowlisted_apps.push("Code.exe".to_string());
    let classification = AiClassification {
        category: "distracting".to_string(),
        confidence: 0.99,
        reason: "video visible".to_string(),
        suggested_action: "intent_required".to_string(),
        ..AiClassification::unknown("")
    };

    assert_eq!(
        apply_ai_policy(&mut state, "app:Code.exe", 1_000, &classification),
        Decision::Allow
    );
    assert_eq!(
        apply_ai_policy(&mut state, "app:Code.exe", 31_000, &classification),
        Decision::Allow
    );
}

#[test]
fn ai_policy_ignores_low_confidence_and_unknown_categories() {
    let mut state = AppPolicyState::new(AppMonitorConfig::default());
    state.config.local_ai.enabled = true;

    let low_confidence = AiClassification {
        category: "distracting".to_string(),
        confidence: 0.5,
        reason: "maybe entertainment".to_string(),
        suggested_action: "none".to_string(),
        ..AiClassification::unknown("")
    };
    let unknown = AiClassification {
        category: "unknown".to_string(),
        confidence: 0.95,
        reason: "not enough context".to_string(),
        suggested_action: "none".to_string(),
        ..AiClassification::unknown("")
    };

    assert_eq!(
        apply_ai_policy(&mut state, "app:Chrome.exe", 1_000, &low_confidence),
        Decision::Allow
    );
    assert_eq!(
        apply_ai_policy(&mut state, "app:Chrome.exe", 31_000, &unknown),
        Decision::Allow
    );
}

#[test]
fn ai_policy_enters_cooldown_after_triggering() {
    let mut state = AppPolicyState::new(AppMonitorConfig::default());
    state.config.local_ai.enabled = true;
    let classification = AiClassification {
        category: "distracting".to_string(),
        confidence: 0.9,
        reason: "feed browsing".to_string(),
        suggested_action: "intent_required".to_string(),
        ..AiClassification::unknown("")
    };

    let _ = apply_ai_policy(&mut state, "app:Chrome.exe", 1_000, &classification);
    assert_eq!(
        apply_ai_policy(&mut state, "app:Chrome.exe", 31_000, &classification),
        Decision::IntentRequired {
            target: "app:Chrome.exe".to_string()
        }
    );
    assert_eq!(
        apply_ai_policy(&mut state, "app:Chrome.exe", 61_000, &classification),
        Decision::Allow
    );
}

#[test]
fn llm_response_parser_accepts_structured_json_only() {
    let response = r#"{"category":"distracting","confidence":0.82,"reason":"Bilibili feed","suggested_action":"intent_required","semantic_category":"B站娱乐视频","privacy_risk":"low"}"#;
    let parsed = classify_context_from_llm_response(response);

    assert_eq!(parsed.category, "distracting");
    assert_eq!(parsed.confidence, 0.82);
    assert_eq!(parsed.reason, "Bilibili feed");
    assert_eq!(parsed.suggested_action, "intent_required");
    assert_eq!(parsed.semantic_category.as_deref(), Some("B站娱乐视频"));
    assert_eq!(parsed.privacy_risk.as_deref(), Some("low"));
}

#[test]
fn llm_response_parser_normalizes_entertainment_to_distracting() {
    let response = r#"{"category":"entertainment","confidence":0.99,"reason":"B站游戏直播","suggested_action":"intent_required","semantic_category":"B站娱乐视频","privacy_risk":"low"}"#;
    let parsed = classify_context_from_llm_response(response);

    assert_eq!(parsed.category, "distracting");
    assert_eq!(parsed.confidence, 0.99);
    assert_eq!(parsed.suggested_action, "intent_required");
    assert_eq!(parsed.semantic_category.as_deref(), Some("B站娱乐视频"));
}

#[test]
fn llm_response_parser_treats_invalid_output_as_unknown() {
    let parsed = classify_context_from_llm_response(r#"looks distracting"#);

    assert_eq!(parsed.category, "unknown");
    assert_eq!(parsed.confidence, 0.0);
    assert_eq!(parsed.suggested_action, "none");
}

#[test]
fn local_ai_request_includes_context_and_model() {
    let config = LocalAiConfig::default();
    let context = AiContext {
        process_name: "chrome.exe".to_string(),
        window_title: "Bilibili - Chrome".to_string(),
        screenshot_base64: Some("abc123".to_string()),
        browser_domain: Some("bilibili.com".to_string()),
        browser_title: Some("study_title".to_string()),
        safe_signals: vec!["bilibili".to_string(), "study_signal".to_string()],
    };

    let request = local_ai_request_json(&config, &context);

    assert!(request.contains(r#""model":"ep-20260617210329-lsz4k""#));
    assert!(request.contains(r#""input""#));
    assert!(request.contains("chrome.exe"));
    assert!(request.contains("Bilibili - Chrome"));
    assert!(request.contains("data:image/png;base64,abc123"));
    assert!(request.contains("reason value in Simplified Chinese"));
    assert!(request.contains("中文原因"));
    assert!(request.contains("semantic_category"));
    assert!(request.contains("Do not quote private messages"));
}

#[test]
fn json_escape_handles_backslash() {
    assert_eq!(json_escape("a\\b"), "a\\\\b");
}

#[test]
fn json_escape_handles_double_quote() {
    assert_eq!(json_escape("a\"b"), "a\\\"b");
}

#[test]
fn json_escape_handles_newline() {
    assert_eq!(json_escape("a\nb"), "a\\nb");
}

#[test]
fn json_escape_handles_carriage_return() {
    assert_eq!(json_escape("a\rb"), "a\\rb");
}

#[test]
fn json_escape_handles_tab() {
    assert_eq!(json_escape("a\tb"), "a\\tb");
}

#[test]
fn json_escape_handles_all_control_characters_together() {
    assert_eq!(json_escape("\\\"\n\r\t"), "\\\\\\\"\\n\\r\\t");
}

#[test]
fn json_escape_unchanged_when_no_special_chars() {
    assert_eq!(json_escape("hello world"), "hello world");
    assert_eq!(json_escape(""), "");
}

#[test]
fn csv_escape_handles_comma() {
    assert_eq!(csv_escape("a,b"), "\"a,b\"");
}

#[test]
fn csv_escape_handles_double_quote() {
    assert_eq!(csv_escape("a\"b"), "\"a\"\"b\"");
}

#[test]
fn csv_escape_handles_newline() {
    assert_eq!(csv_escape("a\nb"), "\"a\nb\"");
}

#[test]
fn csv_escape_handles_carriage_return() {
    assert_eq!(csv_escape("a\rb"), "\"a\rb\"");
}

#[test]
fn csv_escape_handles_multiple_special_chars() {
    assert_eq!(csv_escape("a,b\"c\nd"), "\"a,b\"\"c\nd\"");
}

#[test]
fn csv_escape_unchanged_when_no_special_chars() {
    assert_eq!(csv_escape("hello"), "hello");
    assert_eq!(csv_escape(""), "");
}

#[test]
fn classify_context_from_llm_response_study_category() {
    let response = r#"{"category":"study","confidence":0.9,"reason":"reading textbook","suggested_action":"none"}"#;
    let parsed = classify_context_from_llm_response(response);

    assert_eq!(parsed.category, "study");
    assert_eq!(parsed.confidence, 0.9);
    assert_eq!(parsed.reason, "reading textbook");
    assert_eq!(parsed.suggested_action, "none");
}

#[test]
fn classify_context_from_llm_response_distraction_category() {
    let response = r#"{"category":"distracting","confidence":0.85,"reason":"social media feed","suggested_action":"intent_required"}"#;
    let parsed = classify_context_from_llm_response(response);

    assert_eq!(parsed.category, "distracting");
    assert_eq!(parsed.confidence, 0.85);
    assert_eq!(parsed.reason, "social media feed");
    assert_eq!(parsed.suggested_action, "intent_required");
}

#[test]
fn classify_context_from_llm_response_unknown_category() {
    let response = r#"{"category":"unknown","confidence":0.3,"reason":"unclear context","suggested_action":"none"}"#;
    let parsed = classify_context_from_llm_response(response);

    assert_eq!(parsed.category, "unknown");
    assert_eq!(parsed.confidence, 0.3);
}

#[test]
fn classify_context_from_llm_response_work_category() {
    let response = r#"{"category":"work","confidence":0.7,"reason":"coding in IDE","suggested_action":"none"}"#;
    let parsed = classify_context_from_llm_response(response);

    assert_eq!(parsed.category, "work");
    assert_eq!(parsed.confidence, 0.7);
}

#[test]
fn classify_context_from_llm_response_malformed_json() {
    let parsed = classify_context_from_llm_response("not json at all");

    assert_eq!(parsed.category, "unknown");
    assert_eq!(parsed.confidence, 0.0);
    assert_eq!(parsed.suggested_action, "none");
}

#[test]
fn classify_context_from_llm_response_empty_string() {
    let parsed = classify_context_from_llm_response("");

    assert_eq!(parsed.category, "unknown");
    assert_eq!(parsed.confidence, 0.0);
}

#[test]
fn classify_context_from_llm_response_wrapper_json() {
    let response = r#"{"response":"{\"category\":\"work\",\"confidence\":0.7,\"reason\":\"coding\",\"suggested_action\":\"none\"}"}"#;
    let parsed = classify_context_from_llm_response(response);

    assert_eq!(parsed.category, "work");
    assert_eq!(parsed.confidence, 0.7);
}

#[test]
fn classify_context_from_llm_response_invalid_category() {
    let response = r#"{"category":"invalid_category","confidence":0.5,"reason":"test","suggested_action":"none"}"#;
    let parsed = classify_context_from_llm_response(response);

    assert_eq!(parsed.category, "unknown");
    assert_eq!(parsed.confidence, 0.0);
}

#[test]
fn parse_http_endpoint_localhost_default_port() {
    let (host, port, path) = parse_http_endpoint("http://127.0.0.1/api/generate").unwrap();

    assert_eq!(host, "127.0.0.1");
    assert_eq!(port, 80);
    assert_eq!(path, "/api/generate");
}

#[test]
fn parse_http_endpoint_localhost_with_port() {
    let (host, port, path) = parse_http_endpoint("http://localhost:11434/api/generate").unwrap();

    assert_eq!(host, "localhost");
    assert_eq!(port, 11434);
    assert_eq!(path, "/api/generate");
}

#[test]
fn parse_http_endpoint_localhost_no_path() {
    let (host, port, path) = parse_http_endpoint("http://127.0.0.1:8080").unwrap();

    assert_eq!(host, "127.0.0.1");
    assert_eq!(port, 8080);
    assert_eq!(path, "/");
}

#[test]
fn parse_http_endpoint_accepts_non_localhost() {
    let result = parse_http_endpoint("http://example.com/api");

    assert!(result.is_ok());
    let (host, port, path) = result.unwrap();
    assert_eq!(host, "example.com");
    assert_eq!(port, 80);
    assert_eq!(path, "/api");
}

#[test]
fn parse_http_endpoint_rejects_https() {
    let result = parse_http_endpoint("https://127.0.0.1/api");

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("http"));
}

#[test]
fn strip_www_removes_prefix() {
    assert_eq!(strip_www("www.example.com"), "example.com");
}

#[test]
fn strip_www_no_prefix() {
    assert_eq!(strip_www("example.com"), "example.com");
}

#[test]
fn strip_www_nested_www() {
    assert_eq!(strip_www("www.www.example.com"), "www.example.com");
}

#[test]
fn matches_host_rule_exact_match() {
    assert!(matches_host_rule("example.com", "=example.com"));
    assert!(matches_host_rule("www.example.com", "=example.com"));
    assert!(!matches_host_rule("sub.example.com", "=example.com"));
}

#[test]
fn matches_host_rule_wildcard_tld() {
    assert!(matches_host_rule("example.edu", "*.edu"));
    assert!(matches_host_rule("sub.example.edu", "*.edu"));
    assert!(!matches_host_rule("example.com", "*.edu"));
}

#[test]
fn matches_host_rule_wildcard_tld_pattern() {
    assert!(matches_host_rule("example.edu.cn", "*.edu.*"));
    assert!(matches_host_rule("sub.example.edu.cn", "*.edu.*"));
    assert!(!matches_host_rule("example.com", "*.edu.*"));
    assert!(matches_host_rule("example.edu", "*.edu.*"));
}

#[test]
fn matches_host_rule_no_dot_matches_subdomain() {
    assert!(matches_host_rule("example.zhihu.com", "zhihu"));
    assert!(matches_host_rule("zhihu.com", "zhihu"));
    assert!(!matches_host_rule("bilibili.com", "zhihu"));
}

#[test]
fn matches_host_rule_full_domain() {
    assert!(matches_host_rule("zhihu.com", "zhihu.com"));
    assert!(matches_host_rule("www.zhihu.com", "zhihu.com"));
    assert!(matches_host_rule("sub.zhihu.com", "zhihu.com"));
    assert!(!matches_host_rule("bilibili.com", "zhihu.com"));
}

#[test]
fn matches_host_rule_empty_rule() {
    assert!(!matches_host_rule("example.com", ""));
}

#[test]
fn matches_host_rule_case_insensitive() {
    assert!(matches_host_rule("EXAMPLE.COM", "example.com"));
    assert!(matches_host_rule("example.com", "EXAMPLE.COM"));
}

#[test]
fn is_target_allowlisted_allowlisted_domain() {
    let config = AppMonitorConfig::default();
    assert!(is_target_allowlisted(&config, "site:example.edu"));
    assert!(is_target_allowlisted(&config, "site:sub.example.edu"));
    assert!(is_target_allowlisted(&config, "site:example.edu.cn"));
}

#[test]
fn is_target_allowlisted_unknown_domain() {
    let config = AppMonitorConfig::default();
    assert!(!is_target_allowlisted(&config, "site:bilibili.com"));
    assert!(!is_target_allowlisted(&config, "site:zhihu.com"));
}

#[test]
fn is_target_allowlisted_allowlisted_app() {
    let config = AppMonitorConfig::default();
    assert!(is_target_allowlisted(&config, "app:Code.exe"));
    assert!(is_target_allowlisted(&config, "app:devenv.exe"));
}

#[test]
fn is_target_allowlisted_unknown_app() {
    let config = AppMonitorConfig::default();
    assert!(!is_target_allowlisted(&config, "app:WeChat.exe"));
    assert!(!is_target_allowlisted(&config, "app:Chrome.exe"));
}

#[test]
fn encode_decode_native_message_round_trip() {
    let original = r#"{"type":"intent_submitted","target":"site:zhihu.com"}"#;
    let encoded = encode_native_message(original);
    let decoded = decode_native_message(&encoded).unwrap();

    assert_eq!(decoded, original);
}

#[test]
fn decode_native_message_rejects_too_short() {
    let result = decode_native_message(&[0, 0]);

    assert!(result.is_err());
}

#[test]
fn decode_native_message_rejects_truncated() {
    let len_bytes = (100u32).to_le_bytes();
    let data = [
        len_bytes[0],
        len_bytes[1],
        len_bytes[2],
        len_bytes[3],
        b'a',
        b'b',
    ];
    let result = decode_native_message(&data);

    assert!(result.is_err());
}

#[test]
fn decode_native_message_rejects_invalid_utf8() {
    let len_bytes = (2u32).to_le_bytes();
    let data = [
        len_bytes[0],
        len_bytes[1],
        len_bytes[2],
        len_bytes[3],
        0xFF,
        0xFE,
    ];
    let result = decode_native_message(&data);

    assert!(result.is_err());
}
