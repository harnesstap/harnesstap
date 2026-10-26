use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command as StdCommand, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

const SIDECAR_LOG_FILE: &str = "ht-agent.log";
const SIDECAR_TAIL_LINES: usize = 40;

/// Output of the most recent sidecar launch. Lines are kept in memory (for the
/// connect splash) and appended to `ht-agent.log` in the app log directory (for
/// "Open logs"), so a sidecar that dies at startup leaves its stderr behind.
#[derive(Clone, Default)]
struct SidecarLog {
    tail: Arc<Mutex<VecDeque<String>>>,
    file: Arc<Mutex<Option<fs::File>>>,
    exit: Arc<Mutex<Option<String>>>,
}

impl SidecarLog {
    fn begin(&self, path: Option<PathBuf>) {
        if let Ok(mut tail) = self.tail.lock() {
            tail.clear();
        }
        if let Ok(mut exit) = self.exit.lock() {
            *exit = None;
        }
        let file = path.and_then(|path| {
            if let Some(dir) = path.parent() {
                let _ = fs::create_dir_all(dir);
            }
            fs::File::create(path).ok()
        });
        if let Ok(mut slot) = self.file.lock() {
            *slot = file;
        }
    }

    fn push(&self, line: &str) {
        let line = line.trim_end_matches(['\r', '\n']);
        eprintln!("[ht-agent] {line}");
        if let Ok(mut tail) = self.tail.lock() {
            if tail.len() >= SIDECAR_TAIL_LINES {
                tail.pop_front();
            }
            tail.push_back(line.to_string());
        }
        if let Ok(mut slot) = self.file.lock() {
            if let Some(file) = slot.as_mut() {
                let _ = writeln!(file, "{line}");
            }
        }
    }

    fn set_exit(&self, description: String) {
        self.push(&format!("ht-agent exited: {description}"));
        if let Ok(mut exit) = self.exit.lock() {
            *exit = Some(description);
        }
    }

    fn exit(&self) -> Option<String> {
        self.exit.lock().ok().and_then(|exit| exit.clone())
    }

    fn tail_text(&self) -> String {
        self.tail
            .lock()
            .map(|tail| tail.iter().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default()
    }
}

fn pump_lines<R: Read + Send + 'static>(reader: R, log: SidecarLog) {
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(_) => log.push(&String::from_utf8_lossy(&buffer)),
            }
        }
    });
}

struct SidecarState {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    process: Mutex<Option<std::process::Child>>,
    port: Mutex<Option<u16>>,
    starting: Mutex<bool>,
    log: SidecarLog,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarDiagnostics {
    stderr_tail: String,
    exit: Option<String>,
    log_path: Option<String>,
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

fn spawn_sidecar_via_shell(
    app: &AppHandle,
    log: SidecarLog,
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
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    log.push(&String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Terminated(payload) => {
                    log.set_exit(format!(
                        "code {:?}, signal {:?}",
                        payload.code, payload.signal
                    ));
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(child)
}

fn spawn_sidecar_via_process(log: &SidecarLog) -> Result<std::process::Child, String> {
    let path = sidecar_binary_path()?;
    let mut command = StdCommand::new(path);
    // Keep stdin open so ht-agent can watch for parent death (EOF).
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.env("HARNESSTAP_AGENT_PORT", "7474");
    command.env("HARNESSTAP_PRODUCT", "desktop");
    // Ensure the sidecar uses the same home resolution as the desktop shell.
    if let Ok(home) = std::env::var("HARNESSTAP_HOME") {
        command.env("HARNESSTAP_HOME", home);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to spawn sidecar process: {error}"))?;
    if let Some(stderr) = child.stderr.take() {
        pump_lines(stderr, log.clone());
    }
    if let Some(stdout) = child.stdout.take() {
        pump_lines(stdout, log.clone());
    }
    Ok(child)
}

fn sidecar_log_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_log_dir()
        .ok()
        .map(|dir| dir.join(SIDECAR_LOG_FILE))
}

/// Why the sidecar went away before reporting its port, if it did.
fn sidecar_early_exit(state: &AppState) -> Option<String> {
    if let Ok(mut guard) = state.sidecar.process.lock() {
        if let Some(child) = guard.as_mut() {
            if let Ok(Some(status)) = child.try_wait() {
                return Some(status.to_string());
            }
        }
    }
    state.sidecar.log.exit()
}

fn wait_for_sidecar_ready(state: &AppState, timeout_ms: u64) -> Result<u16, String> {
    let attempts = timeout_ms / 50;
    for _ in 0..attempts {
        if let Some(port) = read_port_file() {
            return Ok(port);
        }
        if let Some(exit) = sidecar_early_exit(state) {
            // Give the stderr pump a moment to flush the final lines.
            thread::sleep(Duration::from_millis(100));
            return Err(format!("ht-agent exited before it was ready ({exit})"));
        }
        thread::sleep(Duration::from_millis(50));
    }
    Err("ht-agent sidecar did not report its port".to_string())
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
    state.sidecar.log.begin(sidecar_log_path(&app));

    let spawn_result = (|| {
        match spawn_sidecar_via_process(&state.sidecar.log) {
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
                match spawn_sidecar_via_shell(&app, state.sidecar.log.clone()) {
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

    let port = wait_for_sidecar_ready(&state, 5_000)?;
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
fn get_sidecar_diagnostics(app: AppHandle, state: State<'_, AppState>) -> SidecarDiagnostics {
    SidecarDiagnostics {
        stderr_tail: state.sidecar.log.tail_text(),
        exit: sidecar_early_exit(&state),
        log_path: sidecar_log_path(&app).map(|path| path.to_string_lossy().into_owned()),
    }
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
        .plugin(tauri_plugin_opener::init())
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
                log: SidecarLog::default(),
            },
        })
        .setup(|app| {
            // Dev ergonomics: when prepare-sidecar rewrites the binary + stamp,
            // restart the managed agent without relaunching Tauri.
            spawn_sidecar_reload_watcher(app.handle().clone());
            // "Open logs" targets this directory; make sure it exists even
            // before the sidecar has written anything.
            if let Ok(dir) = app.path().app_log_dir() {
                let _ = fs::create_dir_all(dir);
            }
            // WDIO and `kill -TERM` do not always emit Tauri Exit. Stop the
            // sidecar on SIGTERM/SIGINT so port 7474 is not left behind.
            let handle = app.handle().clone();
            let _ = ctrlc::set_handler(move || {
                if let Some(state) = handle.try_state::<AppState>() {
                    stop_managed_process(&state);
                }
                handle.exit(0);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            restart_sidecar,
            read_agent_token,
            get_sidecar_port,
            get_sidecar_diagnostics,
            e2e_project_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building HarnessTap desktop")
        .run(|app, event| {
            match event {
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } => {
                    // Kill the managed sidecar so quitting never leaves an
                    // orphaned ht-agent holding the port and state files.
                    if let Some(state) = app.try_state::<AppState>() {
                        stop_managed_process(&state);
                    }
                }
                _ => {}
            }
        });
}
