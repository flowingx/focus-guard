use std::io::{self, Read, Write};

use std::time::{SystemTime, UNIX_EPOCH};

use focus_guard_desktop::{
    append_activity_jsonl, default_activity_log_path, encode_native_message, handle_native_json,
    AppMonitorConfig, AppPolicyState,
};

fn main() -> io::Result<()> {
    let mut stdin = io::stdin();
    let mut state = load_state_from_jsonl();

    loop {
        let mut length_bytes = [0_u8; 4];

        if stdin.read_exact(&mut length_bytes).is_err() {
            break;
        }

        let length = u32::from_le_bytes(length_bytes) as usize;
        let mut payload = vec![0_u8; length];
        if stdin.read_exact(&mut payload).is_err() {
            break;
        }

        let payload_text = String::from_utf8_lossy(&payload);
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or_default();
        let response_json = handle_native_json(&mut state, &payload_text, now_ms);
        let _ = append_activity_jsonl(&default_activity_log_path(), &state);
        let response = encode_native_message(&response_json);
        io::stdout().write_all(&response)?;
        io::stdout().flush()?;
    }

    Ok(())
}

fn load_state_from_jsonl() -> AppPolicyState {
    let path = default_activity_log_path();
    let mut state = AppPolicyState::new(AppMonitorConfig::default());

    if let Ok(content) = std::fs::read_to_string(&path) {
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Some(target) = focus_guard_desktop::json_string_field(line, "target") {
                let reason = focus_guard_desktop::json_string_field(line, "reason").unwrap_or_default();
                let outcome = focus_guard_desktop::json_string_field(line, "outcome").unwrap_or_default();
                let timestamp_ms = focus_guard_desktop::json_u64_field(line, "timestamp_ms").unwrap_or(0);
                let granted_minutes = focus_guard_desktop::json_u32_field(line, "granted_minutes").unwrap_or(0);
                state.activity_log.push(focus_guard_desktop::ActivityRecord {
                    timestamp_ms,
                    target,
                    reason,
                    granted_minutes,
                    outcome,
                });
            }
        }
    }

    state
}
