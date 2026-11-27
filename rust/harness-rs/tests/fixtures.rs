//! Replays `tests/fixtures/harness.json` (recorded by `make-fixtures.ts` from the
//! original): the selection, `parseHarnessList`, `detectPlatforms` over the same trees,
//! and the path-keyed project identity, at the same fixed folder.

use std::path::Path;
use std::process::Command;

use db_rs::paths::Env;
use harness_rs::project_identity::{
    Identity, ensure_project_for_root, find_project_for_root, normalize_project_path,
    path_project_id, resolve_project_identity,
};
use harness_rs::{SelectionInput, parse_harness_list, resolve_harness_selection};
use models_rs::{Ctx, SystemClock, UlidIds};
use serde::Deserialize;
use serde_json::{Value, json};

const BASE: &str = "/tmp/ht-harness-fixture";

#[derive(Deserialize)]
struct Fixture {
    platform: String,
    selection: Vec<Value>,
    lists: Vec<Value>,
    detect: Vec<Tree>,
    identity: Vec<Value>,
    projects: Vec<Value>,
}

#[derive(Deserialize)]
struct Tree {
    entries: Vec<Entry>,
    detected: Vec<String>,
}

#[derive(Deserialize)]
struct Entry {
    path: String,
    kind: String,
    target: Option<String>,
}

fn build(root: &Path, entries: &[Entry]) {
    std::fs::create_dir_all(root).unwrap();
    for e in entries {
        let full = root.join(&e.path);
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        match e.kind.as_str() {
            "dir" => std::fs::create_dir_all(&full).unwrap(),
            "file" => std::fs::write(&full, "x").unwrap(),
            _ => std::os::unix::fs::symlink(e.target.as_deref().unwrap_or(""), &full).unwrap(),
        }
    }
}

fn strings(v: &Value) -> Option<Vec<String>> {
    v.as_array()
        .map(|a| a.iter().map(|s| s.as_str().unwrap().to_string()).collect())
}

/// The recorder's `norm`: `$BASE`, `<ts>` and `<id>`.
fn norm(value: Value) -> Value {
    let real = std::fs::canonicalize(BASE)
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let mut text = value.to_string();
    for from in [real.to_lowercase(), real, BASE.to_string()] {
        text = text.replace(&from, "$BASE");
    }
    let ts = regex::Regex::new(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z").unwrap();
    let id = regex::Regex::new(r"\b[0-9A-HJKMNP-TV-Z]{26}\b").unwrap();
    let text = ts.replace_all(&text, "<ts>");
    let text = id.replace_all(&text, "<id>");
    serde_json::from_str(&text).unwrap()
}

fn same_platform(recorded: &str) -> bool {
    matches!(
        (recorded, std::env::consts::OS),
        ("darwin", "macos") | ("linux", "linux") | ("win32", "windows")
    )
}

#[test]
fn matches_the_original() {
    let f: Fixture =
        serde_json::from_str(include_str!("fixtures/harness.json")).expect("harness.json");
    let _ = std::fs::remove_dir_all(BASE);
    std::fs::create_dir_all(BASE).unwrap();
    let mut failures = Vec::new();

    for case in &f.selection {
        let i = &case["input"];
        let (harnesses, aliases, current, detected) = (
            strings(&i["harnesses"]),
            strings(&i["aliases"]),
            strings(&i["current"]),
            strings(&i["detected"]).unwrap_or_default(),
        );
        let got = resolve_harness_selection(&SelectionInput {
            harnesses: harnesses.as_deref(),
            main: i["main"].as_str(),
            aliases: aliases.as_deref(),
            current: current.as_deref(),
            detected: &detected,
        });
        let got = match got {
            Ok(r) => json!({ "input": i, "ok": r }),
            Err(e) => json!({ "input": i, "error": e }),
        };
        if &got != case {
            failures.push(format!("selection {case} got {got}"));
        }
    }

    for case in &f.lists {
        let got = json!(parse_harness_list(case["value"].as_str()));
        if got != case["out"] {
            failures.push(format!("list {case} got {got}"));
        }
    }

    for (n, tree) in f.detect.iter().enumerate() {
        let root = Path::new(BASE).join("detect").join(n.to_string());
        build(&root, &tree.entries);
        let got = harness_rs::scanner::detect_platforms(root.to_str().unwrap());
        if got != tree.detected {
            failures.push(format!(
                "detect {:?} want {:?} got {got:?}",
                tree.entries.iter().map(|e| &e.path).collect::<Vec<_>>(),
                tree.detected
            ));
        }
    }

    let id_root = Path::new(BASE).join("id");
    build(
        &id_root,
        &serde_json::from_value::<Vec<Entry>>(json!([
            { "path": "proj", "kind": "dir" },
            { "path": "Mixed Case/inner", "kind": "dir" },
            { "path": "file.txt", "kind": "file" },
            { "path": "link", "kind": "symlink", "target": "proj" },
            { "path": "dangling", "kind": "symlink", "target": "nowhere" },
            { "path": "repo-origin", "kind": "dir" },
            { "path": "repo-none", "kind": "dir" },
            { "path": "repo-blank", "kind": "dir" },
        ]))
        .unwrap(),
    );
    let git = |dir: &str, args: &[&str]| {
        assert!(
            Command::new("git")
                .args(args)
                .current_dir(id_root.join(dir))
                .output()
                .unwrap()
                .status
                .success()
        );
    };
    git("repo-origin", &["init", "-q"]);
    git(
        "repo-origin",
        &["remote", "add", "origin", "https://github.com/org/repo.git"],
    );
    git("repo-none", &["init", "-q"]);
    git("repo-blank", &["init", "-q"]);
    git("repo-blank", &["config", "remote.origin.url", " "]);
    // `process.cwd()` is the physical folder.
    let cwd = std::fs::canonicalize(&id_root)
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let lowercases = same_platform(&f.platform);
    for case in &f.identity {
        let path = case["path"].as_str().unwrap();
        if !lowercases && path.contains("Mixed") {
            continue;
        }
        let identity = match resolve_project_identity(&cwd, path) {
            Identity::Path {
                root,
                local_id,
                name,
            } => json!({ "kind": "path", "root": root, "localId": local_id, "name": name }),
            Identity::Origin => json!({ "kind": "origin" }),
        };
        let got = norm(json!({
            "path": path,
            "normalized": normalize_project_path(&cwd, path),
            "pathId": path_project_id(&cwd, path),
            "identity": identity,
        }));
        if &got != case {
            failures.push(format!("identity {case} got {got}"));
        }
    }

    let db_home = format!("{BASE}/db");
    let env = |name: &str| (name == "HARNESSTAP_HOME").then(|| db_home.clone());
    let db = db_rs::connection::open(&env as &dyn Env).unwrap();
    db_rs::schema::initialize_schema(&db.conn, Default::default()).unwrap();
    let ctx = Ctx {
        db: &db,
        env: &env,
        clock: &SystemClock,
        ids: &UlidIds,
    };
    for case in &f.projects {
        let (op, path) = (case["op"].as_str().unwrap(), case["path"].as_str().unwrap());
        let identity = resolve_project_identity(&cwd, path);
        let out = if op == "find" {
            json!(find_project_for_root(&ctx, &identity).unwrap().unwrap())
        } else {
            json!(ensure_project_for_root(&ctx, &identity).unwrap().unwrap())
        };
        let got = norm(json!({ "op": op, "path": path, "out": out }));
        if &got != case {
            failures.push(format!("project {case} got {got}"));
        }
    }
    drop(db);
    let _ = std::fs::remove_dir_all(BASE);

    eprintln!(
        "{} selections, {} lists, {} trees, {} identities, {} project calls",
        f.selection.len(),
        f.lists.len(),
        f.detect.len(),
        f.identity.len(),
        f.projects.len()
    );
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
