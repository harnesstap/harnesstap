//! `src/services/mcp-target.ts`: which MCP servers a harness MCP config file receives, with
//! `isClaudeLocalMcpResource` from `claude-local-mcp.ts`.
//!
//! Resources are the JSON objects the original passes around (`type`, `source`, `metadata`,
//! `harness_scope`).

use emit_rs::js::{trim, truthy};
use harness_scope_rs::port::{resource_applies_to_harness, resource_harness_scope};
use platforms_rs::get_all_platforms;
use serde_json::Value;

const CLAUDE_LOCAL_MCP_SOURCE_PREFIX: &str = "~/.claude.json#local:";

fn str_prop<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str()
}

/// `isClaudeLocalMcpResource(resource)`.
pub fn is_claude_local_mcp_resource(resource: &Value) -> bool {
    let local_source = str_prop(resource, "source")
        .and_then(|s| s.strip_prefix(CLAUDE_LOCAL_MCP_SOURCE_PREFIX))
        .is_some_and(|rest| !rest.is_empty());
    local_source
        || matches!(resource.get("metadata"), Some(Value::Object(m)) if m.get("claude_mcp_scope").and_then(Value::as_str) == Some("local"))
}

fn normalize_path(path: &str, root_path: &str) -> String {
    let mut normalized = path.replace('\\', "/");
    if let Some(rest) = normalized.strip_prefix("~/") {
        normalized = rest.to_owned();
    }
    if !root_path.is_empty() {
        let root = root_path.replace('\\', "/");
        let root = root.strip_suffix('/').unwrap_or(&root);
        if normalized == root || normalized.starts_with(&format!("{root}/")) {
            let rest = &normalized[root.len()..];
            normalized = rest.strip_prefix('/').unwrap_or(rest).to_owned();
        }
    }
    match normalized.strip_prefix("./") {
        Some(rest) => rest.to_owned(),
        None => normalized,
    }
}

fn strip_tilde(path: &str) -> &str {
    path.strip_prefix("~/").unwrap_or(path)
}

/// `sourceMatchesManagedPath(source, managedPath, rootPath)`.
pub fn source_matches_managed_path(
    source: Option<&str>,
    managed_path: &str,
    root_path: &str,
) -> bool {
    let Some(source) = source.filter(|s| !s.is_empty()) else {
        return false;
    };
    let source = normalize_path(source, root_path);
    let managed = normalize_path(managed_path, root_path);
    source == managed
        || source == format!("~/{managed}")
        || managed == format!("~/{source}")
        || strip_tilde(&source) == strip_tilde(&managed)
}

/// `/(^|\/)(\.?mcp\.json|mcp[-_]config\.json|opencode\.json)$/i`.
fn looks_like_mcp_config(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    matches!(
        name.as_str(),
        "mcp.json" | ".mcp.json" | "mcp-config.json" | "mcp_config.json" | "opencode.json"
    )
}

fn mcp_candidates(platform: &platforms_rs::PlatformDefinition) -> [Option<&'static str>; 4] {
    [
        platform.project_paths.mcp,
        platform.global_paths.mcp,
        platform.global_paths.settings,
        platform.project_paths.settings,
    ]
}

fn collect_known_mcp_config_paths() -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    for platform in get_all_platforms() {
        for candidate in mcp_candidates(platform).into_iter().flatten() {
            let normalized = strip_tilde(&normalize_path(candidate, "")).to_owned();
            let is_mcp = Some(candidate) == platform.project_paths.mcp
                || Some(candidate) == platform.global_paths.mcp;
            if (is_mcp || looks_like_mcp_config(&normalized)) && !paths.contains(&normalized) {
                paths.push(normalized);
            }
        }
    }
    paths
}

fn is_portable_mcp_source(source: Option<&str>) -> bool {
    let trimmed = source.map(trim).unwrap_or_default();
    if trimmed.is_empty() || trimmed == "manual" {
        return true;
    }
    let normalized = trimmed.replace('\\', "/");
    normalized == "apm.yml"
        || normalized.ends_with("/apm.yml")
        || normalized == "plugin.json"
        || normalized == "mcp.json"
}

/// An MCP server imported from a plugin package keeps the package-relative path of its manifest
/// as its source; it is portable like one declared in `mcp.json`.
fn is_plugin_package_mcp(resource: &Value) -> bool {
    let Some(Value::Object(imported)) = resource
        .get("metadata")
        .and_then(|m| m.get("imported_from"))
    else {
        return false;
    };
    matches!(imported.get("plugin_name"), Some(Value::String(n)) if !n.is_empty())
        && matches!(imported.get("relative_path"), Some(Value::String(_)))
}

/// `harnessIdsForMcpPath(targetMcpPath, rootPath)`.
pub fn harness_ids_for_mcp_path(target_mcp_path: &str, root_path: &str) -> Vec<String> {
    get_all_platforms()
        .iter()
        .filter(|p| {
            mcp_candidates(p)
                .into_iter()
                .any(|c| source_matches_managed_path(c, target_mcp_path, root_path))
        })
        .map(|p| p.id.to_owned())
        .collect()
}

/// `isPortableMcpResource(resource)`. A resource without metadata fails as the original does.
pub fn is_portable_mcp_resource(resource: &Value) -> Result<bool, String> {
    if str_prop(resource, "type") != Some("mcp_server") {
        return Ok(false);
    }
    let meta = match resource.get("metadata") {
        None => {
            return Err(
                "TypeError: Cannot read properties of undefined (reading 'transport')".into(),
            );
        }
        Some(Value::Null) => {
            return Err("TypeError: Cannot read properties of null (reading 'transport')".into());
        }
        Some(meta) => meta,
    };
    if !matches!(str_prop(meta, "transport"), Some("stdio" | "http")) {
        return Ok(false);
    }
    let field = |key: &str| meta.get(key).unwrap_or(&Value::Null);
    if (truthy(field("connection_type")) && field("connection_type") != "sse")
        || truthy(field("framing"))
        || field("claude_mcp_scope") == "local"
    {
        return Ok(false);
    }
    // `Object.keys(meta.env ?? {})`: only an object has keys that are not indexes.
    if let Some(Value::Object(env)) = meta.get("env") {
        let hosted = |k: &String| {
            let k = k.to_ascii_lowercase();
            ["claude", "codex", "opencode", "cursor"]
                .iter()
                .any(|h| k.contains(h))
        };
        if env.keys().any(hosted) {
            return Ok(false);
        }
    }
    Ok(true)
}

/// `filterMcpServersForTargetPath(resources, targetMcpPath, rootPath, platformId)`: the MCP
/// servers to emit into a harness MCP config path. Errors are `harness-scope.ts`'s on a
/// malformed `harness_scope`.
pub fn filter_mcp_servers_for_target_path<'a>(
    resources: &'a [Value],
    target_mcp_path: Option<&str>,
    root_path: &str,
    platform_id: Option<&str>,
) -> Result<Vec<&'a Value>, String> {
    let mcps = resources
        .iter()
        .filter(|r| str_prop(r, "type") == Some("mcp_server") && !is_claude_local_mcp_resource(r));
    let Some(target) = target_mcp_path.filter(|t| !t.is_empty()) else {
        return Ok(mcps.collect());
    };
    let target_harnesses = match platform_id.filter(|p| !p.is_empty()) {
        Some(id) => vec![id.to_owned()],
        None => harness_ids_for_mcp_path(target, root_path),
    };
    let mut known: Option<Vec<String>> = None;
    let mut kept = Vec::new();
    for resource in mcps {
        let scope = resource_harness_scope(resource.clone())?;
        let source = str_prop(resource, "source");
        let keep = if scope.get("kind").and_then(Value::as_str) == Some("subset") {
            let mut applies = false;
            for id in &target_harnesses {
                if resource_applies_to_harness(resource.clone(), id.clone())? {
                    applies = true;
                    break;
                }
            }
            applies
        } else if is_portable_mcp_source(source)
            || is_plugin_package_mcp(resource)
            || source_matches_managed_path(source, target, root_path)
        {
            true
        } else {
            let known = known.get_or_insert_with(collect_known_mcp_config_paths);
            !known.iter().any(|path| {
                source_matches_managed_path(Some(source.unwrap_or("")), path, root_path)
            })
        };
        if keep {
            kept.push(resource);
        }
    }
    Ok(kept)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn path_matching_strips_home_root_and_dot() {
        assert!(source_matches_managed_path(
            Some("~/.cursor/mcp.json"),
            ".cursor/mcp.json",
            ""
        ));
        assert!(source_matches_managed_path(
            Some("C:\\p\\.mcp.json"),
            "./.mcp.json",
            "C:\\p\\"
        ));
        assert!(!source_matches_managed_path(Some(""), "", ""));
    }

    #[test]
    fn foreign_harness_file_is_excluded() {
        let r = json!([{ "type": "mcp_server", "source": ".cursor/mcp.json", "metadata": {} }]);
        let r = r.as_array().unwrap();
        assert_eq!(
            filter_mcp_servers_for_target_path(r, Some(".cursor/mcp.json"), "", None)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            filter_mcp_servers_for_target_path(r, Some(".mcp.json"), "", None)
                .unwrap()
                .len(),
            0
        );
    }
}
