//! The port of `src/models/harness.ts`.

use crate::{Ctx, Result, get};
use rusqlite::{Row, params};
use serde::Serialize;
use serde_json::Value;

/// `HarnessPreference`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HarnessPreference {
    pub registered_harnesses: Vec<String>,
    pub updated_at: String,
}

/// `ProjectHarnessConfig`. `materialization_strategy` is `symlink-preferred`
/// or `copy`; `cursor_skill_mode` is left out when unset.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProjectHarnessConfig {
    pub project_id: String,
    pub registered_harnesses: Vec<String>,
    pub materialization_strategy: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_skill_mode: Option<String>,
    pub updated_at: String,
}

const CURSOR_SKILL_MODES: [&str; 3] = ["agent-requested", "always-on", "agents-skills"];

/// `normalizeRegisteredHarnesses` (`services/harness-targets.ts`): drops
/// empties and duplicates, first occurrence wins.
pub fn normalize_registered_harnesses<S: AsRef<str>>(harnesses: &[S]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for h in harnesses {
        let h = h.as_ref();
        if !h.is_empty() && !out.iter().any(|x| x == h) {
            out.push(h.to_owned());
        }
    }
    out
}

fn parse_cursor_skill_mode(value: Option<String>) -> Option<String> {
    value.filter(|v| CURSOR_SKILL_MODES.contains(&v.as_str()))
}

fn parse_registered_json(value: &str) -> Vec<String> {
    match serde_json::from_str::<Value>(value) {
        Ok(Value::Array(items)) => {
            let strings: Vec<&str> = items.iter().filter_map(Value::as_str).collect();
            normalize_registered_harnesses(&strings)
        }
        _ => Vec::new(),
    }
}

fn registered_json(harnesses: &[String]) -> String {
    let value = Value::Array(harnesses.iter().cloned().map(Value::String).collect());
    emit_rs::json::stringify(&value, "")
}

fn row_to_preference(row: &Row<'_>) -> rusqlite::Result<HarnessPreference> {
    Ok(HarnessPreference {
        registered_harnesses: parse_registered_json(&row.get::<_, String>("registered_harnesses")?),
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_project_harness(row: &Row<'_>) -> rusqlite::Result<ProjectHarnessConfig> {
    let strategy: String = row.get("materialization_strategy")?;
    Ok(ProjectHarnessConfig {
        project_id: row.get("project_id")?,
        registered_harnesses: parse_registered_json(&row.get::<_, String>("registered_harnesses")?),
        materialization_strategy: if strategy == "copy" {
            "copy"
        } else {
            "symlink-preferred"
        }
        .to_owned(),
        cursor_skill_mode: parse_cursor_skill_mode(row.get("cursor_skill_mode")?),
        updated_at: row.get("updated_at")?,
    })
}

/// `getHarnessPreference`.
pub fn get_harness_preference(ctx: &Ctx) -> Result<Option<HarnessPreference>> {
    get(
        ctx.db,
        "SELECT * FROM harness_preferences WHERE scope = 'default'",
        [],
        row_to_preference,
    )
}

/// `setHarnessPreference`.
pub fn set_harness_preference<S: AsRef<str>>(
    ctx: &Ctx,
    registered_harnesses: &[S],
) -> Result<HarnessPreference> {
    let now = ctx.clock.now_iso();
    let normalized = normalize_registered_harnesses(registered_harnesses);
    ctx.db.run(
        "INSERT INTO harness_preferences (scope, registered_harnesses, updated_at)\n     VALUES ('default', ?, ?)\n     ON CONFLICT(scope) DO UPDATE SET\n       registered_harnesses = excluded.registered_harnesses,\n       updated_at = excluded.updated_at",
        params![registered_json(&normalized), now],
    )?;
    Ok(HarnessPreference {
        registered_harnesses: normalized,
        updated_at: now,
    })
}

/// `getProjectHarnessConfig`.
pub fn get_project_harness_config(
    ctx: &Ctx,
    project_id: &str,
) -> Result<Option<ProjectHarnessConfig>> {
    get(
        ctx.db,
        "SELECT * FROM project_harnesses WHERE project_id = ?",
        [project_id],
        row_to_project_harness,
    )
}

/// The input of `setProjectHarnessConfig`.
#[derive(Debug, Clone, Default)]
pub struct ProjectHarnessInput<'a> {
    pub project_id: &'a str,
    pub registered_harnesses: &'a [String],
    pub materialization_strategy: Option<&'a str>,
    pub cursor_skill_mode: Option<&'a str>,
}

/// `setProjectHarnessConfig`. An unset `cursor_skill_mode` keeps the stored one.
pub fn set_project_harness_config(
    ctx: &Ctx,
    input: &ProjectHarnessInput,
) -> Result<ProjectHarnessConfig> {
    let now = ctx.clock.now_iso();
    let normalized = normalize_registered_harnesses(input.registered_harnesses);
    let strategy = input
        .materialization_strategy
        .unwrap_or("symlink-preferred")
        .to_owned();
    let existing = get_project_harness_config(ctx, input.project_id)?;
    // `??` keeps an empty string (it only skips null and undefined).
    let cursor_skill_mode = match input.cursor_skill_mode {
        Some(mode) => Some(mode.to_owned()),
        None => existing.and_then(|e| e.cursor_skill_mode),
    };
    ctx.db.run(
        "INSERT INTO project_harnesses (\n       project_id, registered_harnesses, materialization_strategy,\n       cursor_skill_mode, updated_at\n     )\n     VALUES (?, ?, ?, ?, ?)\n     ON CONFLICT(project_id) DO UPDATE SET\n       registered_harnesses = excluded.registered_harnesses,\n       materialization_strategy = excluded.materialization_strategy,\n       cursor_skill_mode = excluded.cursor_skill_mode,\n       updated_at = excluded.updated_at",
        params![
            input.project_id,
            registered_json(&normalized),
            strategy,
            cursor_skill_mode,
            now
        ],
    )?;
    Ok(ProjectHarnessConfig {
        project_id: input.project_id.to_owned(),
        registered_harnesses: normalized,
        materialization_strategy: strategy,
        // the returned object spreads `cursor_skill_mode` only when truthy
        cursor_skill_mode: cursor_skill_mode.filter(|m| !m.is_empty()),
        updated_at: now,
    })
}

/// `deleteProjectHarnessConfig`.
pub fn delete_project_harness_config(ctx: &Ctx, project_id: &str) -> Result<bool> {
    Ok(ctx.db.run(
        "DELETE FROM project_harnesses WHERE project_id = ?",
        [project_id],
    )? > 0)
}
