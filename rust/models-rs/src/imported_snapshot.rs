//! The port of `src/models/imported-snapshot.ts`.
//!
//! Inside a status computation the original reads every install's file list
//! once (`computationSlot`). That cache comes with the status port; until then
//! [`find_imported_snapshot_owners_by_file`] always queries.

use crate::{Ctx, Result, all, get};
use rusqlite::{Row, params};
use serde::Serialize;
use serde_json::Value;

/// `ImportedSnapshot`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportedSnapshot {
    pub id: String,
    pub source_kind: String,
    pub source_label: String,
    pub plugin_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_version: Option<String>,
    pub resource_ids: Value,
    pub metadata: Value,
    pub created_at: String,
}

/// `ImportedSnapshotInstall`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportedSnapshotInstall {
    pub snapshot_id: String,
    pub platform_id: String,
    pub files: Value,
    pub installed_at: String,
}

/// `ImportedSnapshotFileOwner`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportedSnapshotFileOwner {
    pub snapshot_id: String,
    pub platform_id: String,
    pub plugin_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_version: Option<String>,
}

fn parse_json(raw: &str) -> rusqlite::Result<Value> {
    serde_json::from_str(raw).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })
}

fn json(v: &Value) -> String {
    emit_rs::json::stringify(v, "")
}

fn row_to_snapshot(row: &Row<'_>) -> rusqlite::Result<ImportedSnapshot> {
    Ok(ImportedSnapshot {
        id: row.get("id")?,
        source_kind: row.get("source_kind")?,
        source_label: row.get("source_label")?,
        plugin_name: row.get("plugin_name")?,
        plugin_version: row.get("plugin_version")?,
        resource_ids: parse_json(&row.get::<_, String>("resource_ids")?)?,
        metadata: parse_json(&row.get::<_, String>("metadata")?)?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_install(row: &Row<'_>) -> rusqlite::Result<ImportedSnapshotInstall> {
    Ok(ImportedSnapshotInstall {
        snapshot_id: row.get("snapshot_id")?,
        platform_id: row.get("platform_id")?,
        files: parse_json(&row.get::<_, String>("files")?)?,
        installed_at: row.get("installed_at")?,
    })
}

/// The input of `createImportedSnapshot`.
#[derive(Debug, Clone)]
pub struct NewImportedSnapshot<'a> {
    pub source_kind: &'a str,
    pub source_label: &'a str,
    pub plugin_name: &'a str,
    pub plugin_version: Option<&'a str>,
    pub resource_ids: &'a Value,
    pub metadata: &'a Value,
}

/// `createImportedSnapshot`.
pub fn create_imported_snapshot(
    ctx: &Ctx,
    input: &NewImportedSnapshot,
) -> Result<ImportedSnapshot> {
    let snapshot = ImportedSnapshot {
        id: ctx.ids.ulid(),
        source_kind: input.source_kind.to_owned(),
        source_label: input.source_label.to_owned(),
        plugin_name: input.plugin_name.to_owned(),
        plugin_version: input.plugin_version.map(str::to_owned),
        resource_ids: input.resource_ids.clone(),
        metadata: input.metadata.clone(),
        created_at: ctx.clock.now_iso(),
    };
    ctx.db.run(
        "INSERT INTO imported_snapshots (\n      id,\n      source_kind,\n      source_label,\n      plugin_name,\n      plugin_version,\n      resource_ids,\n      metadata,\n      created_at\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            snapshot.id,
            snapshot.source_kind,
            snapshot.source_label,
            snapshot.plugin_name,
            snapshot.plugin_version,
            json(&snapshot.resource_ids),
            json(&snapshot.metadata),
            snapshot.created_at
        ],
    )?;
    Ok(snapshot)
}

/// `listImportedSnapshots`: newest first.
pub fn list_imported_snapshots(ctx: &Ctx) -> Result<Vec<ImportedSnapshot>> {
    all(
        ctx.db,
        "SELECT * FROM imported_snapshots ORDER BY created_at DESC, id DESC",
        [],
        row_to_snapshot,
    )
}

/// `getLatestImportedSnapshot`.
pub fn get_latest_imported_snapshot(
    ctx: &Ctx,
    plugin_name: &str,
) -> Result<Option<ImportedSnapshot>> {
    get(
        ctx.db,
        "SELECT * FROM imported_snapshots\n       WHERE plugin_name = ?\n       ORDER BY created_at DESC, id DESC\n       LIMIT 1",
        [plugin_name],
        row_to_snapshot,
    )
}

/// `getImportedSnapshot`.
pub fn get_imported_snapshot(ctx: &Ctx, snapshot_id: &str) -> Result<Option<ImportedSnapshot>> {
    get(
        ctx.db,
        "SELECT * FROM imported_snapshots WHERE id = ?",
        [snapshot_id],
        row_to_snapshot,
    )
}

/// `recordImportedSnapshotInstall`.
pub fn record_imported_snapshot_install(
    ctx: &Ctx,
    snapshot_id: &str,
    platform_id: &str,
    files: &Value,
) -> Result<ImportedSnapshotInstall> {
    let install = ImportedSnapshotInstall {
        snapshot_id: snapshot_id.to_owned(),
        platform_id: platform_id.to_owned(),
        files: files.clone(),
        installed_at: ctx.clock.now_iso(),
    };
    ctx.db.run(
        "INSERT INTO imported_snapshot_installs (\n      snapshot_id,\n      platform_id,\n      files,\n      installed_at\n    ) VALUES (?, ?, ?, ?)\n    ON CONFLICT(snapshot_id, platform_id) DO UPDATE SET\n      files = excluded.files,\n      installed_at = excluded.installed_at",
        params![install.snapshot_id, install.platform_id, json(&install.files), install.installed_at],
    )?;
    Ok(install)
}

/// `removeImportedSnapshotOwnershipForFiles`: drops the files from every
/// install (but `exclude_snapshot_id`'s), deleting installs left empty.
pub fn remove_imported_snapshot_ownership_for_files(
    ctx: &Ctx,
    file_paths: &[String],
    exclude_snapshot_id: Option<&str>,
) -> Result<()> {
    if file_paths.is_empty() {
        return Ok(());
    }
    let rows = all(
        ctx.db,
        "SELECT snapshot_id, platform_id, files, installed_at\n       FROM imported_snapshot_installs",
        [],
        row_to_install,
    )?;
    let now = ctx.clock.now_iso();
    for row in rows {
        if exclude_snapshot_id.is_some_and(|x| !x.is_empty() && x == row.snapshot_id) {
            continue;
        }
        let files = row.files.as_array().cloned().unwrap_or_default();
        let remaining: Vec<Value> = files
            .iter()
            .filter(|f| {
                !f.as_str()
                    .is_some_and(|s| file_paths.iter().any(|p| p == s))
            })
            .cloned()
            .collect();
        if remaining.len() == files.len() {
            continue;
        }
        if remaining.is_empty() {
            ctx.db.run(
                "DELETE FROM imported_snapshot_installs\n         WHERE snapshot_id = ? AND platform_id = ?",
                params![row.snapshot_id, row.platform_id],
            )?;
            continue;
        }
        ctx.db.run(
            "UPDATE imported_snapshot_installs\n       SET files = ?, installed_at = ?\n       WHERE snapshot_id = ? AND platform_id = ?",
            params![json(&Value::Array(remaining)), now, row.snapshot_id, row.platform_id],
        )?;
    }
    Ok(())
}

/// `listImportedSnapshotInstalls`.
pub fn list_imported_snapshot_installs(
    ctx: &Ctx,
    snapshot_id: &str,
) -> Result<Vec<ImportedSnapshotInstall>> {
    all(
        ctx.db,
        "SELECT snapshot_id, platform_id, files, installed_at\n       FROM imported_snapshot_installs\n       WHERE snapshot_id = ?\n       ORDER BY installed_at DESC, platform_id ASC",
        [snapshot_id],
        row_to_install,
    )
}

/// `findImportedSnapshotOwnersByFile`.
pub fn find_imported_snapshot_owners_by_file(
    ctx: &Ctx,
    file_path: &str,
) -> Result<Vec<ImportedSnapshotFileOwner>> {
    let owners = all(
        ctx.db,
        "SELECT installs.snapshot_id, installs.platform_id, snapshots.plugin_name, snapshots.plugin_version\n       FROM imported_snapshot_installs installs\n       JOIN imported_snapshots snapshots ON snapshots.id = installs.snapshot_id",
        [],
        |row| {
            Ok(ImportedSnapshotFileOwner {
                snapshot_id: row.get(0)?,
                platform_id: row.get(1)?,
                plugin_name: row.get(2)?,
                plugin_version: row.get(3)?,
            })
        },
    )?;
    let mut out = Vec::new();
    for owner in owners {
        let files = get(
            ctx.db,
            "SELECT files\n         FROM imported_snapshot_installs\n         WHERE snapshot_id = ? AND platform_id = ?",
            [&owner.snapshot_id, &owner.platform_id],
            |row| row.get::<_, String>(0),
        )?;
        let Some(files) = files else { continue };
        let files: Value = serde_json::from_str(&files).map_err(|e| format!("SyntaxError: {e}"))?;
        if files
            .as_array()
            .is_some_and(|a| a.iter().any(|f| f.as_str() == Some(file_path)))
        {
            out.push(owner);
        }
    }
    Ok(out)
}
