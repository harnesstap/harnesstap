//! Replays tests/fixtures/mcp-target.json, recorded from `mcp-target.ts` under Node by
//! tests/make-mcp-target-fixtures.mjs.

use serde_json::{Value, json};
use serializer_services_rs::mcp_target::*;

fn result<T: Into<Value>>(r: Result<T, String>) -> Value {
    match r {
        Ok(v) => json!({ "ok": v.into() }),
        Err(e) => json!({ "err": e }),
    }
}

#[test]
fn replays_recorded_mcp_target_calls() {
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mcp-target.json"
    ))
    .expect("fixtures");
    let cases: Vec<Value> = serde_json::from_str(&raw).expect("json");
    assert_eq!(cases.len(), 4337);
    let mut failures = Vec::new();
    for (i, c) in cases.iter().enumerate() {
        let root = c["root"].as_str().unwrap_or("");
        let got = match c["fn"].as_str().unwrap() {
            "filter" => {
                let resources = c["resources"].as_array().unwrap();
                result(
                    filter_mcp_servers_for_target_path(
                        resources,
                        c["target"].as_str(),
                        root,
                        c["platformId"].as_str(),
                    )
                    .map(|kept| {
                        kept.iter()
                            .map(|k| resources.iter().position(|r| std::ptr::eq(r, *k)).unwrap())
                            .collect::<Vec<_>>()
                    }),
                )
            }
            "portable" => result(is_portable_mcp_resource(&c["resource"])),
            "matches" => json!(source_matches_managed_path(
                c["source"].as_str(),
                c["managed"].as_str().unwrap(),
                root
            )),
            "ids" => json!(harness_ids_for_mcp_path(
                c["target"].as_str().unwrap(),
                root
            )),
            other => panic!("{other}"),
        };
        if got != c["out"] {
            failures.push(format!("#{i} {c}\n  got {got}"));
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
