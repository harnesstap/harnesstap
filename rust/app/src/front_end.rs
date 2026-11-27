//! Glue from the front door to `cli-rs`: root help, `--help`, command groups' help and
//! commander errors are answered here; everything else runs the original.
//! Kill switch: `RUST_ANYTHING_UNIT_CLI=original`.

use std::ffi::OsString;
use std::io::{IsTerminal, Write};
use std::process::ExitCode;

use cli_rs::{Host, Outcome, ProfileNames};

struct ProcessHost;

impl Host for ProcessHost {
    fn var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }
    fn stdout_is_tty(&self) -> bool {
        std::io::stdout().is_terminal()
    }
    fn stderr_is_tty(&self) -> bool {
        std::io::stderr().is_terminal()
    }
    /// `getDb` + `initializeSchema` + `listProfilePluginsCommand` (`src/cli/runtime.ts`).
    fn profile_names(&mut self) -> ProfileNames {
        profile_names().map_or(ProfileNames::Failed, ProfileNames::Names)
    }
    fn telemetry_prologue(&mut self, args: &[String]) {
        telemetry_prologue(args);
    }
}

const PROFILE_PLUGIN_TAG: &str = "profile";

fn profile_names() -> Result<Vec<String>, String> {
    let env = db_rs::paths::ProcessEnv;
    let db = db_rs::connection::open(&env)?;
    db_rs::schema::initialize_schema(&db.conn, Default::default())?;
    let ctx = models_rs::Ctx {
        db: &db,
        env: &env,
        clock: &models_rs::SystemClock,
        ids: &models_rs::UlidIds,
    };
    let is_profile = |p: &plugin_model_rs::Plugin| p.tags.iter().any(|t| t == PROFILE_PLUGIN_TAG);
    let mut names: Vec<String> = Vec::new();
    for plugin in plugin_model_rs::list_plugins(&ctx)? {
        if is_profile(&plugin) && !names.contains(&plugin.name) {
            names.push(plugin.name);
        }
    }
    let mut profiles = Vec::new();
    for name in names {
        if plugin_model_rs::get_plugin_by_name(&ctx, &name, None)?.is_some_and(|p| is_profile(&p)) {
            profiles.push(name);
        }
    }
    Ok(profiles)
}

/// The telemetry endpoint: one POST per event, fire and forget, as the original's unref'd
/// socket: it gives up after 800 ms and never keeps the process alive.
struct PostHog;

impl telemetry_rs::Transport for PostHog {
    fn send(&mut self, url: &str, body: &str) {
        let (url, body) = (url.to_string(), body.to_string());
        std::thread::spawn(move || {
            let agent: ureq::Agent = ureq::Agent::config_builder()
                .timeout_global(Some(std::time::Duration::from_millis(800)))
                .http_status_as_error(false)
                .build()
                .into();
            let _ = agent
                .post(&url)
                .header("content-type", "application/json")
                .send(body.as_str());
        });
    }
}

/// Node-shaped argv (`[execPath, script, ...args]`): the binary stands for both.
fn node_argv(args: &[String]) -> Vec<String> {
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut argv = vec![exe.clone(), exe];
    argv.extend(args.iter().cloned());
    argv
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

/// `setTelemetryProduct("cli")`, `maybeWarnCliTelemetry` and `trackCliStartup`.
fn telemetry_prologue(args: &[String]) {
    let dir = db_rs::paths::harnesstap_dir(&db_rs::paths::ProcessEnv);
    let argv = node_argv(args);
    let env = |name: &str| std::env::var(name).ok();
    let now = || models_rs::iso_from_millis(now_ms());
    let mut new_uuid = || uuid::Uuid::new_v4().to_string();
    let mut stderr = std::io::stderr();
    let mut startup = telemetry_rs::Startup {
        harnesstap_dir: &dir,
        env: &env,
        exec_path: &argv[0],
        argv: &argv,
        stdout_is_tty: std::io::stdout().is_terminal(),
        version: &package_version().unwrap_or_default(),
        platform: telemetry_rs::node_platform(),
        now: &now,
        new_uuid: &mut new_uuid,
        transport: &mut PostHog,
        stderr: &mut stderr,
    };
    telemetry_rs::run_cli_prologue(&mut startup);
}

/// `maybeNotifyCliUpdate({ argv })` after an action, as `runHarnesstapCli` does. The install
/// channel is read from this binary's path, where the original reads the script's.
fn notify_cli_update(args: &[String], version: &str, code: u8) {
    let env: self_update_rs::Env = std::env::vars().collect();
    let dir = db_rs::paths::harnesstap_dir(&db_rs::paths::ProcessEnv);
    let argv = node_argv(args);
    let options = self_update_rs::NotifyOptions {
        argv: &argv,
        env: &env,
        harnesstap_dir: std::path::Path::new(&dir),
        current_version: version,
        package_version: version,
        now_ms: now_ms(),
        exit_code: Some(i32::from(code)),
    };
    self_update_rs::maybe_notify_cli_update(&options, &self_update_rs::HttpFetch, &mut |m| {
        eprintln!("{m}");
    });
}

pub fn run(argv: &[OsString]) -> Option<ExitCode> {
    if std::env::var("RUST_ANYTHING_UNIT_CLI").is_ok_and(|v| v == "original") {
        return None;
    }
    // Arguments that are not UTF-8 go to the original.
    let args: Vec<String> = argv
        .get(1..)?
        .iter()
        .map(|a| a.to_str().map(str::to_string))
        .collect::<Option<_>>()?;
    let program = argv.first().and_then(|p| p.to_str()).unwrap_or_default();
    let version = package_version().ok()?;
    match cli_rs::run(&mut ProcessHost, program, &args, &version) {
        Outcome::Original => None,
        Outcome::Answer {
            stdout,
            stderr,
            code,
        } => {
            let _ = std::io::stdout().write_all(stdout.as_bytes());
            let _ = std::io::stderr().write_all(stderr.as_bytes());
            Some(ExitCode::from(code))
        }
        Outcome::Acted {
            stdout,
            stderr,
            code,
        } => {
            let _ = std::io::stdout().write_all(stdout.as_bytes());
            let _ = std::io::stderr().write_all(stderr.as_bytes());
            notify_cli_update(&args, &version, code);
            Some(ExitCode::from(code))
        }
    }
}

/// The version `PACKAGE_VERSION` holds in a build made from the same commit and environment.
pub fn package_version() -> Result<String, String> {
    let options = serde_json::json!({
        "isRelease": env!("HT_BUILD_RELEASE") == "1",
        "gitSha": env!("HT_BUILD_GIT_SHA"),
    });
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("../../../package.json")).map_err(|e| e.to_string())?;
    let version = manifest["version"].as_str().unwrap_or_default().to_string();
    version_rs::port::format_dev_build_version(version, Some(options))
}
