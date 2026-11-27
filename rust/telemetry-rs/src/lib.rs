//! The CLI's telemetry prologue from `src/telemetry/`: what `runHarnesstapCli`
//! runs before parsing (`setTelemetryProduct("cli")`, `maybeWarnCliTelemetry`,
//! `trackCliStartup`), with the consent rules, the state file and `captureEvent`.
//!
//! Everything the original reads from `process` (environment, `execPath`,
//! `argv`, stdout's TTY flag, `platform`), the clock, `randomUUID`, stderr and
//! the HTTP request come in through [`Startup`]. Like the original, nothing here
//! fails: errors are swallowed.

use emit_rs::js::trim;
use serde_json::{Map, Value};
use std::io::Write;
use std::path::Path;

/// Public PostHog project API key (EU project 190845, a client-safe `phc_` key).
pub const DEFAULT_POSTHOG_PROJECT_API_KEY: &str =
    "phc_qNGtvTMWscMjjt9yVoK2kySDnpCyMSNb4nNkkXabRtYv";
pub const DEFAULT_POSTHOG_HOST: &str = "https://eu.i.posthog.com";

pub const TELEMETRY_SCOPE_SUMMARY: &str = "HarnessTap can send anonymous product analytics to our EU PostHog project so we can see how the product is used.";
pub const TELEMETRY_TRACKED_LINES: [&str; 4] = [
    "Which product you used (CLI or Desktop), version, and operating system",
    "How the CLI was installed",
    "HarnessTap Cloud interactions",
    "Plugin install, apply, and view occurrences",
];
pub const TELEMETRY_NOT_TRACKED_LINES: [&str; 2] = [
    "No personal data: names, emails, file paths, code, secrets, or MCP configs",
    "No resource-related information: plugin names, contents, or organization ids",
];
pub const TELEMETRY_CLI_DISABLE_INSTRUCTIONS: &str = r#"Disable with HARNESSTAP_TELEMETRY=0 or set "telemetry": { "enabled": false } in ~/.harnesstap/config.jsonc."#;
pub const TELEMETRY_CLI_ENABLE_INSTRUCTIONS: &str = r#"Enable with HARNESSTAP_TELEMETRY=1 or set "telemetry": { "enabled": true } in ~/.harnesstap/config.jsonc."#;

/// Where `captureEvent` sends: the original POSTs `body` to `url` and forgets it.
pub trait Transport {
    fn send(&mut self, url: &str, body: &str);
}

/// A process environment lookup (`process.env[name]`; `Some("")` when set but empty).
pub type Env<'a> = &'a dyn Fn(&str) -> Option<String>;

/// What one CLI run hands the telemetry code.
pub struct Startup<'a> {
    /// `getHarnesstapDir()`.
    pub harnesstap_dir: &'a str,
    pub env: Env<'a>,
    /// `process.execPath`.
    pub exec_path: &'a str,
    /// `process.argv`, Node style: `argv[1]` is the script path.
    pub argv: &'a [String],
    /// `process.stdout.isTTY`.
    pub stdout_is_tty: bool,
    /// `PACKAGE_VERSION`.
    pub version: &'a str,
    /// `process.platform` (see [`node_platform`]).
    pub platform: &'a str,
    /// `new Date().toISOString()`.
    pub now: &'a dyn Fn() -> String,
    /// `randomUUID()`.
    pub new_uuid: &'a mut dyn FnMut() -> String,
    pub transport: &'a mut dyn Transport,
    pub stderr: &'a mut dyn Write,
}

/// `process.platform` for this build.
// ponytail: only the platforms ADR-013 targets map; others pass `std::env::consts::OS` through.
pub fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        os => os,
    }
}

/// `setTelemetryProduct("cli")`, `maybeWarnCliTelemetry(getHarnesstapDir(), { argv })`
/// and `trackCliStartup()`, in that order.
pub fn run_cli_prologue(s: &mut Startup) {
    maybe_warn_cli_telemetry(s);
    track_cli_startup(s);
}

fn env_trimmed(env: Env, name: &str) -> Option<String> {
    env(name).map(|v| trim(&v).to_owned())
}

/// `telemetryEnvFlag()`: `HARNESSTAP_TELEMETRY` as a boolean, or `None` when unset or unknown.
pub fn telemetry_env_flag(env: Env) -> Option<bool> {
    match env_trimmed(env, "HARNESSTAP_TELEMETRY")?
        .to_lowercase()
        .as_str()
    {
        "0" | "false" | "no" | "off" => Some(false),
        "1" | "true" | "yes" | "on" => Some(true),
        _ => None,
    }
}

/// `readTelemetryConfigPreference`: `telemetry.enabled` when it is a boolean in
/// `config.jsonc` (or the legacy `config.json` when only that exists).
pub fn read_telemetry_config_preference(harnesstap_dir: &str) -> Option<bool> {
    let bytes = std::fs::read(settings_rs::settings_path(harnesstap_dir)).ok()?;
    let raw = settings_rs::parse_jsonc(&String::from_utf8_lossy(&bytes)).ok()?;
    raw.get("telemetry")?.get("enabled")?.as_bool()
}

/// `resolvePosthogProjectApiKey`: a set override wins, and an empty one disables capture.
pub fn resolve_posthog_project_api_key(env: Env) -> Option<String> {
    match env_trimmed(env, "HARNESSTAP_POSTHOG_PROJECT_API_KEY") {
        Some(key) => (!key.is_empty()).then_some(key),
        None => Some(DEFAULT_POSTHOG_PROJECT_API_KEY.to_owned()),
    }
}

/// `resolvePosthogCaptureUrl`.
pub fn resolve_posthog_capture_url(env: Env) -> String {
    let host = env_trimmed(env, "HARNESSTAP_POSTHOG_HOST").filter(|h| !h.is_empty());
    let host = host
        .as_deref()
        .map_or(DEFAULT_POSTHOG_HOST, |h| h.trim_end_matches('/'));
    format!("{host}/capture/")
}

/// `isTelemetryEnabled`: the env flag, else an explicit `true` in the config; either way only
/// with an API key.
pub fn is_telemetry_enabled(env: Env, harnesstap_dir: &str) -> bool {
    let allowed = match telemetry_env_flag(env) {
        Some(flag) => flag,
        None => read_telemetry_config_preference(harnesstap_dir) == Some(true),
    };
    allowed && resolve_posthog_project_api_key(env).is_some()
}

const STATE_FIELDS: [&str; 7] = [
    "distinct_id",
    "identified_distinct_id",
    "cli_installed_at",
    "cli_first_run_at",
    "desktop_installed_at",
    "desktop_first_open_at",
    "cli_notice_shown_at",
];

fn state_path(harnesstap_dir: &str) -> std::path::PathBuf {
    Path::new(harnesstap_dir).join("telemetry-state.json")
}

/// `loadTelemetryState`: the known fields that are non-blank strings, trimmed, in the
/// original's order; a fresh `distinct_id` when missing, unreadable or not an object.
pub fn load_telemetry_state(
    harnesstap_dir: &str,
    new_uuid: &mut dyn FnMut() -> String,
) -> Map<String, Value> {
    let parsed = std::fs::read(state_path(harnesstap_dir))
        .ok()
        .and_then(|b| serde_json::from_str::<Value>(&String::from_utf8_lossy(&b)).ok());
    let mut state = Map::new();
    let Some(Value::Object(file)) = parsed else {
        state.insert("distinct_id".into(), Value::String(new_uuid()));
        return state;
    };
    for key in STATE_FIELDS {
        let value = file
            .get(key)
            .and_then(Value::as_str)
            .map(trim)
            .filter(|v| !v.is_empty());
        match value {
            Some(v) => state.insert(key.into(), v.into()),
            None if key == "distinct_id" => state.insert(key.into(), Value::String(new_uuid())),
            None => None,
        };
    }
    state
}

fn save_telemetry_state(state: &Map<String, Value>, harnesstap_dir: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(harnesstap_dir)?;
    let text = emit_rs::json::to_file_string(&Value::Object(state.clone()));
    std::fs::write(state_path(harnesstap_dir), text)
}

/// `updateTelemetryState`: load, apply `patch` (new keys go last), save.
pub fn update_telemetry_state(
    patch: &[(&str, &str)],
    harnesstap_dir: &str,
    new_uuid: &mut dyn FnMut() -> String,
) -> std::io::Result<Map<String, Value>> {
    let mut state = load_telemetry_state(harnesstap_dir, new_uuid);
    for (key, value) in patch {
        state.insert((*key).into(), (*value).into());
    }
    save_telemetry_state(&state, harnesstap_dir)?;
    Ok(state)
}

/// `resolveDistinctId`: the identified id, else the anonymous one (saving the state first).
pub fn resolve_distinct_id(
    harnesstap_dir: &str,
    new_uuid: &mut dyn FnMut() -> String,
) -> std::io::Result<String> {
    let state = load_telemetry_state(harnesstap_dir, new_uuid);
    if let Some(Value::String(id)) = state.get("identified_distinct_id") {
        return Ok(id.clone());
    }
    save_telemetry_state(&state, harnesstap_dir)?;
    Ok(state["distinct_id"].as_str().unwrap_or_default().to_owned())
}

/// `detectCliInstallMethod`.
pub fn detect_cli_install_method(env: Env, exec_path: &str, script_path: &str) -> &'static str {
    const METHODS: [&str; 6] = ["brew", "npm", "bun", "npx", "curl", "unknown"];
    let forced = env_trimmed(env, "HARNESSTAP_INSTALL_METHOD").map(|v| v.to_lowercase());
    if let Some(method) = forced.and_then(|v| METHODS.into_iter().find(|m| *m == v)) {
        return method;
    }
    let var = |name| env(name).unwrap_or_default();
    let haystack = [
        exec_path.to_owned(),
        script_path.to_owned(),
        var("npm_execpath"),
        var("npm_command"),
    ]
    .join(" ")
    .to_lowercase();
    if haystack.contains("npx") {
        "npx"
    } else if haystack.contains("/cellar/") || haystack.contains("homebrew") {
        "brew"
    } else if haystack.contains("bun") {
        "bun"
    } else if haystack.contains("node_modules")
        || haystack.contains("npm")
        || (exec_path.to_lowercase().contains("node") && haystack.contains("harnesstap"))
    {
        "npm"
    } else {
        "unknown"
    }
}

fn argv_requests_json(argv: &[String]) -> bool {
    argv.iter().enumerate().any(|(i, arg)| {
        arg == "--json"
            || arg == "--format=json"
            || (arg == "--format" && argv.get(i + 1).is_some_and(|n| n == "json"))
    })
}

/// `formatTelemetryScopeBody`.
pub fn format_telemetry_scope_body() -> String {
    let bullets = |lines: &[&str]| {
        lines
            .iter()
            .map(|l| format!("• {l}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "{TELEMETRY_SCOPE_SUMMARY}\n\nWhat we track:\n{}\n\nWhat we do not track:\n{}",
        bullets(&TELEMETRY_TRACKED_LINES),
        bullets(&TELEMETRY_NOT_TRACKED_LINES)
    )
}

/// `formatCliTelemetryEnabledWarning`.
pub fn format_cli_telemetry_enabled_warning() -> String {
    format!(
        "Anonymous usage telemetry is on.\n{}\n{TELEMETRY_CLI_DISABLE_INSTRUCTIONS}",
        format_telemetry_scope_body()
    )
}

/// `formatCliTelemetryUnsettledWarning`.
pub fn format_cli_telemetry_unsettled_warning() -> String {
    format!(
        "Anonymous usage telemetry is off until you opt in. No events are sent yet.\n{}\n{TELEMETRY_CLI_ENABLE_INSTRUCTIONS}\n{TELEMETRY_CLI_DISABLE_INSTRUCTIONS}",
        format_telemetry_scope_body()
    )
}

/// `maybeWarnCliTelemetry`: once per HarnessTap directory, on a TTY and not for
/// `--json`/`--format json`, print the notice to stderr when telemetry is on or
/// not decided yet, then record `cli_notice_shown_at`.
pub fn maybe_warn_cli_telemetry(s: &mut Startup) {
    if argv_requests_json(s.argv) || !s.stdout_is_tty {
        return;
    }
    let env = telemetry_env_flag(s.env);
    if env == Some(false) {
        return;
    }
    let preference = read_telemetry_config_preference(s.harnesstap_dir);
    let enabled = is_telemetry_enabled(s.env, s.harnesstap_dir);
    let unsettled = env.is_none() && preference.is_none();
    if !enabled && !unsettled {
        return;
    }
    let state = load_telemetry_state(s.harnesstap_dir, s.new_uuid);
    if state.contains_key("cli_notice_shown_at") {
        return;
    }
    let message = if enabled {
        format_cli_telemetry_enabled_warning()
    } else {
        format_cli_telemetry_unsettled_warning()
    };
    let _ = writeln!(s.stderr, "{message}");
    let now = (s.now)();
    let _ = update_telemetry_state(
        &[("cli_notice_shown_at", &now)],
        s.harnesstap_dir,
        s.new_uuid,
    );
}

/// `captureEvent` with the CLI product: one PostHog `/capture/` request when telemetry is on,
/// sent only once the state file is saved.
// ponytail: `sanitizeTelemetryProps` is left out: the CLI startup properties are fixed keys
// with no secret-like names, emails or 200+ character values. Port it with the next caller.
pub fn capture_event(s: &mut Startup, event: &str, properties: &[(&str, &str)]) {
    if !is_telemetry_enabled(s.env, s.harnesstap_dir) {
        return;
    }
    let Some(api_key) = resolve_posthog_project_api_key(s.env) else {
        return;
    };
    let Ok(distinct_id) = resolve_distinct_id(s.harnesstap_dir, s.new_uuid) else {
        return;
    };
    let mut props = Map::new();
    props.insert("product".into(), "cli".into());
    props.insert("app_version".into(), s.version.into());
    props.insert("os".into(), s.platform.into());
    props.insert("$lib".into(), "harnesstap".into());
    props.insert("$ip".into(), Value::Null);
    for (key, value) in properties {
        props.insert((*key).into(), (*value).into());
    }
    let mut payload = Map::new();
    payload.insert("api_key".into(), api_key.into());
    payload.insert("event".into(), event.into());
    payload.insert("distinct_id".into(), distinct_id.into());
    payload.insert("properties".into(), Value::Object(props));
    let body = emit_rs::json::stringify(&Value::Object(payload), "");
    s.transport.send(&resolve_posthog_capture_url(s.env), &body);
}

/// `trackCliStartup`: `cli_installed` and `cli_first_run` the first time, then their timestamps.
pub fn track_cli_startup(s: &mut Startup) {
    if !is_telemetry_enabled(s.env, s.harnesstap_dir) {
        return;
    }
    let state = load_telemetry_state(s.harnesstap_dir, s.new_uuid);
    let installed = state.contains_key("cli_installed_at");
    let first_run = state.contains_key("cli_first_run_at");
    let version = s.version.to_owned();
    if !installed {
        let script = s.argv.get(1).map_or("", String::as_str);
        let method = detect_cli_install_method(s.env, s.exec_path, script);
        capture_event(
            s,
            "cli_installed",
            &[("install_method", method), ("version", &version)],
        );
    }
    if !first_run {
        capture_event(s, "cli_first_run", &[("version", &version)]);
    }
    let now = (s.now)();
    let mut patch = Vec::new();
    if !installed {
        patch.push(("cli_installed_at", now.as_str()));
    }
    if !first_run {
        patch.push(("cli_first_run_at", now.as_str()));
    }
    let _ = update_telemetry_state(&patch, s.harnesstap_dir, s.new_uuid);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_flags_skip_the_notice() {
        let argv = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(argv_requests_json(&argv(&["ht", "--format", "json"])));
        assert!(!argv_requests_json(&argv(&["ht", "--format", "--json=1"])));
        assert!(!argv_requests_json(&argv(&["ht", "--format"])));
    }

    #[test]
    fn platform_names_follow_node() {
        assert!(!["macos", "windows"].contains(&node_platform()));
    }
}
