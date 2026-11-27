//! Replays `tests/fixtures/export.json` (recorded by `make-export-fixtures.ts`): each lockfile
//! read, its timestamp resolved and the SBOM written byte for byte, or the same error.

use lockfile_rs::export::{
    LicenseKind, TimestampError, classify_declared_license, export_sbom, parse_sbom_format,
    resolve_export_timestamp,
};
use lockfile_rs::{LockError, read_lockfile};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Export {
    yaml: String,
    timestamp: Option<String>,
    epoch: Option<String>,
    format: String,
    ok: Option<String>,
    err: Option<Err>,
}

#[derive(Deserialize)]
struct Err {
    name: String,
    message: String,
}

#[derive(Deserialize)]
struct Fixtures {
    exports: Vec<Export>,
    classify: Vec<Value>,
    formats: Vec<Value>,
}

fn load() -> Fixtures {
    serde_json::from_str(include_str!("fixtures/export.json")).unwrap()
}

/// `(name, message)` of what the run throws; `None` for a `Date.parse` the port leaves alone.
fn run(case: &Export, dir: &str) -> Option<Result<String, (String, String)>> {
    let err = |name: &str, message: String| Some(Err((name.to_owned(), message)));
    let lock = match read_lockfile(dir) {
        Ok(lock) => lock.unwrap(),
        Err(LockError::Invalid(m)) => return err("Error", m),
        Err(e) => panic!("{e}"),
    };
    let ts = match resolve_export_timestamp(
        case.timestamp.as_deref(),
        &lock.resolved_at,
        case.epoch.as_deref(),
    ) {
        Ok(ts) => ts,
        Err(TimestampError::Invalid(m)) => return err("LockExportTimestampError", m),
        // Bun words it `Invalid Date`, Node `Invalid time value`.
        Err(TimestampError::Range) => return err("RangeError", "Invalid Date".into()),
        Err(TimestampError::Unsupported) => return None,
    };
    match parse_sbom_format(Some(&case.format)) {
        Ok(format) => Some(Ok(export_sbom(&lock, format, &ts))),
        Err(m) => err("LockExportError", m),
    }
}

#[test]
fn exports_match() {
    let f = load();
    let dir = std::env::temp_dir().join(format!("lockfile-rs-export-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let dir_s = dir.to_string_lossy().into_owned();
    let (mut checked, mut skipped, mut failures) = (0, 0, Vec::new());
    for (i, case) in f.exports.iter().enumerate() {
        std::fs::write(dir.join("apm.lock.yaml"), &case.yaml).unwrap();
        let Some(got) = run(case, &dir_s) else {
            skipped += 1;
            continue;
        };
        checked += 1;
        let want = match (&case.ok, &case.err) {
            (Some(doc), _) => Ok(doc.clone()),
            (None, Some(e)) => {
                // The recorder's temporary folder.
                let message = match e.message.find("/apm.lock.yaml") {
                    Some(end) if e.message.starts_with("Invalid lockfile in ") => {
                        format!("Invalid lockfile in {dir_s}{}", &e.message[end..])
                    }
                    _ => e.message.clone(),
                };
                Err((e.name.clone(), message))
            }
            _ => unreachable!(),
        };
        if got != want {
            failures.push(format!(
                "#{i} {:?}\n want {want:?}\n got  {got:?}",
                case.yaml
            ));
        }
    }
    std::fs::remove_dir_all(&dir).ok();
    eprintln!("{checked} exports checked, {skipped} timestamps left to the original");
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert!(skipped * 20 < checked, "too many skipped: {skipped}");
}

#[test]
fn licenses_and_formats_match() {
    let f = load();
    for case in &f.classify {
        let (kind, value) = classify_declared_license(case["value"].as_str().unwrap());
        let kind = match kind {
            LicenseKind::Id => "id",
            LicenseKind::Expression => "expression",
            LicenseKind::Named => "named",
        };
        assert_eq!(
            (kind, value.as_str()),
            (
                case["ok"]["kind"].as_str().unwrap(),
                case["ok"]["value"].as_str().unwrap()
            ),
            "{case}"
        );
    }
    for case in &f.formats {
        let got = parse_sbom_format(case["value"].as_str());
        match (got, case.get("ok")) {
            (Ok(_), Some(_)) => {}
            (Err(m), None) => assert_eq!(m, case["err"]["message"].as_str().unwrap()),
            (got, _) => panic!("{case} {got:?}"),
        }
    }
}
