//! The port of `src/models/plugin-pin-materialization.ts`.

use crate::{Ctx, Result, get};
use rusqlite::params;

fn table_exists(ctx: &Ctx) -> bool {
    get(
        ctx.db,
        "SELECT 1 as ok FROM sqlite_master\n         WHERE type = 'table' AND name = 'plugin_pin_materializations'\n         LIMIT 1",
        [],
        |_| Ok(()),
    )
    .is_ok_and(|row| row.is_some())
}

/// `path.replace(/\\/g, "/").replace(/^\.\//, "")`.
fn normalize_relative_path(path: &str) -> String {
    let slashed = path.replace('\\', "/");
    slashed
        .strip_prefix("./")
        .map(str::to_owned)
        .unwrap_or(slashed)
}

/// The input of `upsertPluginPinMaterialization`. `scope` is `global` or `project`.
#[derive(Debug, Clone, Default)]
pub struct MaterializationInput<'a> {
    pub scope: &'a str,
    pub root_path: &'a str,
    pub relative_path: &'a str,
    pub origin_ref: &'a str,
    pub resource_type: &'a str,
    pub resource_name: &'a str,
    pub plugin_pin_resource_id: Option<&'a str>,
}

/// `upsertPluginPinMaterialization`.
pub fn upsert_plugin_pin_materialization(ctx: &Ctx, input: &MaterializationInput) -> Result<()> {
    let now = ctx.clock.now_iso();
    let relative = normalize_relative_path(input.relative_path);
    let existing = get(
        ctx.db,
        "SELECT id FROM plugin_pin_materializations\n       WHERE scope = ? AND root_path = ? AND relative_path = ?",
        params![input.scope, input.root_path, relative],
        |row| row.get::<_, String>(0),
    )?;
    if let Some(id) = existing {
        ctx.db.run(
            "UPDATE plugin_pin_materializations\n       SET origin_ref = ?,\n           resource_type = ?,\n           resource_name = ?,\n           plugin_pin_resource_id = ?,\n           updated_at = ?\n       WHERE id = ?",
            params![
                input.origin_ref,
                input.resource_type,
                input.resource_name,
                input.plugin_pin_resource_id,
                now,
                id
            ],
        )?;
        return Ok(());
    }
    let id = ctx.ids.ulid();
    ctx.db.run(
        "INSERT INTO plugin_pin_materializations (\n      id, scope, root_path, relative_path, origin_ref,\n      resource_type, resource_name, plugin_pin_resource_id,\n      created_at, updated_at\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            input.scope,
            input.root_path,
            relative,
            input.origin_ref,
            input.resource_type,
            input.resource_name,
            input.plugin_pin_resource_id,
            now,
            now
        ],
    )?;
    Ok(())
}

const SKILL_MD: &str = "/SKILL.md";

fn dirname_skill_dir(skill_md_path: &str) -> String {
    let normalized = skill_md_path.replace('\\', "/");
    match normalized.strip_suffix(SKILL_MD) {
        Some(dir) => dir.to_owned(),
        None => normalized,
    }
}

/// JavaScript's `trim`.
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| {
        matches!(
            c,
            '\u{9}'..='\u{d}'
                | ' '
                | '\u{a0}'
                | '\u{1680}'
                | '\u{2000}'..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
        )
    })
}

fn relative_path_candidates(resource_type: &str, source: Option<&str>) -> Vec<String> {
    let Some(source) = source.map(js_trim).filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    let configured = source.strip_prefix("~/").unwrap_or(source);
    let relative = normalize_relative_path(configured);
    let mut candidates = vec![relative.clone()];
    if resource_type == "skill" && relative.ends_with(SKILL_MD) {
        candidates.push(dirname_skill_dir(&relative));
    }
    candidates
}

/// `matchesPluginPinMaterialization`: false on any database error.
pub fn matches_plugin_pin_materialization(
    ctx: &Ctx,
    root_path: &str,
    resource_type: &str,
    resource_name: &str,
    source: Option<&str>,
) -> bool {
    let paths = relative_path_candidates(resource_type, source);
    if paths.is_empty() {
        return false;
    }
    // a JavaScript Set: insertion order, no repeats
    let mut expanded: Vec<String> = Vec::new();
    let mut add = |p: String| {
        if !expanded.contains(&p) {
            expanded.push(p);
        }
    };
    for relative in paths {
        add(relative.clone());
        if relative.ends_with(SKILL_MD) {
            add(dirname_skill_dir(&relative));
        } else if resource_type == "skill" {
            add(format!("{relative}{SKILL_MD}"));
        }
    }
    if !table_exists(ctx) {
        return false;
    }
    for relative in &expanded {
        match get(
            ctx.db,
            "SELECT 1 as ok FROM plugin_pin_materializations\n           WHERE root_path = ?\n             AND relative_path = ?\n             AND resource_type = ?\n             AND resource_name = ?\n           LIMIT 1",
            params![root_path, relative, resource_type, resource_name],
            |_| Ok(()),
        ) {
            Ok(Some(())) => return true,
            Ok(None) => {}
            Err(_) => return false,
        }
    }
    false
}

/// `findPluginPinResourceIdByOriginRef`.
pub fn find_plugin_pin_resource_id_by_origin_ref(
    ctx: &Ctx,
    origin_ref: &str,
) -> Result<Option<String>> {
    get(
        ctx.db,
        "SELECT id FROM resources\n       WHERE type = 'plugin'\n         AND origin_ref = ?\n       ORDER BY updated_at DESC\n       LIMIT 1",
        [origin_ref],
        |row| row.get::<_, String>(0),
    )
}
