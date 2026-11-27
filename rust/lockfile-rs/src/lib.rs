//! `src/services/lockfile.ts`: the `apm.lock.yaml` HarnessTap writes after an apply, read back
//! to pin versions and to check the deployed tree.
//!
//! The plugin model is not ported yet, so the plugin lookups the original makes
//! (`getPluginById`, `getPluginResources`, and the two helpers it feeds them to) come in through
//! [`PluginLookup`]. The clock and `PACKAGE_VERSION` are parameters.
//!
//! Replayed against recordings of the TypeScript by `tests/make-fixtures.ts`.

#![forbid(unsafe_code)]

mod deployed;
pub mod export;
mod read;
mod write;

use std::collections::HashMap;

use models_rs::resource::Resource;
use resolve_rs::resource_resolution::{resolution_key, resource_fingerprint};
use resolve_rs::types::{DependencySourceKind, ResolutionResult, SelectedPlugin};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub use deployed::{
    DeployedFile, DeployedHashIssue, IssueKind, diff_deployed_file_hashes,
    verify_deployed_file_hashes,
};
pub use read::read_lockfile;
pub use write::{lockfile_document, write_lockfile};

/// `APM_LOCKFILE_FILENAME`.
pub const APM_LOCKFILE_FILENAME: &str = "apm.lock.yaml";
/// `LOCKFILE_VERSION`.
pub const LOCKFILE_VERSION: &str = "1";

/// What the original throws.
#[derive(Debug)]
pub enum LockError {
    /// A plain `Error`: the file is not a mapping, or its version is unsupported.
    Invalid(String),
    /// The `YAMLParseError` of the `yaml` package, or input yaml-rs does not support.
    Yaml(yaml_rs::YamlError),
    /// `LockIntegrityError`.
    Integrity(String),
    /// A `TypeError` the original throws by accident: `null` metadata on an `env_var` or
    /// `mcp_server` resource, or a lock path named like an `Object.prototype` property.
    Type(&'static str),
    /// A file system error.
    Io(std::io::Error),
}

impl std::fmt::Display for LockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(m) | Self::Integrity(m) => f.write_str(m),
            Self::Yaml(e) => write!(f, "{e:?}"),
            Self::Type(m) => f.write_str(m),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for LockError {}

/// `LockSource`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LockSource {
    Local,
    Marketplace,
    Git,
    Catalog,
}

impl LockSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Marketplace => "marketplace",
            Self::Git => "git",
            Self::Catalog => "catalog",
        }
    }
}

/// `ExecStatus` from `executable-trust.ts`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecStatus {
    Deployed,
    GatedPendingApproval,
    Denied,
    Absent,
}

impl ExecStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Deployed => "deployed",
            Self::GatedPendingApproval => "gated_pending_approval",
            Self::Denied => "denied",
            Self::Absent => "absent",
        }
    }

    /// `parseExecStatus`.
    pub fn parse(value: &Value) -> Option<Self> {
        match value.as_str()? {
            "deployed" => Some(Self::Deployed),
            "gated_pending_approval" => Some(Self::GatedPendingApproval),
            "denied" => Some(Self::Denied),
            "absent" => Some(Self::Absent),
            _ => None,
        }
    }
}

/// `LockEntry`. `Some("")` and `None` differ: the original keeps an empty string it was given.
#[derive(Clone, Debug, PartialEq)]
pub struct LockEntry {
    pub name: String,
    pub version: String,
    pub source: LockSource,
    /// Hash over the plugin's attached resource fingerprints.
    pub integrity: String,
    /// A JavaScript number: a hand-edited file can make it fractional or `NaN`.
    pub depth: f64,
    /// Dependency path from the root that selected this version.
    pub path: Vec<String>,
    pub repo_url: Option<String>,
    pub resolved_commit: Option<String>,
    pub resolved_ref: Option<String>,
    pub constraint: Option<String>,
    pub resolved_tag: Option<String>,
    pub virtual_path: Option<String>,
    pub content_hash: Option<String>,
    pub exec_status: Option<ExecStatus>,
    pub declared_license: Option<String>,
}

/// `LockMcpServer`. Built from resources, the fields carry whatever truthy metadata value the
/// resource had; read from a file, only strings.
#[derive(Clone, Debug, PartialEq)]
pub struct LockMcpServer {
    pub name: String,
    pub transport: Option<Value>,
    pub command: Option<Value>,
    pub url: Option<Value>,
}

/// `Lockfile`.
#[derive(Clone, Debug, PartialEq)]
pub struct Lockfile {
    pub root: String,
    pub resolved_at: String,
    /// Hash over the resolved `type:name` to fingerprint map, for drift detection.
    pub resource_map_hash: String,
    pub plugins: Vec<LockEntry>,
    pub environment: Option<String>,
    pub mcp_servers: Option<Vec<LockMcpServer>>,
    /// Path to hash, in the key order of the JavaScript object.
    pub deployed_file_hashes: Option<Vec<(String, String)>>,
}

/// `ApmGitLockFields`.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct ApmGitLockFields {
    pub name: String,
    pub repo_url: String,
    pub resolved_commit: String,
    #[serde(default)]
    pub resolved_ref: Option<String>,
    #[serde(default)]
    pub constraint: Option<String>,
    #[serde(default)]
    pub resolved_tag: Option<String>,
    #[serde(default)]
    pub virtual_path: Option<String>,
    #[serde(default)]
    pub declared_license: Option<String>,
}

/// `LockfileFromResolutionExtras`. The maps are looked up by plugin name; the original indexes
/// plain objects, so a plugin named like an `Object.prototype` member would read that member.
/// Plugin names never are.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LockfileExtras {
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub deployed_files: Option<Vec<DeployedFile>>,
    #[serde(default)]
    pub git_locks: Option<Vec<ApmGitLockFields>>,
    #[serde(default)]
    pub exec_statuses: Option<HashMap<String, ExecStatus>>,
    #[serde(default)]
    pub declared_licenses: Option<HashMap<String, String>>,
}

/// The fields of a plugin row that `gitFieldsForPlugin` reads.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PluginOrigin {
    pub origin_locator: Option<String>,
    pub origin_fingerprint: Option<String>,
    pub origin_fingerprint_kind: Option<String>,
}

/// What `recoverOriginLocator` returns, as far as the lockfile cares.
#[derive(Clone, Debug, PartialEq)]
pub enum OriginLocator {
    Git {
        url: String,
        git_ref: Option<String>,
    },
    Other,
}

/// The plugin model and the origin helpers, not ported yet.
pub trait PluginLookup {
    /// `getPluginById`, reduced to its origin fields.
    fn plugin(&self, plugin_id: &str) -> Option<PluginOrigin>;
    /// `getPluginResources`.
    fn plugin_resources(&self, plugin_id: &str) -> Vec<Resource>;
    /// `recoverOriginLocator(getPluginById(pluginId))`, for a plugin that exists.
    fn recover_origin_locator(&self, plugin_id: &str) -> Option<OriginLocator>;
    /// `canonicalApmRepoUrl`.
    fn canonical_apm_repo_url(&self, url: &str) -> String;
}

/// `sha256Envelope`.
pub fn sha256_envelope(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("sha256:{hex}")
}

/// `canonicalizeText`.
pub(crate) fn canonicalize_text(content: &str) -> String {
    content.replace("\r\n", "\n")
}

/// `lockfilePath`.
pub fn lockfile_path(project_root: &str) -> String {
    db_rs::paths::posix_join(&[project_root, APM_LOCKFILE_FILENAME])
}

/// `Array.prototype.sort()` with no comparator: UTF-16 code unit order.
pub(crate) fn sort_utf16(items: &mut [String]) {
    items.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
}

const NULL_METADATA: &str = "null is not an object (evaluating 'metadata')";

fn fingerprint_entries(resources: &[Resource]) -> Result<String, LockError> {
    let mut entries = resources
        .iter()
        .map(|r| {
            let key = resolution_key(r).map_err(|_| LockError::Type(NULL_METADATA))?;
            Ok(format!("{key}={}", resource_fingerprint(r)))
        })
        .collect::<Result<Vec<_>, LockError>>()?;
    sort_utf16(&mut entries);
    Ok(sha256_envelope(&entries.join("\n")))
}

/// `resourceMapHash`.
pub fn resource_map_hash(resources: &[Resource]) -> Result<String, LockError> {
    fingerprint_entries(resources)
}

/// `pluginIntegrity`.
pub fn plugin_integrity(lookup: &dyn PluginLookup, plugin_id: &str) -> Result<String, LockError> {
    fingerprint_entries(&lookup.plugin_resources(plugin_id))
}

fn lock_source(plugin: &SelectedPlugin) -> LockSource {
    match plugin.source {
        DependencySourceKind::Local => LockSource::Local,
        DependencySourceKind::Marketplace => LockSource::Marketplace,
        DependencySourceKind::Git => LockSource::Git,
        DependencySourceKind::Catalog => LockSource::Catalog,
    }
}

fn non_empty(s: Option<&String>) -> Option<String> {
    s.filter(|s| !s.is_empty()).cloned()
}

/// `gitFieldsForPlugin`: `(repo_url, resolved_commit, resolved_ref)`.
fn git_fields(
    lookup: &dyn PluginLookup,
    plugin_id: &str,
) -> (Option<String>, Option<String>, Option<String>) {
    let Some(plugin) = lookup.plugin(plugin_id) else {
        return (None, None, None);
    };
    let locator = lookup.recover_origin_locator(plugin_id);
    let repo_url = match &locator {
        Some(OriginLocator::Git { url, .. }) => Some(lookup.canonical_apm_repo_url(url)),
        _ => non_empty(plugin.origin_locator.as_ref()),
    }
    .filter(|u| !u.is_empty());
    let commit = (plugin.origin_fingerprint_kind.as_deref() == Some("git_sha"))
        .then(|| non_empty(plugin.origin_fingerprint.as_ref()))
        .flatten();
    let pinned = match &locator {
        Some(OriginLocator::Git { git_ref, .. }) => git_ref.clone(),
        _ => None,
    };
    let resolved_ref = commit.as_ref().map(|c| pinned.unwrap_or_else(|| c.clone()));
    (repo_url, commit, resolved_ref)
}

/// `mergeGitLockFields`.
fn merge_git_lock_fields(entry: LockEntry, extras: Option<&[ApmGitLockFields]>) -> LockEntry {
    let Some(extra) = extras.and_then(|e| e.iter().find(|i| i.name == entry.name)) else {
        return entry;
    };
    let declared = non_empty(extra.declared_license.as_ref());
    LockEntry {
        source: LockSource::Git,
        repo_url: Some(extra.repo_url.clone()),
        resolved_commit: Some(extra.resolved_commit.clone()),
        resolved_ref: extra.resolved_ref.clone(),
        constraint: extra.constraint.clone(),
        resolved_tag: extra.resolved_tag.clone(),
        virtual_path: extra.virtual_path.clone(),
        declared_license: declared.or(entry.declared_license.clone()),
        ..entry
    }
}

/// `mcpServersFromResources`.
fn mcp_servers_from_resources(resources: &[Resource]) -> Result<Vec<LockMcpServer>, LockError> {
    resources
        .iter()
        .filter(|r| r.resource_type == "mcp_server")
        .map(|r| {
            let field = |name: &str| match &r.metadata {
                Value::Object(map) => map.get(name).filter(|v| emit_rs::js::truthy(v)).cloned(),
                _ => None,
            };
            if r.metadata.is_null() {
                return Err(LockError::Type(NULL_METADATA));
            }
            Ok(LockMcpServer {
                name: r.name.clone(),
                transport: field("transport"),
                command: field("command"),
                url: field("url"),
            })
        })
        .collect()
}

/// `lockfileFromResolution`, with `new Date().toISOString()` passed in as `now`.
pub fn lockfile_from_resolution(
    result: &ResolutionResult,
    extras: &LockfileExtras,
    lookup: &dyn PluginLookup,
    now: &str,
) -> Result<Lockfile, LockError> {
    let mcp_servers = mcp_servers_from_resources(&result.resources)?;
    let deployed = extras
        .deployed_files
        .as_deref()
        .map(deployed::deployed_file_hashes);
    let resource_map_hash = resource_map_hash(&result.resources)?;
    let git_locks = extras.git_locks.as_deref();
    let plugins = result
        .selected
        .iter()
        .filter(|p| p.depth > 0.0)
        .map(|plugin| {
            let integrity = plugin_integrity(lookup, &plugin.plugin_id)?;
            let declared = match extras
                .declared_licenses
                .as_ref()
                .and_then(|m| m.get(&plugin.name))
            {
                Some(d) => Some(d.clone()),
                None => git_locks
                    .and_then(|l| l.iter().find(|i| i.name == plugin.name))
                    .and_then(|i| i.declared_license.clone()),
            };
            let (repo_url, resolved_commit, resolved_ref) = git_fields(lookup, &plugin.plugin_id);
            let entry = LockEntry {
                name: plugin.name.clone(),
                version: plugin.version.clone(),
                source: lock_source(plugin),
                integrity: integrity.clone(),
                depth: plugin.depth,
                path: plugin.path.clone(),
                repo_url,
                resolved_commit,
                resolved_ref,
                constraint: None,
                resolved_tag: None,
                virtual_path: None,
                content_hash: Some(integrity),
                exec_status: extras
                    .exec_statuses
                    .as_ref()
                    .and_then(|m| m.get(&plugin.name))
                    .copied(),
                declared_license: non_empty(declared.as_ref()),
            };
            Ok(merge_git_lock_fields(entry, git_locks))
        })
        .collect::<Result<Vec<_>, LockError>>()?;
    Ok(Lockfile {
        root: result.root.name.clone(),
        resolved_at: now.to_owned(),
        resource_map_hash,
        plugins,
        environment: non_empty(extras.environment.as_ref()),
        mcp_servers: (!mcp_servers.is_empty()).then_some(mcp_servers),
        deployed_file_hashes: deployed.filter(|d| !d.is_empty()),
    })
}

/// `new Map(entries)`: one entry per key, at its first position, holding the last value.
fn js_map<'a>(entries: impl Iterator<Item = (&'a str, &'a str)>) -> Vec<(&'a str, &'a str)> {
    let mut out: Vec<(&str, &str)> = Vec::new();
    for (key, value) in entries {
        match out.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => slot.1 = value,
            None => out.push((key, value)),
        }
    }
    out
}

fn resolved_by_name(result: &ResolutionResult) -> Vec<(&str, &str)> {
    js_map(
        result
            .selected
            .iter()
            .filter(|p| p.depth > 0.0)
            .map(|p| (p.name.as_str(), p.version.as_str())),
    )
}

fn locked_by_name(lock: &Lockfile) -> Vec<(&str, &str)> {
    js_map(
        lock.plugins
            .iter()
            .map(|e| (e.name.as_str(), e.version.as_str())),
    )
}

fn lookup<'a>(map: &[(&str, &'a str)], key: &str) -> Option<&'a str> {
    map.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

/// `lockedVersionsFrom`, as the entries of the `Map`.
pub fn locked_versions_from(lock: &Lockfile) -> Vec<(String, String)> {
    locked_by_name(lock)
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v.to_owned()))
        .collect()
}

/// `lockfileMatchesResolution`.
pub fn lockfile_matches_resolution(
    lock: &Lockfile,
    result: &ResolutionResult,
) -> Result<bool, LockError> {
    if lock.root != result.root.name {
        return Ok(false);
    }
    if lock.resource_map_hash != resource_map_hash(&result.resources)? {
        return Ok(false);
    }
    let resolved = resolved_by_name(result);
    if resolved.len() != lock.plugins.len() {
        return Ok(false);
    }
    Ok(lock
        .plugins
        .iter()
        .all(|e| lookup(&resolved, &e.name) == Some(e.version.as_str())))
}

/// `lockIsUsable`: every locked plugin is still available at the locked version.
pub fn lock_is_usable(lock: &Lockfile, root_name: &str) -> bool {
    lock.root == root_name && lock.plugins.iter().all(|e| !e.version.is_empty())
}

/// One entry of `LockDrift.changes`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LockChange {
    pub name: String,
    pub locked: String,
    pub resolved: String,
}

/// `LockDrift`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LockDrift {
    pub drift: bool,
    pub root: String,
    pub changes: Vec<LockChange>,
    pub added: Vec<String>,
    /// Always empty: the original filters the locked names by `lockedByName.has`.
    pub removed: Vec<String>,
}

/// `compareLockToResolution`.
pub fn compare_lock_to_resolution(
    lock: &Lockfile,
    result: &ResolutionResult,
) -> Result<LockDrift, LockError> {
    let locked = locked_by_name(lock);
    let resolved = resolved_by_name(result);
    let changes: Vec<LockChange> = locked
        .iter()
        .filter_map(|(name, locked)| {
            let resolved = lookup(&resolved, name)?;
            (resolved != *locked).then(|| LockChange {
                name: (*name).to_owned(),
                locked: (*locked).to_owned(),
                resolved: resolved.to_owned(),
            })
        })
        .collect();
    let added: Vec<String> = resolved
        .iter()
        .filter(|(name, _)| lookup(&locked, name).is_none())
        .map(|(name, _)| (*name).to_owned())
        .collect();
    let resource_drift = lock.resource_map_hash != resource_map_hash(&result.resources)?;
    Ok(LockDrift {
        drift: !changes.is_empty() || !added.is_empty() || resource_drift,
        root: lock.root.clone(),
        changes,
        added,
        removed: Vec::new(),
    })
}
