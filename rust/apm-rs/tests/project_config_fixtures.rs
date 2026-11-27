//! Replays tests/fixtures/project-config.json, recorded from `project-config.ts` under Node
//! (tests/make-project-config-fixtures.mjs). Each recorded project tree is rebuilt in a
//! temporary directory.

use std::fs;
use std::path::Path;

use apm_rs::manifest::ManifestError;
use apm_rs::project_config::{
    ProjectConfig, evaluate_project_config_contents, find_project_config, get_profile_entry,
    locate_project_manifest, merge_project_config_local_overrides, parse_project_config_contents,
    resolve_profile_environment, validate_project_config,
};
use emit_rs::js::{number_to_string, ordered_entries};
use serde_json::{Map, Value, json};

mod common;

use common::scratch;

fn enc_value(v: &Value) -> Value {
    match v {
        Value::Number(n) if n.as_f64().is_some_and(|f| f == 0.0 && f.is_sign_negative()) => {
            json!({ "$num": "-0" })
        }
        Value::Number(n) => json!({ "$num": number_to_string(n) }),
        Value::Array(items) => Value::Array(items.iter().map(enc_value).collect()),
        Value::Object(map) => enc_map(map),
        other => other.clone(),
    }
}

fn enc_map(map: &Map<String, Value>) -> Value {
    let entries: Vec<Value> = ordered_entries(map)
        .into_iter()
        .map(|(k, v)| json!([k, enc_value(v)]))
        .collect();
    json!({ "$obj": entries })
}

fn enc_config(c: &ProjectConfig) -> Value {
    let mut out = Map::new();
    for (k, v) in [
        ("default_profile", &c.default_profile),
        ("default_environment", &c.default_environment),
        ("apm_name", &c.apm_name),
        ("apm_version", &c.apm_version),
        ("apm_description", &c.apm_description),
    ] {
        if let Some(v) = v {
            out.insert(k.into(), json!(v));
        }
    }
    let profiles: Vec<Value> = c
        .profiles
        .iter()
        .map(|p| {
            let mut o = Map::new();
            o.insert("name".into(), json!(p.name));
            o.insert("source".into(), json!(p.source.as_str()));
            for (k, v) in [
                ("selector", &p.selector),
                ("plugin", &p.plugin),
                ("environment", &p.environment),
            ] {
                if let Some(v) = v {
                    o.insert(k.into(), json!(v));
                }
            }
            Value::Object(o)
        })
        .collect();
    out.insert("profiles".into(), Value::Array(profiles));
    let environments: Vec<Value> = c
        .environments
        .iter()
        .map(|e| {
            let mut o = Map::new();
            o.insert("name".into(), json!(e.name));
            o.insert(
                "values".into(),
                json!({ "$obj": e.values.iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>() }),
            );
            if let Some(refs) = &e.secret_refs {
                o.insert(
                    "secret_refs".into(),
                    json!({ "$obj": refs.iter().map(|(k, r)| json!([k, { "provider": r.provider, "ref": r.reference }])).collect::<Vec<_>>() }),
                );
            }
            Value::Object(o)
        })
        .collect();
    out.insert("environments".into(), Value::Array(environments));
    out.insert(
        "plugins".into(),
        Value::Array(c.plugins.iter().map(enc_map).collect()),
    );
    if let Some(doc) = &c.apm_document {
        out.insert("apm_document".into(), enc_map(doc));
    }
    Value::Object(out)
}

fn scrub(s: &str, root: &Path) -> String {
    s.replace(&*root.to_string_lossy(), "<root>")
}

fn enc_err(e: &ManifestError, root: &Path) -> Value {
    json!({ "name": e.name, "message": scrub(&e.message, root) })
}

/// The text after `Invalid project local overrides TOML: ` is the `toml` crate's, not
/// smol-toml's, and after `Invalid YAML in <path>: ` it is saphyr's; only the prefixes are
/// compared.
fn same(want: &Value, got: &Value) -> bool {
    if want == got {
        return true;
    }
    let msg = |v: &Value| v["message"].as_str().map(str::to_owned);
    let (Some(w), Some(g)) = (msg(want), msg(got)) else {
        return false;
    };
    if want["name"] != got["name"] {
        return false;
    }
    const TOML: &str = "Invalid project local overrides TOML: ";
    if w.starts_with(TOML) && g.starts_with(TOML) {
        return true;
    }
    // YAML errors: saphyr's wording after `Invalid YAML in <path>: `.
    let prefix = |s: &str| s.find(": ").map(|i| s[..i + 2].to_owned());
    w.starts_with("Invalid YAML in ") && prefix(&w) == prefix(&g)
}

fn load() -> Value {
    let raw = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/project-config.json"
    ))
    .expect("fixtures");
    serde_json::from_str(&raw).expect("json")
}

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} differ:\n{}",
        failures.len(),
        failures
            .iter()
            .take(8)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn replays_recorded_project_config_contents() {
    let doc = load();
    let cases = doc["contents"].as_array().expect("contents");
    assert_eq!(cases.len(), 2500);
    let empty_root = scratch("project-config-empty");
    let mut failures = Vec::new();
    for (i, case) in cases.iter().enumerate() {
        let raw = case["raw"].as_str().expect("raw");
        let mut got = Map::new();
        match parse_project_config_contents(raw, "apm.yml", None) {
            Ok(config) => {
                got.insert("config".into(), enc_config(&config));
                let v = validate_project_config(&config);
                got.insert(
                    "validation".into(),
                    json!({ "valid": v.valid, "errors": v.errors }),
                );
                let key = case["profile"]["key"].as_str().expect("key");
                let profile = match get_profile_entry(&config, key) {
                    Ok(entry) => {
                        json!({ "key": key, "environment": resolve_profile_environment(&config, entry) })
                    }
                    Err(e) => json!({ "key": key, "err": enc_err(&e, &empty_root) }),
                };
                got.insert("profile".into(), profile);
            }
            Err(e) => {
                got.insert("err".into(), enc_err(&e, &empty_root));
            }
        }
        let evaluate = match evaluate_project_config_contents(raw, "apm.yml", &empty_root) {
            Ok(_) => json!({ "ok": true }),
            Err(errors) => json!({
                "ok": false,
                "errors": errors.iter().map(|e| scrub(e, &empty_root)).collect::<Vec<_>>(),
            }),
        };
        got.insert("evaluate".into(), evaluate);
        let mut want = case.as_object().expect("case").clone();
        want.remove("raw");
        let (want, got) = (Value::Object(want), Value::Object(got));
        if want != got {
            failures.push(format!(
                "contents #{i} {raw:?}\n  want {want}\n  got  {got}"
            ));
        }
    }
    let _ = fs::remove_dir_all(&empty_root);
    report(&failures);
}

#[cfg(unix)]
#[test]
fn replays_recorded_project_trees() {
    let doc = load();
    let base = scratch("project-config-trees")
        .canonicalize()
        .expect("canonical");
    let mut failures = Vec::new();
    for (i, case) in doc["trees"].as_array().expect("trees").iter().enumerate() {
        let root = base.join(format!("t{i}"));
        let project = root.join("proj");
        let nested = case["nested"].as_str().expect("nested");
        fs::create_dir_all(project.join(nested)).expect("dirs");
        match case["kind"].as_str().expect("kind") {
            "file" => fs::write(project.join("apm.yml"), case["raw"].as_str().expect("raw"))
                .expect("write"),
            "dir" => fs::create_dir(project.join("apm.yml")).expect("dir"),
            "symlink" => {
                fs::write(project.join("real.yml"), "name: s\nversion: 1.0.0\n").expect("real");
                std::os::unix::fs::symlink("real.yml", project.join("apm.yml")).expect("link");
            }
            _ => {}
        }
        if let Some(local) = case["local"].as_str() {
            fs::create_dir_all(project.join(".harnesstap")).expect("dir");
            fs::write(project.join(".harnesstap/local.toml"), local).expect("local");
        }
        let start = root.join(case["start"].as_str().expect("start"));
        if case["file"].as_bool().expect("file") {
            fs::write(project.join(nested).join("file.txt"), "x").expect("file");
        }
        if case["skills"].as_bool().expect("skills") {
            fs::create_dir_all(project.join("skills/s")).expect("skills");
            fs::write(
                project.join("skills/s/SKILL.md"),
                "---\nname: s\ndescription: d\n---\nbody\n",
            )
            .expect("skill");
        }
        let ctx = format!("tree #{i} {:?} local {:?}", case["raw"], case["local"]);

        let located = locate_project_manifest(&start).map(|(r, c)| {
            json!({ "rootPath": scrub(&r.to_string_lossy(), &root), "configPath": scrub(&c.to_string_lossy(), &root) })
        });
        if json!(located) != case["located"] {
            failures.push(format!(
                "{ctx} located: want {} got {:?}",
                case["located"], located
            ));
        }

        let (want, got) = match find_project_config(&start) {
            Ok(found) => (
                json!({ "found": case.get("found"), "err": case.get("foundErr") }),
                json!({ "found": found.map(|f| json!({
                    "config": enc_config(&f.config),
                    "rootPath": scrub(&f.root_path.to_string_lossy(), &root),
                    "configPath": scrub(&f.config_path.to_string_lossy(), &root),
                    "harnessTargets": f.harness_targets,
                    "skippedTargets": f.skipped_targets,
                    "warnings": f.warnings,
                    "apmDependencies": f.apm_dependencies,
                    "mcpDependencies": f.mcp_dependencies,
                    "hasPolicyPin": f.policy_pin.is_some(),
                    "overlaySkills": f.overlay.map(|o| o.skills.iter().map(|s| s.name.clone()).collect::<Vec<_>>()),
                    "hasCompilation": f.compilation.is_some(),
                })), "err": Value::Null }),
            ),
            Err(e) => (case["foundErr"].clone(), enc_err(&e, &root)),
        };
        if !same(&want, &got) {
            failures.push(format!("{ctx} find\n  want {want}\n  got  {got}"));
        }

        let base_config = ProjectConfig {
            default_profile: Some("base".into()),
            ..ProjectConfig::default()
        };
        let (want, got) =
            match merge_project_config_local_overrides(base_config, &project.join(".harnesstap")) {
                Ok(c) => (case["merged"].clone(), enc_config(&c)),
                Err(e) => (case["mergedErr"].clone(), enc_err(&e, &root)),
            };
        if !same(&want, &got) {
            failures.push(format!("{ctx} merge\n  want {want}\n  got  {got}"));
        }
    }
    let _ = fs::remove_dir_all(&base);
    report(&failures);
}

/// A parsed inline profile always has a plugin key; one built in code may not, and the
/// original then reports `(missing)`.
#[test]
fn validates_an_inline_profile_without_a_plugin() {
    use apm_rs::project_config::{ProfileSource, ProjectProfileEntry};
    let config = ProjectConfig {
        profiles: vec![ProjectProfileEntry {
            name: "p".into(),
            source: ProfileSource::Inline,
            selector: None,
            plugin: None,
            environment: None,
        }],
        ..ProjectConfig::default()
    };
    let v = validate_project_config(&config);
    assert!(!v.valid);
    assert_eq!(
        v.errors,
        ["Profile p with inline source references unknown plugin: (missing)"]
    );
}
