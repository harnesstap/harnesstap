//! Replays tests/fixtures/manifest-write.json, recorded from the writing half of
//! `apm-manifest.ts` under Node (tests/make-manifest-write-fixtures.mjs).

use std::fs;

use apm_rs::manifest::{format_apm_manifest, serialize_environment_block};
use apm_rs::project_config::parse_project_config_contents;
use serde_json::Value;

#[test]
fn replays_recorded_manifest_writes() {
    let raw = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/manifest-write.json"
    ))
    .expect("fixtures");
    let doc: Value = serde_json::from_str(&raw).expect("json");
    let cases = doc["cases"].as_array().expect("cases");
    assert!(cases.len() > 1000);
    let mut failures = Vec::new();
    for (i, case) in cases.iter().enumerate() {
        let source = case["raw"].as_str().expect("raw");
        let mut config = parse_project_config_contents(source, "apm.yml", None).expect("parses");
        match case["drop"].as_str().expect("drop") {
            "name" => config.apm_name = None,
            "version" => config.apm_version = None,
            "both" => {
                config.apm_name = None;
                config.apm_version = None;
            }
            _ => {}
        }
        let block = serialize_environment_block(&config)
            .map(|b| emit_rs::json::stringify(&Value::Object(b), ""));
        if json_or_null(&block) != case["block"] {
            failures.push(format!(
                "case #{i} block: want {} got {block:?}",
                case["block"]
            ));
        }
        let yaml = format_apm_manifest(&config, case["projectPath"].as_str().expect("path"));
        if yaml != case["yaml"].as_str().expect("yaml") {
            failures.push(format!(
                "case #{i} {source:?} drop {} path {}\n  want {:?}\n  got  {yaml:?}",
                case["drop"], case["projectPath"], case["yaml"]
            ));
        }
    }
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

fn json_or_null(v: &Option<String>) -> Value {
    v.clone().map(Value::String).unwrap_or(Value::Null)
}

/// Parsed configs never carry these, so the replay cannot reach them: an `apm_document` built
/// in code loses the vendor and stripped keys, and an empty `secret_refs` is left out, as in
/// the original.
#[test]
fn drops_reserved_keys_and_empty_secret_refs_from_built_configs() {
    use apm_rs::project_config::{DeckJsonEnvironment, ProjectConfig};
    let mut document = serde_json::Map::new();
    for key in [
        "x-harnesstap",
        "environment",
        "default_environment",
        "profiles",
        "plugins",
        "default_profile",
        "environments",
        "keep",
    ] {
        document.insert(key.into(), Value::from(1));
    }
    let config = ProjectConfig {
        apm_name: Some("n".into()),
        apm_version: Some("1".into()),
        apm_document: Some(document),
        environments: vec![DeckJsonEnvironment {
            name: "dev".into(),
            values: Vec::new(),
            secret_refs: Some(Vec::new()),
        }],
        ..ProjectConfig::default()
    };
    assert_eq!(
        format_apm_manifest(&config, "/p"),
        "keep: 1\nname: n\nversion: \"1\"\nenvironments:\n  dev: {}\n"
    );
}
