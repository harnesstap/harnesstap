//! Replays what `make-fixtures.mjs` recorded from `config/settings.ts`.

use serde_json::{Map, Value};
use settings_rs::*;

/// Numbers as f64, since `JSON.parse` keeps no int/float distinction.
fn norm(v: &Value) -> Value {
    match v {
        Value::Number(n) => emit_rs::js::number_value(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), norm(v))).collect()),
        other => other.clone(),
    }
}

fn settings_from(v: &Value) -> HarnesstapSettings {
    let p = &v["plugins"];
    HarnesstapSettings {
        refresh_max_age_hours: p["refreshMaxAgeHours"].as_f64().unwrap(),
        marketplace_refresh_max_age_minutes: p["marketplaceRefreshMaxAgeMinutes"].as_f64().unwrap(),
        marketplaces: p["marketplaces"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| PluginMarketplaceEntry {
                name: m["name"].as_str().unwrap().into(),
                url: m["url"].as_str().unwrap().into(),
                platforms: serde_json::from_value(m["platforms"].clone()).unwrap(),
                tracked_branches: m
                    .get("trackedBranches")
                    .map(|b| serde_json::from_value(b.clone()).unwrap()),
            })
            .collect(),
        plugin_version_history_limit: v["pluginVersionHistoryLimit"].as_f64().unwrap(),
        plugin_resources: v["harnessSync"]["pluginResources"].as_str().unwrap().into(),
        native_agent_plugins: v["harnessSync"]["nativeAgentPlugins"].as_bool().unwrap(),
        updates: parse_update_settings(Some(&v["updates"])),
    }
}

#[test]
fn settings_match_the_original() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/settings.json")).unwrap();
    let root = std::env::temp_dir().join(format!("settings-rs-{}", std::process::id()));
    let mut failures = Vec::new();
    let cases = fixture["cases"].as_array().unwrap();
    for (i, case) in cases.iter().enumerate() {
        let dir = root.join(i.to_string());
        std::fs::create_dir_all(&dir).unwrap();
        let text = case["text"].as_str().unwrap();
        match case["file"].as_str().unwrap() {
            "both" => {
                std::fs::write(dir.join("config.jsonc"), text).unwrap();
                std::fs::write(
                    dir.join("config.json"),
                    "{\"pluginVersionHistoryLimit\": 3}",
                )
                .unwrap();
            }
            "dir" => std::fs::create_dir(dir.join("config.jsonc")).unwrap(),
            "none" => {}
            f => std::fs::write(dir.join(f), text).unwrap(),
        }
        let d = dir.to_string_lossy().into_owned();
        let mut problems = Vec::new();
        match parse_jsonc(text) {
            Ok(v) if case.get("parseError").is_none() => {
                if norm(&v) != norm(&case["parsed"]) {
                    problems.push(format!("parsed {v}"));
                }
            }
            Ok(v) => problems.push(format!("parsed {v}, expected an error")),
            Err(e) if case.get("parseError").is_none() => problems.push(format!("parse error {e}")),
            Err(_) => {}
        }
        let load = load_settings(&d);
        if norm(&load.to_value()) != norm(&case["load"]) {
            problems.push(format!("load {}", load.to_value()));
        }
        let record = Value::Object(read_toolkit_config_record(&d, None));
        if norm(&record) != norm(&case["record"]) {
            problems.push(format!("record {record}"));
        }
        if let Some(patch) = case.get("patch") {
            let patch: Map<String, Value> = patch.as_object().unwrap().clone();
            match save_update_settings(&d, &patch) {
                Err(_) if case.get("saveError").is_some() => {}
                Ok(_) if case.get("saveError").is_some() => {
                    problems.push("saved, expected an error".into())
                }
                Ok(saved) => {
                    if saved.to_value() != case["saved"] {
                        problems.push(format!("saved {}", saved.to_value()));
                    }
                }
                Err(e) => problems.push(format!("save error {e}")),
            }
        } else if case.get("written").is_some() {
            save_settings(&d, &settings_from(&case["load"])).unwrap();
        } else if case.get("saveError").is_some() && save_settings(&d, &load).is_ok() {
            problems.push("saved, expected an error".into());
        }
        if let Some(written) = case.get("written").and_then(Value::as_str) {
            let actual = std::fs::read_to_string(settings_path(&d)).unwrap();
            if actual != written {
                problems.push(format!("written {actual:?}\n    expected {written:?}"));
            }
        }
        if !problems.is_empty() {
            failures.push(format!("case {i} ({:?}): {}", text, problems.join("; ")));
        }
    }
    for m in fixture["modes"].as_array().unwrap() {
        let got = parse_plugin_resource_mode(m["v"].as_str());
        let ok = got.as_ref().ok().map(|s| Value::String(s.clone()));
        if m.get("ok").cloned() != ok
            || m.get("err").and_then(Value::as_str) != got.as_ref().err().map(String::as_str)
        {
            failures.push(format!("mode {m}: {got:?}"));
        }
    }
    let _ = std::fs::remove_dir_all(&root);
    assert!(
        failures.is_empty(),
        "{} failures\n{}",
        failures.len(),
        failures
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
    assert!(cases.len() >= 2500);
}
