//! The port of `src/models/resource-materialization.ts`.
//!
//! Inside a status computation the original answers per-path lookups from one
//! query per root (`computationSlot`). That cache comes with the status port;
//! until then [`list_materializations_for_root_path`] always queries.

use crate::{Ctx, Result, all, get};
use rusqlite::{Row, params};
use serde::Serialize;

/// `ResourceMaterialization`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ResourceMaterialization {
    pub id: String,
    pub resource_id: String,
    pub scope: String,
    pub project_id: Option<String>,
    pub root_path: String,
    pub platform_id: String,
    pub path: String,
    pub action: String,
    pub ownership_key: String,
    pub generated_hash: String,
    pub managed_container: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn row_to_materialization(row: &Row<'_>) -> rusqlite::Result<ResourceMaterialization> {
    Ok(ResourceMaterialization {
        id: row.get("id")?,
        resource_id: row.get("resource_id")?,
        scope: row.get("scope")?,
        project_id: row.get("project_id")?,
        root_path: row.get("root_path")?,
        platform_id: row.get("platform_id")?,
        path: row.get("path")?,
        action: row.get("action")?,
        ownership_key: row.get("ownership_key")?,
        generated_hash: row.get("generated_hash")?,
        managed_container: row.get::<_, i64>("managed_container")? == 1,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// `queryMaterializations`: empty on any database error.
fn query<P: rusqlite::Params>(ctx: &Ctx, sql: &str, params: P) -> Vec<ResourceMaterialization> {
    all(ctx.db, sql, params, row_to_materialization).unwrap_or_default()
}

/// The input of `recordResourceMaterialization`.
#[derive(Debug, Clone, Default)]
pub struct MaterializationRecord<'a> {
    pub resource_id: &'a str,
    pub scope: &'a str,
    pub project_id: Option<&'a str>,
    pub root_path: &'a str,
    pub platform_id: &'a str,
    pub path: &'a str,
    pub action: &'a str,
    pub ownership_key: &'a str,
    pub generated_hash: &'a str,
    pub managed_container: bool,
}

/// `recordResourceMaterialization`.
pub fn record_resource_materialization(
    ctx: &Ctx,
    input: &MaterializationRecord,
) -> Result<ResourceMaterialization> {
    let now = ctx.clock.now_iso();
    let managed = i64::from(input.managed_container);
    let existing = get(
        ctx.db,
        "SELECT id FROM resource_materializations\n       WHERE resource_id = ?\n         AND scope = ?\n         AND project_id IS ?\n         AND root_path = ?\n         AND platform_id = ?\n         AND path = ?\n         AND ownership_key = ?",
        params![
            input.resource_id,
            input.scope,
            input.project_id,
            input.root_path,
            input.platform_id,
            input.path,
            input.ownership_key
        ],
        |row| row.get::<_, String>(0),
    )?;
    if let Some(id) = existing {
        ctx.db.run(
            "UPDATE resource_materializations\n       SET action = ?,\n           generated_hash = ?,\n           managed_container = ?,\n           updated_at = ?\n       WHERE id = ?",
            params![input.action, input.generated_hash, managed, now, id],
        )?;
        return get(
            ctx.db,
            "SELECT * FROM resource_materializations WHERE id = ?",
            [&id],
            row_to_materialization,
        )?
        .ok_or_else(|| format!("resource materialization {id} vanished"));
    }
    let id = ctx.ids.ulid();
    ctx.db.run(
        "INSERT INTO resource_materializations (\n      id, resource_id, scope, project_id, root_path, platform_id, path,\n      action, ownership_key, generated_hash, managed_container, created_at, updated_at\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            input.resource_id,
            input.scope,
            input.project_id,
            input.root_path,
            input.platform_id,
            input.path,
            input.action,
            input.ownership_key,
            input.generated_hash,
            managed,
            now,
            now
        ],
    )?;
    Ok(ResourceMaterialization {
        id,
        resource_id: input.resource_id.to_owned(),
        scope: input.scope.to_owned(),
        project_id: input.project_id.map(str::to_owned),
        root_path: input.root_path.to_owned(),
        platform_id: input.platform_id.to_owned(),
        path: input.path.to_owned(),
        action: input.action.to_owned(),
        ownership_key: input.ownership_key.to_owned(),
        generated_hash: input.generated_hash.to_owned(),
        managed_container: input.managed_container,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// `listMaterializationsForRoot`: by path.
pub fn list_materializations_for_root(ctx: &Ctx, root_path: &str) -> Vec<ResourceMaterialization> {
    query(
        ctx,
        "SELECT * FROM resource_materializations\n     WHERE root_path = ?\n     ORDER BY path ASC",
        [root_path],
    )
}

/// `listMaterializationsForRootPath` (outside a status computation).
pub fn list_materializations_for_root_path(
    ctx: &Ctx,
    root_path: &str,
    relative_path: &str,
) -> Vec<ResourceMaterialization> {
    query(
        ctx,
        "SELECT * FROM resource_materializations\n     WHERE root_path = ?\n       AND path = ?",
        [root_path, relative_path],
    )
}

/// `deleteMaterializationsForRootPaths`.
pub fn delete_materializations_for_root_paths(
    ctx: &Ctx,
    root_path: &str,
    relative_paths: &[String],
) -> Result<()> {
    for relative in relative_paths {
        ctx.db.run(
            "DELETE FROM resource_materializations\n     WHERE root_path = ?\n       AND path = ?",
            [root_path, relative],
        )?;
    }
    Ok(())
}

/// `listResourceMaterializations`: oldest first.
pub fn list_resource_materializations(
    ctx: &Ctx,
    resource_id: &str,
) -> Result<Vec<ResourceMaterialization>> {
    all(
        ctx.db,
        "SELECT * FROM resource_materializations\n       WHERE resource_id = ?\n       ORDER BY created_at ASC",
        [resource_id],
        row_to_materialization,
    )
}

/// `deleteResourceMaterializations`: the number of rows deleted.
pub fn delete_resource_materializations(ctx: &Ctx, resource_id: &str) -> Result<usize> {
    ctx.db.run(
        "DELETE FROM resource_materializations WHERE resource_id = ?",
        [resource_id],
    )
}

/// One entry of `replaceMaterializationsForPlatform`.
#[derive(Debug, Clone, Default)]
pub struct PlatformEntry {
    pub resource_id: String,
    pub path: String,
    pub action: String,
    pub ownership_key: String,
    pub generated_hash: String,
    pub managed_container: bool,
}

/// `replaceMaterializationsForPlatform`: entries whose resource is gone are
/// dropped, and when all are gone nothing changes.
pub fn replace_materializations_for_platform(
    ctx: &Ctx,
    scope: &str,
    project_id: Option<&str>,
    root_path: &str,
    platform_id: &str,
    entries: &[PlatformEntry],
) -> Result<()> {
    let mut kept = Vec::new();
    for entry in entries {
        if get(
            ctx.db,
            "SELECT 1 as ok FROM resources WHERE id = ? LIMIT 1",
            [&entry.resource_id],
            |_| Ok(()),
        )?
        .is_some()
        {
            kept.push(entry);
        }
    }
    if kept.is_empty() && !entries.is_empty() {
        return Ok(());
    }
    ctx.db.run(
        "DELETE FROM resource_materializations\n     WHERE scope = ?\n       AND project_id IS ?\n       AND root_path = ?\n       AND platform_id = ?",
        params![scope, project_id, root_path, platform_id],
    )?;
    for entry in kept {
        record_resource_materialization(
            ctx,
            &MaterializationRecord {
                resource_id: &entry.resource_id,
                scope,
                project_id,
                root_path,
                platform_id,
                path: &entry.path,
                action: &entry.action,
                ownership_key: &entry.ownership_key,
                generated_hash: &entry.generated_hash,
                managed_container: entry.managed_container,
            },
        )?;
    }
    Ok(())
}
