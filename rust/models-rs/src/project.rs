//! The port of `src/models/project.ts`.

use crate::{Ctx, Result, all, get};
use rusqlite::{Row, params};
use serde::Serialize;
use serde_json::Value;

/// `Project`. Rows read back also carry `tracked_at`; a freshly created
/// project does not, as in the original.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Project {
    pub id: String,
    pub git_origin: String,
    pub local_id: String,
    pub name: String,
    pub local_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracked_at: Option<String>,
    pub created_at: String,
}

fn row_to_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get("id")?,
        git_origin: row.get("git_origin")?,
        local_id: row.get("local_id")?,
        name: row.get("name")?,
        local_path: row.get("local_path")?,
        tracked_at: Some(row.get("tracked_at")?),
        created_at: row.get("created_at")?,
    })
}

/// `createProject`.
pub fn create_project(
    ctx: &Ctx,
    git_origin: &str,
    local_id: Option<&str>,
    name: &str,
    local_path: &str,
) -> Result<Project> {
    let now = ctx.clock.now_iso();
    let id = ctx.ids.ulid();
    let local_id = local_id.unwrap_or("");
    ctx.db.run(
        "INSERT INTO projects (id, git_origin, local_id, name, local_path, created_at)\n     VALUES (?, ?, ?, ?, ?, ?)",
        params![id, git_origin, local_id, name, local_path, now],
    )?;
    Ok(Project {
        id,
        git_origin: git_origin.to_owned(),
        local_id: local_id.to_owned(),
        name: name.to_owned(),
        local_path: local_path.to_owned(),
        tracked_at: None,
        created_at: now,
    })
}

/// `getProjectByLocalId`: a project identified by its folder (no git origin).
pub fn get_project_by_local_id(ctx: &Ctx, local_id: &str) -> Result<Option<Project>> {
    if local_id.is_empty() {
        return Ok(None);
    }
    get(
        ctx.db,
        "SELECT * FROM projects WHERE local_id = ? AND git_origin = ''",
        [local_id],
        row_to_project,
    )
}

fn rename(ctx: &Ctx, existing: Project, name: &str, local_path: &str) -> Result<Project> {
    ctx.db.run(
        "UPDATE projects SET local_path = ?, name = ? WHERE id = ?",
        params![local_path, name, existing.id],
    )?;
    Ok(Project {
        local_path: local_path.to_owned(),
        name: name.to_owned(),
        ..existing
    })
}

/// `upsertProjectByLocalId`.
pub fn upsert_project_by_local_id(
    ctx: &Ctx,
    local_id: &str,
    name: &str,
    local_path: &str,
) -> Result<Project> {
    match get_project_by_local_id(ctx, local_id)? {
        Some(existing) => rename(ctx, existing, name, local_path),
        None => create_project(ctx, "", Some(local_id), name, local_path),
    }
}

/// `getProjectByOrigin`.
pub fn get_project_by_origin(ctx: &Ctx, git_origin: &str) -> Result<Option<Project>> {
    if git_origin.is_empty() {
        return Ok(None);
    }
    get(
        ctx.db,
        "SELECT * FROM projects WHERE git_origin = ?",
        [git_origin],
        row_to_project,
    )
}

/// `getProject`.
pub fn get_project(ctx: &Ctx, id: &str) -> Result<Option<Project>> {
    get(
        ctx.db,
        "SELECT * FROM projects WHERE id = ?",
        [id],
        row_to_project,
    )
}

/// `upsertProject`.
pub fn upsert_project(
    ctx: &Ctx,
    git_origin: &str,
    name: &str,
    local_path: &str,
) -> Result<Project> {
    match get_project_by_origin(ctx, git_origin)? {
        Some(existing) => rename(ctx, existing, name, local_path),
        None => create_project(ctx, git_origin, None, name, local_path),
    }
}

/// `listProjects`: by name.
pub fn list_projects(ctx: &Ctx) -> Result<Vec<Project>> {
    all(
        ctx.db,
        "SELECT * FROM projects ORDER BY name",
        [],
        row_to_project,
    )
}

/// `getProjectByLocalPath`: compares `path.resolve` of both sides against `cwd`.
pub fn get_project_by_local_path(
    ctx: &Ctx,
    cwd: &str,
    local_path: &str,
) -> Result<Option<Project>> {
    let normalized = db_rs::paths::posix_resolve(cwd, local_path);
    Ok(list_projects(ctx)?
        .into_iter()
        .find(|p| db_rs::paths::posix_resolve(cwd, &p.local_path) == normalized))
}

/// `ProjectPlugin`. `platforms` is the parsed JSON column.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProjectPlugin {
    pub project_id: String,
    pub plugin_id: String,
    pub platforms: Value,
    pub applied_at: String,
}

/// `applyPluginToProject` (also `applyConfiguredPluginToProject`, `applyLayerToProject`).
pub fn apply_plugin_to_project(
    ctx: &Ctx,
    project_id: &str,
    plugin_id: &str,
    platforms: &[String],
) -> Result<()> {
    let now = ctx.clock.now_iso();
    let platforms = Value::Array(platforms.iter().cloned().map(Value::String).collect());
    ctx.db.run(
        "INSERT OR REPLACE INTO project_plugins (project_id, plugin_id, platforms, applied_at)\n     VALUES (?, ?, ?, ?)",
        params![project_id, plugin_id, emit_rs::json::stringify(&platforms, ""), now],
    )?;
    Ok(())
}

/// `getProjectPlugins` (also `getProjectConfiguredPlugins`, `getProjectLayers`).
pub fn get_project_plugins(ctx: &Ctx, project_id: &str) -> Result<Vec<ProjectPlugin>> {
    let rows = all(
        ctx.db,
        "SELECT * FROM project_plugins WHERE project_id = ? ORDER BY applied_at DESC",
        [project_id],
        |row| {
            Ok((
                row.get::<_, String>("project_id")?,
                row.get::<_, String>("plugin_id")?,
                row.get::<_, String>("platforms")?,
                row.get::<_, String>("applied_at")?,
            ))
        },
    )?;
    rows.into_iter()
        .map(|(project_id, plugin_id, platforms, applied_at)| {
            Ok(ProjectPlugin {
                project_id,
                plugin_id,
                platforms: serde_json::from_str(&platforms)
                    .map_err(|e| format!("SyntaxError: {e}"))?,
                applied_at,
            })
        })
        .collect()
}
