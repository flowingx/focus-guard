use std::io::{self, Read, Write};

use std::time::{SystemTime, UNIX_EPOCH};

use focus_guard_desktop::{
    append_activity_jsonl, default_activity_log_path, encode_native_message, handle_native_json,
    AppMonitorConfig, AppPolicyState,
};

fn main() -> io::Result<()> {
    let mut stdin = io::stdin();
    let mut length_bytes = [0_u8; 4];

    if stdin.read_exact(&mut length_bytes).is_err() {
        return Ok(());
    }

    let length = u32::from_le_bytes(length_bytes) as usize;
    let mut payload = vec![0_u8; length];
    stdin.read_exact(&mut payload)?;

    let payload_text = String::from_utf8_lossy(&payload);
    let mut state = AppPolicyState::new(AppMonitorConfig::default());
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    let response_json = handle_native_json(&mut state, &payload_text, now_ms);
    let _ = append_activity_jsonl(&default_activity_log_path(), &state);
    let response = encode_native_message(&response_json);
    io::stdout().write_all(&response)?;
    io::stdout().flush()?;

    Ok(())
}
