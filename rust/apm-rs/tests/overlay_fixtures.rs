//! Replays tests/fixtures/overlay.json, recorded from `apm-overlay.ts`, the overlay half of
//! `buildAuditInstallPlan`, `parseHooksJsonContent` and `skillMetadataFromDir` under Node
//! (tests/make-overlay-fixtures.mjs). Each recorded project tree is rebuilt in a temporary
//! directory.

use std::fs;
use std::path::{Path, PathBuf};

use apm_rs::hook_serialization::parse_hooks_json_content;
use apm_rs::overlay::{ApmOverlayInfo, OverlayError, collect_skill_md_files, inspect_apm_overlay};
use apm_rs::policy::overlay_primitives;
use apm_rs::skill_auxiliary::SkillMetadata;
use frontmatter_rs::JsValue;
use serde_json::{Value, json};

fn enc(v: &JsValue) -> Value {
    match v {
        JsValue::Undefined => json!({ "$undef": true }),
        JsValue::Null => Value::Null,
        JsValue::Bool(b) => Value::Bool(*b),
        JsValue::Number(n) if *n == 0.0 && n.is_sign_negative() => json!({ "$num": "-0" }),
        JsValue::Number(n) => json!({ "$num": node_semver_rs::js_number(*n) }),
        JsValue::String(s) => Value::String(s.clone()),
        JsValue::Array(items) => Value::Array(items.iter().map(enc).collect()),
        JsValue::Object(entries) => {
            json!({ "$obj": entries.iter().map(|(k, v)| json!([k, enc(v)])).collect::<Vec<_>>() })
        }
        JsValue::Date(ms) => json!({ "$date": node_semver_rs::js_number(*ms) }),
        JsValue::Buffer(bytes) => json!({ "$buf": bytes }),
    }
}

fn enc_skill_metadata(m: &SkillMetadata) -> Value {
    let mut entries = Vec::new();
    for (k, v) in [
        ("scripts", &m.scripts),
        ("references", &m.references),
        ("companions", &m.companions),
    ] {
        if let Some(list) = v {
            entries.push(json!([k, list]));
        }
    }
    json!({ "$obj": entries })
}

fn enc_overlay(o: &Option<ApmOverlayInfo>) -> Value {
    let Some(o) = o else { return Value::Null };
    json!({
        "present": o.present,
        "fromApm": o.from_apm,
        "skills": o.skills.iter().map(|s| json!({
            "name": s.name, "description": s.description, "content": s.content,
            "skillDirRelative": s.skill_dir_relative, "skillMdRelative": s.skill_md_relative,
            "metadata": enc_skill_metadata(&s.metadata),
        })).collect::<Vec<_>>(),
        "primitives": o.primitives.iter().map(|p| json!({
            "type": p.resource_type, "name": p.name, "description": p.description, "content": p.content,
            "metadata": enc(&p.metadata), "sourceRelative": p.source_relative,
        })).collect::<Vec<_>>(),
        "skippedKinds": o.skipped_kinds,
        "skippedRootDirs": o.skipped_root_dirs,
        "warnings": o.warnings,
    })
}

fn enc_err(e: &OverlayError) -> Value {
    let message = if e.name == "Error" {
        ""
    } else {
        e.message.as_str()
    };
    json!({ "name": e.name, "message": message })
}

fn materialize(root: &Path, entries: &[Value]) {
    for e in entries {
        let p = root.join(e["path"].as_str().expect("path"));
        if let Some(parent) = p.parent() {
            let _ = fs::create_dir_all(parent);
        }
        match e["kind"].as_str().expect("kind") {
            "dir" => {
                let _ = fs::create_dir_all(&p);
            }
            "fifo" => {
                let status = std::process::Command::new("mkfifo")
                    .arg(&p)
                    .status()
                    .expect("mkfifo");
                assert!(status.success());
            }
            "symlink" => {
                #[cfg(unix)]
                let _ = std::os::unix::fs::symlink(e["target"].as_str().expect("target"), &p);
            }
            _ => {
                if fs::write(&p, e["content"].as_str().unwrap_or_default()).is_ok() {
                    #[cfg(unix)]
                    if let Some(mode) = e["mode"].as_u64() {
                        use std::os::unix::fs::PermissionsExt;
                        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(mode as u32));
                    }
                }
            }
        }
    }
}

fn scratch() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("apm-overlay-replay-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch");
    dir
}

#[cfg(unix)]
#[test]
fn replays_recorded_overlays() {
    let raw = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/overlay.json"
    ))
    .expect("fixtures");
    let doc: Value = serde_json::from_str(&raw).expect("json");
    let trees = doc["trees"].as_array().expect("trees");
    assert_eq!(trees.len(), 700);
    let base = scratch();
    let mut failures = Vec::new();
    for (i, tree) in trees.iter().enumerate() {
        let root = base.join(i.to_string());
        fs::create_dir_all(&root).expect("root");
        materialize(&root, tree["entries"].as_array().expect("entries"));
        let exclude: Vec<String> =
            serde_json::from_value(tree["exclude"].clone()).expect("exclude");

        let got = match inspect_apm_overlay(&root, &exclude) {
            Ok(o) => json!({ "overlay": enc_overlay(&o) }),
            Err(e) => json!({ "overlayErr": enc_err(&e) }),
        };
        let want = match tree.get("overlay") {
            Some(o) => json!({ "overlay": o }),
            None => json!({ "overlayErr": tree["overlayErr"] }),
        };
        if got != want {
            failures.push(format!("tree #{i} overlay\n  want {want}\n  got  {got}"));
        }

        let primitives = serde_json::to_value(overlay_primitives(&root)).expect("primitives");
        if primitives != tree["auditPrimitives"] {
            failures.push(format!(
                "tree #{i} audit primitives: want {} got {primitives}",
                tree["auditPrimitives"]
            ));
        }
    }
    let _ = fs::remove_dir_all(&base);
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
fn replays_recorded_skill_md_collections() {
    let raw = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/overlay.json"
    ))
    .expect("fixtures");
    let doc: Value = serde_json::from_str(&raw).expect("json");
    let base = scratch().join("skills");
    let mut failures = Vec::new();
    for (i, tree) in doc["trees"].as_array().expect("trees").iter().enumerate() {
        let root = base.join(i.to_string());
        fs::create_dir_all(&root).expect("root");
        materialize(&root, tree["entries"].as_array().expect("entries"));
        let dir = tree["skillMdDir"].as_str().expect("skillMdDir");
        let got = match collect_skill_md_files(&root, dir) {
            Ok(skills) => {
                json!({ "skillMd": skills.iter().map(|s| json!([s.name, s.skill_dir_relative, enc_skill_metadata(&s.metadata)])).collect::<Vec<_>>() })
            }
            Err(e) => json!({ "skillMdErr": enc_err(&e) }),
        };
        let want = match tree.get("skillMd") {
            Some(v) => json!({ "skillMd": v }),
            None => json!({ "skillMdErr": tree["skillMdErr"] }),
        };
        if got != want {
            failures.push(format!("tree #{i} ({dir})\n  want {want}\n  got  {got}"));
        }
    }
    let _ = fs::remove_dir_all(&base);
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
fn replays_recorded_hook_files() {
    let raw = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/overlay.json"
    ))
    .expect("fixtures");
    let doc: Value = serde_json::from_str(&raw).expect("json");
    for (i, case) in doc["hooks"].as_array().expect("hooks").iter().enumerate() {
        let got: Vec<Value> = parse_hooks_json_content(
            case["content"].as_str().expect("content"),
            "hooks/x.json",
        )
        .iter()
        .map(|r| {
            json!({
                "type": "hook", "name": r.name, "description": r.description, "content": r.content,
                "source": r.source, "metadata": enc(&r.metadata),
            })
        })
        .collect();
        assert_eq!(
            Value::Array(got),
            case["resources"],
            "hook case #{i}: {}",
            case["content"]
        );
    }
}
