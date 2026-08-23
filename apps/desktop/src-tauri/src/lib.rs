use std::fs;
use std::path::PathBuf;
use std::process::Command as StdCommand;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

struct SidecarState {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    process: Mutex<Option<std::process::Child>>,
    port: Mutex<Option<u16>>,
    starting: Mutex<bool>,
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

fn agent_port_path() -> PathBuf {
    harnesstap_home().join("agent-port")
}

#[cfg(debug_assertions)]
fn host_target_triple() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return "aarch64-apple-darwin";
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return "x86_64-apple-darwin";
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return "x86_64-unknown-linux-gnu";
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return "aarch64-unknown-linux-gnu";
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return "x86_64-pc-windows-msvc";
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        return "aarch64-pc-windows-msvc";
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64"),
    )))]
    {
        "unknown"
    }
}

fn sidecar_reload_stamp_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(".sidecar-reload")
}

fn read_reload_stamp() -> Option<String> {
    fs::read_to_string(sidecar_reload_stamp_path())
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn spawn_sidecar_reload_watcher(app: AppHandle) {
    thread::spawn(move || {
        let mut last_stamp = read_reload_stamp();
        loop {
            thread::sleep(Duration::from_millis(750));
            let Some(stamp) = read_reload_stamp() else {
                continue;
            };
            if last_stamp.as_ref() == Some(&stamp) {
                continue;
            }
            last_stamp = Some(stamp);
            eprintln!("ht-agent sidecar binary updated; restarting…");
            let app_for_restart = app.clone();
            tauri::async_runtime::spawn(async move {
                let Some(state) = app_for_restart.try_state::<AppState>() else {
                    return;
                };
                match restart_sidecar(app_for_restart.clone(), state).await {
                    Ok(port) => {
                        let _ = app_for_restart.emit("sidecar-reloaded", port);
                        eprintln!("ht-agent sidecar restarted on port {port}");
                    }
                    Err(error) => {
                        eprintln!("ht-agent sidecar restart failed: {error}");
                    }
                }
            });
        }
    });
}

fn sidecar_binary_path() -> Result<PathBuf, String> {
    // Dev-only ergonomics: during `tauri dev`, prefer the prepared binary under
    // src-tauri/binaries so `desktop:prepare-sidecar` takes effect without a
    // full app relaunch. Release builds always use the bundled sidecar so the
    // installed app never depends on a checkout existing at the build path.
    #[cfg(debug_assertions)]
    {
        let prepared = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("ht-agent-{}", host_target_triple()));
        if prepared.exists() {
            return Ok(prepared);
        }
    }

    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "missing executable directory".to_string())?;
    let candidate = dir.join("ht-agent");
    if candidate.exists() {
        return Ok(candidate);
    }
    #[cfg(debug_assertions)]
    let prepared = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("ht-agent-{}", host_target_triple()));
    #[cfg(not(debug_assertions))]
    let prepared = candidate.clone();
    Err(format!(
        "sidecar binary not found at {} or {}",
        prepared.display(),
        candidate.display()
    ))
}

fn read_port_file() -> Option<u16> {
    let raw = fs::read_to_string(agent_port_path()).ok()?;
    let port = raw.trim().parse::<u16>().ok()?;
    if port == 0 {
        None
    } else {
        Some(port)
    }
}

fn process_is_running(child: &mut std::process::Child) -> bool {
    match child.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) => false,
        Err(_) => false,
    }
}

fn stop_managed_process(state: &AppState) {
    if let Ok(mut process_guard) = state.sidecar.process.lock() {
        if let Some(mut child) = process_guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(mut child_guard) = state.sidecar.child.lock() {
        if let Some(child) = child_guard.take() {
            let _ = child.kill();
        }
    }
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
    if let Some(port) = read_port_file() {
        if let Ok(mut guard) = state.sidecar.port.lock() {
            *guard = Some(port);
        }
        return Ok(Some(port));
    }
    Ok(*state.sidecar.port.lock().map_err(|_| "lock poisoned")?)
}

fn spawn_sidecar_via_shell(
    app: &AppHandle,
) -> Result<tauri_plugin_shell::process::CommandChild, String> {
    let mut sidecar = app
        .shell()
        .sidecar("ht-agent")
        .map_err(|error| error.to_string())?
        .env("HARNESSTAP_AGENT_PORT", "7474");
    if let Ok(home) = std::env::var("HARNESSTAP_HOME") {
        sidecar = sidecar.env("HARNESSTAP_HOME", home);
    }
    let (mut rx, child) = sidecar.spawn().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Terminated(payload) = event {
                eprintln!("ht-agent sidecar terminated: {:?}", payload);
                break;
            }
        }
    });
    Ok(child)
}

fn spawn_sidecar_via_process() -> Result<std::process::Child, String> {
    let path = sidecar_binary_path()?;
    let mut command = StdCommand::new(path);
    command.env("HARNESSTAP_AGENT_PORT", "7474");
    // Ensure the sidecar uses the same home resolution as the desktop shell.
    if let Ok(home) = std::env::var("HARNESSTAP_HOME") {
        command.env("HARNESSTAP_HOME", home);
    }
    command
        .spawn()
        .map_err(|error| format!("failed to spawn sidecar process: {error}"))
}

fn wait_for_port_file(timeout_ms: u64) -> Option<u16> {
    let attempts = timeout_ms / 50;
    for _ in 0..attempts {
        if let Some(port) = read_port_file() {
            return Some(port);
        }
        thread::sleep(Duration::from_millis(50));
    }
    None
}

#[tauri::command]
async fn start_sidecar(app: AppHandle, state: State<'_, AppState>) -> Result<u16, String> {
    {
        let mut process_guard = state
            .sidecar
            .process
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        if let Some(child) = process_guard.as_mut() {
            if process_is_running(child) {
                if let Some(port) = read_port_file() {
                    *state
                        .sidecar
                        .port
                        .lock()
                        .map_err(|_| "lock poisoned".to_string())? = Some(port);
                    return Ok(port);
                }
                return Ok(7474);
            }
            let _ = child.kill();
            let _ = child.wait();
            *process_guard = None;
        }
    }

    {
        let child_guard = state
            .sidecar
            .child
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        if child_guard.is_some() {
            if let Some(port) = read_port_file() {
                return Ok(port);
            }
        }
    }

    {
        let mut starting = state
            .sidecar
            .starting
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        if *starting {
            drop(starting);
            return wait_for_port_file(5_000).ok_or_else(|| {
                "ht-agent sidecar is starting but did not report its port".to_string()
            });
        }
        *starting = true;
    }

    // Remove files written by previous (possibly dead or orphaned) agents so
    // wait_for_port_file only observes the child we are about to spawn. The
    // sidecar writes the token first, then the port, after it binds.
    let _ = fs::remove_file(agent_port_path());
    let _ = fs::remove_file(agent_token_path());

    let spawn_result = (|| {
        match spawn_sidecar_via_process() {
            Ok(child) => {
                let mut process_guard = state
                    .sidecar
                    .process
                    .lock()
                    .map_err(|_| "lock poisoned".to_string())?;
                *process_guard = Some(child);
                Ok(())
            }
            Err(process_error) => {
                eprintln!("process sidecar spawn failed, trying shell: {process_error}");
                match spawn_sidecar_via_shell(&app) {
                    Ok(child) => {
                        let mut child_guard = state
                            .sidecar
                            .child
                            .lock()
                            .map_err(|_| "lock poisoned".to_string())?;
                        *child_guard = Some(child);
                        Ok(())
                    }
                    Err(shell_error) => Err(format!(
                        "sidecar spawn failed (process: {process_error}; shell: {shell_error})"
                    )),
                }
            }
        }
    })();

    if let Ok(mut starting) = state.sidecar.starting.lock() {
        *starting = false;
    }

    spawn_result?;

    let port = wait_for_port_file(5_000).ok_or_else(|| {
        "ht-agent sidecar did not report its port; check ~/.harnesstap for a stale agent".to_string()
    })?;
    *state
        .sidecar
        .port
        .lock()
        .map_err(|_| "lock poisoned".to_string())? = Some(port);
    Ok(port)
}

#[tauri::command]
async fn restart_sidecar(app: AppHandle, state: State<'_, AppState>) -> Result<u16, String> {
    stop_managed_process(&state);
    thread::sleep(Duration::from_millis(150));
    start_sidecar(app, state).await
}

#[tauri::command]
fn e2e_project_path() -> Option<String> {
    #[cfg(feature = "e2e")]
    {
        std::env::var("HARNESSTAP_E2E_PROJECT_PATH").ok()
    }
    #[cfg(not(feature = "e2e"))]
    {
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));

    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .manage(AppState {
            sidecar: SidecarState {
                child: Mutex::new(None),
                process: Mutex::new(None),
                port: Mutex::new(Some(7474)),
                starting: Mutex::new(false),
            },
        })
        .setup(|app| {
            // Dev ergonomics: when prepare-sidecar rewrites the binary + stamp,
            // restart the managed agent without relaunching Tauri.
            spawn_sidecar_reload_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            restart_sidecar,
            read_agent_token,
            get_sidecar_port,
            e2e_project_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building HarnessTap desktop")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Kill the managed sidecar so quitting never leaves an
                // orphaned ht-agent holding the port and state files.
                if let Some(state) = app.try_state::<AppState>() {
                    stop_managed_process(&state);
                }
            }
        });
}
