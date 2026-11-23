//! The port of `src/models/snapshot.ts`.

use crate::{Ctx, Result, all, get};
use rusqlite::{Row, params};
use serde::Serialize;
use serde_json::Value;

/// `Snapshot`. `state` is the parsed `SnapshotState`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Snapshot {
    pub id: String,
    pub project_id: String,
    pub label: String,
    pub state: Value,
    pub created_at: String,
}

fn row_to_snapshot(row: &Row<'_>) -> rusqlite::Result<Snapshot> {
    let state: String = row.get("state")?;
    Ok(Snapshot {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        label: row.get("label")?,
        state: serde_json::from_str(&state).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })?,
        created_at: row.get("created_at")?,
    })
}

/// `createSnapshot`.
pub fn create_snapshot(
    ctx: &Ctx,
    project_id: &str,
    label: &str,
    state: &Value,
) -> Result<Snapshot> {
    let now = ctx.clock.now_iso();
    let id = ctx.ids.ulid();
    ctx.db.run(
        "INSERT INTO snapshots (id, project_id, label, state, created_at)\n     VALUES (?, ?, ?, ?, ?)",
        params![id, project_id, label, emit_rs::json::stringify(state, ""), now],
    )?;
    Ok(Snapshot {
        id,
        project_id: project_id.to_owned(),
        label: label.to_owned(),
        state: state.clone(),
        created_at: now,
    })
}

/// `getSnapshot`.
pub fn get_snapshot(ctx: &Ctx, id: &str) -> Result<Option<Snapshot>> {
    get(
        ctx.db,
        "SELECT * FROM snapshots WHERE id = ?",
        [id],
        row_to_snapshot,
    )
}

/// `findSnapshotById`: the exact id, or a unique prefix of at least `min_prefix`
/// UTF-16 units (8 in the original's default).
pub fn find_snapshot_by_id(ctx: &Ctx, id: &str, min_prefix: usize) -> Result<Option<Snapshot>> {
    if let Some(exact) = get_snapshot(ctx, id)? {
        return Ok(Some(exact));
    }
    if id.encode_utf16().count() < min_prefix {
        return Ok(None);
    }
    let mut rows = all(
        ctx.db,
        "SELECT * FROM snapshots WHERE id LIKE ?",
        [format!("{id}%")],
        row_to_snapshot,
    )?;
    Ok(if rows.len() == 1 { rows.pop() } else { None })
}

/// `listSnapshots`: newest first.
pub fn list_snapshots(ctx: &Ctx, project_id: &str) -> Result<Vec<Snapshot>> {
    all(
        ctx.db,
        "SELECT * FROM snapshots WHERE project_id = ? ORDER BY created_at DESC",
        [project_id],
        row_to_snapshot,
    )
}

/// `getLatestSnapshot`.
pub fn get_latest_snapshot(ctx: &Ctx, project_id: &str) -> Result<Option<Snapshot>> {
    Ok(list_snapshots(ctx, project_id)?.into_iter().next())
}
