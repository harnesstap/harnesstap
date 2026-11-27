//! Replays what `make-fixtures.ts` recorded from the original's telemetry prologue:
//! same directories, environment, argv, TTY flag, clock and UUID counter; compares
//! stderr, the requests sent and every file left in the HarnessTap directory.

use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::path::Path;
use telemetry_rs::{Startup, Transport, run_cli_prologue};

#[derive(Default)]
struct Spy(Vec<Value>);

impl Transport for Spy {
    fn send(&mut self, url: &str, body: &str) {
        self.0.push(json!({ "url": url, "body": body }));
    }
}

fn hex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn list_files(home: &Path) -> Value {
    let mut out = BTreeMap::new();
    if home.is_dir() {
        for entry in std::fs::read_dir(home).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let content = if path.is_dir() {
                Value::Null
            } else {
                String::from_utf8_lossy(&std::fs::read(&path).unwrap()).into()
            };
            out.insert(name, content);
        }
    }
    Value::Object(out.into_iter().collect::<Map<_, _>>())
}

#[test]
fn prologue_matches_the_original() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/scenarios.json")).unwrap();
    let version = fixture["version"].as_str().unwrap();
    let platform = fixture["platform"].as_str().unwrap();
    let root = std::env::temp_dir().join(format!("telemetry-rs-{}", std::process::id()));
    let scenarios = fixture["scenarios"].as_array().unwrap();
    let (mut runs, mut failures) = (0, Vec::new());
    for (i, s) in scenarios.iter().enumerate() {
        let base = root.join(i.to_string());
        let home = base.join("home").join(".harnesstap");
        match s["home"].as_str().unwrap() {
            "dir" => std::fs::create_dir_all(&home).unwrap(),
            "file" => {
                std::fs::create_dir_all(base.join("home")).unwrap();
                std::fs::write(&home, "not a directory").unwrap();
            }
            _ => {}
        }
        if let Some(config) = s.get("config") {
            let text = config["text"].as_str().unwrap();
            match config["file"].as_str().unwrap() {
                "dir" => std::fs::create_dir(home.join("config.jsonc")).unwrap(),
                "both" => {
                    std::fs::write(home.join("config.jsonc"), text).unwrap();
                    std::fs::write(
                        home.join("config.json"),
                        r#"{"telemetry":{"enabled":false}}"#,
                    )
                    .unwrap();
                }
                file => std::fs::write(home.join(file), text).unwrap(),
            }
        }
        let state_file = home.join("telemetry-state.json");
        if let Some(state) = s.get("state") {
            if state.get("dir").is_some() {
                std::fs::create_dir(&state_file).unwrap();
            } else if let Some(h) = state["hex"].as_str() {
                std::fs::write(&state_file, hex(h)).unwrap();
            } else {
                std::fs::write(&state_file, state["text"].as_str().unwrap()).unwrap();
            }
        }
        let env_map: Map<String, Value> = s["env"].as_object().unwrap().clone();
        let env = move |name: &str| env_map.get(name).and_then(Value::as_str).map(str::to_owned);
        let argv: Vec<String> = serde_json::from_value(s["argv"].clone()).unwrap();
        let now = s["now"].as_str().unwrap().to_owned();
        let clock = move || now.clone();
        let mut count = 0;
        let mut new_uuid = || {
            count += 1;
            format!("00000000-0000-4000-8000-{count:012}")
        };
        let dir = home.to_string_lossy().into_owned();
        for (r, expected) in s["runs"].as_array().unwrap().iter().enumerate() {
            let (mut spy, mut stderr) = (Spy::default(), Vec::new());
            run_cli_prologue(&mut Startup {
                harnesstap_dir: &dir,
                env: &env,
                exec_path: s["execPath"].as_str().unwrap(),
                argv: &argv,
                stdout_is_tty: s["tty"].as_bool().unwrap(),
                version,
                platform,
                now: &clock,
                new_uuid: &mut new_uuid,
                transport: &mut spy,
                stderr: &mut stderr,
            });
            let actual = json!({
                "stderr": String::from_utf8(stderr).unwrap(),
                "sends": spy.0,
                "files": list_files(&home),
            });
            runs += 1;
            if &actual != expected {
                failures.push(format!(
                    "#{i} {} run {r}\n  expected {expected}\n  actual   {actual}",
                    s["name"]
                ));
            }
        }
    }
    let _ = std::fs::remove_dir_all(&root);
    assert!(
        failures.is_empty(),
        "{} of {runs} runs differ:\n{}",
        failures.len(),
        failures.join("\n")
    );
    assert!(runs > 1000);
}
