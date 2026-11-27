//! The port of `src/models/environment.ts`.

use crate::resource::{
    ConflictPolicy, Resource, UpsertResourceInput, UpsertResult, hydrate, read_row, upsert_resource,
};
use crate::{Ctx, Result, all, get};
use rusqlite::{Row, params};
use serde::Serialize;
use serde_json::{Map, Value, json};

/// `Environment`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Environment {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
}

/// `EnvironmentLookupResult`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum EnvironmentLookup {
    Found { environment: Environment },
    NotFound,
    Ambiguous { matches: Vec<Environment> },
}

/// A resource row from `getEnvironmentResources`, which also carries the
/// link's `order` (the original spreads `r.*, er."order"`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EnvironmentResource {
    #[serde(flatten)]
    pub resource: Resource,
    pub order: i64,
}

/// `EnvironmentSecretRef`. `provider` is `keychain`, `env` or `file`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EnvironmentSecretRef {
    pub environment_id: String,
    pub key: String,
    pub provider: String,
    #[serde(rename = "ref")]
    pub reference: String,
}

/// A plugin that names the environment as its default.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EnvironmentReference {
    pub id: String,
    pub name: String,
}

/// `EnvironmentReferenceSummary`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EnvironmentReferenceSummary {
    pub plugins: Vec<EnvironmentReference>,
}

fn row_to_environment(row: &Row<'_>) -> rusqlite::Result<Environment> {
    Ok(Environment {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn find_environment_by_id_prefix(ctx: &Ctx, prefix: &str) -> Result<Vec<Environment>> {
    all(
        ctx.db,
        "SELECT * FROM environments\n       WHERE id LIKE ?\n       ORDER BY name",
        [format!("{prefix}%")],
        row_to_environment,
    )
}

fn is_ulid(s: &str) -> bool {
    s.len() == 26
        && s.bytes()
            .all(|b| b.is_ascii_digit() || b.is_ascii_uppercase())
}

/// `resolveEnvironmentSelector`: id, then name, then a unique id prefix.
pub fn resolve_environment_selector(ctx: &Ctx, selector: &str) -> Result<EnvironmentLookup> {
    if is_ulid(selector)
        && let Some(environment) = get_environment(ctx, selector)?
    {
        return Ok(EnvironmentLookup::Found { environment });
    }
    if let Some(environment) = get_environment_by_name(ctx, selector)? {
        return Ok(EnvironmentLookup::Found { environment });
    }
    let mut by_prefix = find_environment_by_id_prefix(ctx, selector)?;
    Ok(match by_prefix.len() {
        0 => EnvironmentLookup::NotFound,
        1 => EnvironmentLookup::Found {
            environment: by_prefix.remove(0),
        },
        _ => EnvironmentLookup::Ambiguous { matches: by_prefix },
    })
}

fn upsert_environment_resource(
    ctx: &Ctx,
    environment_id: &str,
    resource_type: &str,
    name: &str,
    metadata: Value,
) -> Result<Resource> {
    let environment = get_environment(ctx, environment_id)?
        .ok_or_else(|| format!("Environment not found: {environment_id}"))?;
    let input = UpsertResourceInput {
        resource_type: resource_type.to_owned(),
        name: name.to_owned(),
        namespace: environment.name.clone(),
        description: String::new(),
        content: String::new(),
        metadata,
        source: format!("environment:{}", environment.name),
        origin_kind: "manual".to_owned(),
        origin_ref: format!("environment:{}", environment.id),
    };
    let resource = match upsert_resource(ctx, &input, Some(ConflictPolicy::Overwrite), None)? {
        UpsertResult::Created { resource }
        | UpsertResult::Unchanged { resource }
        | UpsertResult::Updated { resource } => resource,
        UpsertResult::Skipped { .. } => {
            return Err(format!(
                "Failed to upsert environment resource: {resource_type}:{name}"
            ));
        }
    };
    add_resource_to_environment(ctx, &environment.id, &resource.id)?;
    Ok(resource)
}

fn list_environment_resources_by_type(
    ctx: &Ctx,
    environment_id: &str,
    resource_type: &str,
) -> Result<Vec<Resource>> {
    Ok(get_environment_resources(ctx, environment_id)?
        .into_iter()
        .map(|r| r.resource)
        .filter(|r| r.resource_type == resource_type)
        .collect())
}

fn remove_environment_resource(ctx: &Ctx, environment_id: &str, resource_id: &str) -> Result<bool> {
    Ok(ctx.db.run(
        "DELETE FROM environment_resources\n       WHERE environment_id = ? AND resource_id = ?",
        [environment_id, resource_id],
    )? > 0)
}

fn remove_all(ctx: &Ctx, environment_id: &str, matches: Vec<Resource>) -> Result<bool> {
    let mut removed = false;
    for m in matches {
        removed = remove_environment_resource(ctx, environment_id, &m.id)? || removed;
    }
    Ok(removed)
}

/// `createEnvironment`.
pub fn create_environment(ctx: &Ctx, name: &str, description: Option<&str>) -> Result<Environment> {
    let now = ctx.clock.now_iso();
    let id = ctx.ids.ulid();
    let description = description.unwrap_or("").to_owned();
    ctx.db.run(
        "INSERT INTO environments (id, name, description, created_at, updated_at)\n     VALUES (?, ?, ?, ?, ?)",
        params![id, name, description, now, now],
    )?;
    Ok(Environment {
        id,
        name: name.to_owned(),
        description,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// `getEnvironment`.
pub fn get_environment(ctx: &Ctx, id: &str) -> Result<Option<Environment>> {
    get(
        ctx.db,
        "SELECT * FROM environments WHERE id = ?",
        [id],
        row_to_environment,
    )
}

/// `getEnvironmentByName`.
pub fn get_environment_by_name(ctx: &Ctx, name: &str) -> Result<Option<Environment>> {
    get(
        ctx.db,
        "SELECT * FROM environments WHERE name = ?",
        [name],
        row_to_environment,
    )
}

/// `listEnvironments`, by name.
pub fn list_environments(ctx: &Ctx) -> Result<Vec<Environment>> {
    all(
        ctx.db,
        "SELECT * FROM environments ORDER BY name",
        [],
        row_to_environment,
    )
}

/// `deleteEnvironment`.
pub fn delete_environment(ctx: &Ctx, environment_id: &str) -> Result<bool> {
    Ok(ctx
        .db
        .run("DELETE FROM environments WHERE id = ?", [environment_id])?
        > 0)
}

/// `upsertEnvironmentEnvVar`.
pub fn upsert_environment_env_var(
    ctx: &Ctx,
    environment_id: &str,
    key: &str,
    value: &str,
) -> Result<Resource> {
    upsert_environment_resource(
        ctx,
        environment_id,
        "env_var",
        key,
        json!({ "key": key, "value": value }),
    )
}

/// `removeEnvironmentEnvVar`: by metadata key or resource name.
pub fn remove_environment_env_var(ctx: &Ctx, environment_id: &str, key: &str) -> Result<bool> {
    let matches = list_environment_resources_by_type(ctx, environment_id, "env_var")?
        .into_iter()
        .filter(|r| r.metadata.get("key").and_then(Value::as_str) == Some(key) || r.name == key)
        .collect();
    remove_all(ctx, environment_id, matches)
}

/// `upsertEnvironmentModelConfig` (name defaults to `default`).
pub fn upsert_environment_model_config(
    ctx: &Ctx,
    environment_id: &str,
    model: &str,
    provider: Option<&str>,
    name: Option<&str>,
) -> Result<Resource> {
    let mut metadata = Map::new();
    metadata.insert("model".into(), Value::String(model.to_owned()));
    if let Some(provider) = provider.filter(|p| !p.is_empty()) {
        metadata.insert("provider".into(), Value::String(provider.to_owned()));
    }
    upsert_environment_resource(
        ctx,
        environment_id,
        "model_config",
        name.unwrap_or("default"),
        Value::Object(metadata),
    )
}

/// `removeEnvironmentModelConfig` (name defaults to `default`).
pub fn remove_environment_model_config(
    ctx: &Ctx,
    environment_id: &str,
    name: Option<&str>,
) -> Result<bool> {
    let name = name.unwrap_or("default");
    let matches = list_environment_resources_by_type(ctx, environment_id, "model_config")?
        .into_iter()
        .filter(|r| r.name == name)
        .collect();
    remove_all(ctx, environment_id, matches)
}

/// `upsertEnvironmentPermission`: named `<action>-<pattern>` unless given.
pub fn upsert_environment_permission(
    ctx: &Ctx,
    environment_id: &str,
    action: &str,
    pattern: &str,
    name: Option<&str>,
) -> Result<Resource> {
    let name = name.map_or_else(|| format!("{action}-{pattern}"), str::to_owned);
    upsert_environment_resource(
        ctx,
        environment_id,
        "permission",
        &name,
        json!({ "action": action, "pattern": pattern }),
    )
}

/// `removeEnvironmentPermission`: every permission matching all the given
/// (non-empty) fields.
pub fn remove_environment_permission(
    ctx: &Ctx,
    environment_id: &str,
    name: Option<&str>,
    action: Option<&str>,
    pattern: Option<&str>,
) -> Result<bool> {
    let meta = |r: &Resource, k: &str| r.metadata.get(k).and_then(Value::as_str).map(str::to_owned);
    let matches = list_environment_resources_by_type(ctx, environment_id, "permission")?
        .into_iter()
        .filter(|r| {
            name.filter(|n| !n.is_empty()).is_none_or(|n| r.name == n)
                && action
                    .filter(|a| !a.is_empty())
                    .is_none_or(|a| meta(r, "action").as_deref() == Some(a))
                && pattern
                    .filter(|p| !p.is_empty())
                    .is_none_or(|p| meta(r, "pattern").as_deref() == Some(p))
        })
        .collect();
    remove_all(ctx, environment_id, matches)
}

/// `listEnvironmentReferences`: plugins whose default environment it is.
pub fn list_environment_references(
    ctx: &Ctx,
    environment_id: &str,
) -> Result<EnvironmentReferenceSummary> {
    let plugins = all(
        ctx.db,
        "SELECT id, name\n       FROM plugins\n       WHERE default_environment_id = ?\n       ORDER BY name",
        [environment_id],
        |row| {
            Ok(EnvironmentReference {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        },
    )?;
    Ok(EnvironmentReferenceSummary { plugins })
}

/// `hasEnvironmentReferences`.
pub fn has_environment_references(ctx: &Ctx, environment_id: &str) -> Result<bool> {
    Ok(!list_environment_references(ctx, environment_id)?
        .plugins
        .is_empty())
}

/// `addResourceToEnvironment`: appended after the current last `order`;
/// an existing link is left as it is.
pub fn add_resource_to_environment(
    ctx: &Ctx,
    environment_id: &str,
    resource_id: &str,
) -> Result<()> {
    let max_order: i64 = get(
        ctx.db,
        "SELECT COALESCE(MAX(\"order\"), -1) as max_order FROM environment_resources WHERE environment_id = ?",
        [environment_id],
        |row| row.get(0),
    )?
    .unwrap_or(-1);
    ctx.db.run(
        "INSERT OR IGNORE INTO environment_resources (environment_id, resource_id, \"order\") VALUES (?, ?, ?)",
        params![environment_id, resource_id, max_order + 1],
    )?;
    Ok(())
}

/// `removeResourceFromEnvironment`.
pub fn remove_resource_from_environment(
    ctx: &Ctx,
    environment_id: &str,
    resource_id: &str,
) -> Result<()> {
    ctx.db.run(
        "DELETE FROM environment_resources WHERE environment_id = ? AND resource_id = ?",
        [environment_id, resource_id],
    )?;
    Ok(())
}

/// `getEnvironmentResources`, in link order.
pub fn get_environment_resources(
    ctx: &Ctx,
    environment_id: &str,
) -> Result<Vec<EnvironmentResource>> {
    let rows = all(
        ctx.db,
        "SELECT r.*, er.\"order\" FROM resources r\n       JOIN environment_resources er ON er.resource_id = r.id\n       WHERE er.environment_id = ?\n       ORDER BY er.\"order\"",
        [environment_id],
        |row| Ok((read_row(row)?, row.get::<_, i64>("order")?)),
    )?;
    Ok(rows
        .into_iter()
        .map(|(raw, order)| EnvironmentResource {
            resource: hydrate(ctx, raw),
            order,
        })
        .collect())
}

/// `addSecretRefToEnvironment`: replaces the key's provider and ref.
pub fn add_secret_ref_to_environment(
    ctx: &Ctx,
    environment_id: &str,
    key: &str,
    provider: &str,
    reference: &str,
) -> Result<()> {
    ctx.db.run(
        "INSERT INTO environment_secret_refs (environment_id, key, provider, ref)\n     VALUES (?, ?, ?, ?)\n     ON CONFLICT(environment_id, key) DO UPDATE SET provider = excluded.provider, ref = excluded.ref",
        [environment_id, key, provider, reference],
    )?;
    Ok(())
}

/// `getEnvironmentSecretRefs`, by key.
pub fn get_environment_secret_refs(
    ctx: &Ctx,
    environment_id: &str,
) -> Result<Vec<EnvironmentSecretRef>> {
    all(
        ctx.db,
        "SELECT * FROM environment_secret_refs WHERE environment_id = ? ORDER BY key",
        [environment_id],
        |row| {
            Ok(EnvironmentSecretRef {
                environment_id: row.get("environment_id")?,
                key: row.get("key")?,
                provider: row.get("provider")?,
                reference: row.get("ref")?,
            })
        },
    )
}

/// `removeSecretRefFromEnvironment`.
pub fn remove_secret_ref_from_environment(
    ctx: &Ctx,
    environment_id: &str,
    key: &str,
) -> Result<bool> {
    Ok(ctx.db.run(
        "DELETE FROM environment_secret_refs WHERE environment_id = ? AND key = ?",
        [environment_id, key],
    )? > 0)
}
