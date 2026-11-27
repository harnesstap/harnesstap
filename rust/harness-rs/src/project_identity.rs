//! The path-keyed half of `src/services/project-identity.ts`, and `getGitOrigin`
//! (`src/services/git.ts`). A folder with a git `origin` is keyed by its origin and may
//! move path-keyed rows (with a database backup); that half is not ported, so callers get
//! [`Identity::Origin`] and leave the work to the original.

use std::process::{Command, Stdio};

use db_rs::paths::posix_resolve;
use models_rs::project::{Project, get_project_by_local_id, upsert_project_by_local_id};
use models_rs::{Ctx, Result, js_trim};

/// `PATH_PROJECT_ID_PREFIX`.
pub const PATH_PROJECT_ID_PREFIX: &str = "path:";

/// `realOrResolved`: `resolve`, then `realpath` when the folder exists.
fn real_or_resolved(cwd: &str, path: &str) -> String {
    let absolute = posix_resolve(cwd, path);
    std::fs::canonicalize(&absolute)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(absolute)
}

/// `stripTrailingSeparators`: keeps a filesystem root (`/`, `c:/`).
fn strip_trailing_separators(path: &str) -> &str {
    let mut out = path;
    while out.len() > 1 && out.ends_with('/') {
        let b = out.as_bytes();
        if out.len() == 3 && b[0].is_ascii_alphabetic() && b[1] == b':' {
            break;
        }
        out = &out[..out.len() - 1];
    }
    out
}

/// `normalizeProjectPath` for this platform: real path, `\` to `/` on Windows,
/// lowercased on Windows and macOS, no trailing separator.
pub fn normalize_project_path(cwd: &str, path: &str) -> String {
    let mut out = real_or_resolved(cwd, path);
    if cfg!(windows) {
        out = out.replace('\\', "/");
    }
    if cfg!(any(windows, target_os = "macos")) {
        out = out.to_lowercase();
    }
    strip_trailing_separators(&out).to_owned()
}

/// `pathProjectId`.
pub fn path_project_id(cwd: &str, path: &str) -> String {
    format!(
        "{PATH_PROJECT_ID_PREFIX}{}",
        normalize_project_path(cwd, path)
    )
}

/// `getGitOrigin`: the stored `remote.origin.url`, trimmed; `None` when git fails,
/// the folder does not exist or the value is empty.
pub fn get_git_origin(project_root: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["config", "--get", "remote.origin.url"])
        .current_dir(project_root)
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let url = js_trim(&String::from_utf8_lossy(&output.stdout)).to_owned();
    (!url.is_empty()).then_some(url)
}

/// `ProjectIdentity`. The origin variant carries nothing: it is not ported.
#[derive(Debug, Clone, PartialEq)]
pub enum Identity {
    Path {
        root: String,
        local_id: String,
        name: String,
    },
    Origin,
}

/// `resolveProjectIdentity`, with `resolve` against `cwd`.
pub fn resolve_project_identity(cwd: &str, project_root: &str) -> Identity {
    let root = posix_resolve(cwd, project_root);
    let local_id = path_project_id(cwd, &root);
    if get_git_origin(&root).is_some() {
        return Identity::Origin;
    }
    let real = real_or_resolved(cwd, &root);
    let base = real.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    let name = if base.is_empty() {
        root.clone()
    } else {
        base.to_owned()
    };
    Identity::Path {
        root,
        local_id,
        name,
    }
}

/// `findProjectForRoot` for a path identity (`None` for an origin one).
pub fn find_project_for_root(ctx: &Ctx, identity: &Identity) -> Option<Result<Option<Project>>> {
    match identity {
        Identity::Path { local_id, .. } => Some(get_project_by_local_id(ctx, local_id)),
        Identity::Origin => None,
    }
}

/// `ensureProjectForRoot` for a path identity (`None` for an origin one).
pub fn ensure_project_for_root(ctx: &Ctx, identity: &Identity) -> Option<Result<Project>> {
    match identity {
        Identity::Path {
            root,
            local_id,
            name,
        } => Some(upsert_project_by_local_id(ctx, local_id, name, root)),
        Identity::Origin => None,
    }
}
