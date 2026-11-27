//! Replays tests/fixtures/stringify.json, recorded from gray-matter 4.0.3 `matter.stringify`
//! (js-yaml 3.14.2 `safeDump`) under Node with `TZ=UTC` (tests/make-stringify-fixtures.mjs).

use frontmatter_rs::{FrontmatterError, JsValue, emit_frontmatter, stringify};
use serde_json::Value;

fn num(s: &str) -> f64 {
    match s {
        "-0" => -0.0,
        "NaN" => f64::NAN,
        "Infinity" => f64::INFINITY,
        "-Infinity" => f64::NEG_INFINITY,
        s => s.parse().expect("number"),
    }
}

fn dec(v: &Value) -> JsValue {
    match v {
        Value::Null => JsValue::Null,
        Value::Bool(b) => JsValue::Bool(*b),
        Value::String(s) => JsValue::String(s.clone()),
        Value::Array(items) => JsValue::Array(items.iter().map(dec).collect()),
        Value::Object(o) => {
            if o.contains_key("$undef") {
                JsValue::Undefined
            } else if let Some(n) = o.get("$num") {
                JsValue::Number(num(n.as_str().expect("num")))
            } else if let Some(d) = o.get("$date") {
                JsValue::Date(num(d.as_str().expect("date")))
            } else if let Some(b) = o.get("$buf") {
                JsValue::Buffer(
                    b.as_array()
                        .expect("buf")
                        .iter()
                        .map(|x| x.as_u64().expect("byte") as u8)
                        .collect(),
                )
            } else {
                let entries = o["$obj"].as_array().expect("obj");
                JsValue::Object(
                    entries
                        .iter()
                        .map(|e| (e[0].as_str().expect("key").to_owned(), dec(&e[1])))
                        .collect(),
                )
            }
        }
        Value::Number(_) => panic!("bare number in fixture"),
    }
}

#[test]
fn replays_recorded_stringify() {
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/stringify.json"
    ))
    .expect("fixtures");
    let doc: Value = serde_json::from_str(&raw).expect("json");
    let cases = doc["cases"].as_array().expect("cases");
    assert!(cases.len() > 7000, "corpus shrank: {}", cases.len());
    let mut failures = Vec::new();
    let mut refs = 0;
    let mut lone = 0;
    // A lone surrogate (the content's frontmatter is a string with an astral character, spread
    // per UTF-16 unit) is U+FFFD in a JsValue, which js-yaml writes plain.
    let lone_escape = regex::Regex::new(r#""\\uD[89A-F][0-9A-F]{2}""#).expect("regex");
    for (i, case) in cases.iter().enumerate() {
        let kind = case["kind"].as_str().expect("kind");
        let content = case["content"].as_str().expect("content");
        let data = dec(&case["data"]);
        let got = match (kind, &data) {
            ("emit", JsValue::Object(entries)) => emit_frontmatter(entries, content),
            ("stringify", _) => stringify(content, &data),
            _ => panic!("case #{i}: unknown kind {kind}"),
        };
        // The original shares a collection through a YAML alias of the content's frontmatter
        // and writes `&ref_N` anchors; the port reports that as unsupported.
        if case.get("refs").is_some() {
            refs += 1;
            if !matches!(got, Err(FrontmatterError::Unsupported(_))) {
                failures.push(format!(
                    "#{i} {kind} {content:?}: want unsupported, got {got:?}"
                ));
            }
            continue;
        }
        let mut want_out = case.get("out").and_then(Value::as_str).map(str::to_owned);
        if case.get("loneSurrogate").is_some() {
            lone += 1;
            want_out = want_out.map(|w| lone_escape.replace_all(&w, "\u{FFFD}").into_owned());
        }
        let ok = match (&got, want_out, case.get("err")) {
            (Ok(out), Some(want), _) => want == *out,
            (Err(e), _, Some(want)) => want["name"] == e.name() && want["message"] == e.message(),
            _ => false,
        };
        if !ok {
            failures.push(format!(
                "#{i} {kind} {content:?} {}\n  want {}\n  got  {got:?}",
                case["data"],
                case.get("out").or(case.get("err")).unwrap_or(&Value::Null)
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        cases.len(),
        failures
            .iter()
            .take(15)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
    // Known differences, counted so they cannot grow silently.
    assert_eq!(refs, 53, "cases with &ref_N anchors changed");
    assert_eq!(lone, 25, "cases with lone surrogates changed");
}
