//! `utils/git-dependency-constraint.ts`: what a git dependency's constraint
//! pins (#500).

use node_semver_rs::{self as semver, Options};
use serde::Serialize;

/// `GitDependencyPin`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum GitDependencyPin {
    None,
    Semver {
        range: String,
    },
    Commit {
        sha: String,
    },
    Ref {
        #[serde(rename = "ref")]
        reference: String,
    },
}

fn is_hex_sha(value: &str, min: usize) -> bool {
    (min..=40).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `isFullCommitSha`.
pub fn is_full_commit_sha(value: &str) -> bool {
    is_hex_sha(value, 40)
}

/// `isValidGitRefName`: `git check-ref-format` for a branch or tag name.
pub fn is_valid_git_ref_name(name: &str) -> bool {
    if name.is_empty() || name == "@" {
        return false;
    }
    if name.starts_with('-') || name.starts_with('/') || name.ends_with('/') {
        return false;
    }
    if name.ends_with('.') || name.ends_with(".lock") {
        return false;
    }
    if name.contains("..") || name.contains("//") || name.contains("@{") {
        return false;
    }
    if name
        .chars()
        .any(|c| c <= '\u{20}' || c == '\u{7f}' || "~^:?*[\\".contains(c))
    {
        return false;
    }
    name.split('/')
        .all(|part| !part.is_empty() && !part.starts_with('.'))
}

/// `InvalidGitDependencyConstraintError`'s message.
fn invalid(raw: &str) -> String {
    format!(
        "Invalid git dependency constraint: {raw}. Use a commit SHA, a tag or branch name (for example #main or ref:v1.2.0), or a semver range matched against tags."
    )
}

fn explicit_ref(value: &str, raw: &str) -> Result<GitDependencyPin, String> {
    if is_hex_sha(value, 7) {
        return Ok(GitDependencyPin::Commit {
            sha: value.to_ascii_lowercase(),
        });
    }
    if !is_valid_git_ref_name(value) {
        return Err(invalid(raw));
    }
    Ok(GitDependencyPin::Ref {
        reference: value.to_owned(),
    })
}

/// `parseGitDependencyConstraint`. `None` is `undefined` or `null`.
pub fn parse_git_dependency_constraint(raw: Option<&str>) -> Result<GitDependencyPin, String> {
    let trimmed = emit_rs::js::trim(raw.unwrap_or(""));
    if trimmed.is_empty() || trimmed == "latest" || trimmed == "*" {
        return Ok(GitDependencyPin::None);
    }
    if let Some(rest) = trimmed.strip_prefix('#') {
        return explicit_ref(emit_rs::js::trim(rest), trimmed);
    }
    if let Some(rest) = trimmed.strip_prefix("ref:") {
        let reference = emit_rs::js::trim(rest);
        if !is_valid_git_ref_name(reference) {
            return Err(invalid(trimmed));
        }
        return Ok(GitDependencyPin::Ref {
            reference: reference.to_owned(),
        });
    }
    if is_hex_sha(trimmed, 7) {
        return Ok(GitDependencyPin::Commit {
            sha: trimmed.to_ascii_lowercase(),
        });
    }
    if semver::valid(trimmed, Options::default()).is_some()
        || semver::valid_range(trimmed, Options::default()).is_some()
    {
        return Ok(GitDependencyPin::Semver {
            range: trimmed.to_owned(),
        });
    }
    if is_valid_git_ref_name(trimmed) {
        return Ok(GitDependencyPin::Ref {
            reference: trimmed.to_owned(),
        });
    }
    Err(invalid(trimmed))
}

/// `isGitRefConstraint`: the constraint names a commit, tag or branch.
pub fn is_git_ref_constraint(raw: Option<&str>) -> bool {
    matches!(
        parse_git_dependency_constraint(raw),
        Ok(GitDependencyPin::Commit { .. } | GitDependencyPin::Ref { .. })
    )
}

/// `gitPinFetchRef`: the ref a checkout fetches, `None` for the default branch HEAD.
pub fn git_pin_fetch_ref(pin: &GitDependencyPin) -> Option<&str> {
    match pin {
        GitDependencyPin::None => None,
        GitDependencyPin::Commit { sha } => Some(sha),
        GitDependencyPin::Ref { reference } => Some(reference),
        GitDependencyPin::Semver { range } => Some(range),
    }
}
