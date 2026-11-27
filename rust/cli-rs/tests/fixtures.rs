//! Replays `tests/fixtures/runs.json` (recorded by `make-fixtures.mjs` from the original
//! under `rust/run-sandboxed.sh`): every argv the port answers must give the original's
//! stdout, stderr and exit code byte for byte. The rest must be left to the original.

use cli_rs::{Host, Outcome, ProfileNames};
use serde::Deserialize;

#[derive(Deserialize)]
struct Run {
    args: Vec<String>,
    stdout: String,
    stderr: String,
    code: u8,
}

/// The environment `rust/run-sandboxed.sh` sets, a fresh database and no TTY.
struct Sandbox;

impl Host for Sandbox {
    fn var(&self, name: &str) -> Option<String> {
        let value = match name {
            "HARNESSTAP_TELEMETRY" | "FORCE_COLOR" => "0",
            "NO_COLOR" | "CI" | "HARNESSTAP_NO_INTERACTIVE" => "1",
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
