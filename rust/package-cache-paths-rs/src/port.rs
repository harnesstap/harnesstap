//! The Rust port of `src/services/package-cache/paths.ts`: where cached
//! packages live under the HarnessTap home.

#![forbid(unsafe_code)]

use sha2::{Digest, Sha256};

// A copy of `db_rs::paths::posix_join`: depending on db-rs would link plugin-semver-rs, whose
// `#[napi]` exports (the wire buffers among them) clash with this crate's own.
/// Node's `path.posix.join`: join the non-empty parts, then normalize.
fn posix_join(parts: &[&str]) -> String {
    let joined = parts
        .iter()
        .filter(|p| !p.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("/");
    if joined.is_empty() {
        return ".".to_owned();
    }
    posix_normalize(&joined)
}

/// Node's `path.posix.normalize`.
fn posix_normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_owned();
    }
    let absolute = path.starts_with('/');
    let trailing = path.ends_with('/');
    let mut segments: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.last().is_some_and(|s| *s != "..") {
                    segments.pop();
                } else if !absolute {
                    segments.push("..");
                }
            }
            s => segments.push(s),
        }
    }
    let mut out = segments.join("/");
    if out.is_empty() && !absolute {
        out.push('.');
    }
    if !out.is_empty() && trailing {
        out.push('/');
    }
    if absolute { format!("/{out}") } else { out }
}

const PACKAGES_CACHE_ROOT: &str = "cache/packages";

/// `replace(/[/\\]/g, "_")`.
fn safe(segment: &str) -> String {
    segment.replace(['/', '\\'], "_")
}

/// The hex SHA-256 of the UTF-8 repository URL.
fn digest(repo_url: &str) -> String {
    Sha256::digest(repo_url.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Port of `packagesCacheRoot` (`src/services/package-cache/paths.ts:6`).
pub fn packages_cache_root(harnesstap_dir: String) -> Result<String, String> {
    Ok(posix_join(&[&harnesstap_dir, PACKAGES_CACHE_ROOT]))
}

/// Port of `hostPluginPackagesParent` (`src/services/package-cache/paths.ts:10`).
pub fn host_plugin_packages_parent(
    harnesstap_dir: String,
    marketplace: String,
    plugin_name: String,
) -> Result<String, String> {
    let root = packages_cache_root(harnesstap_dir)?;
    Ok(posix_join(&[
        &root,
        "host-plugin",
        &safe(&marketplace),
        &safe(&plugin_name),
    ]))
}

/// Port of `hostPluginPackageDir` (`src/services/package-cache/paths.ts:20`).
pub fn host_plugin_package_dir(
    harnesstap_dir: String,
    marketplace: String,
    plugin_name: String,
    version: String,
) -> Result<String, String> {
    let root = packages_cache_root(harnesstap_dir)?;
    Ok(posix_join(&[
        &root,
        "host-plugin",
        &safe(&marketplace),
        &safe(&plugin_name),
        &safe(&version),
    ]))
}

/// Port of `hostPluginPackageRelativePath` (`src/services/package-cache/paths.ts:40`).
pub fn host_plugin_package_relative_path(
    marketplace: String,
    plugin_name: String,
    version: String,
) -> Result<String, String> {
    Ok(posix_join(&[
        PACKAGES_CACHE_ROOT,
        "host-plugin",
        &safe(&marketplace),
        &safe(&plugin_name),
        &safe(&version),
    ]))
}

/// Port of `apmGitLegacyPackagePaths` (`src/services/package-cache/paths.ts:58`).
pub fn apm_git_legacy_package_paths(
    harnesstap_dir: String,
    repo_url: String,
    commit: String,
) -> Result<Vec<String>, String> {
    let digest = digest(&repo_url);
    let commit = commit.to_lowercase();
    let root = packages_cache_root(harnesstap_dir.clone())?;
    Ok(vec![
        posix_join(&[&harnesstap_dir, "cache", "apm-git", &digest, &commit]),
        posix_join(&[&root, "apm-git", &digest, &commit]),
    ])
}

/// Port of `apmGitPackageDir` (`src/services/package-cache/paths.ts:72`).
pub fn apm_git_package_dir(
    harnesstap_dir: String,
    repo_url: String,
    commit: String,
) -> Result<String, String> {
    let root = packages_cache_root(harnesstap_dir)?;
    Ok(posix_join(&[
        &root,
        "git",
        &digest(&repo_url),
        &commit.to_lowercase(),
    ]))
}

/// Port of `apmGitPackageRelativePath` (`src/services/package-cache/paths.ts:86`).
pub fn apm_git_package_relative_path(repo_url: String, commit: String) -> Result<String, String> {
    Ok(posix_join(&[
        PACKAGES_CACHE_ROOT,
        "git",
        &digest(&repo_url),
        &commit.to_lowercase(),
    ]))
}
