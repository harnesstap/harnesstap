//! Replays tests/fixtures/overlay.json, recorded from `apm-overlay.ts`, the overlay half of
//! `buildAuditInstallPlan`, `parseHooksJsonContent` and `skillMetadataFromDir` under Node
//! (tests/make-overlay-fixtures.mjs). Each recorded project tree is rebuilt in a temporary
//! directory.

use std::fs;

use apm_rs::hook_serialization::parse_hooks_json_content;
use apm_rs::overlay::{OverlayError, collect_skill_md_files, inspect_apm_overlay};
use apm_rs::policy::overlay_primitives;
use serde_json::{Value, json};

mod common;

use common::{enc, enc_overlay, enc_skill_metadata, materialize, scratch};

fn enc_err(e: &OverlayError) -> Value {
    let message = if e.name == "Error" {
        ""
    } else {
        e.message.as_str()
    };
    json!({ "name": e.name, "message": message })
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
    let base = scratch("overlay");
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
    let base = scratch("overlay-skills");
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
