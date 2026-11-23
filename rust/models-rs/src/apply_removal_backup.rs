//! The port of `src/models/apply-removal-backup.ts`.

use crate::{Ctx, Result, all};
use db_rs::paths::{harnesstap_dir, posix_join};
use rusqlite::types::Value as Sql;
use rusqlite::{Row, params};

/// `ApplyRemovalBackup`. A backup kept in the trash holds no copy in the
/// database: [`ApplyRemovalBackup::content`] reads the trash file.
#[derive(Debug, Clone, PartialEq)]
pub struct ApplyRemovalBackup {
    pub id: String,
    pub apply_id: String,
    pub snapshot_id: Option<String>,
    pub relative_path: String,
    stored: Vec<u8>,
    pub mode: i64,
    pub in_trash: bool,
    pub created_at: String,
}

impl ApplyRemovalBackup {
    /// The removed bytes.
    pub fn content(&self, ctx: &Ctx) -> Result<Vec<u8>> {
        if self.in_trash {
            let path = removal_backup_trash_file(ctx, &self.apply_id, &self.relative_path);
            std::fs::read(&path).map_err(|e| format!("{e}: {path}"))
        } else {
            Ok(self.stored.clone())
        }
    }
}

/// `removalBackupTrashFile`: where an apply's trash folder keeps the removed file.
pub fn removal_backup_trash_file(ctx: &Ctx, apply_id: &str, relative_path: &str) -> String {
    let home = harnesstap_dir(ctx.env);
    let mut parts = vec![home.as_str(), "trash", apply_id];
    parts.extend(relative_path.split('/'));
    posix_join(&parts)
}

fn row_to_backup(row: &Row<'_>) -> rusqlite::Result<ApplyRemovalBackup> {
    let stored = match row.get::<_, Sql>("content")? {
        Sql::Blob(b) => b,
        Sql::Text(s) => s.into_bytes(),
        _ => Vec::new(),
    };
    Ok(ApplyRemovalBackup {
        id: row.get("id")?,
        apply_id: row.get("apply_id")?,
        snapshot_id: row.get("snapshot_id")?,
        relative_path: row.get("relative_path")?,
        stored,
        mode: row.get("mode")?,
        in_trash: row.get::<_, Option<i64>>("in_trash")? == Some(1),
        created_at: row.get("created_at")?,
    })
}

fn insert_backup(
    ctx: &Ctx,
    apply_id: &str,
    snapshot_id: Option<&str>,
    relative_path: &str,
    content: Vec<u8>,
    mode: i64,
    in_trash: bool,
) -> Result<ApplyRemovalBackup> {
    let row = ApplyRemovalBackup {
        id: ctx.ids.ulid(),
        apply_id: apply_id.to_owned(),
        snapshot_id: snapshot_id.map(str::to_owned),
        relative_path: relative_path.to_owned(),
        stored: content,
        mode,
        in_trash,
        created_at: ctx.clock.now_iso(),
    };
    ctx.db.run(
        "INSERT INTO apply_removal_backups (\n      id, apply_id, snapshot_id, relative_path, content, mode, in_trash, created_at\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            row.id,
            row.apply_id,
            row.snapshot_id,
            row.relative_path,
            row.stored,
            row.mode,
            i64::from(row.in_trash),
            row.created_at
        ],
    )?;
    Ok(row)
}

/// `recordApplyRemovalBackup`: the bytes go in the row.
pub fn record_apply_removal_backup(
    ctx: &Ctx,
    apply_id: &str,
    snapshot_id: Option<&str>,
    relative_path: &str,
    content: &[u8],
    mode: i64,
) -> Result<ApplyRemovalBackup> {
    insert_backup(
        ctx,
        apply_id,
        snapshot_id,
        relative_path,
        content.to_vec(),
        mode,
        false,
    )
}

/// `recordTrashedApplyRemovalBackup`: the bytes are already in the apply's trash folder.
pub fn record_trashed_apply_removal_backup(
    ctx: &Ctx,
    apply_id: &str,
    snapshot_id: Option<&str>,
    relative_path: &str,
    mode: i64,
) -> Result<ApplyRemovalBackup> {
    insert_backup(
        ctx,
        apply_id,
        snapshot_id,
        relative_path,
        Vec::new(),
        mode,
        true,
    )
}

fn restorable(ctx: &Ctx, rows: Vec<ApplyRemovalBackup>) -> Vec<ApplyRemovalBackup> {
    rows.into_iter()
        .filter(|row| {
            !row.in_trash
                || std::path::Path::new(&removal_backup_trash_file(
                    ctx,
                    &row.apply_id,
                    &row.relative_path,
                ))
                .exists()
        })
        .collect()
}

/// `listApplyRemovalBackups`: by snapshot when given, else by apply; only
/// backups whose bytes are still available.
pub fn list_apply_removal_backups(
    ctx: &Ctx,
    apply_id: Option<&str>,
    snapshot_id: Option<&str>,
) -> Result<Vec<ApplyRemovalBackup>> {
    let (sql, key) = match (
        snapshot_id.filter(|s| !s.is_empty()),
        apply_id.filter(|s| !s.is_empty()),
    ) {
        (Some(s), _) => (
            "SELECT * FROM apply_removal_backups\n         WHERE snapshot_id = ?\n         ORDER BY relative_path ASC",
            s,
        ),
        (None, Some(a)) => (
            "SELECT * FROM apply_removal_backups\n         WHERE apply_id = ?\n         ORDER BY relative_path ASC",
            a,
        ),
        (None, None) => return Ok(Vec::new()),
    };
    let rows = all(ctx.db, sql, [key], row_to_backup)?;
    Ok(restorable(ctx, rows))
}

/// `listTrashPinnedApplyIds`, in the order SQLite returns them.
pub fn list_trash_pinned_apply_ids(ctx: &Ctx) -> Result<Vec<String>> {
    all(
        ctx.db,
        "SELECT DISTINCT apply_id FROM apply_removal_backups WHERE in_trash = 1",
        [],
        |row| row.get::<_, String>(0),
    )
}
