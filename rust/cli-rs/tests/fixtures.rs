//! Replays `tests/fixtures/runs.json` (recorded by `make-fixtures.mjs` from the original
//! under `rust/run-sandboxed.sh`): every argv the port answers must give the original's
//! stdout, stderr and exit code byte for byte. The rest must be left to the original.
//! `tests/fixtures/harness-runs.json` adds the harness actions across states: each run
//! rebuilds the state (files and database rows), and an answered run must also leave the
//! same rows and files.

use cli_rs::{Host, Outcome, ProfileNames};
use serde::Deserialize;
use serde_json::{Value, json};

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
            // Never the real home: no run here should reach a database.
            "HOME" => "/tmp/ht-cli-rs-sandbox",
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
            Outcome::Answer {
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
fn colored_or_telemetry_runs_go_to_the_original() {
    struct Tty;
    impl Host for Tty {
        fn var(&self, name: &str) -> Option<String> {
            (name == "HARNESSTAP_TELEMETRY").then(|| "0".to_string())
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
    }
    let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(
        cli_rs::run(&mut Tty, "ht", &args(&["--help"]), "1"),
        Outcome::Original
    );
    assert_eq!(
        cli_rs::run(&mut Tty, "ht", &args(&["plugin", "--help"]), "1"),
        Outcome::Original
    );
    assert_eq!(
        cli_rs::run(&mut Tty, "ht", &args(&["frobnicate"]), "1"),
        Outcome::Original
    );
    // Errors carry no color, so a TTY does not matter.
    assert!(matches!(
        cli_rs::run(&mut Tty, "ht", &args(&["plugin", "--bogus"]), "1"),
        Outcome::Answer { code: 1, .. }
    ));
    struct Telemetry;
    impl Host for Telemetry {
        fn var(&self, _: &str) -> Option<String> {
            None
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
    }
    assert_eq!(
        cli_rs::run(&mut Telemetry, "ht", &args(&["plugin", "--bogus"]), "1"),
        Outcome::Original
    );
}

#[derive(Deserialize)]
struct HarnessRun {
    state: String,
    args: Vec<String>,
    before: Value,
    stdout: String,
    stderr: String,
    code: u8,
    after: Value,
}

/// The sandbox in a HOME of its own, run from `HOME/proj`.
struct InHome {
    home: String,
    cwd: String,
}

impl Host for InHome {
    fn var(&self, name: &str) -> Option<String> {
        if name == "HOME" {
            return Some(self.home.clone());
        }
        Sandbox.var(name)
    }
    fn stdout_is_tty(&self) -> bool {
        false
    }
    fn stderr_is_tty(&self) -> bool {
        false
    }
    fn stdin_is_tty(&self) -> bool {
        false
    }
    fn cwd(&self) -> Option<String> {
        Some(self.cwd.clone())
    }
    fn profile_names(&mut self) -> ProfileNames {
        ProfileNames::Names(Vec::new())
    }
}

fn real(path: &str) -> String {
    std::fs::canonicalize(path)
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

/// The recorder's normalization: `$HOME`, then (`all`) `<ts>` and `<id>`.
fn norm(text: &str, home: &str, all: bool) -> String {
    let text = text.replace(&real(home), "$HOME").replace(home, "$HOME");
    if !all {
        return text;
    }
    let ts = regex::Regex::new(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z").unwrap();
    let id = regex::Regex::new(r"\b[0-9A-HJKMNP-TV-Z]{26}\b").unwrap();
    let text = ts.replace_all(&text, "<ts>");
    id.replace_all(&text, "<id>").into_owned()
}

fn db_env(home: &str) -> impl Fn(&str) -> Option<String> + '_ {
    move |name: &str| (name == "HOME").then(|| home.to_string())
}

fn sql_value(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as V;
    match v {
        Value::Null => V::Null,
        Value::Number(n) => n
            .as_i64()
            .map_or_else(|| V::Real(n.as_f64().unwrap()), V::Integer),
        Value::String(s) => V::Text(s.clone()),
        other => {
            let hex = other["$blob"].as_str().unwrap();
            V::Blob(
                (0..hex.len())
                    .step_by(2)
                    .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                    .collect(),
            )
        }
    }
}

/// Writes the recorded files and database rows (`$HOME` read as `home`'s real path).
fn rebuild(home: &str, before: &Value) {
    let text = before.to_string().replace("$HOME", &real(home));
    let before: Value = serde_json::from_str(&text).unwrap();
    for (path, content) in before["files"].as_object().unwrap() {
        let full = format!("{home}/{path}");
        match content {
            Value::Bool(true) => std::fs::create_dir_all(&full).unwrap(),
            Value::String(s) if s != "<db>" => std::fs::write(&full, s).unwrap(),
            _ => {}
        }
    }
    let tables = before["tables"].as_object().unwrap();
    if tables.is_empty() {
        return;
    }
    let env = db_env(home);
    let db = db_rs::connection::open(&env).unwrap();
    db_rs::schema::initialize_schema(&db.conn, Default::default()).unwrap();
    db.conn.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
    for (table, rows) in tables {
        db.conn
            .execute(&format!("DELETE FROM \"{table}\""), [])
            .unwrap();
        for row in rows.as_array().unwrap() {
            let row = row.as_object().unwrap();
            let columns: Vec<String> = row.keys().map(|k| format!("\"{k}\"")).collect();
            let marks = vec!["?"; row.len()].join(", ");
            let values: Vec<_> = row.values().map(sql_value).collect();
            db.conn
                .execute(
                    &format!(
                        "INSERT INTO \"{table}\" ({}) VALUES ({marks})",
                        columns.join(", ")
                    ),
                    rusqlite::params_from_iter(values),
                )
                .unwrap();
        }
    }
}

/// The files under `home` and every non-empty table, like the recorder's `snapshot`,
/// with rows (and the recorded ones) sorted the same way.
fn snapshot(home: &str) -> Value {
    fn walk(dir: &std::path::Path, rel: &str, files: &mut serde_json::Map<String, Value>) {
        let mut entries: Vec<_> = std::fs::read_dir(dir).unwrap().flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            let path = format!("{rel}{name}");
            if e.path().is_dir() {
                files.insert(format!("{path}/"), Value::Bool(true));
                walk(&e.path(), &format!("{path}/"), files);
            } else if [".db", ".db-wal", ".db-shm", ".db-journal"]
                .iter()
                .any(|x| name.ends_with(x))
            {
                files.insert(path, json!("<db>"));
            } else {
                files.insert(path, json!(std::fs::read_to_string(e.path()).unwrap()));
            }
        }
    }
    let mut files = serde_json::Map::new();
    walk(std::path::Path::new(home), "", &mut files);
    let mut tables = serde_json::Map::new();
    let db_path = format!("{home}/.harnesstap/harnesstap.db");
    if std::path::Path::new(&db_path).exists() {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let mut names = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .unwrap();
        let names: Vec<String> = names
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        for name in names {
            let mut stmt = conn.prepare(&format!("SELECT * FROM \"{name}\"")).unwrap();
            let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
            let rows: Vec<Value> = stmt
                .query_map([], |r| {
                    let mut row = serde_json::Map::new();
                    for (i, c) in columns.iter().enumerate() {
                        use rusqlite::types::ValueRef as V;
                        let v = match r.get_ref(i)? {
                            V::Null => Value::Null,
                            V::Integer(n) => json!(n),
                            V::Real(f) if f.fract() == 0.0 => json!(f as i64),
                            V::Real(f) => json!(f),
                            V::Text(t) => json!(String::from_utf8_lossy(t)),
                            V::Blob(b) => json!({ "$blob": b.iter().map(|x| format!("{x:02x}")).collect::<String>() }),
                        };
                        row.insert(c.clone(), v);
                    }
                    Ok(Value::Object(row))
                })
                .unwrap()
                .map(Result::unwrap)
                .collect();
            if !rows.is_empty() {
                tables.insert(name, Value::Array(rows));
            }
        }
    }
    let text = json!({ "files": files, "tables": tables }).to_string();
    sorted(serde_json::from_str(&norm(&text, home, true)).unwrap())
}

fn sorted(mut snapshot: Value) -> Value {
    if let Some(tables) = snapshot["tables"].as_object_mut() {
        for rows in tables.values_mut() {
            if let Some(rows) = rows.as_array_mut() {
                rows.sort_by_key(|r| r.to_string());
            }
        }
    }
    snapshot
}

#[test]
fn harness_runs_match_the_original() {
    let runs: Vec<HarnessRun> = serde_json::from_str(include_str!("fixtures/harness-runs.json"))
        .expect("fixtures/harness-runs.json");
    let version = package_version();
    let base = "/tmp/ht-cli-harness-rs";
    let _ = std::fs::remove_dir_all(base);
    let (mut answered, mut failures) = (0, Vec::new());
    for (i, run) in runs.iter().enumerate() {
        let home = format!("{base}/{i}");
        std::fs::create_dir_all(format!("{home}/proj")).unwrap();
        rebuild(&home, &run.before);
        let mut host = InHome {
            cwd: real(&format!("{home}/proj")),
            home: home.clone(),
        };
        if let Outcome::Answer {
            stdout,
            stderr,
            code,
        } = cli_rs::run(&mut host, "dist/bin.js", &run.args, &version)
        {
            answered += 1;
            let got = (norm(&stdout, &home, true), norm(&stderr, &home, true), code);
            if got != (run.stdout.clone(), run.stderr.clone(), run.code) {
                failures.push(format!(
                    "[{}] {:?}\n  want ({}) {:?} {:?}\n  got  ({}) {:?} {:?}",
                    run.state, run.args, run.code, run.stdout, run.stderr, got.2, got.0, got.1
                ));
            }
            let after = snapshot(&home);
            let want = sorted(run.after.clone());
            if after != want {
                failures.push(format!(
                    "[{}] {:?} state\n  want {want}\n  got  {after}",
                    run.state, run.args
                ));
            }
        }
        std::fs::remove_dir_all(&home).unwrap();
    }
    let _ = std::fs::remove_dir_all(base);
    eprintln!("{answered} of {} harness runs answered", runs.len());
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
    // Everything but `harness sync` is answered in this sandbox.
    let sync = runs
        .iter()
        .filter(|r| r.args.contains(&"sync".to_string()))
        .count();
    assert_eq!(answered, runs.len() - sync);
}
