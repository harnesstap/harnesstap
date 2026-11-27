//! `detectPlatforms` (`src/services/scanner.ts`): which harnesses have their own
//! files in a project folder.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;

use db_rs::paths::posix_join;
use platforms_rs::{PlatformDefinition, PlatformPaths, get_all_platforms};

/// `configuredProjectPaths`: every non-empty path, then the alternates.
fn configured_paths(paths: &PlatformPaths) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = [
        paths.instructions,
        paths.legacy_instructions,
        paths.skills,
        paths.rules,
        paths.legacy_rules,
        paths.mcp,
        paths.permissions,
        paths.hooks,
        paths.agents,
        paths.commands,
        paths.settings,
        paths.plugins,
    ]
    .into_iter()
    .flatten()
    .filter(|p| !p.is_empty())
    .collect();
    if let Some(alt) = paths.path_alternates {
        for list in [
            alt.commands,
            alt.agents,
            alt.rules,
            alt.instructions,
            alt.skills,
            alt.settings,
        ]
        .into_iter()
        .flatten()
        {
            out.extend_from_slice(list);
        }
    }
    out
}

/// Node's `path.basename`.
fn basename(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    trimmed.rsplit('/').next().unwrap_or(trimmed)
}

/// Node's `path.posix.dirname`.
fn dirname(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return if path.starts_with('/') { "/" } else { "." };
    }
    match trimmed.rfind('/') {
        None => ".",
        Some(0) => "/",
        Some(i) => &trimmed[..i],
    }
}

/// `pathHasExactConfiguredName`: `existsSync` ignores case on macOS, the listing does not.
fn has_exact_name(full: &str, configured: &str) -> bool {
    let expected = basename(configured.trim_end_matches('/'));
    if expected.is_empty() || expected == "." || expected == ".." {
        return true;
    }
    fs::read_dir(dirname(full)).is_ok_and(|entries| {
        entries
            .flatten()
            .any(|e| e.file_name() == OsStr::new(expected))
    })
}

/// `pathCountsForPlatformDetection`.
fn counts(root: &str, configured: &str) -> bool {
    let full = posix_join(&[root, configured]);
    if fs::metadata(&full).is_err() || !has_exact_name(&full, configured) {
        return false;
    }
    !(configured == "AGENTS.md"
        && fs::symlink_metadata(&full).is_ok_and(|m| m.file_type().is_symlink()))
}

/// `buildSharedProjectPathSet`: paths more than one platform configures.
fn shared_project_paths() -> HashMap<&'static str, usize> {
    let mut counts: HashMap<&'static str, usize> = HashMap::new();
    for platform in get_all_platforms() {
        let mut unique = configured_paths(&platform.project_paths);
        unique.sort_unstable();
        unique.dedup();
        for path in unique {
            *counts.entry(path).or_default() += 1;
        }
    }
    counts
}

/// `platformHasFiles`.
fn has_files(platform: &PlatformDefinition, root: &str, shared: &HashMap<&str, usize>) -> bool {
    let detection = platform
        .detection_paths
        .and_then(|d| d.project)
        .unwrap_or_default();
    if detection
        .iter()
        .any(|p| counts(root, p.strip_prefix("~/").unwrap_or(p)))
    {
        return true;
    }
    configured_paths(&platform.project_paths)
        .into_iter()
        .filter(|p| counts(root, p))
        .any(|p| shared.get(p).copied().unwrap_or(0) <= 1)
}

/// `detectPlatforms`, in registry order.
pub fn detect_platforms(project_root: &str) -> Vec<&'static str> {
    let shared = shared_project_paths();
    get_all_platforms()
        .iter()
        .filter(|p| has_files(p, project_root, &shared))
        .map(|p| p.id)
        .collect()
}
