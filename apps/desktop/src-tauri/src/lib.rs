use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command as StdCommand, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

struct SidecarState {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    process: Mutex<Option<std::process::Child>>,
    port: Mutex<Option<u16>>,
    starting: Mutex<bool>,
    last_stderr: Arc<Mutex<String>>,
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

fn sidecar_exe_suffix() -> &'static str {
    if cfg!(windows) {
        ".exe"
    } else {
        ""
    }
}

#[cfg(debug_assertions)]
fn prepared_sidecar_filename() -> String {
    format!("ht-agent-{}{}", host_target_triple(), sidecar_exe_suffix())
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
            .join(prepared_sidecar_filename());
        if prepared.exists() {
            return Ok(prepared);
        }
    }

    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "missing executable directory".to_string())?;
    let candidate = dir.join(format!("ht-agent{}", sidecar_exe_suffix()));
    if candidate.exists() {
        return Ok(candidate);
    }
    #[cfg(debug_assertions)]
    let prepared = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(prepared_sidecar_filename());
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

fn append_agent_log(sink: &Arc<Mutex<String>>, chunk: &str) {
    if chunk.is_empty() {
        return;
    }
    if let Ok(mut buf) = sink.lock() {
        if !buf.is_empty() && !buf.ends_with('\n') {
            buf.push('\n');
        }
        buf.push_str(chunk);
        const MAX: usize = 8192;
        if buf.len() > MAX {
            let extra = buf.len() - MAX;
            buf.drain(..extra);
        }
    }
}

fn parse_ht_fatal_code(text: &str) -> Option<String> {
    let mut found = None;
    for line in text.lines() {
        let trimmed = line.trim();
        let payload = if let Some(rest) = trimmed.strip_prefix("HT_FATAL ") {
            rest
        } else if let Some(index) = trimmed.find("HT_FATAL ") {
            &trimmed[index + "HT_FATAL ".len()..]
        } else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
            if let Some(code) = value.get("code").and_then(|item| item.as_str()) {
                found = Some(code.to_string());
            }
        }
    }
    found
}

fn humanize_agent_failure(stderr: &str) -> String {
    let code = parse_ht_fatal_code(stderr);
    match code.as_deref() {
        Some("newer_schema") => {
            "This data was saved by a newer HarnessTap. Update the app to open it.".to_string()
        }
        Some("port_in_use") => {
            "Port 7474 is already in use. Close the other HarnessTap process and try again."
                .to_string()
        }
        Some("home_not_writable") => {
            "HarnessTap can't write to its data folder. Check folder permissions and try again."
                .to_string()
        }
        _ if stderr.to_lowercase().contains("newer than this binary") => {
            "This data was saved by a newer HarnessTap. Update the app to open it.".to_string()
        }
        _ if stderr.contains("EADDRINUSE")
            || stderr.to_lowercase().contains("address already in use") =>
        {
            "Port 7474 is already in use. Close the other HarnessTap process and try again."
                .to_string()
        }
        _ if stderr.contains("EACCES")
            || stderr.contains("EROFS")
            || stderr.to_lowercase().contains("permission denied")
            || stderr.to_lowercase().contains("not writable") =>
        {
            "HarnessTap can't write to its data folder. Check folder permissions and try again."
                .to_string()
        }
        _ => "Can't reach the HarnessTap agent".to_string(),
    }
}

fn collect_agent_failure(state: &AppState) -> String {
    thread::sleep(Duration::from_millis(120));
    if let Ok(mut process_guard) = state.sidecar.process.lock() {
        if let Some(child) = process_guard.as_mut() {
            let _ = child.try_wait();
        }
    }
    let stderr = state
        .sidecar
        .last_stderr
        .lock()
        .ok()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    humanize_agent_failure(&stderr)
}

fn spawn_sidecar_via_shell(
    app: &AppHandle,
    sink: Arc<Mutex<String>>,
) -> Result<tauri_plugin_shell::process::CommandChild, String> {
    let mut sidecar = app
        .shell()
        .sidecar("ht-agent")
        .map_err(|error| error.to_string())?
        .env("HARNESSTAP_AGENT_PORT", "7474")
        .env("HARNESSTAP_PRODUCT", "desktop");
    if let Ok(home) = std::env::var("HARNESSTAP_HOME") {
        sidecar = sidecar.env("HARNESSTAP_HOME", home);
    }
    let (mut rx, child) = sidecar.spawn().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    let chunk = String::from_utf8_lossy(&bytes);
                    eprint!("{chunk}");
                    append_agent_log(&sink, &chunk);
                }
                CommandEvent::Stdout(bytes) => {
                    let chunk = String::from_utf8_lossy(&bytes);
                    eprint!("{chunk}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("ht-agent terminated: {:?}", payload);
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(child)
}

fn spawn_sidecar_via_process(
    sink: Arc<Mutex<String>>,
) -> Result<std::process::Child, String> {
    let path = sidecar_binary_path()?;
    let mut command = StdCommand::new(path);
    command.env("HARNESSTAP_AGENT_PORT", "7474");
    command.env("HARNESSTAP_PRODUCT", "desktop");
    command.stderr(Stdio::piped());
    // Ensure the sidecar uses the same home resolution as the desktop shell.
    if let Ok(home) = std::env::var("HARNESSTAP_HOME") {
        command.env("HARNESSTAP_HOME", home);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to spawn agent process: {error}"))?;
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                eprintln!("{line}");
                append_agent_log(&sink, &line);
            }
        });
    }
    Ok(child)
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
            return wait_for_port_file(5_000)
                .ok_or_else(|| collect_agent_failure(&state));
        }
        *starting = true;
    }

    // Remove files written by previous (possibly dead or orphaned) agents so
    // wait_for_port_file only observes the child we are about to spawn. The
    // sidecar writes the token first, then the port, after it binds.
    let _ = fs::remove_file(agent_port_path());
    let _ = fs::remove_file(agent_token_path());
    if let Ok(mut log) = state.sidecar.last_stderr.lock() {
        log.clear();
    }

    let spawn_result = (|| {
        match spawn_sidecar_via_process(state.sidecar.last_stderr.clone()) {
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
                eprintln!("process agent spawn failed, trying shell: {process_error}");
                match spawn_sidecar_via_shell(&app, state.sidecar.last_stderr.clone()) {
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
                        "Can't reach the HarnessTap agent ({process_error}; {shell_error})"
                    )),
                }
            }
        }
    })();

    if let Ok(mut starting) = state.sidecar.starting.lock() {
        *starting = false;
    }

    spawn_result?;

    let port = wait_for_port_file(5_000).ok_or_else(|| collect_agent_failure(&state))?;
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
                last_stderr: Arc::new(Mutex::new(String::new())),
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

#[cfg(test)]
mod tests {
    use super::{humanize_agent_failure, parse_ht_fatal_code};

    #[test]
    fn parses_ht_fatal_newer_schema() {
        let text = concat!(
            "Database schema v33 is newer than this binary (v30).\n",
            r#"HT_FATAL {"code":"newer_schema","message":"Database schema is newer than this HarnessTap build."}"#,
            "\n",
        );
        assert_eq!(parse_ht_fatal_code(text).as_deref(), Some("newer_schema"));
        assert_eq!(
            humanize_agent_failure(text),
            "This data was saved by a newer HarnessTap. Update the app to open it."
        );
    }

    #[test]
    fn parses_ht_fatal_port_and_home() {
        assert_eq!(
            humanize_agent_failure(
                r#"HT_FATAL {"code":"port_in_use","message":"The HarnessTap agent port is already in use."}"#
            ),
            "Port 7474 is already in use. Close the other HarnessTap process and try again."
        );
        assert_eq!(
            humanize_agent_failure(
                r#"HT_FATAL {"code":"home_not_writable","message":"The HarnessTap data folder is not writable."}"#
            ),
            "HarnessTap can't write to its data folder. Check folder permissions and try again."
        );
    }

    #[test]
    fn falls_back_without_ht_fatal() {
        assert_eq!(
            humanize_agent_failure("Database schema v33 is newer than this binary (v30)."),
            "This data was saved by a newer HarnessTap. Update the app to open it."
        );
        assert_eq!(
            humanize_agent_failure("listen EADDRINUSE: address already in use 127.0.0.1:7474"),
            "Port 7474 is already in use. Close the other HarnessTap process and try again."
        );
        assert_eq!(
            humanize_agent_failure(""),
            "Can't reach the HarnessTap agent"
        );
    }
}
