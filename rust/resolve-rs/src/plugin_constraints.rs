//! Port of `src/services/plugin-constraints.ts`.

use crate::js_trim;
use node_semver_rs::{self as semver, Options};
use regex::Regex;
use std::sync::LazyLock;

/// `VersionConstraint`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VersionConstraint {
    Exact { version: String },
    Range { range: String },
}

/// `LATEST_CONSTRAINT`.
pub const LATEST_CONSTRAINT: &str = "latest";

static COMMIT_LIKE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new("^(?i:[0-9a-f]{7,40})$").unwrap_or_else(|e| panic!("{e}")));

/// `parseVersionConstraint`. The `Err` is the thrown `Error`'s message.
pub fn parse_version_constraint(raw: &str) -> Result<VersionConstraint, String> {
    let trimmed = js_trim(raw);
    if trimmed == LATEST_CONSTRAINT {
        return Ok(VersionConstraint::Range {
            range: "*".to_owned(),
        });
    }
    if semver::valid(trimmed, Options::STRICT).is_some() {
        return Ok(VersionConstraint::Exact {
            version: trimmed.to_owned(),
        });
    }
    if semver::valid_range(trimmed, Options::STRICT).is_some() {
        return Ok(VersionConstraint::Range {
            range: trimmed.to_owned(),
        });
    }
    if COMMIT_LIKE.is_match(trimmed) {
        return Err(format!(
            "Invalid version constraint: {raw}. It looks like a commit SHA, but this dependency takes a version or semver range (for example 1.11.0). To pin a commit, depend on the plugin's git repository instead."
        ));
    }
    Err(format!("Invalid version constraint: {raw}"))
}

/// `satisfiesConstraint`.
pub fn satisfies_constraint(constraint: &str, installed: &str) -> Result<bool, String> {
    if installed == "unknown" {
        return Ok(false);
    }
    if semver::valid(installed, Options::STRICT).is_none() {
        return Ok(false);
    }
    match parse_version_constraint(constraint)? {
        VersionConstraint::Exact { version } => semver::eq(installed, &version, Options::STRICT),
        VersionConstraint::Range { range } => Ok(semver::satisfies(
            installed,
            &range,
            Options::INCLUDE_PRERELEASE,
        )),
    }
}
