//! Replays `tests/fixtures/runs.json` (recorded by `make-fixtures.mjs` from the original
//! under `rust/run-sandboxed.sh`): every argv the port answers must give the original's
//! stdout, stderr and exit code byte for byte. The rest must be left to the original.
//! `tests/fixtures/projects.json` adds project folders, HOME files and databases: an answered
//! run must also leave the same files and rows, and one left to the original nothing at all.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use cli_rs::{Host, Outcome, ProfileNames};
use serde::Deserialize;
use serde_json::{Map, Value};

#[derive(Deserialize)]
struct Run {
    args: Vec<String>,
    stdout: String,
    stderr: String,
    code: u8,
}

/// The environment `rust/run-sandboxed.sh` sets (with the update check skipped, as the
/// recorder does), a fresh database and no TTY.
struct Sandbox;

impl Host for Sandbox {
    fn var(&self, name: &str) -> Option<String> {
        let value = match name {
            "HARNESSTAP_TELEMETRY" | "FORCE_COLOR" => "0",
            "NO_COLOR" | "CI" | "HARNESSTAP_NO_INTERACTIVE" | "HARNESSTAP_SKIP_UPDATE_CHECK" => "1",
            "TERM" => "dumb",
            _ => return None,
        };
        Some(value.to_string())
    }
    fn stdout_is_tty(&self) -> bool {
        false
    }
    fn stderr_is_tty(&self) -> bool {
        false
    }
    fn profile_names(&mut self) -> ProfileNames {
        ProfileNames::Names(Vec::new())
    }
    fn telemetry_prologue(&mut self, _: &[String]) {}
}

fn package_version() -> String {
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("../../../package.json")).expect("package.json");
    manifest["version"].as_str().expect("version").to_string()
}

#[test]
fn answers_match_the_original() {
    let runs: Vec<Run> =
        serde_json::from_str(include_str!("fixtures/runs.json")).expect("fixtures/runs.json");
    let version = package_version();
    let mut answered = 0;
    let mut failures = Vec::new();
    for run in &runs {
        match cli_rs::run(&mut Sandbox, "dist/bin.js", &run.args, &version) {
            Outcome::Original => {}
            // The recorder skips the update check, so an action adds nothing after it.
            Outcome::Answer {
                stdout,
                stderr,
                code,
            }
            | Outcome::Acted {
                stdout,
                stderr,
                code,
            } => {
                answered += 1;
                if (stdout.as_str(), stderr.as_str(), code)
                    != (run.stdout.as_str(), run.stderr.as_str(), run.code)
                {
                    failures.push(format!(
                        "{:?}\n  want ({}) {:?} {:?}\n  got  ({code}) {stdout:?} {stderr:?}",
                        run.args, run.code, run.stdout, run.stderr
                    ));
                }
            }
        }
    }
    eprintln!("{answered} of {} runs answered", runs.len());
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
    // Fewer answers than this means a regression in what the port covers.
    assert!(
        answered * 10 >= runs.len() * 8,
        "only {answered} of {} answered",
        runs.len()
    );
}

#[test]
fn colored_runs_go_to_the_original_and_answers_run_the_prologue() {
    #[derive(Default)]
    struct Tty {
        prologues: usize,
    }
    impl Host for Tty {
        fn var(&self, _: &str) -> Option<String> {
            None
        }
        fn stdout_is_tty(&self) -> bool {
            true
        }
        fn stderr_is_tty(&self) -> bool {
            true
        }
        fn profile_names(&mut self) -> ProfileNames {
            ProfileNames::Unknown
        }
        fn telemetry_prologue(&mut self, _: &[String]) {
            self.prologues += 1;
        }
    }
    let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let mut host = Tty::default();
    for argv in [&["--help"][..], &["plugin", "--help"], &["frobnicate"]] {
        assert_eq!(
            cli_rs::run(&mut host, "ht", &args(argv), "1"),
            Outcome::Original
        );
    }
    // Root help comes before the prologue in the original; a fallback never runs it.
    assert_eq!(host.prologues, 0);
    // Errors carry no color, so a TTY does not matter; they come after the prologue.
    assert!(matches!(
        cli_rs::run(&mut host, "ht", &args(&["plugin", "--bogus"]), "1"),
        Outcome::Answer { code: 1, .. }
    ));
    assert_eq!(host.prologues, 1);
    assert!(matches!(
        cli_rs::run(&mut host, "ht", &args(&["uninstall"]), "1"),
        Outcome::Answer { code: 1, .. }
    ));
    assert_eq!(host.prologues, 1);
}

/// A run of `tests/fixtures/projects.json`: the state it starts from and what it left.
#[derive(Deserialize)]
struct ProjectRun {
    args: Vec<String>,
    #[serde(default)]
    files: Option<Map<String, Value>>,
    #[serde(default)]
    home: Option<Map<String, Value>>,
    /// `true` for the schema, or SQL to run on it.
    #[serde(default)]
    db: Option<Value>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    env: Option<Map<String, Value>>,
    stdout: String,
    stderr: String,
    code: u8,
    changes: Map<String, Value>,
    rows: Option<Value>,
}

/// The sandbox's environment around one project folder and HOME.
struct Project {
    home: String,
    cwd: String,
    env: Map<String, Value>,
    skip_update_check: bool,
}

impl Host for Project {
    fn var(&self, name: &str) -> Option<String> {
        if let Some(v) = self.env.get(name) {
            return v.as_str().map(str::to_string);
        }
        match name {
            "HOME" => Some(self.home.clone()),
            "XDG_CONFIG_HOME" => Some(format!("{}/.config", self.home)),
            "XDG_DATA_HOME" => Some(format!("{}/.local/share", self.home)),
            "XDG_CACHE_HOME" => Some(format!("{}/.cache", self.home)),
            "XDG_STATE_HOME" => Some(format!("{}/.local/state", self.home)),
            "HARNESSTAP_SKIP_UPDATE_CHECK" if !self.skip_update_check => None,
            _ => Sandbox.var(name),
        }
    }
    fn stdout_is_tty(&self) -> bool {
        false
    }
    fn stderr_is_tty(&self) -> bool {
        false
    }
    fn telemetry_prologue(&mut self, _: &[String]) {}
    fn profile_names(&mut self) -> ProfileNames {
        ProfileNames::Unknown
    }
    fn cwd(&self) -> Option<String> {
        Some(self.cwd.clone())
    }
}

fn write_tree(base: &Path, files: &Option<Map<String, Value>>) {
    for (rel, content) in files.iter().flatten() {
        let path = base.join(rel);
        match content.as_str() {
            None => std::fs::create_dir_all(&path).unwrap(),
            Some(text) => {
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(&path, text).unwrap();
            }
        }
    }
}

fn is_db_file(name: &str) -> bool {
    ["", "-wal", "-shm", "-journal"]
        .iter()
        .any(|s| name == format!("harnesstap.db{s}"))
}

/// `snapshot` of the recorder: files by path under `tag`, folders as `path/` with no content.
fn snapshot(dir: &Path, tag: &str, out: &mut BTreeMap<String, Option<String>>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries {
        let entry = entry.unwrap();
        let name = entry.file_name().to_string_lossy().into_owned();
        let rel = format!("{tag}/{name}");
        let path = entry.path();
        if std::fs::symlink_metadata(&path).unwrap().is_dir() {
            out.insert(format!("{rel}/"), None);
            snapshot(&path, &rel, out);
        } else if !is_db_file(&name) {
            out.insert(rel, Some(std::fs::read_to_string(&path).unwrap()));
        }
    }
}

/// `dumpDb` of the recorder.
fn dump_db(home: &Path) -> Value {
    let path = home.join(".harnesstap/harnesstap.db");
    if !path.exists() {
        return Value::Null;
    }
    let conn =
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    let rows = |sql: &str| -> Value {
        let Ok(mut stmt) = conn.prepare(sql) else {
            return Value::Null;
        };
        let n = stmt.column_count();
        let rows: Vec<Value> = stmt
            .query_map([], |row| {
                Ok(Value::Array(
                    (0..n)
                        .map(|i| match row.get_ref(i).unwrap() {
                            rusqlite::types::ValueRef::Text(t) => {
                                Value::String(String::from_utf8_lossy(t).into_owned())
                            }
                            other => Value::String(format!("{other:?}")),
                        })
                        .collect(),
                ))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        Value::Array(rows)
    };
    serde_json::json!({
        "plugins": rows("SELECT name, version, description, tags, origin FROM plugins ORDER BY name, version"),
        "environments": rows("SELECT name, description FROM environments ORDER BY name"),
    })
}

static PROJECT_DIRS: AtomicUsize = AtomicUsize::new(0);

/// Builds the run's starting state, runs the port on it and returns its outcome, the changes on
/// disk (as the recorder words them) and the database rows before and after.
fn run_project(
    run: &ProjectRun,
    skip_update_check: bool,
) -> (Outcome, Map<String, Value>, Value, Value) {
    let n = PROJECT_DIRS.fetch_add(1, Ordering::SeqCst);
    let base = std::env::temp_dir().join(format!("cli-rs-proj-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(base.join("project")).unwrap();
    std::fs::create_dir_all(base.join("home")).unwrap();
    let base = base.canonicalize().unwrap();
    let (root, home) = (base.join("project"), base.join("home"));
    write_tree(&root, &run.files);
    write_tree(&home, &run.home);
    let home_s = home.to_string_lossy().into_owned();
    let root_s = root.to_string_lossy().into_owned();
    if let Some(db) = &run.db {
        let env = |name: &str| (name == "HOME").then(|| home_s.clone());
        let opened = db_rs::connection::open(&env).unwrap();
        db_rs::schema::initialize_schema(&opened.conn, Default::default()).unwrap();
        if let Some(sql) = db.as_str() {
            opened.conn.execute_batch(sql).unwrap();
        }
    }
    let mut before = BTreeMap::new();
    snapshot(&root, "[ROOT]", &mut before);
    snapshot(&home, "[HOME]", &mut before);
    let rows_before = dump_db(&home);
    let mut host = Project {
        home: home_s.clone(),
        cwd: root
            .join(run.cwd.as_deref().unwrap_or(""))
            .to_string_lossy()
            .trim_end_matches('/')
            .to_string(),
        env: run.env.clone().unwrap_or_default(),
        skip_update_check,
    };
    let norm = |s: &str| s.replace(&root_s, "[ROOT]").replace(&home_s, "[HOME]");
    let outcome = match cli_rs::run(&mut host, "dist/bin.js", &run.args, &package_version()) {
        Outcome::Answer {
            stdout,
            stderr,
            code,
        } => Outcome::Answer {
            stdout: norm(&stdout),
            stderr: norm(&stderr),
            code,
        },
        Outcome::Acted {
            stdout,
            stderr,
            code,
        } => Outcome::Acted {
            stdout: norm(&stdout),
            stderr: norm(&stderr),
            code,
        },
        Outcome::Original => Outcome::Original,
    };
    let mut after = BTreeMap::new();
    snapshot(&root, "[ROOT]", &mut after);
    snapshot(&home, "[HOME]", &mut after);
    let rows_after = dump_db(&home);
    let mut changes = Map::new();
    for key in before.keys().chain(after.keys()) {
        if before.get(key) != after.get(key) {
            let value = match after.get(key) {
                None => Value::String("$deleted".into()),
                Some(None) => Value::Null,
                Some(Some(text)) => Value::String(norm(text)),
            };
            changes.insert(key.clone(), value);
        }
    }
    std::fs::remove_dir_all(&base).unwrap();
    (outcome, changes, rows_before, rows_after)
}

#[test]
fn project_runs_match_the_original() {
    let runs: Vec<ProjectRun> = serde_json::from_str(include_str!("fixtures/projects.json"))
        .expect("fixtures/projects.json");
    let mut answered = 0;
    let mut failures = Vec::new();
    for run in &runs {
        let (outcome, changes, rows_before, rows_after) = run_project(run, true);
        // The ported update notice runs after a Rust answer (ADR-019), so turning the update
        // check on must not change the outcome.
        if run_project(run, false).0 != outcome {
            failures.push(format!("{:?} differs with the update check on", run.args));
        }
        match outcome {
            Outcome::Answer {
                stdout,
                stderr,
                code,
            }
            | Outcome::Acted {
                stdout,
                stderr,
                code,
            } => {
                answered += 1;
                let want_rows = run.rows.clone().unwrap_or(Value::Null);
                if (stdout.as_str(), stderr.as_str(), code)
                    != (run.stdout.as_str(), run.stderr.as_str(), run.code)
                    || changes != run.changes
                    || rows_after != want_rows
                {
                    failures.push(format!(
                        "{:?}\n  want ({}) {:?} {:?} {:?} {want_rows}\n  got  ({code}) {stdout:?} {stderr:?} {changes:?} {rows_after}",
                        run.args, run.code, run.stdout, run.stderr, run.changes
                    ));
                }
            }
            Outcome::Original => {
                if !changes.is_empty() || rows_before != rows_after {
                    failures.push(format!(
                        "{:?} handed back after writing {changes:?}",
                        run.args
                    ));
                }
            }
        }
    }
    eprintln!("{answered} of {} project runs answered", runs.len());
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
    assert!(
        answered * 10 >= runs.len() * 8,
        "only {answered} of {} answered",
        runs.len()
    );
}
