use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

struct SidecarState {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    port: Mutex<Option<u16>>,
}

struct AppState {
    sidecar: SidecarState,
}

fn harnesstap_home() -> PathBuf {
    if let Ok(path) = std::env::var("HARNESSTAP_HOME") {
        return PathBuf::from(path);
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".harnesstap")
}

fn agent_token_path() -> PathBuf {
    harnesstap_home().join("agent-token")
}

#[tauri::command]
fn read_agent_token() -> Result<Option<String>, String> {
    let path = agent_token_path();
    if !path.exists() {
        return Ok(None);
    }
    let token = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let trimmed = token.trim().to_string();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed))
    }
}

#[tauri::command]
fn get_sidecar_port(state: State<'_, AppState>) -> Result<Option<u16>, String> {
    Ok(*state.sidecar.port.lock().map_err(|_| "lock poisoned")?)
}

#[tauri::command]
fn get_project_path() -> Result<String, String> {
    Ok(std::env::current_dir()
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
async fn start_sidecar(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    {
        let child_guard = state
            .sidecar
            .child
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        if child_guard.is_some() {
            return Ok(());
        }
    }

    let sidecar = app
        .shell()
        .sidecar("ht-agent")
        .map_err(|error| error.to_string())?;

    let (mut rx, child) = sidecar.spawn().map_err(|error| error.to_string())?;

    {
        let mut child_guard = state
            .sidecar
            .child
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        *child_guard = Some(child);
    }

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Terminated(payload) = event {
                eprintln!("ht-agent sidecar terminated: {:?}", payload);
                break;
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(AppState {
            sidecar: SidecarState {
                child: Mutex::new(None),
                port: Mutex::new(Some(7474)),
            },
        })
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            read_agent_token,
            get_sidecar_port,
            get_project_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running HarnessTap desktop");
}
