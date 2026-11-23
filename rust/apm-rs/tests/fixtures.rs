//! Replays `fixtures/*.json`, recorded from the TypeScript by `make-fixtures.ts`.

use apm_rs::dependencies::*;
use serde_json::{Value, json};

fn load(name: &str) -> Value {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn outcome<T: serde::Serialize>(r: Result<T, String>) -> Value {
    match r {
        Ok(v) => json!({ "ok": v }),
        Err(e) => json!({ "err": e }),
    }
}

/// The recorded `{ ok }` or `{ err }`. Values compare without key order (the order of the
/// result object's own keys is not observable in the app); `env` and `headers` order is checked
/// separately.
fn same(actual: &Value, recorded: &Value) -> bool {
    let pick = |v: &Value| {
        let mut m = serde_json::Map::new();
        for k in ["ok", "err"] {
            if let Some(x) = v.get(k) {
                m.insert(k.into(), x.clone());
            }
        }
        Value::Object(m)
    };
    pick(actual) == pick(recorded)
}

#[test]
fn apm_entries() {
    let f = load("dependencies.json");
    let mut checked = 0;
    for case in f["apm"].as_array().unwrap() {
        let parsed = parse_apm_dependency_entry(&case["entry"]);
        let fs = parsed.as_ref().ok().map(is_filesystem_apm_dependency);
        let actual = outcome(parsed);
        assert!(
            same(&actual, case),
            "{}\n  got {actual}\n  want {case}",
            case["entry"]
        );
        assert_eq!(json!(fs), case["fs"], "{}", case["entry"]);
        checked += 1;
    }
    assert!(checked > 1500);
}

#[test]
fn mcp_entries() {
    let f = load("dependencies.json");
    for case in f["mcp"].as_array().unwrap() {
        let actual = outcome(parse_mcp_dependency_entry(&case["entry"]));
        assert!(
            same(&actual, case),
            "{}\n  got {actual}\n  want {case}",
            case["entry"]
        );
        for key in ["env", "headers"] {
            let keys = |v: &Value| -> Vec<String> {
                v["ok"][key]
                    .as_object()
                    .map(|m| m.keys().cloned().collect())
                    .unwrap_or_default()
            };
            assert_eq!(keys(&actual), keys(case), "{} {key} order", case["entry"]);
        }
    }
}

#[test]
fn documents() {
    let f = load("dependencies.json");
    for case in f["collect"].as_array().unwrap() {
        let doc = case["document"].as_object().unwrap();
        let all = outcome(
            collect_apm_and_dev_dependencies(doc)
                .map(|(apm, mcp)| json!({ "apm": apm, "mcp": mcp })),
        );
        assert!(
            same(&all, &case["all"]),
            "{doc:?}\n  got {all}\n  want {}",
            case["all"]
        );
        let runtime = outcome(collect_runtime_apm_dependencies(doc));
        assert!(same(&runtime, &case["runtime"]), "{doc:?}\n  got {runtime}");
    }
}
