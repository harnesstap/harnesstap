//! `services/plugin-dependency.ts` and `utils/plugin-dependency-ref.ts`, plus
//! `isHostPluginPinResource` split out of `services/host-plugin-serialize.ts`
//! (the rest of that file needs the platform registry and the package cache).

use models_rs::Ctx;
use models_rs::resource::{
    ConflictPolicy, Resource, UpsertResourceInput, UpsertResult, find_resource_by_key,
    upsert_resource,
};
use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::versioning::mark_plugin_dirty;
use crate::{
    AttachedResource, Result, add_resource_to_plugin, get_plugin_by_id, get_plugin_resources,
    remove_resource_from_plugin,
};

/// `ParsedDependencyRef`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ParsedDependencyRef {
    pub name: String,
    pub source_kind: &'static str,
    pub origin_ref: String,
    pub namespace: String,
}

const GIT_PREFIXES: [&str; 7] = [
    "http://", "https://", "file://", "git://", "git@", "ssh://", "git+",
];

/// The last non-empty `/` segment, as `split("/").filter(Boolean).pop()`.
fn last_segment(s: &str) -> Option<&str> {
    s.split('/').rfind(|p| !p.is_empty())
}

/// `parseDependencyRef`.
pub fn parse_dependency_ref(reference: &str) -> ParsedDependencyRef {
    let trimmed = emit_rs::js::trim(reference);
    let parsed = |name: &str, source_kind, namespace: &str| ParsedDependencyRef {
        name: name.to_owned(),
        source_kind,
        origin_ref: trimmed.to_owned(),
        namespace: namespace.to_owned(),
    };

    if GIT_PREFIXES.iter().any(|p| trimmed.starts_with(p)) {
        let tail = last_segment(trimmed).unwrap_or(trimmed);
        let stripped = tail.strip_suffix(".git").unwrap_or(tail);
        let name = stripped.rsplit(':').next().unwrap_or(stripped);
        return parsed(name, "git", "");
    }

    if trimmed.starts_with("./") || trimmed.starts_with("../") {
        return parsed(last_segment(trimmed).unwrap_or(trimmed), "local", "");
    }

    let slash_parts: Vec<&str> = trimmed.split('/').collect();
    if let [org, catalog, name] = slash_parts[..]
        && !org.is_empty()
        && !catalog.is_empty()
        && !name.is_empty()
    {
        return parsed(name, "catalog", &format!("{org}/{catalog}"));
    }

    if let Some(at) = trimmed.rfind('@').filter(|&at| at > 0) {
        return parsed(&trimmed[..at], "marketplace", &trimmed[at + 1..]);
    }

    parsed(trimmed, "local", "")
}

/// `isHostPluginPinResource` (from `host-plugin-serialize.ts`).
pub fn is_host_plugin_pin_resource(resource: &Resource) -> bool {
    if resource.resource_type != "plugin" {
        return false;
    }
    let kind = &resource.metadata["source_kind"];
    if kind == "catalog" {
        return false;
    }
    kind == "marketplace" || kind == "local" || resource.origin_ref.contains('@')
}

/// `DependencyView`. `source_kind` and `version_constraint` come straight
/// from the metadata JSON, so they keep whatever type it holds.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DependencyView {
    pub name: String,
    pub source_kind: Value,
    #[serde(rename = "ref")]
    pub reference: String,
    pub version_constraint: Value,
    pub embed_on_export: bool,
    pub resource: AttachedResource,
}

fn dependency_namespace(parsed: &ParsedDependencyRef, constraint: Option<&str>) -> String {
    match constraint.filter(|c| !c.is_empty()) {
        None => parsed.namespace.clone(),
        Some(c) if parsed.namespace.is_empty() => c.to_owned(),
        Some(c) => format!("{}#{c}", parsed.namespace),
    }
}

/// `ensureDependencyResource`. `portable` defaults to `reference`.
pub fn ensure_dependency_resource(
    ctx: &Ctx,
    reference: &str,
    version_constraint: Option<&str>,
    portable: Option<&str>,
) -> Result<Resource> {
    let parsed = parse_dependency_ref(reference);
    let version_constraint = version_constraint.filter(|c| !c.is_empty());
    let namespace = dependency_namespace(&parsed, version_constraint);

    if let Some(existing) = find_resource_by_key(ctx, "plugin", &parsed.name, &namespace)? {
        return Ok(existing);
    }

    let mut metadata = Map::new();
    metadata.insert("source_kind".into(), json!(parsed.source_kind));
    if !parsed.namespace.is_empty() {
        metadata.insert("marketplace_name".into(), json!(parsed.namespace));
    }
    if let Some(c) = version_constraint {
        metadata.insert("version_constraint".into(), json!(c));
    }
    metadata.insert("sync_status".into(), json!("never_synced"));
    metadata.insert("portable".into(), json!(portable.unwrap_or("reference")));

    let input = UpsertResourceInput {
        resource_type: "plugin".into(),
        name: parsed.name.clone(),
        namespace,
        description: format!("Dependency: {reference}"),
        content: "{}".into(),
        metadata: Value::Object(metadata),
        source: "composition:plugin".into(),
        origin_kind: if parsed.source_kind == "local" {
            "manual"
        } else {
            "marketplace_link"
        }
        .into(),
        origin_ref: parsed.origin_ref,
    };
    match upsert_resource(ctx, &input, Some(ConflictPolicy::Overwrite), None)? {
        UpsertResult::Skipped { .. } => Err(format!("Failed to create dependency: {reference}")),
        UpsertResult::Created { resource }
        | UpsertResult::Unchanged { resource }
        | UpsertResult::Updated { resource } => Ok(resource),
    }
}

/// Options of `addDependency`. `mark_dirty` is false when the dependency is
/// part of the plugin as published (a package import building a fresh plugin).
#[derive(Debug, Clone, Default)]
pub struct AddDependencyOptions<'a> {
    pub version_constraint: Option<&'a str>,
    pub embed_on_export: bool,
    pub mark_dirty: Option<bool>,
}

/// `addDependency`.
pub fn add_dependency(
    ctx: &Ctx,
    plugin_id: &str,
    reference: &str,
    opts: &AddDependencyOptions,
) -> Result<Resource> {
    if opts.mark_dirty != Some(false) {
        mark_plugin_dirty(ctx, plugin_id)?;
    }
    let resource = ensure_dependency_resource(
        ctx,
        reference,
        opts.version_constraint,
        opts.embed_on_export.then_some("embed"),
    )?;
    add_resource_to_plugin(ctx, plugin_id, &resource.id, None)?;
    Ok(resource)
}

/// `dependenciesFromResources`.
pub fn dependencies_from_resources(resources: &[AttachedResource]) -> Vec<DependencyView> {
    resources
        .iter()
        .filter(|r| r.resource.resource_type == "plugin")
        .map(|attached| {
            let r = &attached.resource;
            let metadata = &r.metadata;
            let or_default = |key: &str, default: &str| match &metadata[key] {
                Value::Null => json!(default),
                v => v.clone(),
            };
            DependencyView {
                name: r.name.clone(),
                source_kind: or_default("source_kind", "local"),
                reference: if r.origin_ref.is_empty() {
                    r.name.clone()
                } else {
                    r.origin_ref.clone()
                },
                version_constraint: or_default("version_constraint", ""),
                embed_on_export: metadata["portable"] == "embed",
                resource: attached.clone(),
            }
        })
        .collect()
}

/// `listDependencies`: drops the host plugin pin named like the plugin.
pub fn list_dependencies(ctx: &Ctx, plugin_id: &str) -> Result<Vec<DependencyView>> {
    let plugin = get_plugin_by_id(ctx, plugin_id)?;
    let resources = get_plugin_resources(ctx, plugin_id)?;
    Ok(dependencies_from_resources(&resources)
        .into_iter()
        .filter(|d| match &plugin {
            None => true,
            Some(p) => !(d.name == p.name && is_host_plugin_pin_resource(&d.resource.resource)),
        })
        .collect())
}

/// `removeDependency`.
pub fn remove_dependency(ctx: &Ctx, plugin_id: &str, name_or_ref: &str) -> Result<bool> {
    let parsed = parse_dependency_ref(name_or_ref);
    let found = list_dependencies(ctx, plugin_id)?
        .into_iter()
        .find(|d| d.name == parsed.name || d.reference == name_or_ref);
    let Some(found) = found else {
        return Ok(false);
    };
    mark_plugin_dirty(ctx, plugin_id)?;
    remove_resource_from_plugin(ctx, plugin_id, &found.resource.resource.id)?;
    Ok(true)
}
