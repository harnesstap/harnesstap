//! Replays what `make-fixtures.mjs` recorded from `services/self-update.ts`:
//! the same scripted fetch, clock, env, argv and update-check.json, compared byte
//! for byte (result, notices, fetch calls in order, the cache file afterwards).

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use self_update_rs::*;
use serde_json::{Map, Value, json};

struct FakeFetch<'a> {
    script: &'a Value,
    calls: RefCell<Vec<Value>>,
}

impl UpdateFetch for FakeFetch<'_> {
    fn fetch(
        &self,
        url: &str,
        headers: &[(&str, &str)],
        timeout_ms: u64,
    ) -> Result<FetchResponse, String> {
        let headers: Map<String, Value> = headers
            .iter()
            .map(|(k, v)| (k.to_string(), Value::String(v.to_string())))
            .collect();
        self.calls
            .borrow_mut()
            .push(json!({ "url": url, "headers": headers, "timeoutMs": timeout_ms, "retries": 0 }));
        match self.script.get(url) {
            Some(out) if out.get("error").is_none() => Ok(FetchResponse {
                status: out["status"].as_u64().unwrap() as u16,
                body: out["body"].as_str().unwrap().as_bytes().to_vec(),
            }),
            _ => Err("fetch failed".into()),
        }
    }
}

fn prepare(root: &Path, setup: &Value) -> PathBuf {
    std::fs::create_dir_all(root).unwrap();
    let dir = root.join("home");
    match setup["kind"].as_str().unwrap() {
        "none" => std::fs::create_dir(&dir).unwrap(),
        "missing-home" => {}
        "home-is-file" => std::fs::write(&dir, "x").unwrap(),
        "dir" => std::fs::create_dir_all(dir.join("update-check.json")).unwrap(),
        "file" => {
            std::fs::create_dir(&dir).unwrap();
            std::fs::write(
                dir.join("update-check.json"),
                setup["text"].as_str().unwrap(),
            )
            .unwrap();
        }
        k => panic!("{k}"),
    }
    dir
}

fn cache_after(dir: &Path) -> Value {
    let path = dir.join("update-check.json");
    if path.is_dir() {
        json!({ "dir": true })
    } else if path.exists() {
        json!({ "text": std::fs::read_to_string(path).unwrap() })
    } else {
        Value::Null
    }
}

fn env_of(v: &Value) -> Env {
    v.as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned()))
        .collect()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_owned())
        .collect()
}

fn check(problems: &mut Vec<String>, what: &str, actual: &Value, expected: &Value) {
    let (a, e) = (actual.to_string(), expected.to_string());
    if a != e {
        problems.push(format!("{what}: {a}\n    expected {e}"));
    }
}

fn channel(s: &str) -> Channel {
    match s {
        "npm" => Channel::Npm,
        "github" => Channel::Github,
        other => panic!("{other}"),
    }
}

fn finish(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures\n{}",
        failures.len(),
        failures
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/self-update.json")).unwrap()
}

#[test]
fn notify_matches_the_original() {
    let fixture = fixture();
    let package_version = fixture["packageVersion"].as_str().unwrap();
    let root = std::env::temp_dir().join(format!("self-update-rs-notify-{}", std::process::id()));
    let cases = fixture["notify"].as_array().unwrap();
    let mut failures = Vec::new();
    for (i, case) in cases.iter().enumerate() {
        let dir = prepare(&root.join(i.to_string()), &case["setup"]);
        let fetch = FakeFetch {
            script: &case["responses"],
            calls: RefCell::default(),
        };
        let mut notices = Vec::new();
        let argv = strings(&case["argv"]);
        let env = env_of(&case["env"]);
        let result = maybe_notify_cli_update(
            &NotifyOptions {
                argv: &argv,
                env: &env,
                harnesstap_dir: &dir,
                current_version: case["currentVersion"].as_str().unwrap(),
                package_version,
                now_ms: case["now"].as_i64().unwrap(),
                exit_code: case["exitCode"].as_i64().map(|c| c as i32),
            },
            &fetch,
            &mut |m| notices.push(Value::String(m.to_owned())),
        );
        let mut problems = Vec::new();
        let result = result.map_or(Value::Null, |n| n.to_value());
        check(&mut problems, "result", &result, &case["result"]);
        check(
            &mut problems,
            "notices",
            &Value::Array(notices),
            &case["notices"],
        );
        check(
            &mut problems,
            "calls",
            &Value::Array(fetch.calls.into_inner()),
            &case["calls"],
        );
        check(&mut problems, "cache", &cache_after(&dir), &case["after"]);
        if !problems.is_empty() {
            failures.push(format!("notify {i}: {}", problems.join("; ")));
        }
    }
    let _ = std::fs::remove_dir_all(&root);
    finish(&failures);
    assert!(cases.len() >= 700);
    assert!(
        cases
            .iter()
            .filter(|c| !c["notices"].as_array().unwrap().is_empty())
            .count()
            >= 100
    );
}

#[test]
fn resolve_matches_the_original() {
    let fixture = fixture();
    let package_version = fixture["packageVersion"].as_str().unwrap();
    let root = std::env::temp_dir().join(format!("self-update-rs-resolve-{}", std::process::id()));
    let cases = fixture["resolve"].as_array().unwrap();
    let mut failures = Vec::new();
    for (i, case) in cases.iter().enumerate() {
        let dir = prepare(&root.join(i.to_string()), &case["setup"]);
        let fetch = FakeFetch {
            script: &case["responses"],
            calls: RefCell::default(),
        };
        let result = resolve_published_release(
            channel(case["channel"].as_str().unwrap()),
            &dir,
            case["now"].as_i64().unwrap(),
            &fetch,
            package_version,
        );
        let mut problems = Vec::new();
        let result = result.map_or(Value::Null, |r| r.to_value());
        check(&mut problems, "result", &result, &case["result"]);
        check(
            &mut problems,
            "calls",
            &Value::Array(fetch.calls.into_inner()),
            &case["calls"],
        );
        check(&mut problems, "cache", &cache_after(&dir), &case["after"]);
        if !problems.is_empty() {
            failures.push(format!("resolve {i}: {}", problems.join("; ")));
        }
    }
    let _ = std::fs::remove_dir_all(&root);
    finish(&failures);
    assert!(cases.len() >= 300);
}

#[test]
fn helpers_match_the_original() {
    let fixture = fixture();
    let pure = &fixture["pure"];
    let rows = |k: &str| pure[k].as_array().unwrap().clone();
    let mut failures = Vec::new();
    let mut expect = |what: String, actual: Value, expected: &Value| {
        if actual != *expected {
            failures.push(format!("{what}: {actual}, expected {expected}"));
        }
    };
    for r in rows("normalize") {
        expect(
            format!("normalize {}", r[0]),
            normalize_published_version(r[0].as_str().unwrap()).into(),
            &r[1],
        );
    }
    for r in rows("newer") {
        let (a, b) = (r[0].as_str().unwrap(), r[1].as_str().unwrap());
        expect(
            format!("newer {a:?} {b:?}"),
            is_newer_published_version(a, b).into(),
            &r[2],
        );
    }
    for r in rows("channel") {
        let got = detect_cli_install_channel(r[0].as_str().unwrap(), &env_of(&r[1]));
        expect(
            format!("channel {} {}", r[0], r[1]),
            got.as_str().into(),
            &r[2],
        );
    }
    for r in rows("homebrew") {
        let got = is_homebrew_cli_install(r[0].as_str().unwrap(), &env_of(&r[1]));
        expect(format!("homebrew {} {}", r[0], r[1]), got.into(), &r[2]);
    }
    for r in rows("skip") {
        let got = should_skip_cli_update_notice(&strings(&r[0]), &env_of(&r[1]));
        expect(format!("skip {} {}", r[0], r[1]), got.into(), &r[2]);
    }
    for r in rows("hint") {
        let got = cli_install_hint(
            channel(r[0].as_str().unwrap()),
            r[1].as_str().unwrap(),
            r[2].as_bool().unwrap(),
        );
        expect(format!("hint {r}"), got.into(), &r[3]);
    }
    for r in rows("fresh") {
        let cache = UpdateCheckCache {
            last_lookup_at: r[0].as_str().map(str::to_owned),
            ..Default::default()
        };
        expect(
            format!("fresh {r}"),
            is_update_lookup_fresh(&cache, r[1].as_i64().unwrap()).into(),
            &r[2],
        );
    }
    // Known difference: V8's legacy (non-ISO) date fallback. The port reads these as
    // invalid, so it looks up again where the original trusts the cache.
    for r in rows("legacyFresh") {
        let cache = UpdateCheckCache {
            last_lookup_at: r[0].as_str().map(str::to_owned),
            ..Default::default()
        };
        expect(
            format!("legacy {r}"),
            is_update_lookup_fresh(&cache, r[1].as_i64().unwrap()).into(),
            &false.into(),
        );
    }
    assert!(
        rows("legacyFresh").iter().any(|r| r[2] == true),
        "the known difference no longer shows: drop it"
    );
    finish(&failures);
}
