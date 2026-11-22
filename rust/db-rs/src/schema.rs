//! The port of `src/db/schema.ts`: `initializeSchema` and the migrations from
//! v22 to v44. The SQL lives in `schema_sql.rs`, copied verbatim.

use crate::schema_sql as sql;
use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, params};

pub const SCHEMA_VERSION: i64 = 44;

/// `InitializeSchemaOptions`.
#[derive(Debug, Default, Clone, Copy)]
pub struct InitializeSchemaOptions {
    /// Allow opening a pre-v20 database for read-only export (`migrate export`).
    pub allow_legacy_read: bool,
}

type Result<T> = std::result::Result<T, String>;

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn exec(db: &Connection, script: &str) -> Result<()> {
    db.execute_batch(script).map_err(err)
}

fn table_columns(db: &Connection, name: &str) -> Result<Vec<String>> {
    let mut stmt = db
        .prepare(&format!("PRAGMA table_info({name})"))
        .map_err(err)?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>("name"))
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(names)
}

fn table_exists(db: &Connection, name: &str) -> Result<bool> {
    db.query_row(
        "SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
        [name],
        |_| Ok(()),
    )
    .optional()
    .map(|row| row.is_some())
    .map_err(err)
}

fn add_missing_columns(db: &Connection, table: &str, additions: &[(&str, &str)]) -> Result<()> {
    let columns = table_columns(db, table)?;
    for (name, definition) in additions {
        if !columns.iter().any(|c| c == name) {
            exec(
                db,
                &format!("ALTER TABLE {table} ADD COLUMN {name} {definition}"),
            )?;
        }
    }
    Ok(())
}

fn migrate_upstream_checks(db: &Connection) -> Result<()> {
    exec(db, sql::L359)
}

fn migrate_apply_removal_backups_in_trash(db: &Connection) -> Result<()> {
    let columns = table_columns(db, "apply_removal_backups")?;
    if columns.is_empty() || columns.iter().any(|c| c == "in_trash") {
        return Ok(());
    }
    exec(
        db,
        "ALTER TABLE apply_removal_backups ADD COLUMN in_trash INTEGER NOT NULL DEFAULT 0",
    )
}

fn migrate_notifications(db: &Connection) -> Result<()> {
    exec(db, sql::L389)
}

fn migrate_plugin_excludes(db: &Connection) -> Result<()> {
    if !table_exists(db, "plugins")? {
        return Ok(());
    }
    exec(db, sql::L410)
}

fn migrate_plugin_fork_source(db: &Connection) -> Result<()> {
    if !table_exists(db, "plugins")? {
        return Ok(());
    }
    add_missing_columns(
        db,
        "plugins",
        &[
            (
                "upstream_kind",
                "TEXT NOT NULL DEFAULT '' CHECK(upstream_kind IN ('', 'extends', 'fork'))",
            ),
            ("upstream_ref", "TEXT NOT NULL DEFAULT ''"),
            ("upstream_version_at_link", "TEXT NOT NULL DEFAULT ''"),
            ("upstream_plugin_id", "TEXT NOT NULL DEFAULT ''"),
        ],
    )
}

fn migrate_plugin_spec_metadata(db: &Connection) -> Result<()> {
    if table_exists(db, "plugins")? {
        add_missing_columns(
            db,
            "plugins",
            &[
                ("author_json", "TEXT NOT NULL DEFAULT ''"),
                ("homepage", "TEXT NOT NULL DEFAULT ''"),
                ("repository", "TEXT NOT NULL DEFAULT ''"),
                ("license", "TEXT NOT NULL DEFAULT ''"),
                ("opaque_extensions", "TEXT NOT NULL DEFAULT ''"),
            ],
        )?;
    }
    exec(db, sql::L454)
}

fn migrate_non_semver_plugin_versions(db: &Connection) -> Result<()> {
    if !table_exists(db, "plugins")? {
        return Ok(());
    }
    let columns = table_columns(db, "plugins")?;
    if !columns.iter().any(|c| c == "version") {
        return Ok(());
    }
    let has_fingerprint = columns.iter().any(|c| c == "origin_fingerprint");
    let query = if has_fingerprint {
        "SELECT id, version, origin_fingerprint FROM plugins"
    } else {
        "SELECT id, version FROM plugins"
    };
    let mut stmt = db.prepare(query).map_err(err)?;
    let rows = stmt
        .query_map([], |row| {
            let fingerprint = if has_fingerprint {
                row.get::<_, Option<String>>(2)?
            } else {
                None
            };
            Ok((
                row.get::<_, Value>(0)?,
                row.get::<_, String>(1)?,
                fingerprint,
            ))
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    for (id, version, fingerprint) in rows {
        let next =
            plugin_semver_rs::port::semver_safe_plugin_version(Some(version.clone()), fingerprint)?;
        if next != version {
            db.execute(
                "UPDATE plugins SET version = ? WHERE id = ?",
                params![next, id],
            )
            .map_err(err)?;
        }
    }
    Ok(())
}

fn migrate_plugin_resources_harness_scope(db: &Connection) -> Result<()> {
    if !table_exists(db, "plugin_resources")? {
        return Ok(());
    }
    if table_columns(db, "plugin_resources")?
        .iter()
        .any(|c| c == "harness_scope")
    {
        return Ok(());
    }
    exec(
        db,
        "ALTER TABLE plugin_resources ADD COLUMN harness_scope TEXT NOT NULL DEFAULT 'all'",
    )
}

/// `combineLegacyRegisteredJson`: the main harness, then the aliases that are
/// strings, without repeats or empty names, as a JSON array.
pub fn combine_legacy_registered_json(main: &str, aliases_json: &str) -> String {
    let aliases: Vec<String> = match serde_json::from_str::<serde_json::Value>(aliases_json) {
        Ok(serde_json::Value::Array(items)) => items
            .into_iter()
            .filter_map(|v| match v {
                serde_json::Value::String(s) => Some(s),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    let mut registered: Vec<String> = Vec::new();
    for harness in std::iter::once(main.to_owned()).chain(aliases) {
        if harness.is_empty() || registered.contains(&harness) {
            continue;
        }
        registered.push(harness);
    }
    let value = serde_json::Value::Array(
        registered
            .into_iter()
            .map(serde_json::Value::String)
            .collect(),
    );
    emit_rs::json::stringify(&value, "")
}

/// Rows of `SELECT * FROM <table>` as (column name, value) lists.
fn all_rows(db: &Connection, table: &str) -> Result<Vec<Vec<(String, Value)>>> {
    let mut stmt = db.prepare(&format!("SELECT * FROM {table}")).map_err(err)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt
        .query_map([], |row| {
            names
                .iter()
                .enumerate()
                .map(|(i, n)| Ok((n.clone(), row.get::<_, Value>(i)?)))
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

fn field(row: &[(String, Value)], name: &str) -> Value {
    row.iter()
        .find(|(n, _)| n == name)
        .map(|(_, v)| v.clone())
        .unwrap_or(Value::Null)
}

fn text_or(value: Value, default: &str) -> String {
    match value {
        Value::Text(s) => s,
        Value::Null => default.to_owned(),
        Value::Integer(n) => n.to_string(),
        Value::Real(f) => f.to_string(),
        Value::Blob(b) => String::from_utf8_lossy(&b).into_owned(),
    }
}

/// `row.registered_harnesses ?? combineLegacyRegisteredJson(...)`.
fn registered_harnesses(row: &[(String, Value)]) -> Value {
    match field(row, "registered_harnesses") {
        Value::Null => Value::Text(combine_legacy_registered_json(
            &text_or(field(row, "main_harness"), ""),
            &text_or(field(row, "alias_harnesses"), "[]"),
        )),
        v => v,
    }
}

fn needs_registered_set(db: &Connection, table: &str) -> Result<bool> {
    let columns = table_columns(db, table)?;
    Ok(columns.iter().any(|c| c == "main_harness")
        || !columns.iter().any(|c| c == "registered_harnesses"))
}

fn migrate_harness_tables_to_registered_set(db: &Connection) -> Result<()> {
    if table_exists(db, "harness_preferences")? && needs_registered_set(db, "harness_preferences")?
    {
        exec(db, sql::L529)?;
        let rows = all_rows(db, "harness_preferences")?;
        for row in rows {
            db.execute(
                sql::L546,
                params![
                    field(&row, "scope"),
                    registered_harnesses(&row),
                    field(&row, "updated_at")
                ],
            )
            .map_err(err)?;
        }
        exec(db, sql::L555)?;
    }
    if table_exists(db, "project_harnesses")? && needs_registered_set(db, "project_harnesses")? {
        exec(db, sql::L565)?;
        let rows = all_rows(db, "project_harnesses")?;
        for row in rows {
            db.execute(
                sql::L586,
                params![
                    field(&row, "project_id"),
                    registered_harnesses(&row),
                    field(&row, "materialization_strategy"),
                    field(&row, "cursor_skill_mode"),
                    field(&row, "updated_at"),
                ],
            )
            .map_err(err)?;
        }
        exec(db, sql::L603)?;
    }
    Ok(())
}

fn migrate_global_apply_snapshot_state(db: &Connection) -> Result<()> {
    if !table_exists(db, "global_apply_snapshots")? {
        return Ok(());
    }
    if table_columns(db, "global_apply_snapshots")?
        .iter()
        .any(|c| c == "state")
    {
        return Ok(());
    }
    exec(
        db,
        "ALTER TABLE global_apply_snapshots ADD COLUMN state TEXT NOT NULL DEFAULT '{}'",
    )
}

/// v27: layer tables become plugin tables, rebuilt so foreign keys point at `plugins(id)`.
fn migrate_layer_tables_to_plugin_tables(db: &Connection) -> Result<()> {
    if table_exists(db, "layers")? {
        exec(db, "ALTER TABLE layers RENAME TO plugins")?;
    }
    for (table, script) in [
        ("layer_resources", sql::L646),
        ("layer_working_snapshots", sql::L660),
        ("layer_publish_targets", sql::L674),
        ("project_layers", sql::L689),
    ] {
        if table_exists(db, table)? {
            exec(db, script)?;
        }
    }
    if table_exists(db, "global_apply_snapshots")?
        && table_columns(db, "global_apply_snapshots")?
            .iter()
            .any(|c| c == "layer_ids")
    {
        exec(
            db,
            "ALTER TABLE global_apply_snapshots RENAME COLUMN layer_ids TO plugin_ids",
        )?;
    }
    Ok(())
}

/// v26: `plugin_pin` and `layer` resources become `plugin` dependencies.
fn migrate_resources_to_plugin_dependency_type(db: &Connection) -> Result<()> {
    if !table_exists(db, "resources")? {
        return Ok(());
    }
    if table_exists(db, "layer_resources")? {
        exec(db, sql::L732)?;
        exec(db, sql::L751)?;
    }
    exec(db, sql::L768)?;
    exec(db, sql::L779)
}

fn run_migration(db: &Connection, version: i64) -> Result<()> {
    match version {
        22 => exec(db, sql::L9),
        23 => exec(db, sql::L198),
        24 => exec(db, sql::L208),
        25 => exec(db, sql::L212),
        26 => migrate_resources_to_plugin_dependency_type(db),
        27 => migrate_layer_tables_to_plugin_tables(db),
        28 => exec(db, sql::L220),
        29 => exec(db, sql::L223),
        30 => exec(db, sql::L229),
        31 => exec(db, sql::L252),
        32 => migrate_harness_tables_to_registered_set(db),
        33 => migrate_plugin_resources_harness_scope(db),
        34 => exec(db, sql::L288),
        35 => migrate_non_semver_plugin_versions(db),
        36 => migrate_global_apply_snapshot_state(db),
        37 => exec(db, sql::L320),
        38 => migrate_plugin_spec_metadata(db),
        39 => exec(db, sql::L330),
        40 => migrate_plugin_fork_source(db),
        41 => migrate_plugin_excludes(db),
        42 => migrate_upstream_checks(db),
        43 => migrate_notifications(db),
        44 => migrate_apply_removal_backups_in_trash(db),
        _ => Ok(()),
    }
}

fn schema_version(db: &Connection) -> i64 {
    db.query_row("SELECT version FROM schema_version LIMIT 1", [], |row| {
        row.get::<_, Option<i64>>(0)
    })
    .optional()
    .ok()
    .flatten()
    .flatten()
    .unwrap_or(0)
}

/// `initializeSchema`: bring the database to [`SCHEMA_VERSION`].
pub fn initialize_schema(db: &Connection, options: InitializeSchemaOptions) -> Result<()> {
    let current = schema_version(db);
    if current > SCHEMA_VERSION {
        return Err(format!(
            "Database schema v{current} is newer than this binary (v{SCHEMA_VERSION}). \
             Use a matching HarnessTap build, or point HARNESSTAP_HOME at a compatible database."
        ));
    }
    if current == SCHEMA_VERSION {
        return Ok(());
    }
    if current > 0 && current < 22 {
        if options.allow_legacy_read {
            return Ok(());
        }
        return Err(format!(
            "Database schema v{current} cannot be upgraded in place. \
             Export with `ht migrate export backup.tar`, remove the old database, \
             then `ht migrate import backup.tar`."
        ));
    }
    // Table rebuilds (v26) and renames (v27) need foreign keys off, and SQLite
    // ignores that pragma inside a transaction.
    let needs_fk_off = current < 27;
    if needs_fk_off {
        exec(db, "PRAGMA foreign_keys = OFF")?;
    }
    let result = (|| {
        let tx = db.unchecked_transaction().map_err(err)?;
        if current == 0 {
            run_migration(&tx, 22)?;
        }
        let start = if current == 0 { 23 } else { current + 1 };
        for v in start..=SCHEMA_VERSION {
            run_migration(&tx, v)?;
            tx.execute("UPDATE schema_version SET version = ?", [v])
                .map_err(err)?;
        }
        tx.commit().map_err(err)
    })();
    if needs_fk_off {
        exec(db, "PRAGMA foreign_keys = ON")?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combines_legacy_harness_lists() {
        assert_eq!(
            combine_legacy_registered_json("claude", r#"["cursor","claude",3,"codex","cursor"]"#),
            r#"["claude","cursor","codex"]"#
        );
        assert_eq!(combine_legacy_registered_json("", "not json"), "[]");
    }
}
