//! The port of `src/models/global-apply-snapshot.ts`.
//!
//! The original memoizes two reads inside a status computation
//! (`computationSlot`) and keeps the last eight parsed snapshots by id. Both are
//! caches over rows that never change once written, so the port reads through.

use crate::{Ctx, Result, all, get};
use rusqlite::{Row, params};
use serde::Serialize;
use serde_json::Value;

/// `GlobalApplySnapshot`. `state` is absent when the row stores `{}` or bad JSON.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GlobalApplySnapshot {
    pub id: String,
    pub profile_name: String,
    pub plugin_ids: Value,
    pub resolved_set: Value,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<Value>,
}

/// `GlobalApplySnapshotInstall`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GlobalApplySnapshotInstall {
    pub snapshot_id: String,
    pub platform_id: String,
    pub files: Value,
    pub installed_at: String,
}

/// `{ id, profile_name }`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GlobalApplySnapshotHead {
    pub id: String,
    pub profile_name: String,
}

fn parse_json(raw: &str) -> rusqlite::Result<Value> {
    serde_json::from_str(raw).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })
}

/// `parseState`: nothing for empty, `{}` or invalid JSON.
fn parse_state(raw: Option<String>) -> Option<Value> {
    let raw = raw.filter(|r| !r.is_empty() && r != "{}")?;
    serde_json::from_str(&raw).ok()
}

fn row_to_snapshot(row: &Row<'_>) -> rusqlite::Result<GlobalApplySnapshot> {
    let state = row.get::<_, Option<String>>("state").unwrap_or(None);
    let resolved: Option<String> = row.get("resolved_set")?;
    Ok(GlobalApplySnapshot {
        id: row.get("id")?,
        profile_name: row.get("profile_name")?,
        plugin_ids: parse_json(&row.get::<_, String>("plugin_ids")?)?,
        resolved_set: parse_json(resolved.as_deref().unwrap_or("[]"))?,
        created_at: row.get("created_at")?,
        state: parse_state(state),
    })
}

fn row_to_install(row: &Row<'_>) -> rusqlite::Result<GlobalApplySnapshotInstall> {
    Ok(GlobalApplySnapshotInstall {
        snapshot_id: row.get("snapshot_id")?,
        platform_id: row.get("platform_id")?,
        files: parse_json(&row.get::<_, String>("files")?)?,
        installed_at: row.get("installed_at")?,
    })
}

fn json(v: &Value) -> String {
    emit_rs::json::stringify(v, "")
}

fn truthy(v: Option<&Value>) -> Option<&Value> {
    v.filter(|v| !v.is_null())
}

/// `createGlobalApplySnapshot`.
pub fn create_global_apply_snapshot(
    ctx: &Ctx,
    profile_name: &str,
    plugin_ids: &Value,
    resolved_set: Option<&Value>,
    state: Option<&Value>,
) -> Result<GlobalApplySnapshot> {
    let state = truthy(state);
    let snapshot = GlobalApplySnapshot {
        id: ctx.ids.ulid(),
        profile_name: profile_name.to_owned(),
        plugin_ids: plugin_ids.clone(),
        resolved_set: truthy(resolved_set)
            .cloned()
            .unwrap_or(Value::Array(Vec::new())),
        created_at: ctx.clock.now_iso(),
        state: state.cloned(),
    };
    ctx.db.run(
        "INSERT INTO global_apply_snapshots (id, profile_name, plugin_ids, resolved_set, created_at, state)\n     VALUES (?, ?, ?, ?, ?, ?)",
        params![
            snapshot.id,
            snapshot.profile_name,
            json(&snapshot.plugin_ids),
            json(&snapshot.resolved_set),
            snapshot.created_at,
            state.map(json).unwrap_or_else(|| "{}".to_owned())
        ],
    )?;
    Ok(snapshot)
}

/// `recordGlobalApplySnapshotInstall`.
pub fn record_global_apply_snapshot_install(
    ctx: &Ctx,
    snapshot_id: &str,
    platform_id: &str,
    files: &Value,
) -> Result<GlobalApplySnapshotInstall> {
    let install = GlobalApplySnapshotInstall {
        snapshot_id: snapshot_id.to_owned(),
        platform_id: platform_id.to_owned(),
        files: files.clone(),
        installed_at: ctx.clock.now_iso(),
    };
    ctx.db.run(
        "INSERT INTO global_apply_snapshot_installs (\n      snapshot_id,\n      platform_id,\n      files,\n      installed_at\n    ) VALUES (?, ?, ?, ?)\n    ON CONFLICT(snapshot_id, platform_id) DO UPDATE SET\n      files = excluded.files,\n      installed_at = excluded.installed_at",
        params![install.snapshot_id, install.platform_id, json(&install.files), install.installed_at],
    )?;
    Ok(install)
}

/// `getGlobalApplySnapshot`.
pub fn get_global_apply_snapshot(
    ctx: &Ctx,
    snapshot_id: &str,
) -> Result<Option<GlobalApplySnapshot>> {
    get(
        ctx.db,
        "SELECT * FROM global_apply_snapshots WHERE id = ?",
        [snapshot_id],
        row_to_snapshot,
    )
}

/// `listGlobalApplySnapshots`: newest first.
pub fn list_global_apply_snapshots(ctx: &Ctx) -> Result<Vec<GlobalApplySnapshot>> {
    all(
        ctx.db,
        "SELECT * FROM global_apply_snapshots ORDER BY created_at DESC, id DESC",
        [],
        row_to_snapshot,
    )
}

/// `getLatestGlobalApplySnapshotForProfile`.
pub fn get_latest_global_apply_snapshot_for_profile(
    ctx: &Ctx,
    profile_name: &str,
) -> Result<Option<GlobalApplySnapshot>> {
    let head = get(
        ctx.db,
        "SELECT id FROM global_apply_snapshots WHERE profile_name = ?\n         ORDER BY created_at DESC, id DESC LIMIT 1",
        [profile_name],
        |row| row.get::<_, String>(0),
    )?;
    match head {
        Some(id) => get_global_apply_snapshot(ctx, &id),
        None => Ok(None),
    }
}

/// `listGlobalApplySnapshotHeads`: ids and profile names, newest first.
pub fn list_global_apply_snapshot_heads(ctx: &Ctx) -> Result<Vec<GlobalApplySnapshotHead>> {
    all(
        ctx.db,
        "SELECT id, profile_name FROM global_apply_snapshots\n         ORDER BY created_at DESC, id DESC",
        [],
        |row| {
            Ok(GlobalApplySnapshotHead {
                id: row.get(0)?,
                profile_name: row.get(1)?,
            })
        },
    )
}

/// `renameGlobalApplySnapshotsProfile`: the number of rows renamed.
pub fn rename_global_apply_snapshots_profile(
    ctx: &Ctx,
    old_name: &str,
    new_name: &str,
) -> Result<usize> {
    ctx.db.run(
        "UPDATE global_apply_snapshots SET profile_name = ? WHERE profile_name = ?",
        params![new_name, old_name],
    )
}

/// `listGlobalApplySnapshotInstalls`.
pub fn list_global_apply_snapshot_installs(
    ctx: &Ctx,
    snapshot_id: &str,
) -> Result<Vec<GlobalApplySnapshotInstall>> {
    all(
        ctx.db,
        "SELECT snapshot_id, platform_id, files, installed_at\n       FROM global_apply_snapshot_installs\n       WHERE snapshot_id = ?\n       ORDER BY installed_at DESC, platform_id ASC",
        [snapshot_id],
        row_to_install,
    )
}
