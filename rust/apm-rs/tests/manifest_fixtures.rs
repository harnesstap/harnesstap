//! Replays tests/fixtures/manifest.json, recorded from the reading half of `apm-manifest.ts`
//! and from `apm-mcp-manifest.ts` under Node (tests/make-manifest-fixtures.mjs). Overlay roots
//! are the recorded trees of tests/fixtures/overlay.json, rebuilt in a temporary directory.

use std::fs;
use std::path::Path;

use apm_rs::manifest::{
    ApmCompilationConfig, ApmManifestFields, ManifestError, parse_apm_manifest_contents,
    read_package_runtime_apm_dependencies,
};
use apm_rs::mcp_manifest::{
    append_mcp_registry_id_to_manifest, manifest_has_mcp_registry_id, with_mcp_manifest_append,
};
use emit_rs::js::{number_to_string, ordered_entries};
use serde_json::{Map, Value, json};

mod common;

const MANIFEST_YAML_GAPS: usize = 3;
const MCP_YAML_GAPS: usize = 4;

use common::{enc_overlay, materialize, scratch};

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

fn enc_compilation(c: &ApmCompilationConfig) -> Value {
    let mut entries = vec![json!(["targetTokens", c.target_tokens])];
    if let Some(s) = &c.strategy {
        entries.push(json!(["strategy", s]));
    }
    if let Some(b) = c.source_attribution {
        entries.push(json!(["sourceAttribution", b]));
    }
    entries.push(json!(["exclude", c.exclude]));
    if let Some(s) = &c.chatmode {
        entries.push(json!(["chatmode", s]));
    }
    if let Some(b) = c.single_file {
        entries.push(json!(["singleFile", b]));
    }
    json!({ "$obj": entries })
}

fn enc_fields(f: &ApmManifestFields) -> Value {
    let mut out = Map::new();
    out.insert("name".into(), json!(f.name));
    out.insert("version".into(), json!(f.version));
    if let Some(d) = &f.description {
        out.insert("description".into(), json!(d));
    }
    out.insert("vendor".into(), enc_map(&f.vendor));
    out.insert("harnessTargets".into(), json!(f.harness_targets));
    out.insert("skippedTargets".into(), json!(f.skipped_targets));
    out.insert(
        "apmDependencies".into(),
        serde_json::to_value(&f.apm_dependencies).unwrap(),
    );
    out.insert(
        "mcpDependencies".into(),
        serde_json::to_value(&f.mcp_dependencies).unwrap(),
    );
    if let Some(p) = &f.policy_pin {
        out.insert("policyPin".into(), serde_json::to_value(p).unwrap());
    }
    if f.overlay.is_some() {
        out.insert("overlay".into(), enc_overlay(&f.overlay));
    }
    if let Some(c) = &f.compilation {
        out.insert("compilation".into(), enc_compilation(c));
    }
    out.insert("warnings".into(), json!(f.warnings));
    out.insert("rest".into(), enc_map(&f.rest));
    Value::Object(out)
}

fn enc_err(e: &ManifestError, root: Option<&Path>) -> Value {
    let mut message = e.message.clone();
    if let Some(root) = root {
        message = message.replace(&*root.to_string_lossy(), "<root>");
    }
    json!({ "name": e.name, "message": message })
}

/// The text after `Invalid YAML in <path>: ` is the YAML parser's own wording, which `yaml-rs`
/// does not copy from the `yaml` package; only the prefix is compared.
fn same(want: &Value, got: &Value) -> bool {
    if want == got {
        return true;
    }
    let (Some(w), Some(g)) = (
        want["err"]["message"].as_str(),
        got["err"]["message"].as_str(),
    ) else {
        return false;
    };
    let prefix = |s: &str| s.find(": ").map(|i| s[..i + 2].to_owned());
    w.starts_with("Invalid YAML in ")
        && g.starts_with("Invalid YAML in ")
        && prefix(w) == prefix(g)
        && want["err"]["name"] == got["err"]["name"]
}

/// The two `yaml-rs` gaps recorded in MAP.md: `.inf` and `.nan` read as `null`, and
/// `!!binary` or a collection key returns `Unsupported`.
fn yaml_gap(raw: &str, got: &Value) -> bool {
    let non_finite = raw.lines().any(|l| {
        let v = l.rsplit(": ").next().unwrap_or("").trim();
        matches!(
            v,
            ".nan"
                | ".NaN"
                | ".NAN"
                | ".inf"
                | ".Inf"
                | ".INF"
                | "-.inf"
                | "-.Inf"
                | "-.INF"
                | "+.inf"
        )
    });
    let unsupported = got.to_string().contains("unsupported YAML: ");
    non_finite || unsupported
}

/// A YAML alias to a collection: the original's objects keep their identity, so `stringify`
/// writes `&a1` and `*a1` again; `serde_json` values are copies and come out written twice.
/// Both texts read back to the same data.
fn alias_copy(want: &Value, got: &Value) -> bool {
    let (Some(w), Some(g)) = (want["next"].as_str(), got["next"].as_str()) else {
        return false;
    };
    w.contains("&a")
        && want["added"] == got["added"]
        && yaml_rs::parse(w).ok() == yaml_rs::parse(g).ok()
}

fn load() -> Value {
    let raw = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/manifest.json"
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

#[cfg(unix)]
#[test]
fn replays_recorded_manifests() {
    let doc = load();
    let trees_raw = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/overlay.json"
    ))
    .expect("overlay fixtures");
    let trees: Value = serde_json::from_str(&trees_raw).expect("json");
    let cases = doc["manifests"].as_array().expect("manifests");
    assert_eq!(cases.len(), 1500);
    let base = scratch("manifest");
    let mut failures = Vec::new();
    let mut gaps = 0;
    for (i, case) in cases.iter().enumerate() {
        let raw = case["raw"].as_str().expect("raw");
        let file_path = case["filePath"].as_str().expect("filePath");
        let root = case["tree"].as_u64().map(|t| {
            let root = base.join(format!("m{i}"));
            fs::create_dir_all(&root).expect("root");
            materialize(
                &root,
                trees["trees"][t as usize]["entries"]
                    .as_array()
                    .expect("entries"),
            );
            root
        });
        let got = match parse_apm_manifest_contents(raw, file_path, root.as_deref()) {
            Ok(f) => json!({ "fields": enc_fields(&f) }),
            Err(e) => json!({ "err": enc_err(&e, root.as_deref()) }),
        };
        let want = match case.get("fields") {
            Some(f) => json!({ "fields": f }),
            None => json!({ "err": case["err"] }),
        };
        if !same(&want, &got) {
            if yaml_gap(raw, &got) {
                gaps += 1;
                continue;
            }
            failures.push(format!(
                "manifest #{i} {raw:?}\n  want {want}\n  got  {got}"
            ));
        }
    }
    let _ = fs::remove_dir_all(&base);
    report(&failures);
    assert_eq!(
        gaps, MANIFEST_YAML_GAPS,
        "cases that differ only by a yaml-rs gap"
    );
}

#[cfg(unix)]
#[test]
fn replays_recorded_package_dependencies() {
    let doc = load();
    let base = scratch("manifest-packages");
    let mut failures = Vec::new();
    for (i, case) in doc["packages"]
        .as_array()
        .expect("packages")
        .iter()
        .enumerate()
    {
        let root = base.join(format!("p{i}"));
        fs::create_dir_all(&root).expect("root");
        match case["kind"].as_str().expect("kind") {
            "symlink" => {
                fs::write(root.join("real.yml"), "name: x\n").expect("real");
                std::os::unix::fs::symlink("real.yml", root.join("apm.yml")).expect("symlink");
            }
            "dir" => fs::create_dir(root.join("apm.yml")).expect("dir"),
            "file" => {
                fs::write(root.join("apm.yml"), case["raw"].as_str().expect("raw")).expect("write")
            }
            _ => {}
        }
        let got = match read_package_runtime_apm_dependencies(&root) {
            Ok(deps) => json!({ "deps": deps }),
            Err(e) => json!({ "err": enc_err(&e, Some(&root)) }),
        };
        let want = match case.get("deps") {
            Some(d) => json!({ "deps": d }),
            None => json!({ "err": case["err"] }),
        };
        if !same(&want, &got) {
            failures.push(format!("package #{i}\n  want {want}\n  got  {got}"));
        }
    }
    let _ = fs::remove_dir_all(&base);
    report(&failures);
}

#[test]
fn replays_recorded_mcp_manifest_edits() {
    let doc = load();
    let mut failures = Vec::new();
    let mut gaps = 0;
    for (i, case) in doc["mcp"].as_array().expect("mcp").iter().enumerate() {
        let raw = case["raw"].as_str().expect("raw");
        let id = case["registryId"].as_str().expect("registryId");
        let mut got = Map::new();
        let mut want = Map::new();
        match manifest_has_mcp_registry_id(raw, id) {
            Ok(b) => got.insert("has".into(), json!(b)),
            Err(e) => got.insert("err".into(), enc_err(&e, None)),
        };
        match case.get("has") {
            Some(h) => want.insert("has".into(), h.clone()),
            None => want.insert("err".into(), case["hasErr"].clone()),
        };
        let (got_has, want_has) = (Value::Object(got.clone()), Value::Object(want.clone()));
        if !same(&want_has, &got_has) && !yaml_gap(raw, &got_has) {
            failures.push(format!("mcp #{i} has\n  want {want_has}\n  got  {got_has}"));
        }
        let got = match append_mcp_registry_id_to_manifest(raw, id) {
            Ok((next, added)) => json!({ "next": next, "added": added }),
            Err(e) => json!({ "err": enc_err(&e, None) }),
        };
        let want = match case.get("next") {
            Some(n) => json!({ "next": n, "added": case["added"] }),
            None => json!({ "err": case["appendErr"] }),
        };
        if !same(&want, &got) {
            if yaml_gap(raw, &got) || alias_copy(&want, &got) {
                gaps += 1;
                continue;
            }
            failures.push(format!(
                "mcp #{i} append {raw:?} {id:?}\n  want {want}\n  got  {got}"
            ));
        }
    }
    report(&failures);
    assert_eq!(
        gaps, MCP_YAML_GAPS,
        "cases that differ only by a yaml-rs gap or an alias copy"
    );
}

#[derive(Debug)]
struct RunError(ManifestError);

impl From<ManifestError> for RunError {
    fn from(e: ManifestError) -> Self {
        Self(e)
    }
}

#[test]
fn replays_recorded_manifest_append_runs() {
    let doc = load();
    let base = scratch("manifest-append");
    let mut failures = Vec::new();
    for (i, case) in doc["appendRuns"]
        .as_array()
        .expect("appendRuns")
        .iter()
        .enumerate()
    {
        let root = base.join(format!("a{i}"));
        fs::create_dir_all(&root).expect("root");
        let path = root.join("apm.yml");
        if let Some(file) = case["file"].as_str() {
            fs::write(&path, file).expect("write");
        }
        let exit_code = case["exitCode"].as_i64().expect("exitCode") as i32;
        let throws = case["throws"].as_bool().expect("throws");
        let mut during = Value::Null;
        let result = with_mcp_manifest_append(
            &root,
            "new-server",
            case["dryRun"].as_bool().expect("dryRun"),
            || {
                during = json!(fs::read_to_string(&path).expect("during"));
                if throws {
                    Err(RunError(ManifestError {
                        name: "Error".into(),
                        message: "boom".into(),
                    }))
                } else {
                    Ok(exit_code)
                }
            },
        );
        let mut got = json!({
            "during": during,
            "after": fs::read_to_string(&path).ok(),
        });
        match result {
            Ok(added) => got["added"] = json!(added),
            Err(RunError(e)) => got["err"] = enc_err(&e, Some(&root)),
        }
        let mut want = json!({ "during": case["during"], "after": case["after"] });
        for key in ["added", "err"] {
            if let Some(v) = case.get(key) {
                want[key] = v.clone();
            }
        }
        if got != want {
            failures.push(format!("append run #{i}\n  want {want}\n  got  {got}"));
        }
    }
    let _ = fs::remove_dir_all(&base);
    report(&failures);
}
