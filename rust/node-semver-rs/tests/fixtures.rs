//! Replays `tests/fixtures/semver.json`, recorded from the npm `semver` package by
//! `tests/make-fixtures.mjs`.

use node_semver_rs::{self as semver, Identifier, Options, SemVer};
use serde_json::{Value, json};

fn opts(name: &str) -> Options {
    Options {
        loose: name.starts_with("loose"),
        include_prerelease: name.ends_with("incpr"),
    }
}

fn ident(i: &Identifier) -> Value {
    match i {
        Identifier::Num(n) => json!(n),
        Identifier::Str(s) => json!(s),
    }
}

fn sv(v: Option<SemVer>) -> Value {
    match v {
        None => Value::Null,
        Some(v) => json!({
            "version": v.version,
            "raw": v.raw,
            "prerelease": v.prerelease.iter().map(ident).collect::<Vec<_>>(),
            "build": v.build,
        }),
    }
}

fn s(v: &Value) -> &str {
    v.as_str().expect("string argument")
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .expect("array argument")
        .iter()
        .map(|x| s(x).to_owned())
        .collect()
}

fn ok<T: Into<Value>>(r: Result<T, String>) -> Result<Value, String> {
    r.map(Into::into)
}

fn run(fn_name: &str, args: &[Value], o: Options) -> Result<Value, String> {
    match fn_name {
        "parse" => Ok(sv(semver::parse(s(&args[0]), o))),
        "valid" => Ok(semver::valid(s(&args[0]), o).into()),
        "prerelease" => Ok(semver::prerelease(s(&args[0]), o)
            .map(|p| Value::Array(p.iter().map(ident).collect()))
            .unwrap_or(Value::Null)),
        "coerce" => Ok(sv(semver::coerce(s(&args[0]), o))),
        "major" => ok(semver::major(s(&args[0]), o)),
        "compare" => ok(semver::compare(s(&args[0]), s(&args[1]), o)),
        "rcompare" => ok(semver::rcompare(s(&args[0]), s(&args[1]), o)),
        "compareBuild" => ok(semver::compare_build(s(&args[0]), s(&args[1]), o)),
        "eq" => ok(semver::eq(s(&args[0]), s(&args[1]), o)),
        "gt" => ok(semver::gt(s(&args[0]), s(&args[1]), o)),
        "gte" => ok(semver::gte(s(&args[0]), s(&args[1]), o)),
        "lt" => ok(semver::lt(s(&args[0]), s(&args[1]), o)),
        "lte" => ok(semver::lte(s(&args[0]), s(&args[1]), o)),
        "validRange" => Ok(semver::valid_range(s(&args[0]), o).into()),
        "satisfies" => Ok(semver::satisfies(s(&args[0]), s(&args[1]), o).into()),
        "minVersion" => semver::min_version(s(&args[0]), o).map(sv),
        "maxSatisfying" => ok(semver::max_satisfying(&strings(&args[0]), s(&args[1]), o)),
        "rsort" => {
            let mut v = strings(&args[0]);
            semver::rsort(&mut v, o).map(|()| v.into())
        }
        "sortRcompare" => {
            let mut v = strings(&args[0]);
            semver::sort_rcompare(&mut v).map(|()| v.into())
        }
        other => panic!("unknown function {other}"),
    }
}

/// JSON numbers from JavaScript and from `f64` differ only in spelling (`1` against `1.0`).
fn norm(v: Value) -> Value {
    match v {
        Value::Number(n) => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() <= 9_007_199_254_740_991.0 => json!(f as i64),
            _ => Value::Number(n),
        },
        Value::Array(a) => Value::Array(a.into_iter().map(norm).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, norm(v))).collect()),
        other => other,
    }
}

#[test]
fn replays_recorded_semver() {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/semver.json"
    ))
    .expect("fixtures");
    let cases: Vec<Value> = serde_json::from_str(&text).expect("json");
    let mut failures = Vec::new();
    for case in &cases {
        let fn_name = case["fn"].as_str().expect("fn");
        let args = case["args"].as_array().expect("args");
        let o = opts(case["opts"].as_str().expect("opts"));
        let got = match run(fn_name, args, o) {
            Ok(v) => json!({ "ok": norm(v) }),
            Err(e) => json!({ "err": e }),
        };
        let mut want = case.clone();
        let want = match want.as_object_mut() {
            Some(m) => match (m.remove("ok"), m.remove("err")) {
                (Some(v), _) => json!({ "ok": norm(v) }),
                (_, Some(e)) => json!({ "err": e }),
                _ => Value::Null,
            },
            None => Value::Null,
        };
        if got != want {
            failures.push(format!(
                "{fn_name}({args:?}, {o:?}): want {want}, got {got}"
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
            .take(25)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
