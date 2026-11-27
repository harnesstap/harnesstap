//! The port of `src/models/package-cache-entry.ts`.

use crate::{Ctx, Result, get};
use rusqlite::{Row, params};
use serde::Serialize;

/// `PackageCacheEntry`. `kind` is `host_plugin` or `apm_git`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PackageCacheEntry {
    pub id: String,
    pub kind: String,
    pub resource_id: Option<String>,
    pub origin_ref: String,
    pub resolved_key: String,
    pub relative_path: String,
    pub content_fingerprint: String,
    pub created_at: String,
    pub updated_at: String,
}

fn row_to_entry(row: &Row<'_>) -> rusqlite::Result<PackageCacheEntry> {
    Ok(PackageCacheEntry {
        id: row.get("id")?,
        kind: row.get("kind")?,
        resource_id: row.get("resource_id")?,
        origin_ref: row.get("origin_ref")?,
        resolved_key: row.get("resolved_key")?,
        relative_path: row.get("relative_path")?,
        content_fingerprint: row.get("content_fingerprint")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// The input of `upsertPackageCacheEntry`.
#[derive(Debug, Clone, Default)]
pub struct PackageCacheInput<'a> {
    pub kind: &'a str,
    pub origin_ref: &'a str,
    pub resolved_key: &'a str,
    pub relative_path: &'a str,
    pub resource_id: Option<&'a str>,
    pub content_fingerprint: Option<&'a str>,
}

const SELECT_BY_ID: &str = "SELECT * FROM package_cache_entries WHERE id = ?";

fn read_back(ctx: &Ctx, id: &str) -> Result<PackageCacheEntry> {
    get(ctx.db, SELECT_BY_ID, [id], row_to_entry)?
        .ok_or_else(|| format!("package cache entry {id} vanished"))
}

/// `upsertPackageCacheEntry`.
pub fn upsert_package_cache_entry(
    ctx: &Ctx,
    input: &PackageCacheInput,
) -> Result<PackageCacheEntry> {
    let now = ctx.clock.now_iso();
    let fingerprint = input.content_fingerprint.unwrap_or("");
    let existing = get(
        ctx.db,
        "SELECT id FROM package_cache_entries\n       WHERE kind = ? AND origin_ref = ? AND resolved_key = ?",
        [input.kind, input.origin_ref, input.resolved_key],
        |row| row.get::<_, String>(0),
    )?;
    if let Some(id) = existing {
        ctx.db.run(
            "UPDATE package_cache_entries\n       SET relative_path = ?,\n           resource_id = ?,\n           content_fingerprint = ?,\n           updated_at = ?\n       WHERE id = ?",
            params![input.relative_path, input.resource_id, fingerprint, now, id],
        )?;
        return read_back(ctx, &id);
    }
    let id = ctx.ids.ulid();
    ctx.db.run(
        "INSERT INTO package_cache_entries (\n      id, kind, resource_id, origin_ref, resolved_key, relative_path,\n      content_fingerprint, created_at, updated_at\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            input.kind,
            input.resource_id,
            input.origin_ref,
            input.resolved_key,
            input.relative_path,
            fingerprint,
            now,
            now
        ],
    )?;
    read_back(ctx, &id)
}

/// `findPackageCacheEntry`.
pub fn find_package_cache_entry(
    ctx: &Ctx,
    kind: &str,
    origin_ref: &str,
    resolved_key: &str,
) -> Result<Option<PackageCacheEntry>> {
    get(
        ctx.db,
        "SELECT * FROM package_cache_entries\n       WHERE kind = ? AND origin_ref = ? AND resolved_key = ?",
        [kind, origin_ref, resolved_key],
        row_to_entry,
    )
}
