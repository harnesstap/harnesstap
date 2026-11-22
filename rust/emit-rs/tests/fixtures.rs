//! Replays the outputs recorded from the original's emitters
//! (`make-fixtures.mjs`): generated values plus every YAML and JSON document in
//! `rust/app-cases`.

use serde_json::Value;

fn cases(text: &str) -> Vec<Value> {
    text.lines()
        .map(|line| serde_json::from_str(line).expect("fixture line is JSON"))
        .collect()
}

fn check(name: &str, text: &str, key: &str, emit: impl Fn(&Value) -> String) -> usize {
    let mut failures = Vec::new();
    let mut count = 0;
    for case in cases(text) {
        let Some(expected) = case.get(key).and_then(Value::as_str) else {
            continue;
        };
        count += 1;
        let actual = emit(&case["input"]);
        if actual != expected {
            failures.push(format!(
                "input: {}\nexpected: {expected:?}\nactual:   {actual:?}",
                case["input"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{name}: {} of {count} cases differ; first ones:\n{}",
        failures.len(),
        failures
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    count
}

#[test]
fn yaml_matches_the_original() {
    let n = check(
        "yaml",
        include_str!("fixtures/yaml.jsonl"),
        "output",
        emit_rs::yaml::stringify,
    );
    assert!(n > 3000);
}

#[test]
fn json_matches_the_original() {
    let text = include_str!("fixtures/json.jsonl");
    let pretty = check("json", text, "output", |v| {
        emit_rs::json::stringify(v, "  ")
    });
    let compact = check("json compact", text, "compact", |v| {
        emit_rs::json::stringify(v, "")
    });
    assert!(pretty > 3000 && compact == 500);
}
