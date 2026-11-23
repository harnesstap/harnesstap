//! Replays the calls `make-fixtures.ts` recorded against the original's
//! plugin model and compares results, errors and the database they leave,
//! with ULIDs renamed in order of appearance.
//!
//! `Stand` is the same database-only composition the recorder swaps in.

use db_rs::connection::Db;
use db_rs::schema::{InitializeSchemaOptions, initialize_schema};
use models_rs::resource::{Resource, map_resource_row};
use models_rs::{Clock, Ctx, Ids, Result, iso_from_millis};
use plugin_model_rs::origin::{self, AuthoredCapability};
use plugin_model_rs::upstream::{self, PluginUpstream, UpstreamRow};
use plugin_model_rs::versioning::{self, NameVersion, ResolveComposition};
use plugin_model_rs::*;
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
        let n = u128::from(self.0.get()).wrapping_mul(0x9E37_79B9_7F4A_7C15_F39C_C060_5CED_C835);
        ulid::Ulid::from_parts(1_767_225_600_000 + self.0.get(), n).to_string()
    }
}

struct Stand;

impl Stand {
    fn refs(ctx: &Ctx, plugin_id: &str) -> Result<Vec<PluginRefView>> {
        Ok(get_plugin_resources(ctx, plugin_id)?
            .into_iter()
            .filter(|r| r.resource.resource_type == "plugin")
            .map(|r| PluginRefView {
                dependency_name: r.resource.name.clone(),
                version_constraint: match r.resource.metadata.get("version_constraint") {
                    None | Some(Value::Null) => "latest".to_owned(),
                    Some(Value::String(s)) => s.clone(),
                    Some(v) => v.to_string(),
                },
                resource: r,
            })
            .collect())
    }
}

impl PluginComposition for Stand {
    fn composed_plugin_resources(
        &self,
        ctx: &Ctx,
        plugin_id: &str,
    ) -> Result<Vec<AttachedResource>> {
        get_plugin_resources(ctx, plugin_id)
    }
    fn composed_dependencies(&self, ctx: &Ctx, plugin_id: &str) -> Result<Vec<PluginPin>> {
        Ok(Stand::refs(ctx, plugin_id)?
            .into_iter()
            .map(|r| PluginPin {
                reference: r.dependency_name,
                version_constraint: r.version_constraint,
            })
            .collect())
    }
    fn attached_plugin_refs(&self, ctx: &Ctx, plugin_id: &str) -> Result<Vec<PluginRefView>> {
        Stand::refs(ctx, plugin_id)
    }
    fn ensure_plugin_resource(
        &self,
        ctx: &Ctx,
        selector: &str,
        version_constraint: Option<&str>,
    ) -> Result<Resource> {
        let name = selector.strip_prefix("plugin:").unwrap_or(selector);
        let metadata = match version_constraint.filter(|v| !v.is_empty()) {
            Some(v) => json!({ "version_constraint": v }).to_string(),
            None => "{}".to_owned(),
        };
        let now = ctx.clock.now_iso();
        let existing: Option<String> = ctx
            .db
            .conn
            .query_row(
                "SELECT id FROM resources WHERE type = 'plugin' AND name = ?",
                [name],
                |r| r.get(0),
            )
            .ok();
        match existing {
            Some(id) => ctx.db.run(
                "UPDATE resources SET metadata = ?, updated_at = ? WHERE id = ?",
                [metadata, now, id],
            )?,
            None => ctx.db.run(
                "INSERT INTO resources (id, type, name, metadata, created_at, updated_at) VALUES (?, 'plugin', ?, ?, ?, ?)",
                [ctx.ids.ulid(), name.to_owned(), metadata, now.clone(), now],
            )?,
        };
        ctx.db
            .conn
            .query_row(
                "SELECT * FROM resources WHERE type = 'plugin' AND name = ?",
                [name],
                |r| map_resource_row(ctx, r),
            )
            .map_err(|e| e.to_string())
    }
    fn claude_config_from_plugin_pins(&self, _ctx: &Ctx, pins: &[PluginPin]) -> Option<Value> {
        (!pins.is_empty()).then(|| {
            json!({ "plugins": pins.iter().map(|p| json!({
                "id": p.reference, "version": p.version_constraint, "enabled": true
            })).collect::<Vec<_>>() })
        })
    }
}

impl ResolveComposition for Stand {
    fn resolved_set(&self, ctx: &Ctx, root_selector: &str) -> Result<Vec<NameVersion>> {
        let root = resolve_plugin_selector(ctx, root_selector)?;
        let Some(root) = root.filter(|r| !r.name.starts_with("broken")) else {
            return Err("unresolvable".to_owned());
        };
        Ok(Stand::refs(ctx, &root.id)?
            .into_iter()
            .map(|r| NameVersion {
                name: r.dependency_name,
                version: r.version_constraint,
            })
            .collect())
    }
}

fn capability(v: &Value) -> AuthoredCapability {
    match v.as_str().unwrap() {
        "edit" => AuthoredCapability::Edit,
        "cut" => AuthoredCapability::Cut,
        "publish" => AuthoredCapability::Publish,
        _ => AuthoredCapability::Needs,
    }
}

fn resolve(v: &Value, results: &[Value]) -> Value {
    match v {
        Value::Array(items) => Value::Array(items.iter().map(|x| resolve(x, results)).collect()),
        Value::Object(o) if o.contains_key("$ref") => {
            let r = &o["$ref"];
            let mut v = &results[r[0].as_u64().unwrap() as usize];
            let field = r[1].as_str().unwrap();
            if !field.is_empty() {
                for key in field.split('.') {
                    v = match v {
                        Value::Array(a) => &a[key.parse::<usize>().unwrap()],
                        other => &other[key],
                    };
                }
            }
            v.clone()
        }
        Value::Object(o) if o.contains_key("$undef") => Value::Null,
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, v)| (k.clone(), resolve(v, results)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn to_value<T: serde::Serialize>(v: T) -> Value {
    serde_json::to_value(v).unwrap()
}

fn from<T: serde::de::DeserializeOwned>(v: &Value) -> Result<T> {
    if v.is_null() {
        return Err("undefined is not an object".to_owned());
    }
    serde_json::from_value(v.clone()).map_err(|e| e.to_string())
}

fn opt_str(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(str::to_owned)
}

fn call(ctx: &Ctx, home: &str, f: &str, a: &[Value]) -> Result<Value> {
    let s = |i: usize| a.get(i).and_then(Value::as_str).unwrap_or_default();
    let o = |i: usize, k: &str| a.get(i).and_then(|v| v.get(k)).and_then(Value::as_str);
    let strs = |i: usize| -> Vec<String> {
        a[i].as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned())
            .collect()
    };
    let scope = |i: usize| a.get(i).filter(|v| !v.is_null());
    Ok(match f {
        "isFrozenPlugin" => json!(is_frozen_plugin(&from::<Plugin>(&a[0])?)),
        "mergePluginsById" => to_value(merge_plugins_by_id(ctx, &Stand, &strs(0))?),
        "createPlugin" => to_value(create_plugin(ctx, &from(&a[0])?)?),
        "stampPluginOrigin" => {
            stamp_plugin_origin(ctx, s(0), &from(&a[1])?)?;
            Value::Null
        }
        "assertNoFrozenWorkingVersion" => {
            assert_no_frozen_working_version(ctx, &from(&a[0])?, s(1))?;
            Value::Null
        }
        "bumpPluginWorkingVersion" => {
            bump_plugin_working_version(ctx, s(0), s(1))?;
            Value::Null
        }
        "updatePluginPublishedIdentity" => json!(update_plugin_published_identity(
            ctx,
            s(0),
            o(1, "org_slug").unwrap(),
            o(1, "catalog_slug").unwrap(),
            o(1, "version")
        )?),
        "updatePluginCatalogIdentity" => json!(update_plugin_catalog_identity(
            ctx,
            s(0),
            o(1, "org_slug").unwrap(),
            o(1, "catalog_slug").unwrap()
        )?),
        "parsePluginSelectorString" => to_value(parse_plugin_selector_string(s(0))),
        "getPluginById" => to_value(get_plugin_by_id(ctx, s(0))?),
        "getPlugin" => to_value(get_plugin(ctx, s(0))?),
        "getPluginByName" => to_value(get_plugin_by_name(
            ctx,
            s(0),
            a.get(1).and_then(Value::as_str),
        )?),
        "getPluginByPublishedIdentity" => to_value(get_plugin_by_published_identity(
            ctx,
            o(0, "name").unwrap(),
            o(0, "version").unwrap(),
            o(0, "org"),
            o(0, "catalog"),
        )?),
        "getPluginByCatalogVersion" => {
            to_value(get_plugin_by_catalog_version(ctx, s(0), s(1), s(2))?)
        }
        "findPluginForCatalogInstall" => to_value(find_plugin_for_catalog_install(
            ctx,
            o(0, "org").unwrap(),
            o(0, "catalog").unwrap(),
            o(0, "pluginSlug").unwrap(),
            o(0, "version").unwrap(),
        )?),
        "listLatestPublishedPluginsBySlug" => {
            to_value(list_latest_published_plugins_by_slug(ctx, s(0))?)
        }
        "formatPublishedPluginSelector" => json!(format_published_plugin_selector(
            o(0, "org_slug").unwrap(),
            o(0, "catalog_slug").unwrap(),
            o(0, "name").unwrap(),
            o(0, "version").unwrap()
        )),
        "isSamePublishedPluginIdentity" => {
            let p = &a[0];
            json!(
                p["org_slug"] == a[1]["org_slug"]
                    && p["catalog_slug"] == a[1]["catalog_slug"]
                    && p["name"] == a[1]["plugin_slug"]
            )
        }
        "listPlugins" => to_value(list_plugins(ctx)?),
        "listPluginsAttachingResource" => to_value(list_plugins_attaching_resource(ctx, s(0))?),
        "deletePlugin" => json!(delete_plugin(ctx, s(0))?),
        "addResourceToPlugin" => {
            add_resource_to_plugin(ctx, s(0), s(1), scope(2))?;
            Value::Null
        }
        "setPluginResourceHarnessScope" => {
            set_plugin_resource_harness_scope(ctx, s(0), s(1), &a[2])?;
            Value::Null
        }
        "getPluginResourceHarnessScope" => get_plugin_resource_harness_scope(ctx, s(0), s(1))?,
        "removeResourceFromPlugin" => {
            remove_resource_from_plugin(ctx, s(0), s(1))?;
            Value::Null
        }
        "setPluginResourceOrder" => {
            set_plugin_resource_order(ctx, s(0), &strs(1))?;
            Value::Null
        }
        "touchPluginUpdatedAt" => {
            touch_plugin_updated_at(ctx, s(0))?;
            Value::Null
        }
        "getPluginResources" => to_value(get_plugin_resources(ctx, s(0))?),
        "ensurePluginClaudeMarketplace" => json!(ensure_plugin_claude_marketplace(
            ctx,
            &from(&a[0])?,
            s(1),
            &a[2]
        )?),
        "syncClaudeMarketplacePluginsAfterAdd" => {
            sync_claude_marketplace_plugins_after_add(ctx, &from(&a[0])?, s(1), s(2))?;
            Value::Null
        }
        "syncClaudeMarketplacePluginsAfterRemove" => {
            sync_claude_marketplace_plugins_after_remove(ctx, &from(&a[0])?, s(1))?;
            Value::Null
        }
        "addDependencyToPlugin" => {
            add_dependency_to_plugin(ctx, &Stand, s(0), s(1), s(2))?;
            Value::Null
        }
        "listPluginDependencies" => to_value(list_plugin_dependencies(ctx, &Stand, s(0))?),
        "removeDependencyFromPlugin" => {
            json!(remove_dependency_from_plugin(ctx, &Stand, s(0), s(1))?)
        }
        "setPluginDefaultEnvironment" => {
            json!(set_plugin_default_environment(ctx, s(0), a[1].as_str())?)
        }
        "setPluginTags" => json!(set_plugin_tags(ctx, s(0), &strs(1))?),
        "setPluginApName" => json!(set_plugin_ap_name(ctx, s(0), s(1))?),
        "setPluginSpecMetadata" => {
            set_plugin_spec_metadata(ctx, s(0), &from(&a[1])?)?;
            Value::Null
        }
        "readPluginOpaqueExtensions" => Value::Object(read_plugin_opaque_extensions(ctx, s(0))?),
        "resolveApName" => json!(resolve_ap_name(o(0, "name").unwrap(), o(0, "ap_name"))),
        "updatePluginName" => json!(update_plugin_name(ctx, s(0), s(1))?),
        "updatePluginDescription" => json!(update_plugin_description(ctx, s(0), s(1))?),
        "createPluginFromSources" => {
            to_value(create_plugin_from_sources(ctx, &Stand, &from(&a[0])?)?)
        }
        "resolvePluginSelector" => to_value(resolve_plugin_selector(ctx, s(0))?),
        "listPluginVersions" => to_value(list_plugin_versions(ctx, s(0))?),
        "upstreamFromRow" => {
            let row = UpstreamRow {
                upstream_kind: opt_str(a[0].get("upstream_kind")),
                upstream_ref: opt_str(a[0].get("upstream_ref")),
                upstream_version_at_link: opt_str(a[0].get("upstream_version_at_link")),
                upstream_plugin_id: opt_str(a[0].get("upstream_plugin_id")),
            };
            let (up, id) = upstream::upstream_from_row(&row);
            let mut out = Map::new();
            if let Some(up) = up {
                out.insert("upstream".into(), to_value(up));
            }
            if let Some(id) = id {
                out.insert("upstream_plugin_id".into(), json!(id));
            }
            Value::Object(out)
        }
        "isCatalogUpstreamRef" => json!(upstream::is_catalog_upstream_ref(s(0))),
        "upstreamRange" => json!(upstream::upstream_range(s(0))),
        "buildUpstream" => to_value(upstream::build_upstream(s(0), s(1), s(2))),
        "upstreamRefBase" => json!(upstream::upstream_ref_base(s(0))),
        "formatUpstreamLabel" => json!(upstream::format_upstream_label(&from(&a[0])?)),
        "exportableUpstream" => {
            let up: Option<PluginUpstream> = if a[0].is_null() {
                None
            } else {
                Some(from(&a[0])?)
            };
            to_value(upstream::exportable_upstream(up.as_ref()))
        }
        "parseUpstream" => to_value(upstream::parse_upstream(&a[0])),
        "setPluginUpstream" => {
            upstream::set_plugin_upstream(ctx, s(0), &from(&a[1])?, s(2))?;
            Value::Null
        }
        "isValidApName" => json!(name::is_valid_ap_name(s(0))),
        "isValidAgentSkillName" => json!(name::is_valid_agent_skill_name(s(0))),
        "slugifyAgentSkillName" => json!(name::slugify_agent_skill_name(s(0))),
        "slugifyApName" => json!(name::slugify_ap_name(s(0))),
        "formatPluginVersionLabel" => json!(versioning::format_plugin_version_label(
            s(0),
            a[1].as_bool().unwrap()
        )),
        "listPluginVersionHistory" => to_value(versioning::list_plugin_version_history(ctx, s(0))?),
        "markPluginClean" => {
            versioning::mark_plugin_clean(ctx, s(0))?;
            Value::Null
        }
        "markPluginDirty" => {
            versioning::mark_plugin_dirty(ctx, &Stand, s(0))?;
            Value::Null
        }
        "cutPluginVersion" => to_value(versioning::cut_plugin_version(
            ctx,
            &Stand,
            o(0, "pluginId").unwrap(),
            o(0, "newVersion").unwrap(),
        )?),
        "assertPluginsCleanForShare" => {
            versioning::assert_plugins_clean_for_share(&from::<Vec<Plugin>>(&a[0])?)?;
            Value::Null
        }
        "getFrozenResolvedSet" => versioning::get_frozen_resolved_set(ctx, s(0))?,
        "formatPluginRollbackConfirmMessage" => {
            json!(versioning::format_plugin_rollback_confirm_message(
                o(0, "headVersion").unwrap(),
                o(0, "frozenVersion").unwrap(),
                a[0]["dirty"].as_bool().unwrap(),
            ))
        }
        "rollbackPluginVersion" => to_value(versioning::rollback_plugin_version(
            ctx,
            &Stand,
            o(0, "selector").unwrap(),
            o(0, "toVersion").unwrap(),
        )?),
        "getPluginOrigin" => json!(origin::get_plugin_origin(ctx, s(0))?),
        "setPluginOrigin" => {
            origin::set_plugin_origin(ctx, s(0), s(1))?;
            Value::Null
        }
        "assertAuthored" => {
            origin::assert_authored(ctx, s(0), capability(&a[1]))?;
            Value::Null
        }
        "assertSyncable" => {
            origin::assert_syncable(ctx, s(0))?;
            Value::Null
        }
        "__query" => {
            let mut stmt = ctx.db.conn.prepare(s(0)).unwrap();
            let n = stmt.column_count();
            let rows: Vec<Value> = stmt
                .query_map([], |row| {
                    (0..n)
                        .map(|i| {
                            Ok(match row.get::<_, Sql>(i)? {
                                Sql::Null => Value::Null,
                                Sql::Integer(v) => json!(v),
                                Sql::Real(v) => json!(v),
                                Sql::Text(t) => json!(t),
                                Sql::Blob(_) => json!("<blob>"),
                            })
                        })
                        .collect::<rusqlite::Result<Vec<_>>>()
                        .map(Value::Array)
                })
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();
            Value::Array(rows)
        }
        "__writeConfig" => {
            std::fs::write(std::path::Path::new(home).join("config.json"), s(0)).unwrap();
            Value::Null
        }
        "__exec" => {
            ctx.db.exec(s(0))?;
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
                        Sql::Blob(_) => json!("<blob>"),
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
    let re = regex::Regex::new(r"\b[0-9A-HJKMNP-TV-Z]{26}\b").unwrap();
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
fn plugin_model_matches_the_original() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/plugin-model.json")).unwrap();
    let setup = fixture["setup"].as_str().unwrap();
    let base = 1_767_225_600_000_i64;
    let mut failures = Vec::new();
    let mut calls = 0;
    for scenario in fixture["scenarios"].as_array().unwrap() {
        let name = scenario["name"].as_str().unwrap();
        let home_dir = std::env::temp_dir().join(format!(
            "plugin-model-rs-{}-{}",
            std::process::id(),
            name.replace(' ', "-")
        ));
        std::fs::create_dir_all(&home_dir).unwrap();
        let home = home_dir.to_string_lossy().into_owned();
        let env = {
            let home = home.clone();
            move |k: &str| (k == "HARNESSTAP_HOME").then(|| home.clone())
        };
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        initialize_schema(&conn, InitializeSchemaOptions::default()).unwrap();
        conn.execute_batch(setup).unwrap();
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
            calls += 1;
            clock.0.set(base + i as i64 * 1000);
            let args = resolve(&c["args"], &results);
            let f = c["fn"].as_str().unwrap();
            match call(&ctx, &home, f, args.as_array().unwrap()) {
                Ok(v) => {
                    actual_calls.push(json!({ "i": i, "fn": f, "result": v }));
                    results.push(v);
                }
                Err(e) => {
                    actual_calls.push(json!({ "i": i, "fn": f, "error": e }));
                    results.push(Value::Null);
                }
            }
            let mut expected = json!({ "i": i, "fn": f });
            if let Some(e) = c.get("error") {
                expected["error"] = e.clone();
            } else {
                expected["result"] = c["result"].clone();
            }
            expected_calls.push(expected);
        }
        for (a, e) in actual_calls.iter().zip(&expected_calls) {
            if a != e && normalize(a) != normalize(e) {
                failures.push(format!("{name}:\n  actual:   {a}\n  expected: {e}"));
                break;
            }
        }
        let actual = normalize(&json!({ "calls": actual_calls, "dump": dump(&db.conn) }));
        let expected = normalize(&json!({ "calls": expected_calls, "dump": scenario["dump"] }));
        if actual != expected && !failures.iter().any(|f| f.starts_with(&format!("{name}:"))) {
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
        let _ = std::fs::remove_dir_all(&home_dir);
    }
    assert!(
        failures.is_empty(),
        "{} failures\n{}",
        failures.len(),
        failures.join("\n\n")
    );
    assert!(calls > 1800, "{calls} calls");
}
