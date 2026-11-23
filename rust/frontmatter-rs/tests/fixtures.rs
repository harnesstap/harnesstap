//! Replays tests/fixtures/frontmatter.json, recorded from gray-matter 4.0.3 and js-yaml 3.14.2
//! under Node with `TZ=UTC` (tests/make-fixtures.mjs).

use frontmatter_rs::{
    FrontmatterError, GrayMatterFile, JsValue, LoadError, parse_frontmatter,
    parse_frontmatter_lenient, yaml_safe_load,
};
use serde_json::{Value, json};

fn enc(v: &JsValue) -> Value {
    match v {
        JsValue::Undefined => json!({ "$undef": true }),
        JsValue::Null => Value::Null,
        JsValue::Bool(b) => Value::Bool(*b),
        JsValue::Number(n) if *n == 0.0 && n.is_sign_negative() => json!({ "$num": "-0" }),
        JsValue::Number(n) => json!({ "$num": node_semver_rs::js_number(*n) }),
        JsValue::String(s) => Value::String(s.clone()),
        JsValue::Array(items) => Value::Array(items.iter().map(enc).collect()),
        JsValue::Object(entries) => {
            json!({ "$obj": entries.iter().map(|(k, v)| json!([k, enc(v)])).collect::<Vec<_>>() })
        }
        JsValue::Date(ms) => json!({ "$date": node_semver_rs::js_number(*ms) }),
        JsValue::Buffer(bytes) => json!({ "$buf": bytes }),
    }
}

fn enc_file(f: &GrayMatterFile) -> Value {
    let mut out = json!({ "data": enc(&f.data), "content": f.content, "excerpt": f.excerpt });
    let o = out.as_object_mut().expect("object");
    if let Some(v) = f.is_empty {
        o.insert("isEmpty".into(), Value::Bool(v));
    }
    for (k, v) in [
        ("empty", &f.empty),
        ("language", &f.language),
        ("matter", &f.matter),
    ] {
        if let Some(s) = v {
            o.insert(k.into(), Value::String(s.clone()));
        }
    }
    out
}

enum Outcome {
    Ok(Value),
    Err(String, String),
    Unsupported,
}

fn run(kind: &str, input: &str) -> Outcome {
    let err = |e: FrontmatterError| match e {
        FrontmatterError::Unsupported(_) => Outcome::Unsupported,
        FrontmatterError::Json(_) => Outcome::Err("SyntaxError".into(), String::new()),
        e => Outcome::Err(e.name().into(), e.message().into()),
    };
    match kind {
        "load" => match yaml_safe_load(input) {
            Ok(v) => Outcome::Ok(v.as_ref().map_or(json!({ "$undef": true }), enc)),
            Err(LoadError::Yaml(y)) => Outcome::Err("YAMLException".into(), y.message),
            Err(LoadError::Unsupported(_)) => Outcome::Unsupported,
        },
        "parse" => parse_frontmatter(input).map_or_else(err, |f| Outcome::Ok(enc_file(&f))),
        "lenient" => {
            parse_frontmatter_lenient(input).map_or_else(err, |f| Outcome::Ok(enc_file(&f)))
        }
        other => panic!("unknown kind {other}"),
    }
}

#[test]
fn replays_recorded_frontmatter() {
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/frontmatter.json"
    ))
    .expect("fixtures");
    let doc: Value = serde_json::from_str(&raw).expect("json");
    let cases = doc["cases"].as_array().expect("cases");
    assert!(cases.len() > 9000, "corpus shrank: {}", cases.len());
    let mut failures = Vec::new();
    for (i, case) in cases.iter().enumerate() {
        let kind = case["kind"].as_str().expect("kind");
        let input = case["input"].as_str().expect("input");
        let got = run(kind, input);
        let ok = match (&got, case) {
            (_, c) if c.get("unsupported").is_some() => matches!(got, Outcome::Unsupported),
            (Outcome::Ok(v), c) if c.get("ok").is_some() => *v == c["ok"],
            (Outcome::Err(name, message), c) if c.get("err").is_some() => {
                c["err"]["name"] == *name.as_str() && c["err"]["message"] == *message.as_str()
            }
            _ => false,
        };
        if !ok {
            let shown = match got {
                Outcome::Ok(v) => v.to_string(),
                Outcome::Err(n, m) => format!("{n}: {m}"),
                Outcome::Unsupported => "unsupported".into(),
            };
            failures.push(format!(
                "#{i} {kind} {input:?}\n  want {}\n  got  {shown}",
                {
                    let mut c = case.clone();
                    c.as_object_mut().map(|o| o.remove("input"));
                    c
                }
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
}
