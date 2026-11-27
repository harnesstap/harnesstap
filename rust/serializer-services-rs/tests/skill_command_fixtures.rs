//! Replays tests/fixtures/skill-command-metadata.json, recorded from `skill-command-metadata.ts`
//! under Node by tests/make-skill-command-fixtures.mjs. Each skill tree is rebuilt in a temporary
//! directory, which stands in for `<BASE>` in the recorded paths.

use std::fs;
use std::path::PathBuf;

use serde_json::{Value, json};
use serializer_services_rs::skill_command_metadata::*;

#[test]
fn replays_recorded_skill_command_scans() {
    let raw = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/skill-command-metadata.json"
    ))
    .expect("fixtures");
    let cases: Vec<Value> = serde_json::from_str(&raw).expect("json");
    assert_eq!(cases.len(), 500);
    let base: PathBuf = std::env::temp_dir().join(format!("skill-cmd-rs-{}", std::process::id()));
    let base_str = base.to_str().unwrap().to_owned();
    let mut failures = Vec::new();
    for (i, c) in cases.iter().enumerate() {
        let root = base.join(i.to_string());
        let skill_dir = root.join("skill");
        fs::create_dir_all(&skill_dir).unwrap();
        for e in c["entries"].as_array().unwrap() {
            let full = skill_dir.join(e[0].as_str().unwrap());
            match &e[1] {
                Value::String(text) => {
                    fs::create_dir_all(full.parent().unwrap()).unwrap();
                    fs::write(&full, text).unwrap();
                }
                _ => fs::create_dir_all(&full).unwrap(),
            }
        }
        let dir = skill_dir.to_str().unwrap();
        let skill_dir_arg = match c["dirForm"].as_str().unwrap() {
            "" => dir.to_owned(),
            form => format!("{dir}{form}"),
        };
        let root_str = root.to_str().unwrap().to_owned();
        let relative = |r: &str, f: &str| format!("rel({r}|{f})");
        let input = ScanSkillCommandMetadataInput {
            skill_dir: &skill_dir_arg,
            skill_name: c["skillName"].as_str().unwrap(),
            root_path: &root_str,
            relative_path: &relative,
            imported_from: c.get("importedFrom"),
        };
        let got = match scan_skill_command_metadata_resources(&input) {
            Ok(v) => json!({ "ok": v }),
            Err(e) => json!({ "err": e }),
        };
        let got: Value =
            serde_json::from_str(&got.to_string().replace(&base_str, "<BASE>")).unwrap();
        if got != c["out"] {
            failures.push(format!("#{i}\n  want {}\n  got  {got}", c["out"]));
        }
    }
    let _ = fs::remove_dir_all(&base);
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
