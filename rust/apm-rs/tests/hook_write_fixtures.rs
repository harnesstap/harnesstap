//! Replays tests/fixtures/hook-write.json, recorded from the writing half of
//! `hook-serialization.ts` under Node by tests/make-hook-write-fixtures.mjs.

use apm_rs::hook_serialization::*;
use serde_json::{Map, Value, json};

/// Numbers as JavaScript holds them, so `1.0` and `1` compare equal.
fn norm(v: &Value) -> Value {
    match v {
        Value::Number(n) => emit_rs::js::number_value(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), norm(v))).collect()),
        other => other.clone(),
    }
}

/// JSON text, as the original writes the document (key order included).
fn text(v: &Value) -> String {
    emit_rs::json::stringify(&norm(v), "")
}

#[test]
fn replays_recorded_hook_writes() {
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/hook-write.json"
    ))
    .expect("fixtures");
    let doc: Value = serde_json::from_str(&raw).expect("json");
    let cases = doc["cases"].as_array().unwrap();
    let strips = doc["strips"].as_array().unwrap();
    assert_eq!((cases.len(), strips.len()), (1200, 400));
    let mut failures = Vec::new();
    for (i, c) in cases.iter().enumerate() {
        let hooks = c["hooks"].as_array().unwrap();
        let o = &c["options"];
        let options = BuildHooksJsonOptions {
            version: o.get("version").cloned(),
            shape: if o["shape"] == "flat" {
                HooksJsonShape::Flat
            } else {
                HooksJsonShape::Wrapped
            },
            include_plugin_root: o["includePluginRoot"] == true,
        };
        let built = build_hooks_json(hooks, &options);
        let requires: Vec<bool> = hooks.iter().map(hook_requires_plugin_root).collect();
        let kept: Vec<usize> = user_hooks_for_host_config(hooks)
            .0
            .iter()
            .map(|k| hooks.iter().position(|h| std::ptr::eq(h, *k)).unwrap())
            .collect();
        let got = json!({ "built": text(&built), "requires": requires, "kept": kept });
        let want =
            json!({ "built": text(&c["built"]), "requires": c["requires"], "kept": c["kept"] });
        if got != want {
            failures.push(format!("build #{i}\n  want {want}\n  got  {got}"));
        }
    }
    for (i, s) in strips.iter().enumerate() {
        let hooks: Map<String, Value> = s["hooks"].as_object().unwrap().clone();
        let stripped = Value::Object(strip_plugin_root_commands_from_hooks_object(&hooks));
        let read: Vec<Value> = parse_hooks_json_content(
            &serde_json::to_string(&json!({ "hooks": hooks })).unwrap(),
            "hooks.json",
        )
        .into_iter()
        .map(|r| {
            let mut m = r.metadata.to_json();
            m["name"] = Value::String(r.name);
            m
        })
        .collect();
        let rebuilt = build_hooks_json(&read, &BuildHooksJsonOptions::default());
        let got = json!([text(&stripped), text(&Value::Array(read)), text(&rebuilt)]);
        let want = json!([text(&s["stripped"]), text(&s["read"]), text(&s["rebuilt"])]);
        if got != want {
            failures.push(format!("strip #{i}\n  want {want}\n  got  {got}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} differ:\n{}",
        failures.len(),
        failures
            .iter()
            .take(6)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
