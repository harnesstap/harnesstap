//! Replays tests/fixtures/git.json, recorded by tests/make-git-fixtures.ts.

use apm_rs::dependencies::ParsedApmDependency;
use apm_rs::git_resolve::*;
use lockfile_rs::{LockEntry, LockSource};
use serde_json::{Value, json};

fn load() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/git.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn err_json(e: &GitResolveError) -> Value {
    json!({ "name": e.name, "message": e.message })
}

/// Origins where Bun's `URL` (the recorder) differs from the WHATWG spec, which Node (what the
/// shipped CLI runs on) and the `url` crate follow: a non-special scheme whose path starts with
/// `/.` or `/..` and then a non-ASCII character loses characters in Bun. The answer here is
/// Node's `new URL(origin).pathname` without the leading slash, checked by hand.
const BUN_URL_QUIRKS: &[(&str, &str)] = &[("foo:/..\u{e9}", "..%C3%A9")];

#[test]
fn urls_refs_paths_and_tags() {
    let f = load();
    for case in f["urls"].as_array().unwrap() {
        let origin = case["origin"].as_str().unwrap();
        if let Some((_, node)) = BUN_URL_QUIRKS.iter().find(|(o, _)| *o == origin) {
            assert_eq!(canonical_apm_repo_url(origin), *node, "{origin:?}");
            continue;
        }
        assert_eq!(
            canonical_apm_repo_url(origin),
            case["canonical"],
            "{origin:?}"
        );
        for (token, want) in [None, Some(""), Some("tok")]
            .iter()
            .zip(case["auth"].as_array().unwrap())
        {
            assert_eq!(
                github_https_remote_for_auth(origin, *token),
                *want,
                "{origin:?} {token:?}"
            );
        }
    }
    for case in f["classify"].as_array().unwrap() {
        let kind = classify_apm_git_ref(case["ref"].as_str());
        assert_eq!(json!(kind), case["kind"], "{:?}", case["ref"]);
    }
    for case in f["virtualPaths"].as_array().unwrap() {
        let p = case["path"].as_str().unwrap();
        let safe = assert_safe_apm_virtual_path(p).err().map(|e| err_json(&e));
        assert_eq!(json!(safe), case["safe"], "{p:?}");
        assert_eq!(is_apm_virtual_file_path(p), case["virtualFile"], "{p:?}");
    }
    for case in f["tagSelections"].as_array().unwrap() {
        let tags: Vec<&str> = case["tags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t.as_str().unwrap())
            .collect();
        let got = select_semver_tag(case["range"].as_str().unwrap(), &tags);
        assert_eq!(json!(got), case["selected"], "{case}");
    }
}

fn lock_entry(v: &Value) -> LockEntry {
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
    LockEntry {
        name: s("name").unwrap(),
        version: String::new(),
        source: LockSource::Local,
        integrity: String::new(),
        depth: 0.0,
        path: vec![],
        repo_url: s("repo_url"),
        resolved_commit: s("resolved_commit"),
        resolved_ref: s("resolved_ref"),
        constraint: s("constraint"),
        resolved_tag: s("resolved_tag"),
        virtual_path: s("virtual_path"),
        content_hash: None,
        exec_status: None,
        declared_license: None,
    }
}

struct Replay<'a> {
    calls: std::slice::Iter<'a, Value>,
}

impl Git for Replay<'_> {
    fn authorized_remote(&mut self, url: &str) -> String {
        url.to_owned()
    }
    fn run(&mut self, args: &[String]) -> CommandResult {
        let call = self.calls.next().expect("an unrecorded git call");
        assert_eq!(json!(args), call["args"]);
        CommandResult {
            stdout: call["stdout"].as_str().unwrap().to_owned(),
            stderr: call["stderr"].as_str().unwrap().to_owned(),
            exit_code: call["exitCode"].as_i64().unwrap() as i32,
        }
    }
}

#[test]
fn resolutions_against_recorded_git() {
    let f = load();
    for (i, case) in f["resolutions"].as_array().unwrap().iter().enumerate() {
        let dependency: ParsedApmDependency =
            serde_json::from_value(case["dependency"].clone()).unwrap();
        let lock: Option<Vec<LockEntry>> = case["lock"]
            .as_array()
            .map(|a| a.iter().map(lock_entry).collect());
        let mut git = Replay {
            calls: case["calls"].as_array().unwrap().iter(),
        };
        let options = ResolveOptions {
            update: case["update"].as_bool().unwrap(),
            lock: lock.as_deref(),
        };
        let got =
            resolve_apm_git_dependency(&dependency, options, &mut git, "2026-03-04T05:06:07.089Z");
        assert!(
            git.calls.next().is_none(),
            "case {i}: fewer git calls than recorded"
        );
        match got {
            Ok(r) => assert_eq!(json!(r), case["ok"], "case {i}"),
            Err(e) => assert_eq!(err_json(&e), case["err"], "case {i}"),
        }
    }
}
