use focus_guard_desktop::{
    append_activity_jsonl, apply_ai_policy, classify_context_from_ollama_response,
    encode_native_message, evaluate_app_focus, export_activity_csv, handle_native_json,
    local_ai_request_json, read_foreground_window, AiClassification, AiContext,
    AppEvent, AppMonitorConfig, AppPolicyState, Decision, LocalAiConfig,
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

    assert_eq!(config.enabled, false);
    assert_eq!(config.endpoint, "http://127.0.0.1:11434/api/generate");
    assert_eq!(config.model, "qwen2.5vl:3b");
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
    };
    let unknown = AiClassification {
        category: "unknown".to_string(),
        confidence: 0.95,
        reason: "not enough context".to_string(),
        suggested_action: "none".to_string(),
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
fn ollama_response_parser_accepts_structured_json_only() {
    let response = r#"{"response":"{\"category\":\"distracting\",\"confidence\":0.82,\"reason\":\"Bilibili feed\",\"suggested_action\":\"intent_required\"}"}"#;
    let parsed = classify_context_from_ollama_response(response);

    assert_eq!(parsed.category, "distracting");
    assert_eq!(parsed.confidence, 0.82);
    assert_eq!(parsed.reason, "Bilibili feed");
    assert_eq!(parsed.suggested_action, "intent_required");
}

#[test]
fn ollama_response_parser_treats_invalid_output_as_unknown() {
    let parsed = classify_context_from_ollama_response(r#"{"response":"looks distracting"}"#);

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
    };

    let request = local_ai_request_json(&config, &context);

    assert!(request.contains(r#""model":"qwen2.5vl:3b""#));
    assert!(request.contains(r#""stream":false"#));
    assert!(request.contains("chrome.exe"));
    assert!(request.contains("Bilibili - Chrome"));
    assert!(request.contains(r#""images":["abc123"]"#));
}
