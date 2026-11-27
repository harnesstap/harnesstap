//! Replays `fixtures/lockfile.json`, recorded from the TypeScript by `make-fixtures.ts`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

use lockfile_rs::*;
use models_rs::resource::Resource;
use resolve_rs::types::ResolutionResult;
use serde::Deserialize;
use serde_json::{Map, Value, json};

#[derive(Deserialize)]
struct Fixtures {
    misc: Misc,
    scenarios: Vec<Scenario>,
    rewrites: Vec<Rewrite>,
    reads: Vec<Read>,
    diffs: Vec<Diff>,
}

/// `writeLockfile` over an existing file (#658: only `generated_at` differing keeps the file).
#[derive(Deserialize)]
struct Rewrite {
    s: usize,
    pre: String,
    after: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Misc {
    package_version: String,
    envelopes: Vec<(String, String)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scenario {
    now: String,
    result: ResolutionResult,
    extras: LockfileExtras,
    plugins: HashMap<String, Oracle>,
    plugin_resources: HashMap<String, Vec<Resource>>,
    calls: Vec<Value>,
    yaml: Option<String>,
    reread: Option<Value>,
}

#[derive(Deserialize)]
struct Oracle {
    plugin: Option<OraclePlugin>,
    #[serde(default)]
    locator: Option<Value>,
    #[serde(default)]
    canonical: HashMap<String, String>,
}

#[derive(Deserialize)]
struct OraclePlugin {
    origin_locator: Option<String>,
    origin_fingerprint: Option<String>,
    origin_fingerprint_kind: Option<String>,
}

#[derive(Deserialize)]
struct Read {
    text: Option<String>,
    ok: Option<Value>,
    err: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Diff {
    expected: Vec<(String, String)>,
    files: Vec<DeployedFile>,
    disk: Vec<DeployedFile>,
    dir_b: bool,
    with_root: bool,
    diff: Value,
    verify: Value,
}

struct Lookup<'a>(&'a Scenario);

impl PluginLookup for Lookup<'_> {
    fn plugin(&self, id: &str) -> Option<PluginOrigin> {
        let p = self.0.plugins.get(id)?.plugin.as_ref()?;
        Some(PluginOrigin {
            origin_locator: p.origin_locator.clone(),
            origin_fingerprint: p.origin_fingerprint.clone(),
            origin_fingerprint_kind: p.origin_fingerprint_kind.clone(),
        })
    }
    fn plugin_resources(&self, id: &str) -> Vec<Resource> {
        self.0.plugin_resources.get(id).cloned().unwrap_or_default()
    }
    fn recover_origin_locator(&self, id: &str) -> Option<OriginLocator> {
        let locator = self.0.plugins.get(id)?.locator.as_ref()?.as_object()?;
        Some(if locator["kind"] == "git" {
            OriginLocator::Git {
                url: locator["url"].as_str().unwrap().to_owned(),
                git_ref: locator
                    .get("ref")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            }
        } else {
            OriginLocator::Other
        })
    }
    fn canonical_apm_repo_url(&self, url: &str) -> String {
        self.0
            .plugins
            .values()
            .find_map(|o| o.canonical.get(url))
            .unwrap_or_else(|| panic!("no recorded canonical url for {url}"))
            .clone()
    }
}

fn load() -> Fixtures {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/lockfile.json"
    ))
    .unwrap();
    serde_json::from_str(&text).unwrap()
}

fn error_name(e: &LockError) -> &'static str {
    match e {
        LockError::Invalid(_) | LockError::Io(_) => "Error",
        LockError::Yaml(_) => "YAMLParseError",
        LockError::Integrity(_) => "LockIntegrityError",
        LockError::Type(_) => "TypeError",
    }
}

/// The recorded `{ err }` matches: the name always, the message unless the original's message
/// is an engine `TypeError` text or a `yaml` package parse message.
fn check_err(e: &LockError, recorded: &Value, ctx: &str) {
    assert_eq!(error_name(e), recorded["name"], "{ctx}: {e}");
    if matches!(e, LockError::Invalid(_) | LockError::Integrity(_)) {
        assert_eq!(
            e.to_string(),
            recorded["message"].as_str().unwrap(),
            "{ctx}"
        );
    }
}

fn opt(out: &mut Map<String, Value>, key: &str, v: &Option<String>) {
    if let Some(v) = v {
        out.insert(key.into(), v.clone().into());
    }
}

/// The `Lockfile` object as `JSON.stringify` saw it.
fn lock_json(lock: &Lockfile) -> Value {
    let plugins: Vec<Value> = lock
        .plugins
        .iter()
        .map(|e| {
            let mut out = Map::new();
            out.insert("name".into(), e.name.clone().into());
            out.insert("version".into(), e.version.clone().into());
            out.insert("source".into(), e.source.as_str().into());
            out.insert("integrity".into(), e.integrity.clone().into());
            out.insert("depth".into(), emit_rs::js::number_value(e.depth));
            out.insert("path".into(), e.path.clone().into());
            opt(&mut out, "repo_url", &e.repo_url);
            opt(&mut out, "resolved_commit", &e.resolved_commit);
            opt(&mut out, "resolved_ref", &e.resolved_ref);
            opt(&mut out, "constraint", &e.constraint);
            opt(&mut out, "resolved_tag", &e.resolved_tag);
            opt(&mut out, "virtual_path", &e.virtual_path);
            opt(&mut out, "content_hash", &e.content_hash);
            opt(
                &mut out,
                "exec_status",
                &e.exec_status.map(|s| s.as_str().to_owned()),
            );
            opt(&mut out, "declared_license", &e.declared_license);
            Value::Object(out)
        })
        .collect();
    let mut out = Map::new();
    out.insert("root".into(), lock.root.clone().into());
    out.insert("resolved_at".into(), lock.resolved_at.clone().into());
    out.insert(
        "resource_map_hash".into(),
        lock.resource_map_hash.clone().into(),
    );
    out.insert("plugins".into(), plugins.into());
    opt(&mut out, "environment", &lock.environment);
    if let Some(servers) = &lock.mcp_servers {
        let servers: Vec<Value> = servers
            .iter()
            .map(|s| {
                let mut m = Map::new();
                m.insert("name".into(), s.name.clone().into());
                for (k, v) in [
                    ("transport", &s.transport),
                    ("command", &s.command),
                    ("url", &s.url),
                ] {
                    if let Some(v) = v {
                        m.insert(k.into(), v.clone());
                    }
                }
                Value::Object(m)
            })
            .collect();
        out.insert("mcp_servers".into(), servers.into());
    }
    if let Some(hashes) = &lock.deployed_file_hashes {
        let m: Map<String, Value> = hashes
            .iter()
            .map(|(k, v)| (k.clone(), v.clone().into()))
            .collect();
        out.insert("deployed_file_hashes".into(), Value::Object(m));
    }
    Value::Object(out)
}

/// Equal as values, and the deployed hashes in the same key order.
fn assert_lock(lock: &Lockfile, recorded: &Value, ctx: &str) {
    let actual = lock_json(lock);
    assert_eq!(actual, *recorded, "{ctx}");
    let order = |v: &Value| -> Vec<String> {
        v.get("deployed_file_hashes")
            .and_then(Value::as_object)
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default()
    };
    assert_eq!(
        order(&actual),
        order(recorded),
        "{ctx}: deployed hash order"
    );
}

fn issues_json(issues: &[DeployedHashIssue]) -> Value {
    issues
        .iter()
        .map(|i| {
            let mut m = Map::new();
            m.insert("kind".into(), i.kind.as_str().into());
            m.insert("path".into(), i.path.clone().into());
            opt(&mut m, "expected", &i.expected);
            opt(&mut m, "actual", &i.actual);
            Value::Object(m)
        })
        .collect()
}

static DIRS: AtomicUsize = AtomicUsize::new(0);

fn temp_dir() -> std::path::PathBuf {
    let n = DIRS.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("lockfile-rs-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn envelopes() {
    let f = load();
    for (input, want) in &f.misc.envelopes {
        assert_eq!(sha256_envelope(input), *want);
    }
}

#[test]
fn scenarios_build_write_read_and_compare() {
    let f = load();
    let version = &f.misc.package_version;
    let (mut built, mut failed, mut rewrites) = (0, 0, 0);
    for (i, s) in f.scenarios.iter().enumerate() {
        let ctx = format!("scenario {i}");
        let lookup = Lookup(s);
        let first = &s.calls[0];
        let lock = match lockfile_from_resolution(&s.result, &s.extras, &lookup, &s.now) {
            Ok(lock) => {
                assert_lock(&lock, &first["ok"], &ctx);
                lock
            }
            Err(e) => {
                check_err(&e, &first["err"], &ctx);
                failed += 1;
                continue;
            }
        };
        built += 1;
        let dir = temp_dir();
        let root = dir.to_str().unwrap();
        write_lockfile(root, &lock, version).unwrap();
        assert_eq!(
            std::fs::read_to_string(lockfile_path(root)).unwrap(),
            *s.yaml.as_ref().unwrap(),
            "{ctx}: yaml"
        );
        for r in f.rewrites.iter().filter(|r| r.s == i) {
            std::fs::write(lockfile_path(root), &r.pre).unwrap();
            write_lockfile(root, &lock, version).unwrap();
            assert_eq!(
                std::fs::read_to_string(lockfile_path(root)).unwrap(),
                r.after,
                "{ctx}: rewrite over {:?}",
                r.pre
            );
            rewrites += 1;
        }
        std::fs::write(lockfile_path(root), s.yaml.as_ref().unwrap()).unwrap();
        let reread = read_lockfile(root).unwrap().unwrap();
        assert_lock(
            &reread,
            &s.reread.as_ref().unwrap()["ok"],
            &format!("{ctx}: reread"),
        );
        std::fs::remove_dir_all(&dir).unwrap();

        for call in &s.calls[1..] {
            let result: ResolutionResult = match call.get("other") {
                Some(other) => serde_json::from_value(other.clone()).unwrap(),
                None => s.result.clone(),
            };
            let name = call["fn"].as_str().unwrap();
            let ctx = format!("{ctx}: {name}");
            let actual = match name {
                "writeLockfile" => json!("$undefined"),
                "lockfileMatchesResolution" => {
                    json!(lockfile_matches_resolution(&lock, &result).unwrap())
                }
                "lockIsUsable" => json!(lock_is_usable(&lock, "root")),
                "compareLockToResolution" => {
                    serde_json::to_value(compare_lock_to_resolution(&lock, &result).unwrap())
                        .unwrap()
                }
                "lockedVersionsFrom" => json!(locked_versions_from(&lock)),
                other => panic!("unknown call {other}"),
            };
            assert_eq!(actual, call["ok"], "{ctx}");
        }
    }
    assert!(built > 100 && failed > 0, "built {built}, failed {failed}");
    assert_eq!(rewrites, f.rewrites.len());
}

#[test]
fn reads() {
    let f = load();
    for r in &f.reads {
        let ctx = format!("{:?}", r.text);
        let dir = temp_dir();
        let root = dir.to_str().unwrap().to_owned();
        if let Some(text) = &r.text {
            std::fs::write(lockfile_path(&root), text).unwrap();
        }
        match (read_lockfile(&root), &r.ok, &r.err) {
            (Ok(None), Some(ok), _) => assert_eq!(ok, "$undefined", "{ctx}"),
            (Ok(Some(lock)), Some(ok), _) => assert_lock(&lock, ok, &ctx),
            (Err(e), _, Some(err)) => {
                let mut err = err.clone();
                let message = err["message"].as_str().unwrap().replace("<dir>", &root);
                err["message"] = message.into();
                check_err(&e, &err, &ctx);
            }
            (got, _, _) => panic!("{ctx}: got {got:?}, recorded ok {:?} err {:?}", r.ok, r.err),
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[test]
fn deployed_hash_diffs() {
    let f = load();
    for (i, d) in f.diffs.iter().enumerate() {
        let ctx = format!("diff {i}");
        let dir = temp_dir();
        for file in &d.disk {
            let path = dir.join(&file.path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, &file.content).unwrap();
        }
        if d.dir_b {
            std::fs::create_dir_all(dir.join("b.md")).unwrap();
        }
        let root = d.with_root.then(|| dir.to_str().unwrap().to_owned());
        match diff_deployed_file_hashes(&d.expected, &d.files, root.as_deref()) {
            Ok(issues) => assert_eq!(issues_json(&issues), d.diff["ok"], "{ctx}"),
            Err(e) => check_err(&e, &d.diff["err"], &ctx),
        }
        match verify_deployed_file_hashes(&d.expected, &d.files, root.as_deref()) {
            Ok(()) => assert_eq!(d.verify["ok"], "$undefined", "{ctx}: verify"),
            Err(e) => check_err(&e, &d.verify["err"], &format!("{ctx}: verify")),
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
