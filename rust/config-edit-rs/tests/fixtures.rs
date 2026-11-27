//! Replays tests/fixtures/format-preserving-config.json, recorded from
//! `format-preserving-config.ts` and smol-toml under Node by tests/make-fixtures.mjs.

use config_edit_rs::*;
use serde_json::{Map, Value, json};

/// Numbers as JavaScript holds them (doubles), so `1.0` and `1` compare equal; the recording
/// cannot carry `-0` (JSON prints it `0`).
fn norm(v: &Value) -> Value {
    match v {
        Value::Number(n) => emit_rs::js::number_value(n.as_f64().unwrap() + 0.0),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), norm(v))).collect()),
        other => other.clone(),
    }
}

fn obj(v: &Value) -> Map<String, Value> {
    match norm(v) {
        Value::Object(m) => m,
        other => panic!("not an object: {other}"),
    }
}

fn result(r: Result<String, String>) -> Value {
    match r {
        Ok(s) => json!({ "ok": s }),
        Err(e) => json!({ "err": e }),
    }
}

fn is_record(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Object(m)) if toml_date(&Value::Object(m.clone())).is_none())
}

/// `{ ...a, ...b }`.
fn spread(a: &Map<String, Value>, b: &Map<String, Value>) -> Map<String, Value> {
    let mut out = a.clone();
    for (k, v) in b {
        out.insert(k.clone(), v.clone());
    }
    out
}

/// The `codex` merge of make-fixtures.mjs (`mergeConfigDocuments` in platforms/codex.ts).
fn codex_merge(existing: &Map<String, Value>, overlay: &Map<String, Value>) -> Map<String, Value> {
    let mut merged = existing.clone();
    for (key, value) in emit_rs::js::ordered_entries(overlay) {
        let current = merged.get(key);
        let next = match (key.as_str(), value) {
            ("permissions", Value::Object(v)) if is_record(current) => {
                Value::Object(spread(current.unwrap().as_object().unwrap(), v))
            }
            ("shell_environment_policy", Value::Object(v)) if is_record(current) => {
                let policy = current.unwrap().as_object().unwrap();
                let set = |m: &Map<String, Value>| match m.get("set") {
                    s @ Some(Value::Object(x)) if is_record(s) => x.clone(),
                    _ => Map::new(),
                };
                let mut p = spread(policy, v);
                p.insert("set".into(), Value::Object(spread(&set(policy), &set(v))));
                Value::Object(p)
            }
            _ => value.clone(),
        };
        if key != "__proto__" {
            merged.insert(key.clone(), next);
        }
    }
    merged
}

fn report(failures: &[String]) {
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

fn load() -> Value {
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/format-preserving-config.json"
    ))
    .expect("fixtures");
    serde_json::from_str(&raw).expect("json")
}

#[test]
fn replays_json_cases() {
    let doc = load();
    let cases = doc["json"].as_array().unwrap();
    assert_eq!(cases.len(), 3858);
    let mut failures = Vec::new();
    for (i, c) in cases.iter().enumerate() {
        let raw = c["raw"].as_str();
        let got = match c["fn"].as_str().unwrap() {
            "parse" => parse_json_object(raw.unwrap()).map_or(Value::Null, Value::Object),
            "overlay" => {
                let opts = &c["opts"];
                let keys: Vec<String> = opts
                    .get("mergeObjectKeys")
                    .map(|k| serde_json::from_value(k.clone()).unwrap())
                    .unwrap_or_default();
                let on = if opts["onUnparseable"] == "keep" {
                    OnUnparseable::Keep
                } else {
                    OnUnparseable::Replace
                };
                result(overlay_json_preserving_format(
                    raw,
                    &obj(&c["overlay"]),
                    &keys,
                    on,
                ))
            }
            "update" => result(apply_json_object_update_preserving_format(
                raw.unwrap(),
                &obj(&c["next"]),
            )),
            other => panic!("{other}"),
        };
        if norm(&got) != norm(&c["out"]) {
            failures.push(format!(
                "#{i} {} {:?}\n  want {}\n  got  {got}",
                c["fn"], raw, c["out"]
            ));
        }
    }
    report(&failures);
}

#[test]
fn replays_toml_cases() {
    let doc = load();
    let cases = doc["toml"].as_array().unwrap();
    assert_eq!(cases.len(), 3999);
    let mut failures = Vec::new();
    for (i, c) in cases.iter().enumerate() {
        let raw = c["raw"].as_str();
        let got = match c["fn"].as_str().unwrap() {
            "parse" => match parse_toml(raw.unwrap()) {
                Ok(m) => json!({ "ok": m }),
                Err(_) => json!({ "err": true }),
            },
            "overlay" => {
                let merge = c["merge"].as_str().unwrap();
                result(overlay_toml_preserving_format(
                    raw,
                    &obj(&c["overlay"]),
                    |e, o| {
                        if merge == "codex" {
                            codex_merge(e, o)
                        } else {
                            spread(e, o)
                        }
                    },
                ))
            }
            "update" => result(apply_toml_object_update_preserving_format(
                raw.unwrap(),
                &obj(&c["next"]),
            )),
            "stringify" => result(toml_stringify(&obj(&c["value"]))),
            other => panic!("{other}"),
        };
        if norm(&got) != norm(&c["out"]) {
            failures.push(format!(
                "#{i} {} {:?}\n  want {}\n  got  {got}",
                c["fn"], raw, c["out"]
            ));
        }
    }
    report(&failures);
}
