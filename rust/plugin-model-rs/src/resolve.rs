//! The port of `src/services/resolve/dependency-graph.ts` (pass 1), `resolve/index.ts`
//! (`resolveComposition`) and the database side of `resolve/resource-resolution.ts`
//! (`resolveResources`, pass 2). The pure parts (mediation, errors, keys) come from `resolve-rs`.
//!
//! With them, what they read: `getPluginOverrides` (`plugin-overrides.ts`), `parsePluginSelector`
//! (`plugin-selector.ts`), `harness-scope-graph.ts`, `findKnownMarketplace` and
//! `isLocalFilesystemSource` (`marketplace-registry.ts`) and `wellKnownMarketplaceEntry`
//! (`builtin-marketplaces.ts`).
//!
//! Errors are [`ResolveError`]: a plain `Error` by its message, or the original's
//! `UnsatisfiableConstraintError` and `SingletonConflictError` with their fields.

use crate::claude_pins::parse_plugin_ref;
use crate::composition::ensure_plugin_resource;
use crate::dependency::is_host_plugin_pin_resource;
use crate::extends::{get_composed_plugin_resources, list_composed_dependencies};
use crate::git_constraint::is_git_ref_constraint;
use crate::{
    AttachedResource, CreatePluginInput, Plugin, add_resource_to_plugin, all_scope, create_plugin,
    delete_plugin, err, get_plugin_by_id, get_plugin_by_name, get_plugin_by_published_identity,
    get_plugin_resources, list_plugin_versions, resolve_plugin_selector,
};
use db_rs::paths::harnesstap_dir;
use harness_scope_rs::js::sort as js_sort;
use harness_scope_rs::port::{intersect_harness_scopes, union_harness_scopes};
use indexmap::IndexMap;
use models_rs::resource::Resource;
use models_rs::{Ctx, Result};
use node_semver_rs::{self as semver, Options};
use platforms_rs::{ResourceClass, resource_class};
use resolve_rs::resource_resolution::{resolution_key, resource_fingerprint};
use resolve_rs::types::{
    ConstraintRecord, DependencySourceKind, ResolutionResult, ResolutionRoot, ResolveError,
    ResourceDecision, ResourceDecisionReason, ResourceSide, SelectedPlugin, SelectionReason,
    SingletonConflictError, UnsatisfiableConstraintError, UnsatisfiableInput,
    preview_conflict_content,
};
use resolve_rs::version_mediation::{SelectInput, select_version};
use rusqlite::OptionalExtension;
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet, VecDeque};

type Resolved<T> = std::result::Result<T, ResolveError>;

// --- plugin-overrides.ts ---

/// `PluginOverrides`: plugin name to version, and `type:name` to the winning plugin name or
/// resource id. Values keep the JSON the column holds.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct PluginOverrides {
    pub versions: Map<String, Value>,
    pub resources: Map<String, Value>,
}

impl PluginOverrides {
    /// `overrides.versions[name]`, when it is a string.
    fn version(&self, name: &str) -> Option<String> {
        self.versions
            .get(name)
            .and_then(Value::as_str)
            .map(str::to_owned)
    }
}

/// `getPluginOverrides`. A `versions` or `resources` that is not an object reads as `{}`.
pub fn get_plugin_overrides(ctx: &Ctx, plugin_id: &str) -> Result<PluginOverrides> {
    let raw: Option<Option<String>> = ctx
        .db
        .conn
        .query_row(
            "SELECT overrides FROM plugins WHERE id = ?",
            [plugin_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(raw) = raw.flatten().filter(|r| !r.is_empty() && r != "{}") else {
        return Ok(PluginOverrides::default());
    };
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| format!("overrides: {e}"))?;
    if parsed.is_null() {
        return Err("null is not an object (evaluating 'parsed.versions')".to_owned());
    }
    let field = |key: &str| match parsed.get(key) {
        Some(Value::Object(m)) => m.clone(),
        _ => Map::new(),
    };
    Ok(PluginOverrides {
        versions: field("versions"),
        resources: field("resources"),
    })
}

// --- plugin-selector.ts ---

/// `ParsedPluginSelector`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "scope", rename_all = "lowercase")]
pub enum ParsedPluginSelector {
    Local {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        version: Option<String>,
    },
    Published {
        org: String,
        catalog: String,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        version: Option<String>,
    },
}

const INVALID_SELECTOR_MESSAGE: &str =
    "Invalid plugin selector. Use name, name@version, or org/catalog/name[@version].";

fn split_version_from_segment(segment: &str) -> Result<(String, Option<String>)> {
    match segment.rfind('@') {
        _ if segment.is_empty() => Err(INVALID_SELECTOR_MESSAGE.to_owned()),
        Some(0) => Err(INVALID_SELECTOR_MESSAGE.to_owned()),
        Some(at) if at + 1 == segment.len() => Err(INVALID_SELECTOR_MESSAGE.to_owned()),
        Some(at) => Ok((segment[..at].to_owned(), Some(segment[at + 1..].to_owned()))),
        None => Ok((segment.to_owned(), None)),
    }
}

/// `parsePluginSelector`.
pub fn parse_plugin_selector(selector: &str) -> Result<ParsedPluginSelector> {
    let trimmed = emit_rs::js::trim(selector);
    if trimmed.is_empty() {
        return Err(INVALID_SELECTOR_MESSAGE.to_owned());
    }
    if !trimmed.contains('/') {
        let (name, version) = split_version_from_segment(trimmed)?;
        return Ok(ParsedPluginSelector::Local { name, version });
    }
    let segments: Vec<&str> = trimmed.split('/').filter(|p| !p.is_empty()).collect();
    let [org, catalog, last] = segments[..] else {
        return Err(INVALID_SELECTOR_MESSAGE.to_owned());
    };
    let (name, version) = split_version_from_segment(last)?;
    Ok(ParsedPluginSelector::Published {
        org: org.to_owned(),
        catalog: catalog.to_owned(),
        name,
        version,
    })
}

// --- marketplace-registry.ts, builtin-marketplaces.ts ---

const CURSOR_PUBLIC_MARKETPLACE: &str = "cursor-public";
const CURSOR_PUBLIC_GIT_URL: &str = "https://github.com/cursor/plugins.git";

/// `WELL_KNOWN_CLAUDE_MARKETPLACES`.
const WELL_KNOWN_CLAUDE_MARKETPLACES: [(&str, &str); 15] = [
    (
        "claude-plugins-official",
        "https://github.com/anthropics/claude-plugins-official.git",
    ),
    (
        "karpathy-skills",
        "https://github.com/forrestchang/andrej-karpathy-skills.git",
    ),
    (
        "addy-agent-skills",
        "https://github.com/addyosmani/agent-skills.git",
    ),
    (
        "agentic-awesome-skills",
        "https://github.com/sickn33/agentic-awesome-skills.git",
    ),
    (
        "cc-dev-tools",
        "https://github.com/Lucklyric/cc-dev-tools.git",
    ),
    (
        "claude-code-workflows",
        "https://github.com/wshobson/agents.git",
    ),
    (
        "claude-orchestration",
        "https://github.com/TheLobbi/claude.git",
    ),
    ("ecc", "https://github.com/affaan-m/ECC.git"),
    (
        "fullstack-dev-skills",
        "https://github.com/Jeffallan/claude-skills.git",
    ),
    ("impeccable", "https://github.com/pbakaus/impeccable.git"),
    (
        "llm-council",
        "https://github.com/hey-yvan/llm-council-plugin.git",
    ),
    ("mempalace", "https://github.com/MemPalace/mempalace.git"),
    ("slidev-plugins", "https://github.com/slidevjs/slidev.git"),
    ("thedotmack", "https://github.com/thedotmack/claude-mem.git"),
    (
        "ui-ux-pro-max-skill",
        "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git",
    ),
];

/// `isLocalFilesystemSource`: a marketplace URL that is a path on this machine.
pub fn is_local_filesystem_source(value: &str) -> bool {
    let b = value.as_bytes();
    ["file:", "/", "./", "../", "~/"]
        .iter()
        .any(|p| value.starts_with(p))
        || (b.len() >= 3
            && b[0].is_ascii_alphabetic()
            && b[1] == b':'
            && matches!(b[2], b'\\' | b'/'))
}

/// The URL of `findKnownMarketplace(dir, name) ?? wellKnownMarketplaceEntry(name)`.
fn known_marketplace_url(ctx: &Ctx, name: &str) -> Option<String> {
    let registered = settings_rs::load_settings(&harnesstap_dir(ctx.env))
        .marketplaces
        .into_iter()
        .find(|e| e.name == name)
        .map(|e| e.url);
    registered
        .or_else(|| (name == CURSOR_PUBLIC_MARKETPLACE).then(|| CURSOR_PUBLIC_GIT_URL.to_owned()))
        .or_else(|| {
            WELL_KNOWN_CLAUDE_MARKETPLACES
                .iter()
                .find(|(n, _)| *n == name)
                .map(|(_, url)| (*url).to_owned())
        })
}

// --- harness-scope-graph.ts ---

/// `applyIncomingHarnessScope`.
pub fn apply_incoming_harness_scope(
    resources: Vec<AttachedResource>,
    incoming: &Value,
) -> Result<Vec<AttachedResource>> {
    if incoming["kind"] == "all" {
        return Ok(resources);
    }
    resources
        .into_iter()
        .map(|mut r| {
            let own = r.harness_scope.take().unwrap_or_else(all_scope);
            r.harness_scope = Some(intersect_harness_scopes(own, incoming.clone())?);
            Ok(r)
        })
        .collect()
}

/// `incomingScopeByPluginId`: a nested plugin materializes on the intersection of its own
/// memberships and the scope of the ref that attaches it.
pub fn incoming_scope_by_plugin_id(
    ctx: &Ctx,
    plugin_ids: &[String],
) -> Result<HashMap<String, Value>> {
    let mut incoming = HashMap::new();
    if let Some(root) = plugin_ids.first().filter(|r| !r.is_empty()) {
        incoming.insert(root.clone(), all_scope());
    }
    for plugin_id in plugin_ids {
        let parent = incoming.get(plugin_id).cloned().unwrap_or_else(all_scope);
        for resource in get_composed_plugin_resources(ctx, plugin_id)? {
            if resource.resource.resource_type != "plugin" {
                continue;
            }
            let Some(child) = resolve_plugin_selector(ctx, &resource.resource.name)? else {
                continue;
            };
            if !plugin_ids.contains(&child.id) {
                continue;
            }
            let own = resource.harness_scope.unwrap_or_else(all_scope);
            let next = intersect_harness_scopes(parent.clone(), own)?;
            let merged = match incoming.get(&child.id) {
                Some(existing) => union_harness_scopes(existing.clone(), next)?,
                None => next,
            };
            incoming.insert(child.id, merged);
        }
    }
    Ok(incoming)
}

// --- dependency-graph.ts ---

/// Safety valve: the fixpoint converges in far fewer passes in practice.
const MAX_PASSES: usize = 64;

fn label(name: &str, version: &str) -> String {
    format!("{name}@{version}")
}

/// A git dependency pinned to a commit, tag or branch does not narrow mediation (#500).
fn mediation_constraint(kind: Option<DependencySourceKind>, constraint: &str) -> String {
    if constraint.is_empty()
        || (kind == Some(DependencySourceKind::Git) && is_git_ref_constraint(Some(constraint)))
    {
        return "*".to_owned();
    }
    constraint.to_owned()
}

fn unsatisfiable_missing(
    name: &str,
    root_name: &str,
    source_kind: Option<DependencySourceKind>,
    plugin_ref: Option<&str>,
    requirers: Vec<ConstraintRecord>,
    available: Vec<String>,
) -> ResolveError {
    UnsatisfiableConstraintError::new(UnsatisfiableInput {
        plugin_name: name.to_owned(),
        requirers,
        available,
        root_name: root_name.to_owned(),
        source_kind,
        plugin_ref: plugin_ref.filter(|r| !r.is_empty()).map(str::to_owned),
        root_override: None,
    })
    .into()
}

fn published_versions(ctx: &Ctx, name: &str, org: &str, catalog: &str) -> Result<Vec<String>> {
    let mut stmt = ctx
        .db
        .conn
        .prepare_cached(
            "SELECT version FROM plugins\n           WHERE name = ? AND org_slug = ? AND catalog_slug = ?",
        )
        .map_err(err)?;
    let mut versions: Vec<String> = stmt
        .query_map([name, org, catalog], |r| r.get(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(err)?
        .into_iter()
        .filter(|v| semver::valid(v.as_str(), Options::STRICT).is_some())
        .collect();
    js_sort(&mut versions, |a, b| {
        f64::from(semver::rcompare(a.as_str(), b.as_str(), Options::STRICT).unwrap_or(0))
    });
    Ok(versions)
}

/// `listAvailableVersions`: anything the selector path throws falls back to the bare name.
fn list_available_versions(ctx: &Ctx, dependency_name: &str) -> Result<Vec<String>> {
    let tried = match parse_plugin_selector(dependency_name) {
        Ok(ParsedPluginSelector::Published {
            org, catalog, name, ..
        }) => published_versions(ctx, &name, &org, &catalog),
        Ok(ParsedPluginSelector::Local { name, .. }) => list_plugin_versions(ctx, &name),
        Err(e) => Err(e),
    };
    tried.or_else(|_| list_plugin_versions(ctx, dependency_name))
}

/// `resolveDependencyVersion`.
fn resolve_dependency_version(
    ctx: &Ctx,
    dependency_name: &str,
    version: &str,
) -> Result<Option<Plugin>> {
    let tried = match parse_plugin_selector(dependency_name) {
        Ok(ParsedPluginSelector::Published {
            org, catalog, name, ..
        }) => get_plugin_by_published_identity(ctx, &name, version, Some(&org), Some(&catalog)),
        Ok(ParsedPluginSelector::Local { name, .. }) => {
            get_plugin_by_name(ctx, &name, Some(version))
        }
        Err(e) => Err(e),
    };
    tried.or_else(|_| get_plugin_by_name(ctx, dependency_name, Some(version)))
}

struct WalkFrame {
    plugin_id: String,
    label: String,
    path: Vec<String>,
    depth: usize,
}

/// `DependencyWalk`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyWalk {
    /// Root first, then dependencies ordered by depth then declaration index.
    pub selected: Vec<SelectedPlugin>,
    pub root_label: String,
}

fn by_depth_then_declaration(a: &SelectedPlugin, b: &SelectedPlugin) -> std::cmp::Ordering {
    a.depth
        .total_cmp(&b.depth)
        .then(a.declaration_index.total_cmp(&b.declaration_index))
}

/// `walkDependencyGraph`: unify every plugin name to one version, running to a fixed point
/// (each pass expands with the previous pass's selections, then selects again from every
/// constraint it found). `locked` pins versions from a lockfile.
pub fn walk_dependency_graph(
    ctx: &Ctx,
    root_plugin_id: &str,
    locked: Option<&HashMap<String, String>>,
) -> Resolved<DependencyWalk> {
    let root = get_plugin_by_id(ctx, root_plugin_id)?
        .ok_or_else(|| format!("Plugin not found: {root_plugin_id}"))?;
    let root_label = label(&root.name, &root.version);
    let overrides = get_plugin_overrides(ctx, &root.id)?;
    let locked_version = |name: &str| locked.and_then(|m| m.get(name)).cloned();
    let mut previous: IndexMap<String, String> = IndexMap::new();

    for pass in 0..MAX_PASSES {
        let mut constraints: IndexMap<String, Vec<ConstraintRecord>> = IndexMap::new();
        let mut depths: HashMap<String, usize> = HashMap::new();
        let mut declaration_indexes: HashMap<String, usize> = HashMap::new();
        let mut shortest_paths: HashMap<String, Vec<String>> = HashMap::new();
        let mut source_kinds: HashMap<String, Option<DependencySourceKind>> = HashMap::new();
        let mut visited = HashSet::from([root.id.clone()]);
        let mut queue = VecDeque::from([WalkFrame {
            plugin_id: root.id.clone(),
            label: root_label.clone(),
            path: vec![root_label.clone()],
            depth: 0,
        }]);

        while let Some(frame) = queue.pop_front() {
            for dependency in list_composed_dependencies(ctx, &frame.plugin_id)? {
                let name = dependency.name;
                // An unknown kind behaves like `local` everywhere the original reads it.
                let kind: Option<DependencySourceKind> =
                    serde_json::from_value(dependency.source_kind).ok();
                source_kinds.entry(name.clone()).or_insert(kind);
                let Value::String(raw) = &dependency.version_constraint else {
                    return Err(ResolveError::Message(
                        "dependency.version_constraint.trim is not a function".to_owned(),
                    ));
                };
                let mediated = mediation_constraint(kind, raw);
                let declared = emit_rs::js::trim(raw);
                let bucket = constraints.entry(name.clone()).or_default();
                bucket.push(ConstraintRecord {
                    declared: (kind == Some(DependencySourceKind::Git)
                        && !declared.is_empty()
                        && mediated != declared)
                        .then(|| declared.to_owned()),
                    constraint: mediated,
                    path: frame.path.clone(),
                    requirer: frame.label.clone(),
                });
                let bucket = bucket.clone();

                let depth = frame.depth + 1;
                if depths.get(&name).is_none_or(|&known| depth < known) {
                    depths.insert(name.clone(), depth);
                    shortest_paths.insert(name.clone(), frame.path.clone());
                }
                let next_index = declaration_indexes.len() + 1;
                declaration_indexes
                    .entry(name.clone())
                    .or_insert(next_index);

                let provisional =
                    match locked_version(&name).or_else(|| previous.get(&name).cloned()) {
                        Some(version) => version,
                        None => {
                            select_version(&SelectInput {
                                name: name.clone(),
                                available: list_available_versions(ctx, &name)?,
                                constraints: bucket.clone(),
                                root_override: overrides.version(&name),
                                root_name: root.name.clone(),
                                source_kind: kind,
                                plugin_ref: Some(dependency.reference.clone()),
                            })?
                            .0
                        }
                    };

                let Some(resolved) = resolve_dependency_version(ctx, &name, &provisional)? else {
                    return Err(unsatisfiable_missing(
                        &name,
                        &root.name,
                        kind,
                        Some(&dependency.reference),
                        bucket,
                        list_available_versions(ctx, &name)?,
                    ));
                };
                if visited.insert(resolved.id.clone()) {
                    let child = label(&name, &provisional);
                    let mut path = frame.path.clone();
                    path.push(child.clone());
                    queue.push_back(WalkFrame {
                        plugin_id: resolved.id,
                        label: child,
                        path,
                        depth,
                    });
                }
            }
        }

        let mut current: IndexMap<String, String> = IndexMap::new();
        let mut reasons: HashMap<String, SelectionReason> = HashMap::new();
        for (name, records) in &constraints {
            if let Some(version) = locked_version(name) {
                current.insert(name.clone(), version);
                reasons.insert(name.clone(), SelectionReason::Locked);
                continue;
            }
            let (version, reason) = select_version(&SelectInput {
                name: name.clone(),
                available: list_available_versions(ctx, name)?,
                constraints: records.clone(),
                root_override: overrides.version(name),
                root_name: root.name.clone(),
                source_kind: source_kinds.get(name).copied().flatten(),
                plugin_ref: None,
            })?;
            current.insert(name.clone(), version);
            reasons.insert(name.clone(), reason);
        }

        let stable = current.len() == previous.len()
            && current.iter().all(|(n, v)| previous.get(n) == Some(v));
        previous = current;
        if !stable && pass < MAX_PASSES - 1 {
            continue;
        }
        if !stable {
            return Err(ResolveError::Message(
                "Dependency resolution did not converge. This usually means a version cycle; run `ht plugin show <plugin>` to inspect the dependency list.".to_owned(),
            ));
        }

        let mut selected = vec![SelectedPlugin {
            name: root.name.clone(),
            version: root.version.clone(),
            plugin_id: root.id.clone(),
            depth: 0.0,
            declaration_index: 0.0,
            constraints: Vec::new(),
            reason: SelectionReason::Root,
            path: vec![root_label.clone()],
            source: DependencySourceKind::Local,
        }];
        for (name, version) in &previous {
            let kind = source_kinds.get(name).copied().flatten();
            let records = constraints.get(name).cloned().unwrap_or_default();
            let Some(plugin) = resolve_dependency_version(ctx, name, version)? else {
                return Err(unsatisfiable_missing(
                    name,
                    &root.name,
                    kind,
                    None,
                    records,
                    list_available_versions(ctx, name)?,
                ));
            };
            selected.push(SelectedPlugin {
                name: name.clone(),
                version: version.clone(),
                plugin_id: plugin.id,
                depth: depths.get(name).copied().unwrap_or(1) as f64,
                declaration_index: declaration_indexes
                    .get(name)
                    .map_or(9_007_199_254_740_991.0, |&i| i as f64),
                constraints: records,
                reason: reasons
                    .get(name)
                    .copied()
                    .unwrap_or(SelectionReason::Mediation),
                path: shortest_paths
                    .get(name)
                    .cloned()
                    .unwrap_or_else(|| vec![root_label.clone()]),
                source: kind.unwrap_or(DependencySourceKind::Local),
            });
        }
        selected.sort_by(by_depth_then_declaration);
        return Ok(DependencyWalk {
            selected,
            root_label,
        });
    }
    Err(ResolveError::Message(
        "Dependency resolution did not converge".to_owned(),
    ))
}

// --- resource-resolution.ts ---

/// `ResolveResourcesResult`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ResolvedResources {
    pub resources: Vec<AttachedResource>,
    pub decisions: Vec<ResourceDecision>,
    pub warnings: Vec<String>,
}

struct Candidate {
    resource: AttachedResource,
    side: ResourceSide,
    declaration_index: f64,
    resource_index: usize,
}

fn to_side(plugin: &SelectedPlugin, resource: &Resource) -> ResourceSide {
    ResourceSide {
        plugin_name: plugin.name.clone(),
        plugin_version: plugin.version.clone(),
        depth: plugin.depth,
        resource_id: Some(resource.id.clone()),
        source: Some(resource.source.clone()),
        namespace: Some(resource.namespace.clone()),
        fingerprint: Some(resource_fingerprint(resource)),
        preview: Some(preview_conflict_content(&resource.content)),
    }
}

/// `resolveResources`: one material resource per resolution key. `declaration_order_singletons`
/// (ephemeral roots) lets the last declared singleton win an equal-depth tie instead of failing.
pub fn resolve_resources(
    ctx: &Ctx,
    selected: &[SelectedPlugin],
    overrides: &PluginOverrides,
    root_name: &str,
    declaration_order_singletons: bool,
) -> Resolved<ResolvedResources> {
    let mut ordered: Vec<&SelectedPlugin> = selected.iter().collect();
    ordered.sort_by(|a, b| by_depth_then_declaration(a, b));
    let ids: Vec<String> = ordered.iter().map(|p| p.plugin_id.clone()).collect();
    let incoming = incoming_scope_by_plugin_id(ctx, &ids)?;

    let mut candidates: IndexMap<String, Vec<Candidate>> = IndexMap::new();
    for plugin in ordered {
        let scope = incoming
            .get(&plugin.plugin_id)
            .cloned()
            .unwrap_or_else(all_scope);
        let attached = apply_incoming_harness_scope(
            get_composed_plugin_resources(ctx, &plugin.plugin_id)?,
            &scope,
        )?;
        for (resource_index, resource) in attached.into_iter().enumerate() {
            if resource_class(&resource.resource.resource_type).is_none() {
                continue;
            }
            let key = resolution_key(&resource.resource)
                .map_err(|_| "null is not an object (evaluating 'metadata.key')".to_owned())?;
            candidates.entry(key).or_default().push(Candidate {
                side: to_side(plugin, &resource.resource),
                resource,
                declaration_index: plugin.declaration_index,
                resource_index,
            });
        }
    }

    let mut out = ResolvedResources {
        resources: Vec::new(),
        decisions: Vec::new(),
        warnings: Vec::new(),
    };
    for (key, bucket) in candidates {
        let mut decide = |winner: usize, reason: ResourceDecisionReason| {
            out.resources.push(bucket[winner].resource.clone());
            out.decisions.push(ResourceDecision {
                key: key.clone(),
                winner: bucket[winner].side.clone(),
                losers: bucket
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != winner)
                    .map(|(_, c)| c.side.clone())
                    .collect(),
                reason,
            });
        };

        let override_value = overrides.resources.get(&key).and_then(Value::as_str);
        if let Some(value) = override_value.filter(|v| !v.is_empty())
            && let Some(chosen) = bucket
                .iter()
                .position(|c| c.resource.resource.id == value)
                .or_else(|| bucket.iter().position(|c| c.side.plugin_name == value))
        {
            decide(chosen, ResourceDecisionReason::RootOverride);
            continue;
        }

        if bucket.len() == 1 {
            decide(0, ResourceDecisionReason::OnlyCandidate);
            continue;
        }

        let min_depth = bucket
            .iter()
            .map(|c| c.side.depth)
            .fold(f64::INFINITY, f64::min);
        let shallowest: Vec<usize> = (0..bucket.len())
            .filter(|&i| bucket[i].side.depth == min_depth)
            .collect();
        if let [only] = shallowest[..] {
            decide(only, ResourceDecisionReason::NearestToRoot);
            continue;
        }

        let mut fingerprints = HashSet::new();
        let unique: Vec<usize> = shallowest
            .iter()
            .copied()
            .filter(|&i| fingerprints.insert(bucket[i].side.fingerprint.clone()))
            .collect();
        if let [only] = unique[..] {
            decide(only, ResourceDecisionReason::IdenticalContent);
            continue;
        }

        let first_type = &bucket[unique[0]].resource.resource.resource_type;
        if resource_class(first_type) == Some(ResourceClass::Singleton)
            && !declaration_order_singletons
        {
            return Err(ResolveError::SingletonConflict(Box::new(
                SingletonConflictError::new(
                    &key,
                    unique.iter().map(|&i| bucket[i].side.clone()).collect(),
                    root_name,
                ),
            )));
        }

        // Equal depth, differing content: the last declared wins.
        let mut sorted = shallowest.clone();
        sorted.sort_by(|&a, &b| {
            bucket[a]
                .declaration_index
                .total_cmp(&bucket[b].declaration_index)
                .then(bucket[a].resource_index.cmp(&bucket[b].resource_index))
        });
        let winner = sorted[sorted.len() - 1];
        let names: Vec<&str> = shallowest
            .iter()
            .map(|&i| bucket[i].side.plugin_name.as_str())
            .collect();
        let warning = format!(
            "{key} is declared by {} at the same depth with different content; {} wins because it is declared last.",
            names.join(" and "),
            bucket[winner].side.plugin_name
        );
        decide(winner, ResourceDecisionReason::DeclarationOrder);
        out.warnings.push(warning);
    }
    Ok(out)
}

// --- index.ts ---

/// Prefix for synthesized roots. Never persisted beyond one resolution.
pub const EPHEMERAL_PREFIX: &str = "__ht_ephemeral_root__";

/// Upstream plugins that a marketplace dependency edge installed: plugin name to the ref it was
/// installed from and whether that marketplace is a local folder.
fn marketplace_upstream_refs(
    ctx: &Ctx,
    selected: &[SelectedPlugin],
) -> Result<HashMap<String, (String, bool)>> {
    let mut refs = HashMap::new();
    let mut locality: HashMap<String, Option<bool>> = HashMap::new();
    for plugin in selected {
        if plugin.depth == 0.0 || plugin.source != DependencySourceKind::Marketplace {
            continue;
        }
        let Some(locator) = get_plugin_by_id(ctx, &plugin.plugin_id)?
            .and_then(|p| p.origin_locator)
            .filter(|l| l.contains('@'))
        else {
            continue;
        };
        let marketplace = parse_plugin_ref(&locator).1.to_owned();
        let local = *locality.entry(marketplace.clone()).or_insert_with(|| {
            known_marketplace_url(ctx, &marketplace)
                .map(|url| emit_rs::js::trim(&url).to_owned())
                .filter(|url| !url.is_empty())
                .map(|url| is_local_filesystem_source(&url))
        });
        if let Some(local) = local {
            refs.insert(plugin.name.clone(), (locator, local));
        }
    }
    Ok(refs)
}

/// `appendHostPluginPins`: each plugin's own host pin (`name@marketplace`) and the pins of
/// marketplace upstreams join the material set; a remote marketplace upstream applies to
/// Claude Code only.
fn append_host_plugin_pins(
    ctx: &Ctx,
    selected: &[SelectedPlugin],
    mut resources: Vec<AttachedResource>,
) -> Result<Vec<AttachedResource>> {
    let mut seen: HashSet<String> = resources.iter().map(|r| r.resource.id.clone()).collect();
    let upstream_refs = marketplace_upstream_refs(ctx, selected)?;
    for plugin in selected {
        if plugin.name.starts_with(EPHEMERAL_PREFIX) {
            continue;
        }
        for mut attached in get_plugin_resources(ctx, &plugin.plugin_id)? {
            let resource = &attached.resource;
            let own_pin = resource.name == plugin.name;
            let upstream = (resource.resource_type == "plugin")
                .then(|| upstream_refs.get(&resource.name))
                .flatten();
            let marketplace_edge = upstream.is_some_and(|(r, _)| *r == resource.origin_ref);
            if (!own_pin && !marketplace_edge)
                || !resource.origin_ref.contains('@')
                || !is_host_plugin_pin_resource(resource)
                || !seen.insert(resource.id.clone())
            {
                continue;
            }
            if !own_pin && upstream.is_some_and(|(_, local)| !local) {
                let own = attached.harness_scope.take().unwrap_or_else(all_scope);
                attached.harness_scope = Some(intersect_harness_scopes(
                    own,
                    json!({ "kind": "subset", "harnesses": ["claude-code"] }),
                )?);
            }
            resources.push(attached);
        }
    }
    Ok(resources)
}

/// `Date.now()` from the clock's ISO time.
fn now_millis(ctx: &Ctx) -> i64 {
    let iso = ctx.clock.now_iso();
    let n = |a: usize, b: usize| {
        iso.get(a..b)
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0)
    };
    let (month, day) = (n(5, 7), n(8, 10));
    let year = n(0, 4) - i64::from(month <= 2);
    // days_from_civil (Howard Hinnant)
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let doy = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    days * 86_400_000 + n(11, 13) * 3_600_000 + n(14, 16) * 60_000 + n(17, 19) * 1000 + n(20, 23)
}

/// `createEphemeralRoot`: a root that attaches each selector. The original's six random base-36
/// characters come from a fresh ULID here.
fn create_ephemeral_root(ctx: &Ctx, selectors: &[String]) -> Result<String> {
    let random = ctx.ids.ulid().to_ascii_lowercase();
    let name = format!(
        "{EPHEMERAL_PREFIX}{}_{}",
        now_millis(ctx),
        &random[random.len().saturating_sub(6)..]
    );
    let root = create_plugin(
        ctx,
        &CreatePluginInput {
            name,
            version: Some("0.0.0".to_owned()),
            ..CreatePluginInput::default()
        },
    )?;
    for selector in selectors {
        let Some(target) = resolve_plugin_selector(ctx, selector)? else {
            delete_plugin(ctx, &root.id)?;
            return Err(format!("Plugin not found: {selector}"));
        };
        let reference = ensure_plugin_resource(
            ctx,
            &format!("plugin:{}", target.name),
            Some(&target.version),
            None,
        )?;
        add_resource_to_plugin(ctx, &root.id, &reference.id, None)?;
    }
    Ok(root.id)
}

/// `resolveComposition`: pass 1 unifies every plugin name to one version, pass 2 keeps one
/// resource per `type:name`. One selector is the root; several are attached to a synthesized
/// root that is deleted afterwards. `locked` pins versions from a lockfile.
pub fn resolve_composition(
    ctx: &Ctx,
    root_selectors: &[String],
    locked: Option<&HashMap<String, String>>,
) -> Resolved<ResolutionResult> {
    let (root_plugin_id, ephemeral) = match root_selectors {
        [single] => (
            resolve_plugin_selector(ctx, single)?
                .ok_or_else(|| format!("Plugin not found: {single}"))?
                .id,
            false,
        ),
        [] => {
            return Err(ResolveError::Message(
                "Provide at least one plugin to resolve.".to_owned(),
            ));
        }
        many => (create_ephemeral_root(ctx, many)?, true),
    };
    let result = resolve_root(ctx, &root_plugin_id, ephemeral, locked);
    if ephemeral {
        // The synthesized root exists only for the duration of one resolution.
        ctx.db
            .run("DELETE FROM plugins WHERE id = ?", [&root_plugin_id])?;
    }
    result
}

fn resolve_root(
    ctx: &Ctx,
    root_plugin_id: &str,
    ephemeral: bool,
    locked: Option<&HashMap<String, String>>,
) -> Resolved<ResolutionResult> {
    let root = get_plugin_by_id(ctx, root_plugin_id)?
        .ok_or_else(|| format!("Plugin not found: {root_plugin_id}"))?;
    let overrides = get_plugin_overrides(ctx, &root.id)?;
    let walk = walk_dependency_graph(ctx, root_plugin_id, locked)?;
    let pass2 = resolve_resources(ctx, &walk.selected, &overrides, &root.name, ephemeral)?;
    Ok(ResolutionResult {
        root: ResolutionRoot {
            name: root.name,
            version: root.version,
            plugin_id: root.id,
            ephemeral,
        },
        resources: append_host_plugin_pins(ctx, &walk.selected, pass2.resources)?,
        selected: walk.selected,
        decisions: pass2.decisions,
        warnings: pass2.warnings,
    })
}
