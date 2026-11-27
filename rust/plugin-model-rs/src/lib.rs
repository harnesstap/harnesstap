//! The port of `src/models/plugin-model.ts`, with the small services it
//! needs: `plugin-upstream.ts` ([`upstream`]) and `agent-plugins/name.ts`
//! ([`name`]). `plugin-constraints.ts` comes from `resolve-rs` and
//! `harness-scope.ts` from `harness-scope-rs`.
//!
//! `plugin-composition.ts`, `plugin-extends.ts` and `claude-plugin-pins.ts`
//! reach the marketplace, the cloud API and forks, so the model takes them
//! through [`PluginComposition`] (see `rust/MAP.md`).
//!
//! Like the other models, the port runs outside a status computation, so
//! `computationSlot` is a plain call, and it keeps no statement cache, so the
//! `readPluginByName*Count` diagnostics are not ported.
//!
//! JSON columns written by the app are read with `serde_json`. A column the
//! original's `JSON.parse` rejects is an `Err` here too, with another message.

pub mod name;
pub mod origin;
pub mod upstream;
pub mod versioning;

use harness_scope_rs::js::sort as js_sort;
use harness_scope_rs::port::{parse_harness_scope, serialize_harness_scope};
use models_rs::resource::{Resource, map_resource_row};
use models_rs::{Ctx, Result, js_trim};
use node_semver_rs::{self as semver, Options};
use resolve_rs::plugin_constraints::{parse_version_constraint, satisfies_constraint};
use rusqlite::types::Value as Sql;
use rusqlite::{OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use upstream::{PluginUpstream, UpstreamRow, upstream_from_row};

pub(crate) fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

/// `Plugin`. `claude`, `overrides` and `author` keep the JSON the row holds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Plugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub org_slug: String,
    pub catalog_slug: String,
    pub origin: String,
    pub description: String,
    pub tags: Vec<String>,
    pub dirty: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frozen_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub needs: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overrides: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_environment_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ap_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_locator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_fingerprint_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream: Option<PluginUpstream>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream_plugin_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A resource as a plugin attaches it: the row's `order` and parsed
/// `harness_scope` ride along (`mapAttachedResource`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttachedResource {
    #[serde(flatten)]
    pub resource: Resource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness_scope: Option<Value>,
}

impl From<Resource> for AttachedResource {
    fn from(resource: Resource) -> Self {
        AttachedResource {
            resource,
            order: None,
            harness_scope: None,
        }
    }
}

/// `{ ref, version_constraint }`, a plugin pin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginPin {
    #[serde(rename = "ref")]
    pub reference: String,
    pub version_constraint: String,
}

/// `PluginRefView` from `plugin-composition.ts`.
#[derive(Debug, Clone, PartialEq)]
pub struct PluginRefView {
    pub dependency_name: String,
    pub version_constraint: String,
    pub resource: AttachedResource,
}

/// `PluginDependencyRef`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PluginDependencyRef {
    pub plugin_id: String,
    pub dependency_name: String,
    pub version_constraint: String,
    pub order: usize,
}

/// `MergedPluginContent`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedPluginContent {
    pub plugins: Vec<Plugin>,
    pub resources: Vec<AttachedResource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude: Option<Value>,
    pub plugin_pins: Vec<PluginPin>,
}

/// The plugin services the model calls into, which reach well past the
/// database (marketplace pins, the cloud API, forks).
pub trait PluginComposition {
    /// `getComposedPluginResources` (`plugin-extends.ts`).
    fn composed_plugin_resources(
        &self,
        ctx: &Ctx,
        plugin_id: &str,
    ) -> Result<Vec<AttachedResource>>;
    /// `listComposedDependencies` (`plugin-extends.ts`), as pins.
    fn composed_dependencies(&self, ctx: &Ctx, plugin_id: &str) -> Result<Vec<PluginPin>>;
    /// `listAttachedPluginRefs` (`plugin-composition.ts`).
    fn attached_plugin_refs(&self, ctx: &Ctx, plugin_id: &str) -> Result<Vec<PluginRefView>>;
    /// `ensurePluginResource(selector, { versionConstraint })` (`plugin-composition.ts`).
    fn ensure_plugin_resource(
        &self,
        ctx: &Ctx,
        selector: &str,
        version_constraint: Option<&str>,
    ) -> Result<Resource>;
    /// `claudeConfigFromPluginPins` (`claude-plugin-pins.ts`).
    fn claude_config_from_plugin_pins(&self, ctx: &Ctx, pins: &[PluginPin]) -> Option<Value>;
}

// ---------------------------------------------------------------------------
// JS value helpers

fn truthy(v: Option<&Value>) -> bool {
    v.is_some_and(emit_rs::js::truthy)
}

/// `Object.keys(v).length` for a value that is not null or undefined.
fn keys_len(v: &Value) -> usize {
    match v {
        Value::Object(o) => o.len(),
        Value::Array(a) => a.len(),
        Value::String(s) => s.encode_utf16().count(),
        _ => 0,
    }
}

/// `v.length === 0` for a truthy `v`.
fn length_is_zero(v: &Value) -> bool {
    match v {
        Value::Array(a) => a.is_empty(),
        Value::String(s) => s.is_empty(),
        Value::Object(o) => o.get("length").and_then(Value::as_f64) == Some(0.0),
        _ => false,
    }
}

/// The own properties `{...v}` copies; only objects are spread here.
fn spread(v: Option<&Value>) -> Map<String, Value> {
    match v {
        Some(Value::Object(o)) => o.clone(),
        _ => Map::new(),
    }
}

/// The items `for (const x of v ?? [])` walks; only arrays are walked here.
fn items(v: Option<&Value>) -> Vec<Value> {
    match v {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    }
}

/// A key for `Map` lookups by `p.id`; strings and numbers compare by value.
fn id_key(entry: &Value) -> String {
    match entry.get("id") {
        None | Some(Value::Null) => "undefined".to_owned(),
        Some(v) => v.to_string(),
    }
}

fn parse_json(raw: &str, column: &str) -> Result<Value> {
    serde_json::from_str(raw).map_err(|e| format!("{column}: {e}"))
}

pub(crate) fn stringify(v: &Value) -> String {
    emit_rs::json::stringify(v, "")
}

fn property<'a>(v: &'a Value, key: &str) -> Result<Option<&'a Value>> {
    match v {
        Value::Null => Err(format!("Cannot read properties of null (reading '{key}')")),
        Value::Object(o) => Ok(o.get(key)),
        _ => Ok(None),
    }
}

// ---------------------------------------------------------------------------
// Rows

/// `parseClaudeConfig`.
pub(crate) fn parse_claude_config(raw: Option<&str>) -> Result<Option<Value>> {
    let Some(raw) = raw.filter(|r| !r.is_empty() && *r != "{}") else {
        return Ok(None);
    };
    let parsed = parse_json(raw, "claude_config")?;
    let marketplaces = property(&parsed, "marketplaces")?;
    let plugins = property(&parsed, "plugins")?;
    let no_marketplaces = !truthy(marketplaces) || marketplaces.is_some_and(|m| keys_len(m) == 0);
    let no_plugins = !truthy(plugins) || plugins.is_some_and(length_is_zero);
    Ok(if no_marketplaces && no_plugins {
        None
    } else {
        Some(parsed)
    })
}

/// `serializeClaudeConfig`.
fn serialize_claude_config(config: Option<&Value>) -> String {
    config.map_or_else(|| "{}".to_owned(), stringify)
}

/// `parseNeedsConfig`.
pub(crate) fn parse_needs_config(raw: Option<&str>) -> Result<Option<Vec<String>>> {
    let Some(raw) = raw.filter(|r| !r.is_empty() && *r != "[]") else {
        return Ok(None);
    };
    let parsed: Vec<String> =
        serde_json::from_str(raw).map_err(|e| format!("needs_config: {e}"))?;
    Ok((!parsed.is_empty()).then_some(parsed))
}

/// `serializeNeedsConfig`.
fn serialize_needs_config(needs: Option<&[String]>) -> String {
    stringify(&json!(needs.unwrap_or_default()))
}

/// `parseOverrides`.
fn parse_overrides(raw: Option<&str>) -> Result<Option<Value>> {
    let Some(raw) = raw.filter(|r| !r.is_empty() && *r != "{}") else {
        return Ok(None);
    };
    let parsed = parse_json(raw, "overrides")?;
    let or_empty = |key: &str| -> Result<Value> {
        Ok(match property(&parsed, key)? {
            None | Some(Value::Null) => json!({}),
            Some(v) => v.clone(),
        })
    };
    let versions = or_empty("versions")?;
    let resources = or_empty("resources")?;
    if keys_len(&versions) == 0 && keys_len(&resources) == 0 {
        return Ok(None);
    }
    Ok(Some(
        json!({ "versions": versions, "resources": resources }),
    ))
}

/// A column as text: `None` when the column is missing or NULL.
pub(crate) fn text(row: &Row<'_>, column: &str) -> Option<String> {
    match row.get::<_, Sql>(column) {
        Ok(Sql::Text(t)) => Some(t),
        Ok(Sql::Integer(n)) => Some(n.to_string()),
        Ok(Sql::Real(f)) => Some(emit_rs::js::number_to_string(
            &serde_json::Number::from_f64(f).unwrap_or_else(|| 0.into()),
        )),
        _ => None,
    }
}

pub(crate) fn non_empty(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.is_empty())
}

/// The raw columns of a `plugins` row, read before any JSON is parsed.
pub(crate) struct PluginRow {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) org_slug: String,
    pub(crate) catalog_slug: String,
    pub(crate) origin: Option<String>,
    pub(crate) description: String,
    pub(crate) tags: String,
    pub(crate) claude_config: Option<String>,
    pub(crate) needs_config: Option<String>,
    pub(crate) overrides: Option<String>,
    pub(crate) default_environment_id: Option<String>,
    pub(crate) ap_name: Option<String>,
    pub(crate) author_json: Option<String>,
    pub(crate) homepage: Option<String>,
    pub(crate) repository: Option<String>,
    pub(crate) license: Option<String>,
    pub(crate) origin_locator: Option<String>,
    pub(crate) origin_fingerprint: Option<String>,
    pub(crate) origin_fingerprint_kind: Option<String>,
    pub(crate) upstream: UpstreamRow,
    pub(crate) dirty: bool,
    pub(crate) frozen_at: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

pub(crate) fn read_plugin_row(row: &Row<'_>) -> rusqlite::Result<PluginRow> {
    let dirty = matches!(row.get::<_, Sql>("dirty"), Ok(Sql::Integer(1)))
        || matches!(row.get::<_, Sql>("dirty"), Ok(Sql::Real(f)) if f == 1.0);
    Ok(PluginRow {
        id: row.get("id")?,
        name: row.get("name")?,
        version: row.get("version")?,
        org_slug: row.get("org_slug")?,
        catalog_slug: row.get("catalog_slug")?,
        origin: text(row, "origin"),
        description: row.get("description")?,
        tags: row.get("tags")?,
        claude_config: text(row, "claude_config"),
        needs_config: text(row, "needs_config"),
        overrides: text(row, "overrides"),
        default_environment_id: text(row, "default_environment_id"),
        ap_name: text(row, "ap_name"),
        author_json: text(row, "author_json"),
        homepage: text(row, "homepage"),
        repository: text(row, "repository"),
        license: text(row, "license"),
        origin_locator: text(row, "origin_locator"),
        origin_fingerprint: text(row, "origin_fingerprint"),
        origin_fingerprint_kind: text(row, "origin_fingerprint_kind"),
        upstream: UpstreamRow {
            upstream_kind: text(row, "upstream_kind"),
            upstream_ref: text(row, "upstream_ref"),
            upstream_version_at_link: text(row, "upstream_version_at_link"),
            upstream_plugin_id: text(row, "upstream_plugin_id"),
        },
        dirty,
        frozen_at: text(row, "frozen_at"),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// `rowToPlugin`.
fn row_to_plugin(row: PluginRow) -> Result<Plugin> {
    let claude = parse_claude_config(row.claude_config.as_deref())?;
    let needs = parse_needs_config(row.needs_config.as_deref())?;
    let overrides = parse_overrides(row.overrides.as_deref())?;
    let tags: Vec<String> = serde_json::from_str(&row.tags).map_err(|e| format!("tags: {e}"))?;
    let author = match non_empty(row.author_json) {
        Some(raw) => Some(parse_json(&raw, "author_json")?),
        None => None,
    };
    let (upstream, upstream_plugin_id) = upstream_from_row(&row.upstream);
    Ok(Plugin {
        id: row.id,
        name: row.name,
        version: row.version,
        org_slug: row.org_slug,
        catalog_slug: row.catalog_slug,
        origin: row.origin.unwrap_or_else(|| "authored".to_owned()),
        description: row.description,
        tags,
        dirty: row.dirty,
        frozen_at: non_empty(row.frozen_at),
        claude,
        needs,
        overrides,
        default_environment_id: non_empty(row.default_environment_id),
        ap_name: non_empty(row.ap_name),
        author,
        homepage: non_empty(row.homepage),
        repository: non_empty(row.repository),
        license: non_empty(row.license),
        origin_locator: non_empty(row.origin_locator),
        origin_fingerprint: non_empty(row.origin_fingerprint),
        origin_fingerprint_kind: non_empty(row.origin_fingerprint_kind),
        upstream,
        upstream_plugin_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

pub(crate) fn plugin_rows<P: rusqlite::Params>(
    ctx: &Ctx,
    sql: &str,
    params: P,
) -> Result<Vec<PluginRow>> {
    let mut stmt = ctx.db.conn.prepare_cached(sql).map_err(err)?;
    let rows = stmt.query_map(params, read_plugin_row).map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

fn to_plugins(rows: Vec<PluginRow>) -> Result<Vec<Plugin>> {
    rows.into_iter().map(row_to_plugin).collect()
}

fn first_plugin(rows: Vec<PluginRow>) -> Result<Option<Plugin>> {
    rows.into_iter().next().map(row_to_plugin).transpose()
}

fn max_order(ctx: &Ctx, plugin_id: &str) -> Result<i64> {
    ctx.db
        .conn
        .query_row(
            "SELECT COALESCE(MAX(\"order\"), -1) as max_order FROM plugin_resources WHERE plugin_id = ?",
            [plugin_id],
            |r| r.get(0),
        )
        .map_err(err)
}

pub(crate) fn all_scope() -> Value {
    json!({ "kind": "all" })
}

pub(crate) fn serialize_scope(scope: &Value) -> Result<String> {
    serialize_harness_scope(scope.clone())
}

pub(crate) fn parse_scope(raw: Option<String>) -> Result<Value> {
    parse_harness_scope(raw.map_or(Value::Null, Value::String))
}

// ---------------------------------------------------------------------------
// The model

/// `isFrozenPlugin`.
pub fn is_frozen_plugin(plugin: &Plugin) -> bool {
    plugin.frozen_at.is_some()
}

/// `writePluginClaudeConfig`.
fn write_plugin_claude_config(ctx: &Ctx, plugin_id: &str, config: &Value) -> Result<()> {
    ctx.db.run(
        "UPDATE plugins SET claude_config = ?, updated_at = ? WHERE id = ?",
        params![
            serialize_claude_config(Some(config)),
            ctx.clock.now_iso(),
            plugin_id
        ],
    )?;
    Ok(())
}

/// `mergeClaudeConfig`.
fn merge_claude_config(base: Option<&Value>, next: Option<&Value>) -> Option<Value> {
    if base.is_none() && next.is_none() {
        return None;
    }
    let mut marketplaces = spread(base.and_then(|b| b.get("marketplaces")));
    marketplaces.extend(spread(next.and_then(|n| n.get("marketplaces"))));
    let mut plugin_map: Vec<(String, Value)> = Vec::new();
    for p in items(base.and_then(|b| b.get("plugins")))
        .into_iter()
        .chain(items(next.and_then(|n| n.get("plugins"))))
    {
        let key = id_key(&p);
        match plugin_map.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => slot.1 = p,
            None => plugin_map.push((key, p)),
        }
    }
    let mut out = Map::new();
    if !marketplaces.is_empty() {
        out.insert("marketplaces".into(), Value::Object(marketplaces));
    }
    if !plugin_map.is_empty() {
        out.insert(
            "plugins".into(),
            Value::Array(plugin_map.into_iter().map(|(_, p)| p).collect()),
        );
    }
    Some(Value::Object(out))
}

/// `resourceKey`.
fn resource_key(resource: &Resource) -> String {
    format!("{}:{}", resource.resource_type, resource.name)
}

/// `mergePluginsById`: later plugins override earlier ones for resources
/// (by type:name), plugin pins (by ref) and Claude config.
pub fn merge_plugins_by_id<S: AsRef<str>>(
    ctx: &Ctx,
    composition: &dyn PluginComposition,
    plugin_ids: &[S],
) -> Result<MergedPluginContent> {
    let mut plugins = Vec::new();
    let mut resources: Vec<(String, AttachedResource)> = Vec::new();
    let mut pins: Vec<PluginPin> = Vec::new();
    let mut claude: Option<Value> = None;
    for plugin_id in plugin_ids {
        let plugin_id = plugin_id.as_ref();
        let Some(plugin) = get_plugin_by_id(ctx, plugin_id)? else {
            return Err(format!("Plugin not found: {plugin_id}"));
        };
        for resource in composition.composed_plugin_resources(ctx, &plugin.id)? {
            if resource.resource.resource_type == "plugin" {
                continue;
            }
            let key = resource_key(&resource.resource);
            match resources.iter_mut().find(|(k, _)| *k == key) {
                Some(slot) => slot.1 = resource,
                None => resources.push((key, resource)),
            }
        }
        for pin in composition.composed_dependencies(ctx, &plugin.id)? {
            match pins.iter_mut().find(|p| p.reference == pin.reference) {
                Some(slot) => *slot = pin,
                None => pins.push(pin),
            }
        }
        claude = merge_claude_config(claude.as_ref(), plugin.claude.as_ref());
        plugins.push(plugin);
    }
    let from_pins = composition.claude_config_from_plugin_pins(ctx, &pins);
    claude = merge_claude_config(claude.as_ref(), from_pins.as_ref());
    Ok(MergedPluginContent {
        plugins,
        resources: resources.into_iter().map(|(_, r)| r).collect(),
        claude,
        plugin_pins: pins,
    })
}

/// `copyResourcesToPlugin`.
fn copy_resources_to_plugin(
    ctx: &Ctx,
    plugin_id: &str,
    resources: &[AttachedResource],
) -> Result<()> {
    for (order, resource) in resources.iter().enumerate() {
        let scope = resource.harness_scope.clone().unwrap_or_else(all_scope);
        ctx.db.run(
            "INSERT OR REPLACE INTO plugin_resources (plugin_id, resource_id, \"order\", harness_scope)\n       VALUES (?, ?, ?, ?)",
            params![plugin_id, resource.resource.id, order as i64, serialize_scope(&scope)?],
        )?;
    }
    Ok(())
}

/// `copyPluginCompositionFromSources`.
fn copy_plugin_composition_from_sources<S: AsRef<str>>(
    ctx: &Ctx,
    target_plugin_id: &str,
    source_plugin_ids: &[S],
) -> Result<()> {
    let mut next_order = max_order(ctx, target_plugin_id)? + 1;
    let mut seen: Vec<String> = Vec::new();
    for source in source_plugin_ids {
        let mut stmt = ctx
            .db
            .conn
            .prepare_cached(
                "SELECT r.id, r.type, r.name\n         FROM resources r\n         JOIN plugin_resources lr ON lr.resource_id = r.id\n         WHERE lr.plugin_id = ?\n         ORDER BY lr.\"order\"",
            )
            .map_err(err)?;
        let rows: Vec<(String, String)> = stmt
            .query_map([source.as_ref()], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err)?;
        for (id, kind) in rows {
            if kind != "plugin_pin" && kind != "plugin" {
                continue;
            }
            let key = format!("{kind}:{id}");
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            ctx.db.run(
                "INSERT OR IGNORE INTO plugin_resources (plugin_id, resource_id, \"order\")\n         VALUES (?, ?, ?)",
                params![target_plugin_id, id, next_order],
            )?;
            next_order += 1;
        }
    }
    Ok(())
}

/// The input of `createPlugin`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct CreatePluginInput {
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub claude: Option<Value>,
    #[serde(default)]
    pub needs: Option<Vec<String>>,
    #[serde(default)]
    pub org_slug: Option<String>,
    #[serde(default)]
    pub catalog_slug: Option<String>,
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub default_environment_id: Option<String>,
}

/// `createPlugin`.
pub fn create_plugin(ctx: &Ctx, input: &CreatePluginInput) -> Result<Plugin> {
    let now = ctx.clock.now_iso();
    let id = ctx.ids.ulid();
    let version = input.version.clone().unwrap_or_else(|| "1.0.0".to_owned());
    let origin = input
        .origin
        .clone()
        .unwrap_or_else(|| "authored".to_owned());
    let tags = input.tags.clone().unwrap_or_default();
    let claude = input.claude.as_ref().filter(|c| truthy(Some(c)));
    ctx.db.run(
        "INSERT INTO plugins (\n      id, name, version, org_slug, catalog_slug, origin, description, tags,\n      claude_config, needs_config, default_environment_id, dirty, frozen_at,\n      created_at, updated_at\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            input.name,
            version,
            input.org_slug.as_deref().unwrap_or(""),
            input.catalog_slug.as_deref().unwrap_or(""),
            origin,
            input.description.as_deref().unwrap_or(""),
            stringify(&json!(tags)),
            serialize_claude_config(claude),
            serialize_needs_config(input.needs.as_deref()),
            input.default_environment_id,
            0,
            Option::<String>::None,
            now,
            now,
        ],
    )?;
    Ok(Plugin {
        id,
        name: input.name.clone(),
        version,
        org_slug: input.org_slug.clone().unwrap_or_default(),
        catalog_slug: input.catalog_slug.clone().unwrap_or_default(),
        origin,
        description: input.description.clone().unwrap_or_default(),
        tags,
        dirty: false,
        frozen_at: None,
        claude: claude.cloned(),
        needs: input.needs.clone().filter(|n| !n.is_empty()),
        overrides: None,
        default_environment_id: non_empty(input.default_environment_id.clone()),
        ap_name: None,
        author: None,
        homepage: None,
        repository: None,
        license: None,
        origin_locator: None,
        origin_fingerprint: None,
        origin_fingerprint_kind: None,
        upstream: None,
        upstream_plugin_id: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// The input of `stampPluginOrigin`; `None` leaves a field as it is.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StampOrigin {
    pub locator: String,
    #[serde(default)]
    pub fingerprint: Option<String>,
    #[serde(default)]
    pub fingerprint_kind: Option<String>,
}

/// `stampPluginOrigin`.
pub fn stamp_plugin_origin(ctx: &Ctx, plugin_id: &str, input: &StampOrigin) -> Result<()> {
    type Current = (Option<String>, Option<String>, Option<String>);
    let current: Option<Current> = ctx
        .db
        .conn
        .query_row(
            "SELECT origin_locator, origin_fingerprint, origin_fingerprint_kind FROM plugins WHERE id = ?",
            [plugin_id],
            |r| Ok((text_at(r, 0), text_at(r, 1), text_at(r, 2))),
        )
        .optional()
        .map_err(err)?;
    let Some((locator, fingerprint, kind)) = current else {
        return Err(format!("Plugin not found: {plugin_id}"));
    };
    if locator.as_deref() == Some(input.locator.as_str())
        && (input.fingerprint.is_none() || fingerprint == input.fingerprint)
        && (input.fingerprint_kind.is_none() || kind == input.fingerprint_kind)
    {
        return Ok(());
    }
    let changes = ctx.db.run(
        "UPDATE plugins\n       SET origin_locator = ?,\n           origin_fingerprint = COALESCE(?, origin_fingerprint),\n           origin_fingerprint_kind = COALESCE(?, origin_fingerprint_kind),\n           updated_at = ?\n       WHERE id = ?",
        params![
            input.locator,
            input.fingerprint,
            input.fingerprint_kind,
            ctx.clock.now_iso(),
            plugin_id
        ],
    )?;
    if changes == 0 {
        return Err(format!("Plugin not found: {plugin_id}"));
    }
    Ok(())
}

pub(crate) fn text_at(row: &Row<'_>, i: usize) -> Option<String> {
    match row.get::<_, Sql>(i) {
        Ok(Sql::Text(t)) => Some(t),
        _ => None,
    }
}

/// `assertNoFrozenWorkingVersion`.
pub fn assert_no_frozen_working_version(ctx: &Ctx, plugin: &Plugin, version: &str) -> Result<()> {
    let frozen: Option<Option<String>> = ctx
        .db
        .conn
        .query_row(
            "SELECT id, frozen_at FROM plugins\n       WHERE org_slug = ? AND catalog_slug = ? AND name = ? AND version = ? AND id != ?",
            params![plugin.org_slug, plugin.catalog_slug, plugin.name, version, plugin.id],
            |r| Ok(text_at(r, 1)),
        )
        .optional()
        .map_err(err)?;
    if frozen.flatten().is_some_and(|f| !f.is_empty()) {
        return Err(format!(
            "Cannot bump {} to {version}: that version already exists as a frozen cut",
            plugin.name
        ));
    }
    Ok(())
}

/// `bumpPluginWorkingVersion`.
pub fn bump_plugin_working_version(ctx: &Ctx, plugin_id: &str, version: &str) -> Result<()> {
    let Some(plugin) = get_plugin_by_id(ctx, plugin_id)? else {
        return Err(format!("Plugin not found: {plugin_id}"));
    };
    assert_no_frozen_working_version(ctx, &plugin, version)?;
    ctx.db.run(
        "UPDATE plugins SET version = ?, updated_at = ? WHERE id = ?",
        params![version, ctx.clock.now_iso(), plugin_id],
    )?;
    Ok(())
}

/// `updatePluginPublishedIdentity`.
pub fn update_plugin_published_identity(
    ctx: &Ctx,
    plugin_id: &str,
    org_slug: &str,
    catalog_slug: &str,
    version: Option<&str>,
) -> Result<bool> {
    Ok(ctx.db.run(
        "UPDATE plugins\n       SET org_slug = ?, catalog_slug = ?,\n           version = COALESCE(?, version),\n           updated_at = ?\n       WHERE id = ?",
        params![org_slug, catalog_slug, version, ctx.clock.now_iso(), plugin_id],
    )? > 0)
}

/// `updatePluginCatalogIdentity`.
pub fn update_plugin_catalog_identity(
    ctx: &Ctx,
    plugin_id: &str,
    org_slug: &str,
    catalog_slug: &str,
) -> Result<bool> {
    update_plugin_published_identity(ctx, plugin_id, org_slug, catalog_slug, None)
}

/// `PluginSelector`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PluginSelector {
    Id { id: String },
    Name { name: String },
    NameVersion { name: String, constraint: String },
}

fn is_ulid_like(s: &str) -> bool {
    s.len() == 26
        && s.bytes()
            .all(|b| b.is_ascii_digit() || b.is_ascii_uppercase())
}

/// The index of the last `@`, where JS `lastIndexOf` would report one past 0.
fn last_at(s: &str) -> Option<usize> {
    s.rfind('@').filter(|&i| i > 0)
}

/// `parsePluginSelectorString`.
pub fn parse_plugin_selector_string(selector: &str) -> PluginSelector {
    if let Some(at) = last_at(selector) {
        return PluginSelector::NameVersion {
            name: selector[..at].to_owned(),
            constraint: selector[at + 1..].to_owned(),
        };
    }
    if is_ulid_like(selector) {
        return PluginSelector::Id {
            id: selector.to_owned(),
        };
    }
    PluginSelector::Name {
        name: selector.to_owned(),
    }
}

/// `getPluginById`.
pub fn get_plugin_by_id(ctx: &Ctx, id: &str) -> Result<Option<Plugin>> {
    first_plugin(plugin_rows(
        ctx,
        "SELECT * FROM plugins WHERE id = ?",
        [id],
    )?)
}

/// `sortPluginsByVersionDesc`: a comparator error counts as equal, and the
/// sort is V8's, since that comparator need not be consistent.
fn sort_plugins_by_version_desc(mut rows: Vec<PluginRow>) -> Vec<PluginRow> {
    js_sort(&mut rows, |a, b| {
        f64::from(
            semver::rcompare(a.version.as_str(), b.version.as_str(), Options::STRICT).unwrap_or(0),
        )
    });
    rows
}

/// `preferLocalPluginRows`.
fn prefer_local_plugin_rows(rows: Vec<PluginRow>) -> Vec<PluginRow> {
    if rows
        .iter()
        .any(|r| r.org_slug.is_empty() && r.catalog_slug.is_empty())
    {
        rows.into_iter()
            .filter(|r| r.org_slug.is_empty() && r.catalog_slug.is_empty())
            .collect()
    } else {
        rows
    }
}

fn plugins_named(ctx: &Ctx, name: &str) -> Result<Vec<PluginRow>> {
    plugin_rows(ctx, "SELECT * FROM plugins WHERE name = ?", [name])
}

/// `getPluginLatestByName`.
fn get_plugin_latest_by_name(ctx: &Ctx, name: &str) -> Result<Option<Plugin>> {
    let candidates = prefer_local_plugin_rows(plugins_named(ctx, name)?);
    first_plugin(sort_plugins_by_version_desc(candidates))
}

/// `getPluginByNameAndConstraint`.
fn get_plugin_by_name_and_constraint(
    ctx: &Ctx,
    name: &str,
    constraint: &str,
) -> Result<Option<Plugin>> {
    let rows = prefer_local_plugin_rows(plugins_named(ctx, name)?);
    // A stored version that is not semver is still what `name@version`
    // labels print, so match it as written first.
    let trimmed = js_trim(constraint);
    if let Some(i) = rows.iter().position(|r| r.version == trimmed) {
        return first_plugin(rows.into_iter().skip(i).take(1).collect());
    }
    parse_version_constraint(constraint)?;
    let mut matching = Vec::new();
    for row in rows {
        if satisfies_constraint(constraint, &row.version)? {
            matching.push(row);
        }
    }
    first_plugin(sort_plugins_by_version_desc(matching))
}

/// `getPlugin`.
pub fn get_plugin(ctx: &Ctx, selector: &str) -> Result<Option<Plugin>> {
    match parse_plugin_selector_string(selector) {
        PluginSelector::Id { id } => get_plugin_by_id(ctx, &id),
        PluginSelector::NameVersion { name, constraint } => {
            get_plugin_by_name_and_constraint(ctx, &name, &constraint)
        }
        PluginSelector::Name { name } => match get_plugin_latest_by_name(ctx, &name)? {
            Some(p) => Ok(Some(p)),
            None => get_plugin_by_id(ctx, selector),
        },
    }
}

/// `getPluginByName`. An empty `version` reads as no version, as in JS.
pub fn get_plugin_by_name(ctx: &Ctx, name: &str, version: Option<&str>) -> Result<Option<Plugin>> {
    match version.filter(|v| !v.is_empty()) {
        Some(version) => {
            let rows = plugin_rows(
                ctx,
                "SELECT * FROM plugins WHERE name = ? AND version = ?",
                [name, version],
            )?;
            first_plugin(prefer_local_plugin_rows(rows))
        }
        None => get_plugin_latest_by_name(ctx, name),
    }
}

/// `getPluginByPublishedIdentity`.
pub fn get_plugin_by_published_identity(
    ctx: &Ctx,
    name: &str,
    version: &str,
    org: Option<&str>,
    catalog: Option<&str>,
) -> Result<Option<Plugin>> {
    let org = org.unwrap_or("");
    let catalog = catalog.unwrap_or("");
    if !org.is_empty() || !catalog.is_empty() {
        return first_plugin(plugin_rows(
            ctx,
            "SELECT * FROM plugins\n         WHERE name = ? AND version = ? AND org_slug = ? AND catalog_slug = ?",
            [name, version, org, catalog],
        )?);
    }
    get_plugin_by_name(ctx, name, Some(version))
}

/// `getPluginByCatalogVersion`.
pub fn get_plugin_by_catalog_version(
    ctx: &Ctx,
    org: &str,
    catalog: &str,
    version: &str,
) -> Result<Option<Plugin>> {
    let rows = plugin_rows(
        ctx,
        "SELECT * FROM plugins WHERE org_slug = ? AND catalog_slug = ? AND version = ?",
        [org, catalog, version],
    )?;
    first_plugin(prefer_local_plugin_rows(rows))
}

/// `findPluginForCatalogInstall`: by slug name or origin locator, never a
/// sibling plugin that shares org/catalog/version.
pub fn find_plugin_for_catalog_install(
    ctx: &Ctx,
    org: &str,
    catalog: &str,
    plugin_slug: &str,
    version: &str,
) -> Result<Option<Plugin>> {
    let plugins = to_plugins(plugin_rows(
        ctx,
        "SELECT * FROM plugins WHERE org_slug = ? AND catalog_slug = ? AND version = ?",
        [org, catalog, version],
    )?)?;
    let locator = format!("{org}/{catalog}/{plugin_slug}");
    let by_name = plugins.iter().position(|p| p.name == plugin_slug);
    let index = by_name.or_else(|| {
        plugins
            .iter()
            .position(|p| p.origin_locator.as_deref() == Some(locator.as_str()))
    });
    Ok(index.map(|i| plugins[i].clone()))
}

/// `listLatestPublishedPluginsBySlug`.
pub fn list_latest_published_plugins_by_slug(ctx: &Ctx, slug: &str) -> Result<Vec<Plugin>> {
    let rows = plugin_rows(ctx, "SELECT * FROM plugins WHERE name = ?", [slug])?;
    let mut latest: Vec<(String, PluginRow)> = Vec::new();
    for row in rows
        .into_iter()
        .filter(|r| !r.org_slug.is_empty() || !r.catalog_slug.is_empty())
    {
        let key = format!("{}/{}", row.org_slug, row.catalog_slug);
        match latest.iter_mut().find(|(k, _)| *k == key) {
            None => latest.push((key, row)),
            Some(slot) => {
                let replace = semver::rcompare(
                    row.version.as_str(),
                    slot.1.version.as_str(),
                    Options::STRICT,
                )
                .map_or(true, |c| c > 0);
                if replace {
                    slot.1 = row;
                }
            }
        }
    }
    to_plugins(latest.into_iter().map(|(_, r)| r).collect())
}

/// `formatPublishedPluginSelector`.
pub fn format_published_plugin_selector(
    org_slug: &str,
    catalog_slug: &str,
    name: &str,
    version: &str,
) -> String {
    format!("{org_slug}/{catalog_slug}/{name}@{version}")
}

/// `isSamePublishedPluginIdentity`.
pub fn is_same_published_plugin_identity(
    plugin: &Plugin,
    org_slug: &str,
    catalog_slug: &str,
    plugin_slug: &str,
) -> bool {
    plugin.org_slug == org_slug && plugin.catalog_slug == catalog_slug && plugin.name == plugin_slug
}

/// `listPlugins`.
pub fn list_plugins(ctx: &Ctx) -> Result<Vec<Plugin>> {
    to_plugins(plugin_rows(
        ctx,
        "SELECT * FROM plugins ORDER BY name, version",
        [],
    )?)
}

/// `listPluginsAttachingResource`.
pub fn list_plugins_attaching_resource(ctx: &Ctx, resource_id: &str) -> Result<Vec<Plugin>> {
    to_plugins(plugin_rows(
        ctx,
        "SELECT p.* FROM plugins p\n       JOIN plugin_resources pr ON pr.plugin_id = p.id\n       WHERE pr.resource_id = ?\n       ORDER BY p.name, p.version",
        [resource_id],
    )?)
}

/// `deletePlugin`.
pub fn delete_plugin(ctx: &Ctx, plugin_id: &str) -> Result<bool> {
    Ok(ctx
        .db
        .run("DELETE FROM plugins WHERE id = ?", [plugin_id])?
        > 0)
}

/// `addResourceToPlugin`; `None` is `HARNESS_SCOPE_ALL`.
pub fn add_resource_to_plugin(
    ctx: &Ctx,
    plugin_id: &str,
    resource_id: &str,
    harness_scope: Option<&Value>,
) -> Result<()> {
    let order = max_order(ctx, plugin_id)? + 1;
    let scope = harness_scope.cloned().unwrap_or_else(all_scope);
    ctx.db.run(
        "INSERT OR IGNORE INTO plugin_resources (plugin_id, resource_id, \"order\", harness_scope)\n     VALUES (?, ?, ?, ?)",
        params![plugin_id, resource_id, order, serialize_scope(&scope)?],
    )?;
    Ok(())
}

/// `setPluginResourceHarnessScope`.
pub fn set_plugin_resource_harness_scope(
    ctx: &Ctx,
    plugin_id: &str,
    resource_id: &str,
    harness_scope: &Value,
) -> Result<()> {
    ctx.db.run(
        "UPDATE plugin_resources SET harness_scope = ?\n     WHERE plugin_id = ? AND resource_id = ?",
        params![serialize_scope(harness_scope)?, plugin_id, resource_id],
    )?;
    Ok(())
}

/// `getPluginResourceHarnessScope`.
pub fn get_plugin_resource_harness_scope(
    ctx: &Ctx,
    plugin_id: &str,
    resource_id: &str,
) -> Result<Value> {
    let raw: Option<String> = ctx
        .db
        .conn
        .query_row(
            "SELECT harness_scope FROM plugin_resources\n       WHERE plugin_id = ? AND resource_id = ?",
            [plugin_id, resource_id],
            |r| Ok(text_at(r, 0)),
        )
        .optional()
        .map_err(err)?
        .flatten();
    parse_scope(raw)
}

/// `removeResourceFromPlugin`.
pub fn remove_resource_from_plugin(ctx: &Ctx, plugin_id: &str, resource_id: &str) -> Result<()> {
    ctx.db.run(
        "DELETE FROM plugin_resources WHERE plugin_id = ? AND resource_id = ?",
        [plugin_id, resource_id],
    )?;
    Ok(())
}

/// `setPluginResourceOrder`, in one transaction.
pub fn set_plugin_resource_order<S: AsRef<str>>(
    ctx: &Ctx,
    plugin_id: &str,
    resource_ids: &[S],
) -> Result<()> {
    transaction(ctx, || {
        for (order, id) in resource_ids.iter().enumerate() {
            ctx.db.run(
                "UPDATE plugin_resources SET \"order\" = ? WHERE plugin_id = ? AND resource_id = ?",
                params![order as i64, plugin_id, id.as_ref()],
            )?;
        }
        Ok(())
    })
}

/// `db.transaction(fn)()`: a savepoint, so it nests like better-sqlite3's.
pub(crate) fn transaction<T>(ctx: &Ctx, f: impl FnOnce() -> Result<T>) -> Result<T> {
    ctx.db.exec("SAVEPOINT ht_tx")?;
    match f() {
        Ok(v) => {
            ctx.db.exec("RELEASE ht_tx")?;
            Ok(v)
        }
        Err(e) => {
            let _ = ctx.db.exec("ROLLBACK TO ht_tx");
            let _ = ctx.db.exec("RELEASE ht_tx");
            Err(e)
        }
    }
}

/// `touchPluginUpdatedAt`.
pub fn touch_plugin_updated_at(ctx: &Ctx, plugin_id: &str) -> Result<()> {
    ctx.db.run(
        "UPDATE plugins SET updated_at = ? WHERE id = ?",
        params![ctx.clock.now_iso(), plugin_id],
    )?;
    Ok(())
}

/// `getPluginResources` (`loadPluginResources`).
pub fn get_plugin_resources(ctx: &Ctx, plugin_id: &str) -> Result<Vec<AttachedResource>> {
    let mut stmt = ctx
        .db
        .conn
        .prepare_cached(
            "SELECT r.*, lr.\"order\", lr.harness_scope FROM resources r\n       JOIN plugin_resources lr ON lr.resource_id = r.id\n       WHERE lr.plugin_id = ?\n       ORDER BY lr.\"order\"",
        )
        .map_err(err)?;
    let rows: Vec<(Resource, Option<i64>, Option<String>)> = stmt
        .query_map([plugin_id], |row| {
            Ok((
                map_resource_row(ctx, row)?,
                row.get::<_, Option<i64>>("order")?,
                text(row, "harness_scope"),
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;
    rows.into_iter()
        .map(|(resource, order, scope)| {
            Ok(AttachedResource {
                resource,
                order,
                harness_scope: Some(parse_scope(scope)?),
            })
        })
        .collect()
}

/// `ensurePluginClaudeMarketplace`.
pub fn ensure_plugin_claude_marketplace(
    ctx: &Ctx,
    plugin: &Plugin,
    marketplace_name: &str,
    entry: &Value,
) -> Result<bool> {
    let existing = plugin
        .claude
        .as_ref()
        .and_then(|c| c.get("marketplaces"))
        .and_then(|m| m.get(marketplace_name));
    if truthy(existing) {
        return Ok(false);
    }
    let mut marketplaces = spread(plugin.claude.as_ref().and_then(|c| c.get("marketplaces")));
    marketplaces.insert(marketplace_name.to_owned(), entry.clone());
    let mut config = spread(plugin.claude.as_ref());
    config.insert("marketplaces".into(), Value::Object(marketplaces));
    write_plugin_claude_config(ctx, &plugin.id, &Value::Object(config))?;
    Ok(true)
}

/// `syncClaudeMarketplacePluginsAfterAdd`.
pub fn sync_claude_marketplace_plugins_after_add(
    ctx: &Ctx,
    plugin: &Plugin,
    reference: &str,
    version_constraint: &str,
) -> Result<()> {
    let mut plugins = items(plugin.claude.as_ref().and_then(|c| c.get("plugins")));
    let entry = json!({ "id": reference, "version": version_constraint, "enabled": true });
    match plugins
        .iter()
        .position(|p| p.get("id").and_then(Value::as_str) == Some(reference))
    {
        Some(i) => {
            let mut merged = spread(Some(&plugins[i]));
            merged.extend(spread(Some(&entry)));
            plugins[i] = Value::Object(merged);
        }
        None => plugins.push(entry),
    }
    let mut config = spread(plugin.claude.as_ref());
    config.insert("plugins".into(), Value::Array(plugins));
    write_plugin_claude_config(ctx, &plugin.id, &Value::Object(config))
}

/// `syncClaudeMarketplacePluginsAfterRemove`.
pub fn sync_claude_marketplace_plugins_after_remove(
    ctx: &Ctx,
    plugin: &Plugin,
    reference: &str,
) -> Result<()> {
    let Some(claude) = plugin.claude.as_ref() else {
        return Ok(());
    };
    let plugins: Vec<Value> = items(claude.get("plugins"))
        .into_iter()
        .filter(|p| p.get("id").and_then(Value::as_str) != Some(reference))
        .collect();
    let mut config = spread(Some(claude));
    config.insert("plugins".into(), Value::Array(plugins));
    write_plugin_claude_config(ctx, &plugin.id, &Value::Object(config))
}

/// `addDependencyToPlugin`.
pub fn add_dependency_to_plugin(
    ctx: &Ctx,
    composition: &dyn PluginComposition,
    plugin_id: &str,
    dependency_name: &str,
    version_constraint: &str,
) -> Result<()> {
    for r in composition.attached_plugin_refs(ctx, plugin_id)? {
        if r.dependency_name == dependency_name {
            remove_resource_from_plugin(ctx, plugin_id, &r.resource.resource.id)?;
        }
    }
    let constraint =
        (version_constraint != "latest" && version_constraint != "*").then_some(version_constraint);
    let resource = composition.ensure_plugin_resource(
        ctx,
        &format!("plugin:{dependency_name}"),
        constraint,
    )?;
    add_resource_to_plugin(ctx, plugin_id, &resource.id, None)
}

/// `listPluginDependencies`.
pub fn list_plugin_dependencies(
    ctx: &Ctx,
    composition: &dyn PluginComposition,
    plugin_id: &str,
) -> Result<Vec<PluginDependencyRef>> {
    Ok(composition
        .attached_plugin_refs(ctx, plugin_id)?
        .into_iter()
        .enumerate()
        .map(|(order, r)| PluginDependencyRef {
            plugin_id: plugin_id.to_owned(),
            dependency_name: r.dependency_name,
            version_constraint: r.version_constraint,
            order,
        })
        .collect())
}

/// `removeDependencyFromPlugin`.
pub fn remove_dependency_from_plugin(
    ctx: &Ctx,
    composition: &dyn PluginComposition,
    plugin_id: &str,
    dependency_name: &str,
) -> Result<bool> {
    let attached: Vec<PluginRefView> = composition
        .attached_plugin_refs(ctx, plugin_id)?
        .into_iter()
        .filter(|r| r.dependency_name == dependency_name)
        .collect();
    if attached.is_empty() {
        return Ok(false);
    }
    for r in attached {
        remove_resource_from_plugin(ctx, plugin_id, &r.resource.resource.id)?;
    }
    Ok(true)
}

/// `setPluginDefaultEnvironment`.
pub fn set_plugin_default_environment(
    ctx: &Ctx,
    plugin_id: &str,
    environment_id: Option<&str>,
) -> Result<bool> {
    Ok(ctx.db.run(
        "UPDATE plugins SET default_environment_id = ?, updated_at = ? WHERE id = ?",
        params![environment_id, ctx.clock.now_iso(), plugin_id],
    )? > 0)
}

/// `[...new Set(values)]`.
fn unique<S: AsRef<str>>(values: impl IntoIterator<Item = S>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for v in values {
        if !out.iter().any(|x| x == v.as_ref()) {
            out.push(v.as_ref().to_owned());
        }
    }
    out
}

/// `setPluginTags`.
pub fn set_plugin_tags<S: AsRef<str>>(ctx: &Ctx, plugin_id: &str, tags: &[S]) -> Result<bool> {
    let tags = unique(tags.iter().map(AsRef::as_ref));
    Ok(ctx.db.run(
        "UPDATE plugins SET tags = ?, updated_at = ? WHERE id = ?",
        params![stringify(&json!(tags)), ctx.clock.now_iso(), plugin_id],
    )? > 0)
}

/// `setPluginApName`.
pub fn set_plugin_ap_name(ctx: &Ctx, plugin_id: &str, ap_name: &str) -> Result<bool> {
    Ok(ctx.db.run(
        "UPDATE plugins SET ap_name = ?, updated_at = ? WHERE id = ?",
        params![ap_name, ctx.clock.now_iso(), plugin_id],
    )? > 0)
}

/// The input of `setPluginSpecMetadata`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecMetadata {
    #[serde(default)]
    pub author: Option<Value>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub opaque_extensions: Option<Map<String, Value>>,
}

/// `setPluginSpecMetadata`.
pub fn set_plugin_spec_metadata(ctx: &Ctx, plugin_id: &str, input: &SpecMetadata) -> Result<()> {
    let author = match &input.author {
        Some(a) if truthy(Some(a)) && keys_len(a) > 0 => stringify(a),
        _ => String::new(),
    };
    let opaque = match &input.opaque_extensions {
        Some(o) if !o.is_empty() => stringify(&Value::Object(o.clone())),
        _ => String::new(),
    };
    ctx.db.run(
        "UPDATE plugins\n     SET author_json = ?, homepage = ?, repository = ?, license = ?, opaque_extensions = ?, updated_at = ?\n     WHERE id = ?",
        params![
            author,
            input.homepage.as_deref().unwrap_or(""),
            input.repository.as_deref().unwrap_or(""),
            input.license.as_deref().unwrap_or(""),
            opaque,
            ctx.clock.now_iso(),
            plugin_id
        ],
    )?;
    Ok(())
}

/// `readPluginOpaqueExtensions`.
pub fn read_plugin_opaque_extensions(ctx: &Ctx, plugin_id: &str) -> Result<Map<String, Value>> {
    let raw: Option<String> = ctx
        .db
        .conn
        .query_row(
            "SELECT opaque_extensions FROM plugins WHERE id = ?",
            [plugin_id],
            |r| Ok(text_at(r, 0)),
        )
        .optional()
        .map_err(err)?
        .flatten();
    let Some(raw) = non_empty(raw) else {
        return Ok(Map::new());
    };
    Ok(match parse_json(&raw, "opaque_extensions")? {
        Value::Object(o) => o,
        _ => Map::new(),
    })
}

/// `resolveApName`: the stored override, or a slug of the local name.
pub fn resolve_ap_name(plugin_name: &str, ap_name: Option<&str>) -> String {
    match ap_name.filter(|a| !a.is_empty()) {
        Some(a) => a.to_owned(),
        None => name::slugify_ap_name(plugin_name),
    }
}

/// `updatePluginName`.
pub fn update_plugin_name(ctx: &Ctx, plugin_id: &str, name: &str) -> Result<bool> {
    Ok(ctx.db.run(
        "UPDATE plugins SET name = ?, updated_at = ? WHERE id = ?",
        params![name, ctx.clock.now_iso(), plugin_id],
    )? > 0)
}

/// `updatePluginDescription`.
pub fn update_plugin_description(ctx: &Ctx, plugin_id: &str, description: &str) -> Result<bool> {
    Ok(ctx.db.run(
        "UPDATE plugins SET description = ?, updated_at = ? WHERE id = ?",
        params![description, ctx.clock.now_iso(), plugin_id],
    )? > 0)
}

/// The input of `createPluginFromSources`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FromSourcesInput {
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub source_plugin_ids: Vec<String>,
    #[serde(default)]
    pub environment_id: Option<String>,
}

/// `createPluginFromSources`.
pub fn create_plugin_from_sources(
    ctx: &Ctx,
    composition: &dyn PluginComposition,
    input: &FromSourcesInput,
) -> Result<Plugin> {
    let environment_id = non_empty(input.environment_id.clone());
    if input.source_plugin_ids.is_empty() {
        return create_plugin(
            ctx,
            &CreatePluginInput {
                name: input.name.clone(),
                version: input.version.clone(),
                description: input.description.clone(),
                default_environment_id: environment_id,
                ..CreatePluginInput::default()
            },
        );
    }
    if let [source_id] = input.source_plugin_ids.as_slice() {
        if source_id.is_empty() {
            return Err("sourcePluginIds must include at least one plugin id".to_owned());
        }
        let Some(source) = get_plugin_by_id(ctx, source_id)? else {
            return Err(format!("Plugin not found: {source_id}"));
        };
        let version = input.version.as_deref().unwrap_or(&source.version);
        if input.name == source.name && version == source.version {
            if let Some(env) = environment_id.as_deref() {
                set_plugin_default_environment(ctx, source_id, Some(env))?;
            }
            return get_plugin_by_id(ctx, source_id)?
                .ok_or_else(|| format!("Plugin {source_id} not found after update"));
        }
    }
    let merged = merge_plugins_by_id(ctx, composition, &input.source_plugin_ids)?;
    let tags = unique(merged.plugins.iter().flat_map(|p| p.tags.iter()));
    let needs = unique(merged.plugins.iter().flat_map(|p| p.needs.iter().flatten()));
    let description = input
        .description
        .clone()
        .or_else(|| merged.plugins.first().map(|p| p.description.clone()))
        .unwrap_or_default();
    let plugin = create_plugin(
        ctx,
        &CreatePluginInput {
            name: input.name.clone(),
            version: input.version.clone(),
            description: Some(description),
            tags: Some(tags),
            claude: merged.claude.clone(),
            needs: (!needs.is_empty()).then_some(needs),
            default_environment_id: environment_id,
            ..CreatePluginInput::default()
        },
    )?;
    copy_resources_to_plugin(ctx, &plugin.id, &merged.resources)?;
    copy_plugin_composition_from_sources(ctx, &plugin.id, &input.source_plugin_ids)?;
    get_plugin_by_id(ctx, &plugin.id)?
        .ok_or_else(|| format!("Plugin {} not found after merge create", plugin.id))
}

/// `resolvePluginSelector`.
pub fn resolve_plugin_selector(ctx: &Ctx, selector: &str) -> Result<Option<Plugin>> {
    if is_ulid_like(selector) {
        return get_plugin_by_id(ctx, selector);
    }
    if let Some(at) = last_at(selector) {
        return get_plugin_by_name(ctx, &selector[..at], Some(&selector[at + 1..]));
    }
    if let Some(p) = get_plugin_by_name(ctx, selector, None)? {
        return Ok(Some(p));
    }
    if selector == "default"
        && let Some(p) = get_plugin_by_name(ctx, "global default", None)?
    {
        return Ok(Some(p));
    }
    get_plugin(ctx, selector)
}

/// `listPluginVersions`: every local version for a name, newest first.
pub fn list_plugin_versions(ctx: &Ctx, name: &str) -> Result<Vec<String>> {
    let mut stmt = ctx
        .db
        .conn
        .prepare_cached("SELECT version FROM plugins WHERE name = ?")
        .map_err(err)?;
    let versions: Vec<String> = stmt
        .query_map([name], |r| r.get(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(err)?
        .into_iter()
        .filter(|v| !v.is_empty() && v != "unknown")
        .collect();
    let valid = |v: &String| semver::valid(v.as_str(), Options::STRICT).is_some();
    let mut semver_versions: Vec<String> = versions.iter().filter(|v| valid(v)).cloned().collect();
    js_sort(&mut semver_versions, |a, b| {
        f64::from(semver::rcompare(a.as_str(), b.as_str(), Options::STRICT).unwrap_or(0))
    });
    semver_versions.extend(versions.into_iter().filter(|v| !valid(v)));
    Ok(semver_versions)
}
