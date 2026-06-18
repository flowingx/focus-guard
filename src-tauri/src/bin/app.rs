use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

struct ServerState {
    child: Option<Child>,
}

static SERVER: Mutex<ServerState> = Mutex::new(ServerState { child: None });

fn server_exe_path() -> std::path::PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    exe.parent()
        .unwrap_or(std::path::Path::new("."))
        .join("focus-guard-server.exe")
}

#[tauri::command]
fn start_server(app: AppHandle) -> Result<String, String> {
    let mut state = SERVER.lock().map_err(|e| e.to_string())?;
    if state.child.is_some() {
        return Ok("already_running".to_string());
    }

    let path = server_exe_path();
    if !path.exists() {
        return Err(format!("Server not found at {}", path.display()));
    }

    let child = Command::new(&path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start server: {}", e))?;

    let pid = child.id();
    state.child = Some(child);
    Ok(format!("started_{}", pid))
}

#[tauri::command]
fn stop_server() -> Result<String, String> {
    let mut state = SERVER.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = state.child.take() {
        let _ = child.kill();
        let _ = child.wait();
        Ok("stopped".to_string())
    } else {
        Ok("not_running".to_string())
    }
}

#[tauri::command]
fn get_server_status() -> Result<bool, String> {
    let state = SERVER.lock().map_err(|e| e.to_string())?;
    Ok(state.child.is_some())
}

#[tauri::command]
fn check_server_health() -> Result<bool, String> {
    let resp = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?
        .get("http://127.0.0.1:3001/health")
        .send();

    match resp {
        Ok(r) => Ok(r.status().is_success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
fn show_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            start_server,
            stop_server,
            get_server_status,
            check_server_health,
            show_window,
        ])
        .setup(|app| {
            let toggle_label = {
                let state = SERVER.lock().unwrap();
                if state.child.is_some() {
                    "Stop Server"
                } else {
                    "Start Server"
                }
            };

            let show_item = MenuItemBuilder::with_id("show", "Show Window").build(app)?;
            let toggle_item = MenuItemBuilder::with_id("toggle", toggle_label).build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&toggle_item)
                .item(&PredefinedMenuItem::separator(app)?)
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Focus Guard")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "toggle" => {
                        let running = {
                            let state = SERVER.lock().unwrap();
                            state.child.is_some()
                        };

                        if running {
                            let _ = stop_server();
                            let _ = toggle_item.set_text("Start Server");
                        } else {
                            let _ = start_server(app.clone());
                            let _ = toggle_item.set_text("Stop Server");
                        }

                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("server-status-changed", ());
                        }
                    }
                    "quit" => {
                        let _ = stop_server();
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
