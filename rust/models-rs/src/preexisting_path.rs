//! The port of `src/models/preexisting-path.ts`.

use crate::{Ctx, Result, all, get};
use rusqlite::{Row, params};
use serde::Serialize;

/// `PreexistingPath`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PreexistingPath {
    pub id: String,
    pub root_path: String,
    pub path: String,
    pub content_hash: String,
    pub created_at: String,
}

fn row_to_path(row: &Row<'_>) -> rusqlite::Result<PreexistingPath> {
    Ok(PreexistingPath {
        id: row.get("id")?,
        root_path: row.get("root_path")?,
        path: row.get("path")?,
        content_hash: row.get("content_hash")?,
        created_at: row.get("created_at")?,
    })
}

/// `recordPreexistingPath`. Without the table (an old database), nothing is
/// stored and the path comes back with an empty id.
pub fn record_preexisting_path(
    ctx: &Ctx,
    root_path: &str,
    path: &str,
    content_hash: Option<&str>,
) -> Result<PreexistingPath> {
    if ctx
        .db
        .conn
        .prepare("SELECT 1 FROM preexisting_paths LIMIT 0")
        .is_err()
    {
        return Ok(PreexistingPath {
            id: String::new(),
            root_path: root_path.to_owned(),
            path: path.to_owned(),
            content_hash: content_hash.unwrap_or("").to_owned(),
            created_at: ctx.clock.now_iso(),
        });
    }
    let now = ctx.clock.now_iso();
    let existing = get(
        ctx.db,
        "SELECT * FROM preexisting_paths\n       WHERE root_path = ? AND path = ?",
        [root_path, path],
        row_to_path,
    )?;
    if let Some(existing) = existing {
        if let Some(hash) = content_hash.filter(|h| !h.is_empty() && *h != existing.content_hash) {
            ctx.db.run(
                "UPDATE preexisting_paths SET content_hash = ? WHERE id = ?",
                params![hash, existing.id],
            )?;
            return Ok(PreexistingPath {
                content_hash: hash.to_owned(),
                ..existing
            });
        }
        return Ok(existing);
    }
    let row = PreexistingPath {
        id: ctx.ids.ulid(),
        root_path: root_path.to_owned(),
        path: path.to_owned(),
        content_hash: content_hash.unwrap_or("").to_owned(),
        created_at: now,
    };
    ctx.db.run(
        "INSERT INTO preexisting_paths (id, root_path, path, content_hash, created_at)\n     VALUES (?, ?, ?, ?, ?)",
        params![row.id, row.root_path, row.path, row.content_hash, row.created_at],
    )?;
    Ok(row)
}

/// `isPreexistingPath`: false on any database error.
pub fn is_preexisting_path(ctx: &Ctx, root_path: &str, relative_path: &str) -> bool {
    get(
        ctx.db,
        "SELECT 1 as ok FROM preexisting_paths\n         WHERE root_path = ? AND path = ? LIMIT 1",
        [root_path, relative_path],
        |_| Ok(()),
    )
    .is_ok_and(|row| row.is_some())
}

/// `listPreexistingPaths`: empty on any database error.
pub fn list_preexisting_paths(ctx: &Ctx, root_path: &str) -> Vec<String> {
    all(
        ctx.db,
        "SELECT path FROM preexisting_paths WHERE root_path = ? ORDER BY path ASC",
        [root_path],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_default()
}
