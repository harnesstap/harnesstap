//! Replays `tests/fixtures/resolve.json`, recorded from the TypeScript by `tests/make-fixtures.ts`.

use resolve_rs::plugin_constraints::{
    VersionConstraint, parse_version_constraint, satisfies_constraint,
};
use resolve_rs::types::{ConstraintRecord, DependencySourceKind};
use resolve_rs::version_mediation::{
    MediationError, SelectInput, intersect_constraints, normalize_constraint, select_version,
};
use serde_json::{Value, json};

fn s(v: &Value) -> &str {
    v.as_str().expect("string")
}

fn plain_err(message: String) -> Value {
    json!({ "name": "Error", "message": message })
}

fn select(input: &Value) -> Result<Value, Value> {
    let opt = |k: &str| input.get(k).and_then(Value::as_str).map(str::to_owned);
    let input = SelectInput {
        name: s(&input["name"]).to_owned(),
        available: serde_json::from_value(input["available"].clone()).expect("available"),
        constraints: serde_json::from_value::<Vec<ConstraintRecord>>(input["constraints"].clone())
            .expect("constraints"),
        root_override: opt("rootOverride"),
        root_name: s(&input["rootName"]).to_owned(),
        source_kind: input
            .get("sourceKind")
            .map(|k| serde_json::from_value::<DependencySourceKind>(k.clone()).expect("kind")),
        plugin_ref: opt("pluginRef"),
    };
    match select_version(&input) {
        Ok((version, reason)) => Ok(json!({ "version": version, "reason": reason })),
        Err(MediationError::Constraint(m)) => Err(plain_err(m)),
        Err(MediationError::Unsatisfiable(e)) => Err(serde_json::to_value(&*e).expect("error")),
    }
}

fn run(fn_name: &str, args: &[Value]) -> Result<Value, Value> {
    match fn_name {
        "parseVersionConstraint" => parse_version_constraint(s(&args[0]))
            .map(|c| match c {
                VersionConstraint::Exact { version } => {
                    json!({ "kind": "exact", "version": version })
                }
                VersionConstraint::Range { range } => json!({ "kind": "range", "range": range }),
            })
            .map_err(plain_err),
        "normalizeConstraint" => normalize_constraint(s(&args[0]))
            .map(Value::from)
            .map_err(plain_err),
        "satisfiesConstraint" => satisfies_constraint(s(&args[0]), s(&args[1]))
            .map(Value::from)
            .map_err(plain_err),
        "intersectConstraints" => {
            let list: Vec<String> = serde_json::from_value(args[0].clone()).expect("list");
            intersect_constraints(&list)
                .map(Value::from)
                .map_err(plain_err)
        }
        "selectVersion" => select(&args[0]),
        other => panic!("unknown function {other}"),
    }
}

#[test]
fn replays_recorded_resolve() {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/resolve.json"
    ))
    .expect("fixtures");
    let cases: Vec<Value> = serde_json::from_str(&text).expect("json");
    let mut failures = Vec::new();
    for case in &cases {
        let fn_name = s(&case["fn"]);
        let args = case["args"].as_array().expect("args");
        let got = match run(fn_name, args) {
            Ok(v) => json!({ "ok": v }),
            Err(e) => json!({ "err": e }),
        };
        let want = match (case.get("ok"), case.get("err")) {
            (Some(v), _) => json!({ "ok": v }),
            (_, Some(e)) => json!({ "err": e }),
            _ => Value::Null,
        };
        if got != want {
            failures.push(format!("{fn_name}({args:?}):\n  want {want}\n  got  {got}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        cases.len(),
        failures
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
