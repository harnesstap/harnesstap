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

mod targets_replay {
    use super::*;
    use apm_rs::targets::*;
    use std::path::Path;

    fn strings(v: &Value) -> Option<Vec<String>> {
        v.as_array()
            .map(|a| a.iter().map(|s| s.as_str().unwrap().to_owned()).collect())
    }

    #[test]
    fn mappings_and_lookups() {
        let f = load("targets.json");
        for case in f["mappings"].as_array().unwrap() {
            let tokens = strings(&case["tokens"]).unwrap();
            assert_eq!(json!(map_apm_targets(&tokens)), case["ok"], "{tokens:?}");
        }
        for case in f["singles"].as_array().unwrap() {
            let t = case["token"].as_str().unwrap();
            assert_eq!(
                json!(harness_slug_for_apm_target(t)),
                case["harness"],
                "{t}"
            );
            assert_eq!(apm_target_for_harness(t), case["apm"], "{t}");
            assert_eq!(deploy_dir_for_apm_target(t), case["deployDir"], "{t}");
        }
        for case in f["tokenDocs"].as_array().unwrap() {
            let doc = case["document"].as_object().unwrap();
            assert_eq!(
                json!(collect_apm_target_tokens(doc)),
                case["tokens"],
                "{doc:?}"
            );
        }
    }

    fn build_tree(root: &Path, tree: &[String]) {
        for entry in tree {
            if let Some(link) = entry.strip_prefix("link:") {
                std::fs::create_dir_all(root.join("real")).unwrap();
                let _ = std::os::unix::fs::symlink(root.join("real"), root.join(link));
                continue;
            }
            let path = root.join(entry);
            if entry.ends_with('/') {
                let _ = std::fs::create_dir_all(&path);
            } else {
                let _ = std::fs::create_dir_all(path.parent().unwrap());
                let _ = std::fs::write(&path, "x");
            }
        }
    }

    #[test]
    fn resolutions_against_project_trees() {
        let f = load("targets.json");
        let base = std::env::temp_dir().join(format!("apm-rs-targets-{}", std::process::id()));
        for (i, case) in f["resolutions"].as_array().unwrap().iter().enumerate() {
            let root = base.join(format!("p{i}"));
            std::fs::create_dir_all(&root).unwrap();
            build_tree(&root, &strings(&case["tree"]).unwrap());
            let root_str = root.to_str().unwrap().to_owned();
            assert_eq!(
                json!(detect_apm_target_signals(&root_str)),
                case["detected"],
                "case {i}"
            );

            let input = &case["input"];
            let text = |k: &str| input.get(k).and_then(Value::as_str).map(str::to_owned);
            let resolved = resolve_compile_targets(&ResolveCompileTargetsInput {
                project_root: root_str,
                cli_target: text("cliTarget"),
                cli_all: input
                    .get("cliAll")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                cli_harness: text("cliHarness"),
                manifest_harness_targets: input.get("manifestHarnessTargets").and_then(strings),
                preference_harnesses: input.get("preferenceHarnesses").and_then(strings),
                fallback_harnesses: input.get("fallbackHarnesses").and_then(strings),
            });
            match resolved {
                Ok(r) => {
                    assert_eq!(json!(r), case["resolved"]["ok"], "case {i}");
                    let previews = json!([
                        preview_apm_targets(&r, false),
                        preview_apm_targets(&r, true)
                    ]);
                    assert_eq!(previews, case["preview"], "case {i}");
                }
                Err(e) => assert_eq!(e.message(), case["resolved"]["err"], "case {i}"),
            }
        }
        std::fs::remove_dir_all(&base).unwrap();
    }
}
