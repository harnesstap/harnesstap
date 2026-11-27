//! Replays the calls `make-fixtures.ts` recorded against the original's models
//! and compares results, errors and the database they leave, with ULIDs
//! renamed in order of appearance.

use db_rs::connection::Db;
use db_rs::schema::{InitializeSchemaOptions, initialize_schema};
use models_rs::*;
use regex::Regex;
use rusqlite::Connection;
use rusqlite::types::Value as Sql;
use serde_json::{Map, Value, json};
use std::cell::Cell;

struct StepClock(Cell<i64>);
impl Clock for StepClock {
    fn now_iso(&self) -> String {
        iso_from_millis(self.0.get())
    }
}

struct CountIds(Cell<u64>);
impl Ids for CountIds {
    fn ulid(&self) -> String {
        self.0.set(self.0.get() + 1);
        // Ids sort in creation order, like the original's time-based ULIDs
        // (queries without ORDER BY walk the primary key), and the random
        // part is spread so ids also differ early.
        let n = u128::from(self.0.get()).wrapping_mul(0x9E37_79B9_7F4A_7C15_F39C_C060_5CED_C835);
        ulid::Ulid::from_parts(1_767_225_600_000 + self.0.get(), n).to_string()
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn resolve(v: &Value, results: &[Value]) -> Value {
    match v {
        Value::Array(items) => Value::Array(items.iter().map(|x| resolve(x, results)).collect()),
        Value::Object(o) if o.contains_key("$ref") => {
            let r = &o["$ref"];
            results[r[0].as_u64().unwrap() as usize][r[1].as_str().unwrap()].clone()
        }
        Value::Object(o) if o.contains_key("$prefix") => {
            let r = &o["$prefix"];
            let full = results[r[0].as_u64().unwrap() as usize][r[1].as_str().unwrap()]
                .as_str()
                .unwrap()
                .to_owned();
            json!(full[..r[2].as_u64().unwrap() as usize])
        }
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| (k.clone(), resolve(x, results)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn s<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn to_value<T: serde::Serialize>(v: T) -> Value {
    serde_json::to_value(v).unwrap()
}

fn backup_value(ctx: &Ctx, b: &apply_removal_backup::ApplyRemovalBackup) -> Value {
    let content = match b.content(ctx) {
        Ok(bytes) => json!({ "$bytes": hex(&bytes) }),
        Err(_) => json!({ "$missing": true }),
    };
    json!({
        "id": b.id, "apply_id": b.apply_id, "snapshot_id": b.snapshot_id,
        "relative_path": b.relative_path, "mode": b.mode, "in_trash": b.in_trash,
        "created_at": b.created_at, "content": content,
    })
}

fn call(ctx: &Ctx, home: &str, cwd: &str, f: &str, a: &[Value]) -> Result<Value> {
    let a0 = a.first().cloned().unwrap_or(Value::Null);
    let str_arg = |i: usize| a.get(i).and_then(Value::as_str).unwrap_or("").to_owned();
    Ok(match f {
        "createSnapshot" => to_value(snapshot::create_snapshot(
            ctx,
            s(&a0, "project_id").unwrap(),
            s(&a0, "label").unwrap(),
            &a0["state"],
        )?),
        "getSnapshot" => to_value(snapshot::get_snapshot(ctx, &str_arg(0))?),
        "findSnapshotById" => {
            let min = a.get(1).and_then(Value::as_u64).unwrap_or(8) as usize;
            to_value(snapshot::find_snapshot_by_id(ctx, &str_arg(0), min)?)
        }
        "listSnapshots" => to_value(snapshot::list_snapshots(ctx, &str_arg(0))?),
        "getLatestSnapshot" => to_value(snapshot::get_latest_snapshot(ctx, &str_arg(0))?),
        "recordPreexistingPath" => to_value(preexisting_path::record_preexisting_path(
            ctx,
            s(&a0, "root_path").unwrap(),
            s(&a0, "path").unwrap(),
            s(&a0, "content_hash"),
        )?),
        "isPreexistingPath" => json!(preexisting_path::is_preexisting_path(
            ctx,
            &str_arg(0),
            &str_arg(1)
        )),
        "listPreexistingPaths" => json!(preexisting_path::list_preexisting_paths(ctx, &str_arg(0))),
        "upsertPackageCacheEntry" => to_value(package_cache_entry::upsert_package_cache_entry(
            ctx,
            &package_cache_entry::PackageCacheInput {
                kind: s(&a0, "kind").unwrap(),
                origin_ref: s(&a0, "origin_ref").unwrap(),
                resolved_key: s(&a0, "resolved_key").unwrap(),
                relative_path: s(&a0, "relative_path").unwrap(),
                resource_id: s(&a0, "resource_id"),
                content_fingerprint: s(&a0, "content_fingerprint"),
            },
        )?),
        "findPackageCacheEntry" => to_value(package_cache_entry::find_package_cache_entry(
            ctx,
            s(&a0, "kind").unwrap(),
            s(&a0, "origin_ref").unwrap(),
            s(&a0, "resolved_key").unwrap(),
        )?),
        "createProject" => to_value(project::create_project(
            ctx,
            s(&a0, "git_origin").unwrap(),
            s(&a0, "local_id"),
            s(&a0, "name").unwrap(),
            s(&a0, "local_path").unwrap(),
        )?),
        "getProjectByLocalId" => to_value(project::get_project_by_local_id(ctx, &str_arg(0))?),
        "upsertProjectByLocalId" => to_value(project::upsert_project_by_local_id(
            ctx,
            s(&a0, "local_id").unwrap(),
            s(&a0, "name").unwrap(),
            s(&a0, "local_path").unwrap(),
        )?),
        "getProjectByOrigin" => to_value(project::get_project_by_origin(ctx, &str_arg(0))?),
        "getProject" => to_value(project::get_project(ctx, &str_arg(0))?),
        "upsertProject" => to_value(project::upsert_project(
            ctx,
            s(&a0, "git_origin").unwrap(),
            s(&a0, "name").unwrap(),
            s(&a0, "local_path").unwrap(),
        )?),
        "listProjects" => to_value(project::list_projects(ctx)?),
        "getProjectByLocalPath" => {
            to_value(project::get_project_by_local_path(ctx, cwd, &str_arg(0))?)
        }
        "applyPluginToProject" => {
            let platforms: Vec<String> = serde_json::from_value(a0["platforms"].clone()).unwrap();
            project::apply_plugin_to_project(
                ctx,
                s(&a0, "project_id").unwrap(),
                s(&a0, "plugin_id").unwrap(),
                &platforms,
            )?;
            Value::Null
        }
        "getProjectPlugins" => to_value(project::get_project_plugins(ctx, &str_arg(0))?),
        "recordApplyRemovalBackup" => {
            let b = apply_removal_backup::record_apply_removal_backup(
                ctx,
                s(&a0, "apply_id").unwrap(),
                s(&a0, "snapshot_id"),
                s(&a0, "relative_path").unwrap(),
                &unhex(s(&a0["content"], "$bytes").unwrap()),
                a0["mode"].as_i64().unwrap(),
            )?;
            backup_value(ctx, &b)
        }
        "recordTrashedApplyRemovalBackup" => {
            let b = apply_removal_backup::record_trashed_apply_removal_backup(
                ctx,
                s(&a0, "apply_id").unwrap(),
                s(&a0, "snapshot_id"),
                s(&a0, "relative_path").unwrap(),
                a0["mode"].as_i64().unwrap(),
            )?;
            backup_value(ctx, &b)
        }
        "listApplyRemovalBackups" => {
            let rows = apply_removal_backup::list_apply_removal_backups(
                ctx,
                s(&a0, "apply_id"),
                s(&a0, "snapshot_id"),
            )?;
            Value::Array(rows.iter().map(|b| backup_value(ctx, b)).collect())
        }
        "listTrashPinnedApplyIds" => json!(apply_removal_backup::list_trash_pinned_apply_ids(ctx)?),
        "upsertPluginPinMaterialization" => {
            plugin_pin_materialization::upsert_plugin_pin_materialization(
                ctx,
                &plugin_pin_materialization::MaterializationInput {
                    scope: s(&a0, "scope").unwrap(),
                    root_path: s(&a0, "root_path").unwrap(),
                    relative_path: s(&a0, "relative_path").unwrap(),
                    origin_ref: s(&a0, "origin_ref").unwrap(),
                    resource_type: s(&a0, "resource_type").unwrap(),
                    resource_name: s(&a0, "resource_name").unwrap(),
                    plugin_pin_resource_id: s(&a0, "plugin_pin_resource_id"),
                },
            )?;
            Value::Null
        }
        "matchesPluginPinMaterialization" => {
            let r = &a[1];
            json!(
                plugin_pin_materialization::matches_plugin_pin_materialization(
                    ctx,
                    &str_arg(0),
                    s(r, "type").unwrap(),
                    s(r, "name").unwrap(),
                    s(r, "source"),
                )
            )
        }
        "findPluginPinResourceIdByOriginRef" => {
            json!(
                plugin_pin_materialization::find_plugin_pin_resource_id_by_origin_ref(
                    ctx,
                    &str_arg(0)
                )?
            )
        }
        "createGlobalApplySnapshot" => {
            to_value(global_apply_snapshot::create_global_apply_snapshot(
                ctx,
                s(&a0, "profile_name").unwrap(),
                &a0["plugin_ids"],
                a0.get("resolved_set"),
                a0.get("state"),
            )?)
        }
        "recordGlobalApplySnapshotInstall" => {
            to_value(global_apply_snapshot::record_global_apply_snapshot_install(
                ctx,
                s(&a0, "snapshot_id").unwrap(),
                s(&a0, "platform_id").unwrap(),
                &a0["files"],
            )?)
        }
        "getGlobalApplySnapshot" => to_value(global_apply_snapshot::get_global_apply_snapshot(
            ctx,
            &str_arg(0),
        )?),
        "listGlobalApplySnapshots" => {
            to_value(global_apply_snapshot::list_global_apply_snapshots(ctx)?)
        }
        "getLatestGlobalApplySnapshotForProfile" => to_value(
            global_apply_snapshot::get_latest_global_apply_snapshot_for_profile(ctx, &str_arg(0))?,
        ),
        "listGlobalApplySnapshotHeads" => to_value(
            global_apply_snapshot::list_global_apply_snapshot_heads(ctx)?,
        ),
        "renameGlobalApplySnapshotsProfile" => json!(
            global_apply_snapshot::rename_global_apply_snapshots_profile(
                ctx,
                &str_arg(0),
                &str_arg(1)
            )?
        ),
        "listGlobalApplySnapshotInstalls" => to_value(
            global_apply_snapshot::list_global_apply_snapshot_installs(ctx, &str_arg(0))?,
        ),
        "recordResourceMaterialization" => {
            to_value(resource_materialization::record_resource_materialization(
                ctx,
                &resource_materialization::MaterializationRecord {
                    resource_id: s(&a0, "resource_id").unwrap(),
                    scope: s(&a0, "scope").unwrap(),
                    project_id: s(&a0, "project_id"),
                    root_path: s(&a0, "root_path").unwrap(),
                    platform_id: s(&a0, "platform_id").unwrap(),
                    path: s(&a0, "path").unwrap(),
                    action: s(&a0, "action").unwrap(),
                    ownership_key: s(&a0, "ownership_key").unwrap(),
                    generated_hash: s(&a0, "generated_hash").unwrap(),
                    managed_container: a0["managed_container"].as_bool().unwrap_or(false),
                },
            )?)
        }
        "listMaterializationsForRoot" => to_value(
            resource_materialization::list_materializations_for_root(ctx, &str_arg(0)),
        ),
        "listMaterializationsForRootPath" => to_value(
            resource_materialization::list_materializations_for_root_path(
                ctx,
                &str_arg(0),
                &str_arg(1),
            ),
        ),
        "deleteMaterializationsForRootPaths" => {
            let paths: Vec<String> = serde_json::from_value(a[1].clone()).unwrap();
            resource_materialization::delete_materializations_for_root_paths(
                ctx,
                &str_arg(0),
                &paths,
            )?;
            Value::Null
        }
        "listResourceMaterializations" => to_value(
            resource_materialization::list_resource_materializations(ctx, &str_arg(0))?,
        ),
        "deleteResourceMaterializations" => json!(
            resource_materialization::delete_resource_materializations(ctx, &str_arg(0))?
        ),
        "replaceMaterializationsForPlatform" => {
            let entries: Vec<resource_materialization::PlatformEntry> = a0["entries"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| resource_materialization::PlatformEntry {
                    resource_id: s(e, "resource_id").unwrap().to_owned(),
                    path: s(e, "path").unwrap().to_owned(),
                    action: s(e, "action").unwrap().to_owned(),
                    ownership_key: s(e, "ownership_key").unwrap().to_owned(),
                    generated_hash: s(e, "generated_hash").unwrap().to_owned(),
                    managed_container: e["managed_container"].as_bool().unwrap(),
                })
                .collect();
            resource_materialization::replace_materializations_for_platform(
                ctx,
                s(&a0, "scope").unwrap(),
                s(&a0, "project_id"),
                s(&a0, "root_path").unwrap(),
                s(&a0, "platform_id").unwrap(),
                &entries,
            )?;
            Value::Null
        }
        "createImportedSnapshot" => to_value(imported_snapshot::create_imported_snapshot(
            ctx,
            &imported_snapshot::NewImportedSnapshot {
                source_kind: s(&a0, "source_kind").unwrap(),
                source_label: s(&a0, "source_label").unwrap(),
                plugin_name: s(&a0, "plugin_name").unwrap(),
                plugin_version: s(&a0, "plugin_version"),
                resource_ids: &a0["resource_ids"],
                metadata: &a0["metadata"],
            },
        )?),
        "listImportedSnapshots" => to_value(imported_snapshot::list_imported_snapshots(ctx)?),
        "getLatestImportedSnapshot" => to_value(imported_snapshot::get_latest_imported_snapshot(
            ctx,
            &str_arg(0),
        )?),
        "getImportedSnapshot" => {
            to_value(imported_snapshot::get_imported_snapshot(ctx, &str_arg(0))?)
        }
        "recordImportedSnapshotInstall" => {
            to_value(imported_snapshot::record_imported_snapshot_install(
                ctx,
                s(&a0, "snapshot_id").unwrap(),
                s(&a0, "platform_id").unwrap(),
                &a0["files"],
            )?)
        }
        "removeImportedSnapshotOwnershipForFiles" => {
            let paths: Vec<String> = serde_json::from_value(a0.clone()).unwrap();
            imported_snapshot::remove_imported_snapshot_ownership_for_files(
                ctx,
                &paths,
                a.get(1).and_then(Value::as_str),
            )?;
            Value::Null
        }
        "listImportedSnapshotInstalls" => to_value(
            imported_snapshot::list_imported_snapshot_installs(ctx, &str_arg(0))?,
        ),
        "findImportedSnapshotOwnersByFile" => to_value(
            imported_snapshot::find_imported_snapshot_owners_by_file(ctx, &str_arg(0))?,
        ),
        "__exec" => {
            ctx.db.exec(&str_arg(0))?;
            Value::Null
        }
        "__writeFile" => {
            let full = std::path::Path::new(home).join(str_arg(0));
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(full, unhex(&str_arg(1))).unwrap();
            Value::Null
        }
        other => panic!("no Rust counterpart for {other}"),
    })
}

fn dump(conn: &Connection) -> Value {
    let mut out = Map::new();
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    for name in tables.into_iter().filter(|n| n != "schema_version") {
        let mut stmt = conn
            .prepare(&format!("SELECT * FROM \"{name}\" ORDER BY rowid"))
            .unwrap();
        let cols: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
        let rows: Vec<Value> = stmt
            .query_map([], |row| {
                let mut m = Map::new();
                for (i, c) in cols.iter().enumerate() {
                    let v = match row.get::<_, Sql>(i)? {
                        Sql::Null => Value::Null,
                        Sql::Integer(n) => json!(n),
                        Sql::Real(f) => json!(f),
                        Sql::Text(t) => json!(t),
                        Sql::Blob(b) => json!({ "$bytes": hex(&b) }),
                    };
                    m.insert(c.clone(), v);
                }
                Ok(Value::Object(m))
            })
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        if !rows.is_empty() {
            out.insert(name, Value::Array(rows));
        }
    }
    Value::Object(out)
}

/// Sorted keys, then ULIDs renamed `<id1>`, `<id2>` in order of appearance.
fn normalize(v: &Value) -> String {
    fn sort(v: &Value) -> Value {
        match v {
            Value::Object(o) => {
                let mut keys: Vec<&String> = o.keys().collect();
                keys.sort();
                Value::Object(keys.into_iter().map(|k| (k.clone(), sort(&o[k]))).collect())
            }
            Value::Array(a) => Value::Array(a.iter().map(sort).collect()),
            other => other.clone(),
        }
    }
    let text = sort(v).to_string();
    let re = Regex::new(r"\b[0-9A-HJKMNP-TV-Z]{26}\b").unwrap();
    let mut seen: Vec<String> = Vec::new();
    re.replace_all(&text, |c: &regex::Captures| {
        let id = c[0].to_owned();
        let n = seen.iter().position(|x| *x == id).unwrap_or_else(|| {
            seen.push(id);
            seen.len() - 1
        });
        format!("<id{}>", n + 1)
    })
    .into_owned()
}

#[test]
fn models_match_the_original() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/models.json")).unwrap();
    let cwd = fixture["cwd"].as_str().unwrap();
    let base = 1_767_225_600_000_i64;
    let mut failures = Vec::new();
    for scenario in fixture["scenarios"].as_array().unwrap() {
        let name = scenario["name"].as_str().unwrap();
        let home_dir = std::env::temp_dir().join(format!(
            "models-rs-{}-{}",
            std::process::id(),
            name.replace(' ', "-")
        ));
        let _ = std::fs::remove_dir_all(&home_dir);
        std::fs::create_dir_all(&home_dir).unwrap();
        let home = home_dir.to_string_lossy().into_owned();
        let env = {
            let home = home.clone();
            move |k: &str| (k == "HARNESSTAP_HOME").then(|| home.clone())
        };
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        initialize_schema(&conn, InitializeSchemaOptions::default()).unwrap();
        let db = Db::from_connection(conn, ":memory:");
        let clock = StepClock(Cell::new(base));
        let ids = CountIds(Cell::new(0));
        let ctx = Ctx {
            db: &db,
            env: &env,
            clock: &clock,
            ids: &ids,
        };
        let mut results: Vec<Value> = Vec::new();
        let mut actual_calls = Vec::new();
        let mut expected_calls = Vec::new();
        for (i, c) in scenario["calls"].as_array().unwrap().iter().enumerate() {
            clock.0.set(base + i as i64 * 1000);
            let args = resolve(&c["args"], &results);
            let f = c["fn"].as_str().unwrap();
            match call(&ctx, &home, cwd, f, args.as_array().unwrap()) {
                Ok(v) => {
                    actual_calls.push(json!({ "fn": f, "result": v }));
                    results.push(v);
                }
                Err(e) => {
                    actual_calls.push(json!({ "fn": f, "error": e }));
                    results.push(Value::Null);
                }
            }
            let mut expected = json!({ "fn": f });
            if let Some(e) = c.get("error") {
                expected["error"] = e.clone();
            } else {
                expected["result"] = c["result"].clone();
            }
            expected_calls.push(expected);
        }
        let actual = normalize(&json!({ "calls": actual_calls, "dump": dump(&db.conn) }));
        let expected = normalize(&json!({ "calls": expected_calls, "dump": scenario["dump"] }));
        if actual != expected {
            let at = actual
                .bytes()
                .zip(expected.bytes())
                .position(|(x, y)| x != y)
                .unwrap_or(0);
            let from = at.saturating_sub(150);
            failures.push(format!(
                "{name}: differs at {at}\n  actual:   {}\n  expected: {}",
                &actual[from..(at + 150).min(actual.len())],
                &expected[from..(at + 150).min(expected.len())]
            ));
        }
        std::fs::remove_dir_all(&home_dir).unwrap();
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}
