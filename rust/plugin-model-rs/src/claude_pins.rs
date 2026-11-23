//! `services/claude-plugin-pins.ts`, `plugins/claude-plugin-ref.ts`,
//! `utils/home-root.ts`, and the reads they make of Claude's own files
//! (`installed_plugins.json` and the configured marketplaces, from
//! `plugins/claude-installed.ts` and `services/marketplace-manifest-cache.ts`).
//!
//! The host reads go through [`ClaudeHost`]; [`FsClaudeHost`] reads the files.
//! Nothing is cached: the original caches per status computation and keeps a
//! marketplace manifest cache keyed by mtime and size.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::{PluginPin, Result};

/// The Claude state a pin resolves against.
pub trait ClaudeHost {
    /// `listInstalledRefScopes`: `(ref, scope)` of each install; `None` is a
    /// record without a `scope`.
    fn installed_ref_scopes(&self, home_root: &str) -> Result<Vec<(String, Option<Value>)>>;
    /// `listConfiguredMarketplaceNames`.
    fn configured_marketplace_names(&self, home_root: &str) -> Result<Vec<String>>;
    /// `readCachedMarketplacePluginNames` of one marketplace manifest.
    fn marketplace_plugin_names(
        &self,
        home_root: &str,
        marketplace: &str,
    ) -> Option<HashSet<String>>;
}

/// `CATALOG_AUTHOR_MARKETPLACES`.
const CATALOG_AUTHOR_MARKETPLACES: [(&str, &[&str]); 3] = [
    ("anthropics", &["claude-plugins-official"]),
    ("obra", &["claude-plugins-official", "superpowers-dev"]),
    ("multica-ai", &["karpathy-skills"]),
];

/// `CATALOG_PLUGIN_INSTALL_HINTS`: install refs, then `(name, repo)` marketplaces.
type InstallHint = (
    &'static str,
    &'static [&'static str],
    &'static [(&'static str, &'static str)],
);
const CATALOG_PLUGIN_INSTALL_HINTS: [InstallHint; 4] = [
    (
        "superpowers",
        &[
            "superpowers@claude-plugins-official",
            "superpowers@superpowers-dev",
        ],
        &[],
    ),
    ("context7", &["context7@claude-plugins-official"], &[]),
    (
        "security-guidance",
        &["security-guidance@claude-plugins-official"],
        &[],
    ),
    (
        "andrej-karpathy-skills",
        &["andrej-karpathy-skills@karpathy-skills"],
        &[("karpathy-skills", "forrestchang/andrej-karpathy-skills")],
    ),
];

const DEFAULT_MARKETPLACES: &[&str] = &["claude-plugins-official"];

/// Keys every JS object answers to through `Object.prototype`. A marketplace
/// named like one makes `CATALOG_AUTHOR_MARKETPLACES[marketplace]` a function
/// or an object, and iterating it throws.
const OBJECT_PROTOTYPE_KEYS: [&str; 12] = [
    "constructor",
    "__proto__",
    "toString",
    "toLocaleString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
];

fn hint(name: &str) -> Option<&'static InstallHint> {
    CATALOG_PLUGIN_INSTALL_HINTS.iter().find(|h| h.0 == name)
}

/// `resolveHomeRoot`: `HOME`, else `USERPROFILE`, else the OS home directory.
pub fn resolve_home_root(env: &dyn db_rs::paths::Env) -> String {
    env.var("HOME")
        .or_else(|| env.var("USERPROFILE"))
        .or_else(|| std::env::home_dir().map(|p| p.to_string_lossy().into_owned()))
        .unwrap_or_default()
}

/// `parsePluginRef` (`host-plugin-manifest.ts`): `(name, marketplace)`.
pub fn parse_plugin_ref(reference: &str) -> (&str, &str) {
    match reference.rfind('@') {
        Some(at) if at > 0 => (&reference[..at], &reference[at + 1..]),
        _ => (reference, ""),
    }
}

/// `claudePluginsDir`.
pub fn claude_plugins_dir(home_root: &str) -> PathBuf {
    Path::new(home_root).join(".claude").join("plugins")
}

fn add_candidate(ordered: &mut Vec<String>, candidate: String) {
    if !ordered.contains(&candidate) {
        ordered.push(candidate);
    }
}

/// `resolveClaudeInstallRefCandidates`: candidate install refs, best match first.
pub fn resolve_claude_install_ref_candidates(
    host: &dyn ClaudeHost,
    reference: &str,
    home_root: &str,
) -> Result<Vec<String>> {
    let (name, marketplace) = parse_plugin_ref(reference);
    let mut ordered = Vec::new();
    if let Some(h) = hint(name) {
        for candidate in h.1 {
            add_candidate(&mut ordered, (*candidate).to_owned());
        }
    }
    add_candidate(&mut ordered, reference.to_owned());
    if !marketplace.is_empty() {
        if OBJECT_PROTOTYPE_KEYS.contains(&marketplace) {
            return Err(format!("{marketplace} is not iterable"));
        }
        let aliases = CATALOG_AUTHOR_MARKETPLACES
            .iter()
            .find(|(author, _)| *author == marketplace)
            .map_or(DEFAULT_MARKETPLACES, |(_, aliases)| *aliases);
        for alias in aliases {
            add_candidate(&mut ordered, format!("{name}@{alias}"));
        }
    }
    for local in host.configured_marketplace_names(home_root)? {
        if host
            .marketplace_plugin_names(home_root, &local)
            .is_some_and(|names| names.contains(name))
        {
            add_candidate(&mut ordered, format!("{name}@{local}"));
        }
    }
    Ok(ordered)
}

/// `resolveCatalogPluginMarketplaceBootstrap`: `(name, repo)` marketplaces to add.
pub fn resolve_catalog_plugin_marketplace_bootstrap(reference: &str) -> Vec<(String, String)> {
    let (name, _) = parse_plugin_ref(reference);
    hint(name).map_or_else(Vec::new, |h| {
        h.2.iter()
            .map(|(n, r)| ((*n).to_owned(), (*r).to_owned()))
            .collect()
    })
}

/// `resolveClaudeEnabledPluginRef`: an installed candidate, else the first.
pub fn resolve_claude_enabled_plugin_ref(
    host: &dyn ClaudeHost,
    reference: &str,
    home_root: &str,
) -> Result<String> {
    let candidates = resolve_claude_install_ref_candidates(host, reference, home_root)?;
    let installed = host.installed_ref_scopes(home_root)?;
    if let Some(found) = candidates
        .iter()
        .find(|c| installed.iter().any(|(r, _)| r == *c))
    {
        return Ok(found.clone());
    }
    Ok(candidates
        .into_iter()
        .next()
        .unwrap_or_else(|| reference.to_owned()))
}

/// `findInstalledRefForCatalogPin`. A bare pin also matches `<name>@local`,
/// where HarnessTap registers git and local plugins. `scope` `None` matches any.
pub fn find_installed_ref_for_catalog_pin(
    host: &dyn ClaudeHost,
    reference: &str,
    home_root: &str,
    scope: Option<&Value>,
) -> Result<Option<String>> {
    let mut candidates = resolve_claude_install_ref_candidates(host, reference, home_root)?;
    let (name, marketplace) = parse_plugin_ref(reference);
    let local = format!("{name}@local");
    if marketplace.is_empty() && !name.is_empty() && !candidates.contains(&local) {
        candidates.push(local);
    }
    let installed = host.installed_ref_scopes(home_root)?;
    Ok(candidates.into_iter().find(|c| {
        installed
            .iter()
            .any(|(r, s)| r == c && scope.is_none_or(|want| s.as_ref() == Some(want)))
    }))
}

/// `claudeConfigFromPluginPins`: a Claude plugin block from native plugin pins.
pub fn claude_config_from_plugin_pins(
    host: &dyn ClaudeHost,
    pins: &[PluginPin],
    home_root: &str,
) -> Result<Option<Value>> {
    if pins.is_empty() {
        return Ok(None);
    }
    let plugins = pins
        .iter()
        .map(|pin| {
            Ok(json!({
                "id": resolve_claude_enabled_plugin_ref(host, &pin.reference, home_root)?,
                "version": pin.version_constraint,
                "enabled": true,
            }))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Some(json!({ "plugins": plugins })))
}

/// Reads Claude's files under the home root.
pub struct FsClaudeHost;

/// `readJsonFile`: `None` when missing, unreadable or not JSON.
fn read_json_file(path: &Path) -> Option<Value> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_str(&String::from_utf8_lossy(&bytes)).ok()
}

fn type_error(value: &Value) -> String {
    format!(
        "installed_plugins.json: {} is not a valid install record",
        emit_rs::json::stringify(value, "")
    )
}

impl ClaudeHost for FsClaudeHost {
    fn installed_ref_scopes(&self, home_root: &str) -> Result<Vec<(String, Option<Value>)>> {
        let path = claude_plugins_dir(home_root).join("installed_plugins.json");
        let Some(file) = read_json_file(&path) else {
            return Ok(Vec::new());
        };
        let entries: Vec<(String, Value)> = match file.get("plugins") {
            Some(Value::Object(map)) => emit_rs::js::ordered_entries(map)
                .into_iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            Some(Value::Array(items)) => items
                .iter()
                .enumerate()
                .map(|(i, v)| (i.to_string(), v.clone()))
                .collect(),
            Some(Value::String(s)) if !s.is_empty() => {
                return Err(type_error(&Value::String(s.clone())));
            }
            _ => return Ok(Vec::new()),
        };
        let mut out = Vec::new();
        for (reference, records) in entries {
            let records = match records {
                Value::Array(items) => items,
                Value::String(s) if s.is_empty() => continue,
                other => return Err(type_error(&other)),
            };
            for record in records {
                // `resolveInstalledRecordPath` needs a string `installPath`.
                if !record.get("installPath").is_some_and(Value::is_string) {
                    return Err(type_error(&record));
                }
                out.push((reference.clone(), record.get("scope").cloned()));
            }
        }
        Ok(out)
    }

    fn configured_marketplace_names(&self, home_root: &str) -> Result<Vec<String>> {
        let root = claude_plugins_dir(home_root).join("marketplaces");
        if !root.exists() {
            return Ok(Vec::new());
        }
        // `readdirSync` throws when the path is not a directory.
        let entries =
            std::fs::read_dir(&root).map_err(|e| format!("{}, scandir '{}'", e, root.display()))?;
        Ok(entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect())
    }

    fn marketplace_plugin_names(
        &self,
        home_root: &str,
        marketplace: &str,
    ) -> Option<HashSet<String>> {
        let path = claude_plugins_dir(home_root)
            .join("marketplaces")
            .join(marketplace)
            .join(".claude-plugin")
            .join("marketplace.json");
        if !std::fs::metadata(&path).is_ok_and(|m| m.is_file()) {
            return None;
        }
        let parsed = read_json_file(&path)?;
        if !emit_rs::js::truthy(&parsed) {
            return None;
        }
        let mut names = HashSet::new();
        if let Some(Value::Array(plugins)) = parsed.get("plugins") {
            for entry in plugins {
                if let Some(name) = entry
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|n| !n.is_empty())
                {
                    names.insert(name.to_owned());
                }
            }
        }
        Some(names)
    }
}
