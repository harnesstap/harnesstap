//! The port of `src/services/plugin-versioning.ts`: working snapshots,
//! dirty marks, cuts of frozen versions, history and rollback.
//!
//! `PluginVersionError` is an `Err` with its message.
//!
//! A working snapshot records the plugins the head's composition resolves to
//! (`resolveComposition`). That comes through [`ResolveComposition`] until
//! `services/resolve/index.ts` is ported (see `rust/MAP.md`).

use crate::origin::{AuthoredCapability, assert_authored};
use crate::upstream::upstream_from_row;
use crate::{
    Plugin, PluginRow, all_scope, delete_plugin, err, get_plugin_by_published_identity,
    get_plugin_resources, non_empty, parse_claude_config, parse_needs_config, parse_scope,
    plugin_rows, resolve_plugin_selector, serialize_scope, stringify, transaction,
};
use db_rs::paths::harnesstap_dir;
use harness_scope_rs::js::sort as js_sort;
use models_rs::{Ctx, Result};
use node_semver_rs::{self as semver, Options};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

/// `{ name, version }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NameVersion {
    pub name: String,
    pub version: String,
}

/// `resolveComposition({ rootSelectors: [root] }).selected`, the plugins
/// below the root (`depth > 0`).
pub trait ResolveComposition {
    fn resolved_set(&self, ctx: &Ctx, root_selector: &str) -> Result<Vec<NameVersion>>;
}

fn read_exclude_entries(ctx: &Ctx, plugin_id: &str) -> Result<Vec<String>> {
    let mut stmt = ctx
        .db
        .conn
        .prepare_cached("SELECT entry FROM plugin_excludes WHERE plugin_id = ? ORDER BY entry")
        .map_err(err)?;
    let rows = stmt.query_map([plugin_id], |r| r.get(0)).map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<String>>>().map_err(err)
}

/// This file's `rowToPlugin`, which reads fewer columns than the model's.
fn row_to_plugin(row: PluginRow) -> Result<Plugin> {
    let claude = parse_claude_config(row.claude_config.as_deref())?;
    let needs = parse_needs_config(row.needs_config.as_deref())?;
    let tags: Vec<String> = serde_json::from_str(&row.tags).map_err(|e| format!("tags: {e}"))?;
    let (upstream, upstream_plugin_id) = upstream_from_row(&row.upstream);
    Ok(Plugin {
        id: row.id,
        name: row.name,
        version: row.version,
        org_slug: row.org_slug,
        catalog_slug: row.catalog_slug,
        origin: row.origin.unwrap_or_else(|| "authored".to_owned()),
        description: row.description,
        tags,
        dirty: row.dirty,
        frozen_at: non_empty(row.frozen_at),
        claude,
        needs,
        overrides: None,
        default_environment_id: non_empty(row.default_environment_id),
        ap_name: None,
        author: None,
        homepage: None,
        repository: None,
        license: None,
        origin_locator: None,
        origin_fingerprint: None,
        origin_fingerprint_kind: None,
        upstream,
        upstream_plugin_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn get_plugin_row_by_id(ctx: &Ctx, plugin_id: &str) -> Result<Option<PluginRow>> {
    Ok(
        plugin_rows(ctx, "SELECT * FROM plugins WHERE id = ?", [plugin_id])?
            .into_iter()
            .next(),
    )
}

fn is_frozen(row: &PluginRow) -> bool {
    row.frozen_at.as_deref().is_some_and(|f| !f.is_empty())
}

/// Resource id to serialized scope, for the attachments not scoped to all.
fn harness_scopes(ctx: &Ctx, plugin_id: &str) -> Result<(Vec<String>, Map<String, Value>)> {
    let attached = get_plugin_resources(ctx, plugin_id)?;
    let mut scopes = Map::new();
    for resource in &attached {
        let scope = resource.harness_scope.clone().unwrap_or_else(all_scope);
        let serialized = serialize_scope(&scope)?;
        if serialized != "all" {
            scopes.insert(resource.resource.id.clone(), Value::String(serialized));
        }
    }
    Ok((
        attached.into_iter().map(|r| r.resource.id).collect(),
        scopes,
    ))
}

/// `captureWorkingSnapshot`.
fn capture_working_snapshot(
    ctx: &Ctx,
    resolver: &dyn ResolveComposition,
    plugin_id: &str,
) -> Result<()> {
    let Some(row) = get_plugin_row_by_id(ctx, plugin_id)? else {
        return Err(format!("Plugin not found: {plugin_id}"));
    };
    let (resource_ids, scopes) = harness_scopes(ctx, plugin_id)?;
    // A plugin that does not resolve can still be cut; record nothing.
    let resolved_set = resolver
        .resolved_set(ctx, &format!("{}@{}", row.name, row.version))
        .unwrap_or_default();
    let tags: Value = serde_json::from_str(&row.tags).map_err(|e| format!("tags: {e}"))?;
    let mut payload = Map::new();
    payload.insert("resource_ids".into(), json!(resource_ids));
    if !scopes.is_empty() {
        payload.insert("harness_scopes".into(), Value::Object(scopes));
    }
    payload.insert("description".into(), json!(row.description));
    payload.insert("tags".into(), tags);
    payload.insert("claude_config".into(), json!(row.claude_config));
    payload.insert("needs_config".into(), json!(row.needs_config));
    payload.insert(
        "default_environment_id".into(),
        json!(row.default_environment_id),
    );
    payload.insert("source_version".into(), json!(row.version));
    payload.insert("resolved_set".into(), json!(resolved_set));
    payload.insert(
        "excludes".into(),
        json!(read_exclude_entries(ctx, plugin_id)?),
    );
    ctx.db.run(
        "INSERT INTO plugin_working_snapshots (plugin_id, source_version, payload, created_at)\n     VALUES (?, ?, ?, ?)\n     ON CONFLICT(plugin_id) DO UPDATE SET\n       source_version = excluded.source_version,\n       payload = excluded.payload,\n       created_at = excluded.created_at",
        params![plugin_id, row.version, stringify(&Value::Object(payload)), ctx.clock.now_iso()],
    )?;
    Ok(())
}

/// `ensureWorkingSnapshot`.
fn ensure_working_snapshot(
    ctx: &Ctx,
    resolver: &dyn ResolveComposition,
    plugin_id: &str,
) -> Result<()> {
    let existing: Option<String> = ctx
        .db
        .conn
        .query_row(
            "SELECT plugin_id FROM plugin_working_snapshots WHERE plugin_id = ?",
            [plugin_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if existing.is_none() {
        capture_working_snapshot(ctx, resolver, plugin_id)?;
    }
    Ok(())
}

/// `copySnapshotAttachments`.
fn copy_snapshot_attachments(
    ctx: &Ctx,
    plugin_id: &str,
    resource_ids: &[Value],
    scopes: Option<&Map<String, Value>>,
) -> Result<()> {
    for (order, id) in resource_ids.iter().enumerate() {
        // `if (!resourceId) continue;`
        let Some(id) = id.as_str().filter(|s| !s.is_empty()) else {
            continue;
        };
        let raw = scopes
            .and_then(|s| s.get(id))
            .and_then(Value::as_str)
            .map(str::to_owned);
        ctx.db.run(
            "INSERT OR REPLACE INTO plugin_resources (plugin_id, resource_id, \"order\", harness_scope)\n       VALUES (?, ?, ?, ?)",
            params![plugin_id, id, order as i64, serialize_scope(&parse_scope(raw)?)?],
        )?;
    }
    Ok(())
}

/// `isExactPluginVersionReferenced`.
fn is_exact_plugin_version_referenced(ctx: &Ctx, plugin_name: &str, version: &str) -> Result<bool> {
    let mut stmt = ctx
        .db
        .conn
        .prepare_cached(
            "SELECT r.namespace, r.metadata\n       FROM resources r\n       JOIN plugin_resources lr ON lr.resource_id = r.id\n       WHERE r.type = 'plugin' AND r.name = ?",
        )
        .map_err(err)?;
    let rows: Vec<(String, String)> = stmt
        .query_map([plugin_name], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;
    for (namespace, metadata) in rows {
        let metadata: Value =
            serde_json::from_str(&metadata).map_err(|e| format!("metadata: {e}"))?;
        let is = |key: &str| metadata.get(key).and_then(Value::as_str) == Some(version);
        if namespace == version || is("version_constraint") || is("resolved_version") {
            return Ok(true);
        }
    }
    Ok(false)
}

/// `prunePluginHistory`.
fn prune_plugin_history(ctx: &Ctx, head: &PluginRow) -> Result<()> {
    let limit = settings_rs::load_settings(&harnesstap_dir(ctx.env)).plugin_version_history_limit;
    let rows = plugin_rows(
        ctx,
        "SELECT * FROM plugins\n       WHERE name = ? AND org_slug = ? AND catalog_slug = ?\n       ORDER BY frozen_at IS NULL DESC, frozen_at ASC, created_at ASC",
        [&head.name, &head.org_slug, &head.catalog_slug],
    )?;
    if rows.len() as f64 <= limit {
        return Ok(());
    }
    let mut excess = rows.len() as f64 - limit;
    for row in rows.iter().filter(|r| r.frozen_at.is_some()) {
        if excess <= 0.0 {
            break;
        }
        if is_exact_plugin_version_referenced(ctx, &head.name, &row.version)? {
            eprintln!(
                "Skipping prune of frozen plugin {}@{}: still referenced by a plugin dependency",
                head.name, row.version
            );
            continue;
        }
        delete_plugin(ctx, &row.id)?;
        excess -= 1.0;
    }
    Ok(())
}

/// `formatPluginVersionLabel`.
pub fn format_plugin_version_label(version: &str, dirty: bool) -> String {
    if dirty {
        format!("{version}*")
    } else {
        version.to_owned()
    }
}

/// `PluginVersionHistoryEntry`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PluginVersionHistoryEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub dirty: bool,
    pub frozen_at: Option<String>,
    pub is_head: bool,
    pub updated_at: String,
}

fn valid(version: &str) -> bool {
    semver::valid(version, Options::STRICT).is_some()
}

/// `listPluginVersionHistory`. A version held by two rows lists the first
/// row twice, as the original does.
pub fn list_plugin_version_history(
    ctx: &Ctx,
    name: &str,
) -> Result<Vec<PluginVersionHistoryEntry>> {
    let rows = plugin_rows(ctx, "SELECT * FROM plugins WHERE name = ?", [name])?;
    let versions: Vec<&str> = rows.iter().map(|r| r.version.as_str()).collect();
    let mut ordered: Vec<&str> = versions.iter().copied().filter(|v| valid(v)).collect();
    js_sort(&mut ordered, |a, b| {
        f64::from(semver::rcompare(*a, *b, Options::STRICT).unwrap_or(0))
    });
    ordered.extend(versions.iter().copied().filter(|v| !valid(v)));
    Ok(ordered
        .into_iter()
        .filter_map(|version| rows.iter().find(|r| r.version == version))
        .map(|row| PluginVersionHistoryEntry {
            id: row.id.clone(),
            name: row.name.clone(),
            version: row.version.clone(),
            dirty: row.dirty,
            frozen_at: row.frozen_at.clone(),
            is_head: row.frozen_at.is_none(),
            updated_at: row.updated_at.clone(),
        })
        .collect())
}

/// `markPluginClean`: a plugin fresh from a catalog package is not edited.
pub fn mark_plugin_clean(ctx: &Ctx, plugin_id: &str) -> Result<()> {
    ctx.db
        .run("UPDATE plugins SET dirty = 0 WHERE id = ?", [plugin_id])?;
    Ok(())
}

/// `markPluginDirty`.
pub fn mark_plugin_dirty(
    ctx: &Ctx,
    resolver: &dyn ResolveComposition,
    plugin_id: &str,
) -> Result<()> {
    let Some(row) = get_plugin_row_by_id(ctx, plugin_id)? else {
        return Err(format!("Plugin not found: {plugin_id}"));
    };
    if is_frozen(&row) {
        return Err(format!(
            "Plugin {}@{} is frozen and cannot be marked dirty",
            row.name, row.version
        ));
    }
    if row.dirty {
        return Ok(());
    }
    transaction(ctx, || {
        capture_working_snapshot(ctx, resolver, plugin_id)?;
        ctx.db.run(
            "UPDATE plugins SET dirty = 1, updated_at = ? WHERE id = ?",
            params![ctx.clock.now_iso(), plugin_id],
        )?;
        Ok(())
    })
}

/// `cutPluginVersion`.
pub fn cut_plugin_version(
    ctx: &Ctx,
    resolver: &dyn ResolveComposition,
    plugin_id: &str,
    new_version: &str,
) -> Result<Plugin> {
    let Some(head) = get_plugin_row_by_id(ctx, plugin_id)? else {
        return Err(format!("Plugin not found: {plugin_id}"));
    };
    if is_frozen(&head) {
        return Err(format!(
            "Plugin {}@{} is frozen and cannot be cut",
            head.name, head.version
        ));
    }
    if !valid(new_version) {
        return Err(format!("Invalid semver version: {new_version}"));
    }
    if new_version == head.version {
        return Err(format!(
            "New version must differ from current version {}",
            head.version
        ));
    }
    if get_plugin_by_published_identity(
        ctx,
        &head.name,
        new_version,
        Some(&head.org_slug),
        Some(&head.catalog_slug),
    )?
    .is_some()
    {
        return Err(format!("Plugin {}@{new_version} already exists", head.name));
    }
    ensure_working_snapshot(ctx, resolver, &head.id)?;
    let cut = transaction(ctx, || {
        let snapshot: Option<String> = ctx
            .db
            .conn
            .query_row(
                "SELECT payload FROM plugin_working_snapshots WHERE plugin_id = ?",
                [&head.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let Some(snapshot) = snapshot else {
            return Err(format!("Working snapshot missing for plugin {}", head.id));
        };
        let payload: Value =
            serde_json::from_str(&snapshot).map_err(|e| format!("payload: {e}"))?;
        let now = ctx.clock.now_iso();
        let frozen_id = ctx.ids.ulid();
        ctx.db.run(
            "UPDATE plugins\n       SET version = ?, dirty = 0, updated_at = ?\n       WHERE id = ?",
            params![new_version, now, head.id],
        )?;
        let text = |key: &str| payload.get(key).and_then(Value::as_str).map(str::to_owned);
        let up = &head.upstream;
        ctx.db.run(
            "INSERT INTO plugins (\n        id, name, version, org_slug, catalog_slug, description, tags,\n        claude_config, needs_config, default_environment_id, dirty, frozen_at,\n        created_at, updated_at, upstream_kind, upstream_ref,\n        upstream_version_at_link, upstream_plugin_id\n      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                frozen_id,
                head.name,
                text("source_version"),
                head.org_slug,
                head.catalog_slug,
                text("description"),
                stringify(payload.get("tags").unwrap_or(&Value::Null)),
                text("claude_config"),
                text("needs_config"),
                text("default_environment_id"),
                0,
                now,
                now,
                now,
                up.upstream_kind.as_deref().unwrap_or(""),
                up.upstream_ref.as_deref().unwrap_or(""),
                up.upstream_version_at_link.as_deref().unwrap_or(""),
                up.upstream_plugin_id.as_deref().unwrap_or(""),
            ],
        )?;
        let resolved_set = match payload.get("resolved_set") {
            None | Some(Value::Null) => json!([]),
            Some(v) => v.clone(),
        };
        ctx.db.run(
            "UPDATE plugins SET overrides = ? WHERE id = ?",
            params![
                stringify(
                    &json!({ "versions": {}, "resources": {}, "frozen_resolved_set": resolved_set })
                ),
                frozen_id
            ],
        )?;
        let ids = payload
            .get("resource_ids")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        copy_snapshot_attachments(
            ctx,
            &frozen_id,
            &ids,
            payload.get("harness_scopes").and_then(Value::as_object),
        )?;
        let excludes = match payload.get("excludes") {
            None | Some(Value::Null) => read_exclude_entries(ctx, &head.id)?,
            Some(v) => v
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
        };
        for entry in excludes {
            ctx.db.run(
                "INSERT OR IGNORE INTO plugin_excludes (plugin_id, entry, created_at) VALUES (?, ?, ?)",
                params![frozen_id, entry, now],
            )?;
        }
        ctx.db.run(
            "DELETE FROM plugin_working_snapshots WHERE plugin_id = ?",
            [&head.id],
        )?;
        let Some(updated) = get_plugin_row_by_id(ctx, &head.id)? else {
            return Err(format!("Plugin not found after cut: {}", head.id));
        };
        prune_plugin_history(ctx, &updated)?;
        Ok(updated)
    })?;
    row_to_plugin(cut)
}

/// `assertPluginsCleanForShare`.
pub fn assert_plugins_clean_for_share(plugins: &[Plugin]) -> Result<()> {
    let dirty: Vec<String> = plugins
        .iter()
        .filter(|p| p.dirty)
        .map(|p| format!("{}@{}", p.name, p.version))
        .collect();
    if dirty.is_empty() {
        return Ok(());
    }
    Err(format!(
        "Cannot share plugins with unpublished edits: {}. Cut a frozen version first (plugin cut <name> --version <semver>).",
        dirty.join(", ")
    ))
}

/// `getFrozenResolvedSet`.
pub fn get_frozen_resolved_set(ctx: &Ctx, plugin_id: &str) -> Result<Value> {
    let overrides: Option<Option<String>> = ctx
        .db
        .conn
        .query_row(
            "SELECT overrides FROM plugins WHERE id = ?",
            [plugin_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(overrides) = overrides else {
        return Ok(json!([]));
    };
    let raw = overrides
        .filter(|o| !o.is_empty())
        .unwrap_or_else(|| "{}".to_owned());
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| format!("overrides: {e}"))?;
    Ok(match parsed.get("frozen_resolved_set") {
        None | Some(Value::Null) => json!([]),
        Some(v) => v.clone(),
    })
}

/// `formatPluginRollbackConfirmMessage`.
pub fn format_plugin_rollback_confirm_message(
    head_version: &str,
    frozen_version: &str,
    dirty: bool,
) -> String {
    if dirty {
        format!(
            "Replace unpublished edits on {head_version}* with version {frozen_version}? The working head stays {head_version} and is marked dirty. This does not apply the plugin."
        )
    } else {
        format!(
            "Replace the working head {head_version} with version {frozen_version}? The working head stays {head_version} and is marked dirty. This does not apply the plugin."
        )
    }
}

/// `rollbackPluginVersion`.
pub fn rollback_plugin_version(
    ctx: &Ctx,
    resolver: &dyn ResolveComposition,
    selector: &str,
    to_version: &str,
) -> Result<Plugin> {
    let Some(resolved) = resolve_plugin_selector(ctx, selector)? else {
        return Err(format!("Plugin not found: {selector}"));
    };
    let Some(head) = get_plugin_row_by_id(ctx, &resolved.id)? else {
        return Err(format!("Plugin not found: {selector}"));
    };
    if is_frozen(&head) {
        return Err(format!(
            "Plugin {}@{} is frozen and cannot be rolled back onto",
            head.name, head.version
        ));
    }
    assert_authored(ctx, &head.id, AuthoredCapability::Edit)?;
    let target = format!("{}@{to_version}", head.name);
    let Some(frozen) = resolve_plugin_selector(ctx, &target)? else {
        return Err(format!("Plugin not found: {target}"));
    };
    if frozen.name != head.name || frozen.frozen_at.is_none() || frozen.id == head.id {
        return Err(format!(
            "Plugin {target} is not a frozen version of {}",
            head.name
        ));
    }
    let Some(frozen_row) = get_plugin_row_by_id(ctx, &frozen.id)? else {
        return Err(format!("Plugin not found: {target}"));
    };
    let rolled = transaction(ctx, || {
        if !head.dirty {
            capture_working_snapshot(ctx, resolver, &head.id)?;
        }
        let (ids, scopes) = harness_scopes(ctx, &frozen_row.id)?;
        ctx.db.run(
            "DELETE FROM plugin_resources WHERE plugin_id = ?",
            [&head.id],
        )?;
        let ids: Vec<Value> = ids.into_iter().map(Value::String).collect();
        copy_snapshot_attachments(ctx, &head.id, &ids, (!scopes.is_empty()).then_some(&scopes))?;
        ctx.db.run(
            "UPDATE plugins\n       SET description = ?, tags = ?, claude_config = ?, needs_config = ?,\n           default_environment_id = ?, dirty = 1, updated_at = ?\n       WHERE id = ?",
            params![
                frozen_row.description,
                frozen_row.tags,
                frozen_row.claude_config,
                frozen_row.needs_config,
                frozen_row.default_environment_id,
                ctx.clock.now_iso(),
                head.id
            ],
        )?;
        get_plugin_row_by_id(ctx, &head.id)?
            .ok_or_else(|| format!("Plugin not found after rollback: {}", head.id))
    })?;
    row_to_plugin(rolled)
}
