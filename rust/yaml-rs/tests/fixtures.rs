//! Replays `tests/fixtures/parse.json`, recorded from the `yaml` package by
//! `tests/make-fixtures.mjs`: every source must parse to the same `JSON.stringify` text, or fail
//! where the original fails. The gaps listed in the crate docs return `YamlError::Unsupported`;
//! the few inputs where the port quietly disagrees are listed in `KNOWN` (and in MAP.md).

use serde_json::Value;
use yaml_rs::{YamlError, parse};

/// Inputs where the port and the original disagree without `Unsupported`.
const KNOWN: &[&str] = &[
    // A repeated `%YAML 1.2` directive: the original warns, saphyr rejects it.
    "%YAML 1.2\n%YAML 1.2\n---\n",
    // Invalid YAML that saphyr accepts: `|` or `>` starting a flow key, an empty implicit key
    // with a block value, and a tab used as indentation.
    "{ |pipe: v }\n",
    "{ >gt: v }\n",
    ": c: value\n",
    "\t: value\n",
];

#[test]
fn replays_recorded_parse() {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/parse.json"
    ))
    .expect("fixtures");
    let cases: Vec<Value> = serde_json::from_str(&text).expect("json");
    let mut failures = Vec::new();
    let (mut unsupported, mut known) = (0, 0);
    for case in &cases {
        let src = case["src"].as_str().expect("src");
        let origin = case["origin"].as_str().unwrap_or("");
        let got = parse(src);
        let ok = match (&got, case.get("json"), case.get("err")) {
            (Ok(v), Some(Value::String(want)), _) => emit_rs::json::stringify(v, "") == *want,
            (Err(YamlError::Parse { code, .. }), None, Some(err)) => match err["code"].as_str() {
                Some(want) => code.is_none_or(|c| c == want),
                None => true,
            },
            (Err(YamlError::Unsupported(_)), _, _) => {
                unsupported += 1;
                true
            }
            _ if KNOWN.contains(&src) => {
                known += 1;
                true
            }
            _ => false,
        };
        if !ok {
            let got = match got {
                Ok(v) => emit_rs::json::stringify(&v, ""),
                Err(e) => format!("{e:?}"),
            };
            failures.push(format!(
                "{origin} {src:?}\n  want {}\n  got  {got}",
                case.get("json")
                    .or(case.get("err"))
                    .cloned()
                    .unwrap_or_default()
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
    assert_eq!(known, KNOWN.len(), "a KNOWN divergence no longer occurs");
    eprintln!(
        "{} cases, {unsupported} unsupported, {known} known",
        cases.len()
    );
    // Collection keys, YAML 1.1 tags and `%YAML 1.1` documents (see the crate docs).
    assert_eq!(unsupported, 54, "unsupported cases");
}
