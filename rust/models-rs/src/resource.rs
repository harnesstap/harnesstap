//! The port of `src/models/resource.ts`.
//!
//! The original keeps an in-memory cache of overflow blobs (up to 256, keyed
//! by content hash). The port reads the blob each time, which returns the same
//! text unless a blob file is rewritten behind the process.

use crate::services::blob_store::{first_two, read_blob, write_blob};
use crate::services::resource_hash::hash_resource_body;
use crate::services::resource_selector::{ParsedResourceSelector, parse_resource_selector};
use crate::{Ctx, Result, all, get, js_trim};
use db_rs::paths::harnesstap_dir;
use rusqlite::types::Value as Sql;
use rusqlite::{Row, params, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const INLINE_CONTENT_THRESHOLD: usize = 4096;

/// `MATERIAL_RESOURCE_TYPES` then `plugin` (`LISTABLE_RESOURCE_TYPES`).
pub const LISTABLE_RESOURCE_TYPES: [&str; 11] = [
    "instruction",
    "skill",
    "rule",
    "mcp_server",
    "permission",
    "hook",
    "agent",
    "command",
    "env_var",
    "model_config",
    "plugin",
];

/// `Resource`, in the column order of the `resources` table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Resource {
    pub id: String,
    #[serde(rename = "type")]
    pub resource_type: String,
    pub name: String,
    pub description: String,
    pub content: String,
    pub metadata: Value,
    pub source: String,
    pub namespace: String,
    pub origin_kind: String,
    pub origin_ref: String,
    pub content_hash: String,
    pub content_blob_ref: String,
    pub created_at: String,
    pub updated_at: String,
}

/// `ResourceLookupResult`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ResourceLookup {
    Found { resource: Box<Resource> },
    NotFound,
    Ambiguous { matches: Vec<Resource> },
}

/// `UpsertResult`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum UpsertResult {
    Created { resource: Resource },
    Unchanged { resource: Resource },
    Updated { resource: Resource },
    Skipped { existing: Resource },
}

/// `ResourceResolveMode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ResolveMode {
    #[default]
    Display,
    Compose,
}

/// `UpsertResourceInput` (already normalized: `namespace` and `origin_ref`
/// default to empty, `origin_kind` to `manual`).
#[derive(Debug, Clone)]
pub struct UpsertResourceInput {
    pub resource_type: String,
    pub name: String,
    pub namespace: String,
    pub description: String,
    pub content: String,
    pub metadata: Value,
    pub source: String,
    pub origin_kind: String,
    pub origin_ref: String,
}

/// `ImportConflictPolicy`; `prompt` acts as `fail`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictPolicy {
    Prompt,
    Skip,
    Overwrite,
    Fail,
}

/// `formatResourceSelector`.
pub fn format_resource_selector(
    resource_type: &str,
    name: &str,
    namespace: &str,
    include_type: bool,
) -> String {
    let name_part = if namespace.is_empty() {
        name.to_owned()
    } else {
        format!("{name}@{namespace}")
    };
    if include_type {
        format!("{resource_type}:{name_part}")
    } else {
        name_part
    }
}

pub(crate) struct RawRow {
    pub(crate) resource: Resource,
}

pub(crate) fn read_row(row: &Row<'_>) -> rusqlite::Result<RawRow> {
    let metadata: String = row.get("metadata")?;
    let metadata = serde_json::from_str(&metadata).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    Ok(RawRow {
        resource: Resource {
            id: row.get("id")?,
            resource_type: row.get("type")?,
            name: row.get("name")?,
            description: row.get("description")?,
            content: row.get("content")?,
            metadata,
            source: row.get("source")?,
            namespace: row.get("namespace")?,
            origin_kind: row.get("origin_kind")?,
            origin_ref: row.get("origin_ref")?,
            content_hash: row.get("content_hash")?,
            content_blob_ref: row.get("content_blob_ref")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        },
    })
}

/// `mapResourceRow`: overflow content comes back from the blob store.
pub(crate) fn hydrate(ctx: &Ctx, raw: RawRow) -> Resource {
    let mut resource = raw.resource;
    if resource.content.is_empty() {
        let hash = js_trim(&resource.content_hash);
        if hash.starts_with("sha256:")
            && let Ok(text) = read_blob(&harnesstap_dir(ctx.env), hash)
        {
            resource.content = text;
        }
    }
    resource
}

fn query_one(ctx: &Ctx, sql: &str, params: impl rusqlite::Params) -> Result<Option<Resource>> {
    Ok(get(ctx.db, sql, params, read_row)?.map(|raw| hydrate(ctx, raw)))
}

fn query_all(ctx: &Ctx, sql: &str, params: impl rusqlite::Params) -> Result<Vec<Resource>> {
    Ok(all(ctx.db, sql, params, read_row)?
        .into_iter()
        .map(|raw| hydrate(ctx, raw))
        .collect())
}

/// `/^[0-9A-Z]{26}$/`.
fn is_ulid(s: &str) -> bool {
    s.len() == 26
        && s.bytes()
            .all(|b| b.is_ascii_digit() || b.is_ascii_uppercase())
}

fn find_resource_by_id(ctx: &Ctx, id: &str) -> Result<Option<Resource>> {
    query_one(ctx, "SELECT * FROM resources WHERE id = ?", [id])
}

fn find_existing_resource(
    ctx: &Ctx,
    resource_type: &str,
    name: &str,
    namespace: &str,
) -> Result<Option<Resource>> {
    query_one(
        ctx,
        "SELECT * FROM resources WHERE type = ? AND name = ? AND namespace = ?",
        [resource_type, name, namespace],
    )
}

/// `findResourceByKey`.
pub fn find_resource_by_key(
    ctx: &Ctx,
    resource_type: &str,
    name: &str,
    namespace: &str,
) -> Result<Option<Resource>> {
    find_existing_resource(ctx, resource_type, name, namespace)
}

fn find_resources_by_selector(ctx: &Ctx, parsed: &ParsedResourceSelector) -> Result<Vec<Resource>> {
    let mut conditions = vec!["name = ?"];
    let mut values = vec![parsed.name.clone()];
    if let Some(t) = parsed.type_filter() {
        conditions.push("type = ?");
        values.push(t.to_owned());
    }
    if !parsed.namespace.is_empty() {
        conditions.push("namespace = ?");
        values.push(parsed.namespace.clone());
    }
    let sql = format!(
        "SELECT * FROM resources WHERE {} ORDER BY created_at DESC",
        conditions.join(" AND ")
    );
    query_all(ctx, &sql, params_from_iter(values))
}

fn resolve_from_matches(mut matches: Vec<Resource>, mode: ResolveMode) -> ResourceLookup {
    match matches.len() {
        0 => return ResourceLookup::NotFound,
        1 => {
            return ResourceLookup::Found {
                resource: Box::new(matches.remove(0)),
            };
        }
        _ => {}
    }
    if mode == ResolveMode::Display {
        let unnamespaced: Vec<&Resource> =
            matches.iter().filter(|m| m.namespace.is_empty()).collect();
        if unnamespaced.len() == 1 {
            return ResourceLookup::Found {
                resource: Box::new(unnamespaced[0].clone()),
            };
        }
    }
    ResourceLookup::Ambiguous { matches }
}

/// `resolveResource`: by id, then `type:name@namespace`.
pub fn resolve_resource(ctx: &Ctx, selector: &str, mode: ResolveMode) -> Result<ResourceLookup> {
    if is_ulid(selector)
        && let Some(resource) = find_resource_by_id(ctx, selector)?
    {
        return Ok(ResourceLookup::Found {
            resource: Box::new(resource),
        });
    }
    let parsed = parse_resource_selector(selector);
    if is_ulid(&parsed.name)
        && let Some(by_id) = find_resource_by_id(ctx, &parsed.name)?
    {
        return Ok(match parsed.type_filter() {
            Some(t) if t != by_id.resource_type => ResourceLookup::NotFound,
            _ => ResourceLookup::Found {
                resource: Box::new(by_id),
            },
        });
    }
    let matches = find_resources_by_selector(ctx, &parsed)?;
    if parsed.namespace.is_empty() && mode == ResolveMode::Compose && matches.len() > 1 {
        return Ok(ResourceLookup::Ambiguous { matches });
    }
    Ok(resolve_from_matches(matches, mode))
}

fn content_blob_ref(content_hash: &str) -> String {
    let hex = content_hash.strip_prefix("sha256:").unwrap_or(content_hash);
    format!("blobs/sha256/{}/{hex}", first_two(hex))
}

/// `persistContent`: always writes the blob; content over 4096 UTF-16 units
/// is not kept inline.
fn persist_content(home: &str, content_hash: &str, content: &str) -> Result<(String, String)> {
    write_blob(home, content_hash, content).map_err(|e| e.to_string())?;
    let blob_ref = content_blob_ref(content_hash);
    let inline = if emit_rs::js::utf16_len(content) <= INLINE_CONTENT_THRESHOLD {
        content.to_owned()
    } else {
        String::new()
    };
    Ok((inline, blob_ref))
}

fn json(value: &Value) -> String {
    emit_rs::json::stringify(value, "")
}

/// `upsertResource`. `harnesstap_dir` overrides where blobs go; the policy
/// defaults to `skip`.
pub fn upsert_resource(
    ctx: &Ctx,
    input: &UpsertResourceInput,
    policy: Option<ConflictPolicy>,
    harnesstap_dir_override: Option<&str>,
) -> Result<UpsertResult> {
    let home = harnesstap_dir_override.map_or_else(|| harnesstap_dir(ctx.env), str::to_owned);
    let namespace = input.namespace.as_str();
    let origin_ref = input.origin_ref.as_str();
    let content_hash = hash_resource_body(&input.resource_type, &input.content, &input.metadata);
    let existing = find_existing_resource(ctx, &input.resource_type, &input.name, namespace)?;

    let Some(existing) = existing else {
        let now = ctx.clock.now_iso();
        let id = ctx.ids.ulid();
        let (inline, blob_ref) = persist_content(&home, &content_hash, &input.content)?;
        ctx.db.run(
            "INSERT INTO resources (\n        id, type, name, description, content, metadata, source,\n        namespace, origin_kind, origin_ref, content_hash, content_blob_ref,\n        created_at, updated_at\n      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                id,
                input.resource_type,
                input.name,
                input.description,
                inline,
                json(&input.metadata),
                input.source,
                namespace,
                input.origin_kind,
                origin_ref,
                content_hash,
                blob_ref,
                now,
                now
            ],
        )?;
        return Ok(UpsertResult::Created {
            resource: Resource {
                id,
                resource_type: input.resource_type.clone(),
                name: input.name.clone(),
                description: input.description.clone(),
                content: input.content.clone(),
                metadata: input.metadata.clone(),
                source: input.source.clone(),
                namespace: namespace.to_owned(),
                origin_kind: input.origin_kind.clone(),
                origin_ref: origin_ref.to_owned(),
                content_hash,
                content_blob_ref: blob_ref,
                created_at: now.clone(),
                updated_at: now,
            },
        });
    };

    if existing.content_hash == content_hash {
        let now = ctx.clock.now_iso();
        let kept_ref = if origin_ref.is_empty() {
            existing.origin_ref.clone()
        } else {
            origin_ref.to_owned()
        };
        ctx.db.run(
            "UPDATE resources SET origin_ref = ?, updated_at = ? WHERE id = ?",
            params![kept_ref, now, existing.id],
        )?;
        return Ok(UpsertResult::Unchanged {
            resource: Resource {
                origin_ref: kept_ref,
                updated_at: now,
                ..existing
            },
        });
    }

    match policy.unwrap_or(ConflictPolicy::Skip) {
        ConflictPolicy::Skip => return Ok(UpsertResult::Skipped { existing }),
        ConflictPolicy::Fail | ConflictPolicy::Prompt => {
            let ns = if namespace.is_empty() {
                String::new()
            } else {
                format!("@{namespace}")
            };
            return Err(format!(
                "Resource conflict: {}:{}{ns} exists with different content",
                input.resource_type, input.name
            ));
        }
        ConflictPolicy::Overwrite => {}
    }

    let now = ctx.clock.now_iso();
    let (inline, blob_ref) = persist_content(&home, &content_hash, &input.content)?;
    ctx.db.run(
        "UPDATE resources SET\n      description = ?, content = ?, metadata = ?, source = ?,\n      origin_kind = ?, origin_ref = ?, content_hash = ?, content_blob_ref = ?,\n      updated_at = ?\n     WHERE id = ?",
        params![
            input.description,
            inline,
            json(&input.metadata),
            input.source,
            input.origin_kind,
            origin_ref,
            content_hash,
            blob_ref,
            now,
            existing.id
        ],
    )?;
    Ok(UpsertResult::Updated {
        resource: Resource {
            description: input.description.clone(),
            content: input.content.clone(),
            metadata: input.metadata.clone(),
            source: input.source.clone(),
            origin_kind: input.origin_kind.clone(),
            origin_ref: origin_ref.to_owned(),
            content_hash,
            content_blob_ref: blob_ref,
            updated_at: now,
            ..existing
        },
    })
}

/// `createResource`: an overwriting upsert.
pub fn create_resource(ctx: &Ctx, input: &UpsertResourceInput) -> Result<Resource> {
    match upsert_resource(ctx, input, Some(ConflictPolicy::Overwrite), None)? {
        UpsertResult::Created { resource }
        | UpsertResult::Unchanged { resource }
        | UpsertResult::Updated { resource } => Ok(resource),
        UpsertResult::Skipped { .. } => Err(format!(
            "Resource already exists: {}",
            format_resource_selector(&input.resource_type, &input.name, &input.namespace, true)
        )),
    }
}

/// `getResource`.
pub fn get_resource(ctx: &Ctx, name_or_id: &str, mode: ResolveMode) -> Result<Option<Resource>> {
    Ok(match resolve_resource(ctx, name_or_id, mode)? {
        ResourceLookup::Found { resource } => Some(*resource),
        _ => None,
    })
}

/// `getResourcesByIds`: unknown or ambiguous selectors are dropped.
pub fn get_resources_by_ids<S: AsRef<str>>(ctx: &Ctx, ids: &[S]) -> Result<Vec<Resource>> {
    let mut out = Vec::new();
    for id in ids {
        if let Some(r) = get_resource(ctx, id.as_ref(), ResolveMode::Display)? {
            out.push(r);
        }
    }
    Ok(out)
}

/// The filters of `listResources`.
#[derive(Debug, Clone, Default)]
pub struct ListFilters<'a> {
    pub resource_type: Option<&'a str>,
    pub search: Option<&'a str>,
    pub origin_kind: Option<&'a str>,
    pub include_composition: bool,
}

/// `listResources`, newest update first. Without a type, only listable types
/// unless `include_composition`.
pub fn list_resources(ctx: &Ctx, filters: &ListFilters) -> Result<Vec<Resource>> {
    let mut conditions: Vec<String> = Vec::new();
    let mut values: Vec<Sql> = Vec::new();
    if let Some(t) = filters.resource_type.filter(|t| !t.is_empty()) {
        conditions.push("type = ?".into());
        values.push(Sql::Text(t.to_owned()));
    } else if !filters.include_composition {
        let marks = vec!["?"; LISTABLE_RESOURCE_TYPES.len()].join(", ");
        conditions.push(format!("type IN ({marks})"));
        values.extend(
            LISTABLE_RESOURCE_TYPES
                .iter()
                .map(|t| Sql::Text((*t).to_owned())),
        );
    }
    if let Some(kind) = filters.origin_kind.filter(|k| !k.is_empty()) {
        conditions.push("origin_kind = ?".into());
        values.push(Sql::Text(kind.to_owned()));
    }
    if let Some(search) = filters.search.filter(|s| !s.is_empty()) {
        conditions.push("(name LIKE ? OR description LIKE ?)".into());
        values.push(Sql::Text(format!("%{search}%")));
        values.push(Sql::Text(format!("%{search}%")));
    }
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };
    query_all(
        ctx,
        &format!("SELECT * FROM resources {where_clause} ORDER BY updated_at DESC"),
        params_from_iter(values),
    )
}

/// `listLinkedResources`.
pub fn list_linked_resources(ctx: &Ctx, selector: Option<&str>) -> Result<Vec<Resource>> {
    let linked = list_resources(
        ctx,
        &ListFilters {
            origin_kind: Some("marketplace_link"),
            ..ListFilters::default()
        },
    )?;
    let Some(selector) = selector.filter(|s| !s.is_empty()) else {
        return Ok(linked);
    };
    Ok(
        match resolve_resource(ctx, selector, ResolveMode::Compose)? {
            ResourceLookup::Found { resource } if resource.origin_kind == "marketplace_link" => {
                vec![*resource]
            }
            ResourceLookup::Ambiguous { matches } => matches
                .into_iter()
                .filter(|r| r.origin_kind == "marketplace_link")
                .collect(),
            _ => Vec::new(),
        },
    )
}

/// The input of `updateResource`: only the given fields change.
#[derive(Debug, Clone, Default)]
pub struct ResourceUpdate {
    pub name: Option<String>,
    pub description: Option<String>,
    pub content: Option<String>,
    pub metadata: Option<Value>,
}

/// The error `updateResource` throws when the new name is taken (its `code`
/// is `resource_exists`).
pub const RESOURCE_EXISTS: &str = "Resource already exists";

/// `updateResource`.
pub fn update_resource(
    ctx: &Ctx,
    name_or_id: &str,
    input: &ResourceUpdate,
) -> Result<Option<Resource>> {
    let ResourceLookup::Found { resource } =
        resolve_resource(ctx, name_or_id, ResolveMode::Display)?
    else {
        return Ok(None);
    };
    if let Some(name) = input.name.as_deref()
        && name != resource.name
        && let Some(existing) =
            find_existing_resource(ctx, &resource.resource_type, name, &resource.namespace)?
        && existing.id != resource.id
    {
        return Err(RESOURCE_EXISTS.to_owned());
    }
    let mut sets: Vec<&str> = Vec::new();
    let mut values: Vec<Sql> = Vec::new();
    if let Some(name) = &input.name {
        sets.push("name = ?");
        values.push(Sql::Text(name.clone()));
    }
    if let Some(description) = &input.description {
        sets.push("description = ?");
        values.push(Sql::Text(description.clone()));
    }
    if let Some(content) = &input.content {
        let metadata = input.metadata.as_ref().unwrap_or(&resource.metadata);
        let hash = hash_resource_body(&resource.resource_type, content, metadata);
        let (inline, blob_ref) = persist_content(&harnesstap_dir(ctx.env), &hash, content)?;
        sets.extend(["content = ?", "content_hash = ?", "content_blob_ref = ?"]);
        values.extend([Sql::Text(inline), Sql::Text(hash), Sql::Text(blob_ref)]);
    }
    if let Some(metadata) = &input.metadata {
        sets.push("metadata = ?");
        values.push(Sql::Text(json(metadata)));
    }
    if sets.is_empty() {
        return Ok(Some(*resource));
    }
    sets.push("updated_at = ?");
    values.push(Sql::Text(ctx.clock.now_iso()));
    values.push(Sql::Text(resource.id.clone()));
    ctx.db.run(
        &format!("UPDATE resources SET {} WHERE id = ?", sets.join(", ")),
        params_from_iter(values),
    )?;
    get_resource(ctx, &resource.id, ResolveMode::Display)
}

/// `renamePluginTypedResources` (and its alias `renameLayerTypedResources`):
/// skips rows whose new key is taken.
pub fn rename_plugin_typed_resources(ctx: &Ctx, old_name: &str, new_name: &str) -> Result<usize> {
    let now = ctx.clock.now_iso();
    let rows = all(
        ctx.db,
        "SELECT id, namespace, origin_ref FROM resources WHERE type = 'plugin' AND name = ?",
        [old_name],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    )?;
    let mut updated = 0;
    for (id, namespace, origin_ref) in rows {
        if find_resource_by_key(ctx, "plugin", new_name, &namespace)?.is_some() {
            continue;
        }
        let origin_ref = if origin_ref == old_name {
            new_name
        } else {
            origin_ref.as_str()
        };
        ctx.db.run(
            "UPDATE resources SET name = ?, origin_ref = ?, updated_at = ? WHERE id = ?",
            params![new_name, origin_ref, now, id],
        )?;
        updated += 1;
    }
    Ok(updated)
}

/// `listResourcesByOriginRef` (kind defaults to `local_snapshot`).
pub fn list_resources_by_origin_ref(
    ctx: &Ctx,
    origin_ref: &str,
    origin_kind: Option<&str>,
) -> Result<Vec<Resource>> {
    query_all(
        ctx,
        "SELECT * FROM resources WHERE origin_ref = ? AND origin_kind = ? ORDER BY updated_at DESC",
        [origin_ref, origin_kind.unwrap_or("local_snapshot")],
    )
}

/// `listResourcesMatchingOriginRef`: any origin kind.
pub fn list_resources_matching_origin_ref(ctx: &Ctx, origin_ref: &str) -> Result<Vec<Resource>> {
    query_all(
        ctx,
        "SELECT * FROM resources WHERE origin_ref = ? ORDER BY updated_at DESC",
        [origin_ref],
    )
}

/// `listPluginResourcesByOriginRef`.
pub fn list_plugin_resources_by_origin_ref(ctx: &Ctx, origin_ref: &str) -> Result<Vec<Resource>> {
    query_all(
        ctx,
        "SELECT * FROM resources WHERE type = 'plugin' AND origin_ref = ? ORDER BY created_at DESC",
        [origin_ref],
    )
}

/// `deleteResource`: only a uniquely resolved resource.
pub fn delete_resource(ctx: &Ctx, name_or_id: &str) -> Result<bool> {
    let ResourceLookup::Found { resource } =
        resolve_resource(ctx, name_or_id, ResolveMode::Display)?
    else {
        return Ok(false);
    };
    Ok(ctx
        .db
        .run("DELETE FROM resources WHERE id = ?", [&resource.id])?
        > 0)
}
