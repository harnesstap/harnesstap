//! Replays tests/fixtures/policy.json, recorded by tests/make-policy-fixtures.ts.

use apm_rs::dependencies::{ParsedApmDependency, ParsedMcpDependency};
use apm_rs::policy::*;
use lockfile_rs::{LockEntry, LockMcpServer, LockSource};
use serde_json::{Value, json};

fn load() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/policy.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn err_json(e: &PolicyError) -> Value {
    json!({ "name": e.name, "message": e.message })
}

fn result<T: serde::Serialize>(r: Result<T, PolicyError>) -> Value {
    match r {
        Ok(v) => json!({ "ok": v }),
        Err(e) => json!({ "err": err_json(&e) }),
    }
}

/// `yaml-rs` does not reproduce the `yaml` package's error text: keep `Invalid YAML in <path>:`.
fn normalize(v: &Value) -> Value {
    match v {
        Value::String(s) if s.starts_with("Invalid YAML in ") => {
            let cut = s.find(": ").map_or(s.len(), |i| i + 1);
            Value::String(s[..cut].to_owned())
        }
        Value::Array(a) => Value::Array(a.iter().map(normalize).collect()),
        Value::Object(m) => {
            Value::Object(m.iter().map(|(k, v)| (k.clone(), normalize(v))).collect())
        }
        other => other.clone(),
    }
}

#[test]
fn pins_hashes_and_formats() {
    let f = load();
    for case in f["pins"].as_array().unwrap() {
        let value = &case["value"];
        let arg = (value != "$undefined").then_some(value);
        let mut want = case.clone();
        want.as_object_mut().unwrap().remove("value");
        assert_eq!(result(parse_apm_policy_pin(arg)), want, "{value}");
    }
    for case in f["hashCases"].as_array().unwrap() {
        let bytes: Vec<u8> = case["bytes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b.as_u64().unwrap() as u8)
            .collect();
        let alg: HashAlgorithm = serde_json::from_value(case["algorithm"].clone()).unwrap();
        assert_eq!(hash_policy_bytes(&bytes, alg), case["hash"]);
    }
    for case in f["matchPairs"].as_array().unwrap() {
        let (a, b) = (case["a"].as_str().unwrap(), case["b"].as_str().unwrap());
        assert_eq!(policy_hashes_match(a, b), case["match"], "{a:?} {b:?}");
    }
    for case in f["formats"].as_array().unwrap() {
        let v: Vec<Violation> = serde_json::from_value(case["violations"].clone()).unwrap();
        assert_eq!(format_policy_violations(&v), case["text"]);
    }
}

#[test]
fn documents_and_patterns() {
    let f = load();
    for case in f["documents"].as_array().unwrap() {
        let raw = case["raw"].as_str().unwrap();
        let mut want = case.clone();
        want.as_object_mut().unwrap().remove("raw");
        let got = result(parse_apm_policy_document(raw, "/p/apm-policy.yml"));
        assert_eq!(normalize(&got), normalize(&want), "{raw:?}");
    }
    for case in f["matches"].as_array().unwrap() {
        let pattern = case["pattern"].as_str().unwrap();
        let candidates: Vec<&str> = case["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c.as_str().unwrap())
            .collect();
        let got = result(match_policy_pattern(pattern, &candidates));
        assert_eq!(got["ok"], case["ok"], "{pattern:?} {candidates:?}");
    }
}

fn lock_entry(v: &Value) -> LockEntry {
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
    LockEntry {
        name: s("name").unwrap(),
        version: s("version").unwrap(),
        source: serde_json::from_value::<LockSource>(v["source"].clone()).unwrap(),
        integrity: String::new(),
        depth: v["depth"].as_f64().unwrap(),
        path: vec![],
        repo_url: s("repo_url"),
        resolved_commit: None,
        resolved_ref: None,
        constraint: None,
        resolved_tag: None,
        virtual_path: None,
        content_hash: None,
        exec_status: None,
        declared_license: None,
    }
}

fn mcp_dep(v: &Value) -> ParsedMcpDependency {
    ParsedMcpDependency {
        raw: v["raw"].as_str().unwrap().to_owned(),
        name: v["name"].as_str().unwrap().to_owned(),
        registry_id: v
            .get("registryId")
            .and_then(Value::as_str)
            .map(str::to_owned),
        transport: None,
        command: None,
        args: None,
        url: None,
        env: None,
        headers: None,
        self_defined: false,
    }
}

fn list<T>(v: &Value, f: impl Fn(&Value) -> T) -> Vec<T> {
    v.as_array()
        .map(|a| a.iter().map(f).collect())
        .unwrap_or_default()
}

fn locate(id: &str) -> PluginLocator {
    match id {
        "p-git" => PluginLocator::Git {
            url: "https://github.com/acme/r.git".into(),
        },
        "p-cat" => PluginLocator::Catalog {
            org: "org".into(),
            catalog: "cat".into(),
            slug: "slug".into(),
        },
        "p-mkt" => PluginLocator::Marketplace {
            reference: "x@market".into(),
        },
        _ => PluginLocator::Other,
    }
}

#[test]
fn plans_and_evaluations() {
    let f = load();
    for (i, case) in f["plans"].as_array().unwrap().iter().enumerate() {
        let input = &case["input"];
        let apm: Vec<ParsedApmDependency> = list(&input["apmDependencies"], |d| {
            serde_json::from_value(d.clone()).unwrap()
        });
        let mcp = list(&input["mcpDependencies"], mcp_dep);
        let plan = if case["audit"] == true {
            let lock = input.get("lock").filter(|l| !l.is_null());
            let plugins = lock
                .map(|l| list(&l["plugins"], lock_entry))
                .unwrap_or_default();
            let servers: Option<Vec<LockMcpServer>> =
                lock.and_then(|l| l.get("mcp_servers")).map(|s| {
                    list(s, |m| LockMcpServer {
                        name: m["name"].as_str().unwrap().into(),
                        transport: None,
                        command: None,
                        url: None,
                    })
                });
            build_audit_install_plan(AuditPlanInput {
                overlay_primitives: &[],
                apm_dependencies: &apm,
                mcp_dependencies: &mcp,
                lock_plugins: &plugins,
                lock_mcp_servers: servers.as_deref(),
            })
        } else {
            let selected = serde_json::from_value::<Vec<_>>(input["selected"].clone()).unwrap();
            let decisions = serde_json::from_value::<Vec<_>>(input["decisions"].clone()).unwrap();
            let resources = serde_json::from_value::<Vec<_>>(input["resources"].clone()).unwrap();
            let git_locks: Vec<(String, String)> = list(&input["gitLocks"], |g| {
                (
                    g["name"].as_str().unwrap().into(),
                    g["repo_url"].as_str().unwrap().into(),
                )
            });
            build_apply_install_plan(ApplyPlanInput {
                selected: &selected,
                decisions: &decisions,
                resources: &resources,
                apm_dependencies: &apm,
                mcp_dependencies: &mcp,
                git_locks: &git_locks,
                locate: &mut locate,
            })
        };
        assert_eq!(json!(plan), case["plan"], "plan {i}");
        for e in case["evaluations"].as_array().unwrap() {
            let policy: PolicyDocument = serde_json::from_value(e["policy"].clone()).unwrap();
            let got = result(evaluate_policy(&policy, &plan));
            assert_eq!(got["ok"], e["ok"], "plan {i}");
        }
    }
}

#[test]
fn loads_against_project_trees() {
    let f = load();
    let base = std::env::temp_dir().join(format!("apm-rs-policy-{}", std::process::id()));
    for case in f["loads"].as_array().unwrap() {
        let i = case["index"].as_u64().unwrap();
        let root = base.join(format!("p{i}"));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        let content = case["content"].as_str().unwrap();
        match case["where"].as_u64().unwrap() {
            1 => std::fs::write(root.join("apm-policy.yml"), content).unwrap(),
            2 => std::fs::write(root.join("sub/custom.yml"), content).unwrap(),
            3 => std::fs::create_dir_all(root.join("apm-policy.yml")).unwrap(),
            _ => {}
        }
        if let Some(apm) = case["apmYml"].as_str() {
            std::fs::write(root.join("apm.yml"), apm).unwrap();
        }
        let root_s = root.to_str().unwrap().to_owned();
        let policy_path = case["policyPath"]
            .as_str()
            .map(|p| p.replace("<root>", &root_s));
        let pin: Option<PolicyPin> = serde_json::from_value(case["pin"].clone()).unwrap();
        let strip = |v: Value| -> Value {
            serde_json::from_str(&v.to_string().replace(&root_s, "<root>")).unwrap()
        };
        let loaded = load_project_policy(LoadOptions {
            project_root: &root_s,
            policy_path: policy_path.as_deref(),
            pin,
            require_policy: case["requirePolicy"] == true,
        });
        match loaded {
            Ok(l) => {
                assert_eq!(
                    normalize(&strip(json!({ "ok": l }))),
                    normalize(&case["loaded"]),
                    "load {i}"
                );
                let plan: InstallPlan = serde_json::from_value(case["plan"].clone()).unwrap();
                let ev = result(evaluation_from_load(&l, &plan));
                assert_eq!(
                    normalize(&strip(ev)),
                    normalize(&case["evaluation"]),
                    "evaluation {i}"
                );
            }
            Err(e) => {
                let want = case["loaded"]["err"]["message"].as_str().unwrap();
                assert!(
                    want.starts_with("EISDIR") && e.kind() == std::io::ErrorKind::IsADirectory,
                    "load {i}: {e} vs {want}"
                );
            }
        }
        let pin = result(read_manifest_policy_pin(&root_s));
        assert_eq!(
            normalize(&strip(pin)),
            normalize(&case["manifestPin"]),
            "manifest pin {i}"
        );
    }
    std::fs::remove_dir_all(&base).unwrap();
}
