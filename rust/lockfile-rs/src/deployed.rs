//! `deployedFileHashes`, `diffDeployedFileHashes` and `verifyDeployedFileHashes`.

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::{LockError, canonicalize_text, sha256_envelope, sort_utf16};

/// One planned file: `{ path, content }`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct DeployedFile {
    pub path: String,
    pub content: String,
}

/// `DeployedHashIssueKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IssueKind {
    Missing,
    Extra,
    Mismatch,
    UnsafePath,
}

impl IssueKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Extra => "extra",
            Self::Mismatch => "mismatch",
            Self::UnsafePath => "unsafe-path",
        }
    }
}

/// `DeployedHashIssue`.
#[derive(Clone, Debug, PartialEq)]
pub struct DeployedHashIssue {
    pub kind: IssueKind,
    pub path: String,
    pub expected: Option<String>,
    pub actual: Option<String>,
}

/// The names a plain JavaScript object answers through `Object.prototype`.
const PROTOTYPE_NAMES: [&str; 12] = [
    "__proto__",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
];

/// `deployedFileHashes`: sorted by `localeCompare`, written into a plain object (a later
/// duplicate overwrites in place, `__proto__` is swallowed), then in that object's key order.
pub(crate) fn deployed_file_hashes(files: &[DeployedFile]) -> Vec<(String, String)> {
    let mut sorted: Vec<&DeployedFile> = files.iter().collect();
    sorted.sort_by(|a, b| collate_rs::locale_compare(&a.path, &b.path));
    let mut hashes = Map::new();
    for file in sorted {
        if file.path == "__proto__" {
            continue;
        }
        let hash = sha256_envelope(&canonicalize_text(&file.content));
        hashes.insert(file.path.clone(), Value::String(hash));
    }
    emit_rs::js::ordered_entries(&hashes)
        .into_iter()
        .map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_owned()))
        .collect()
}

/// `normalizeDigest`.
fn normalize_digest(value: &str) -> String {
    let rest = match value.get(..7) {
        Some(prefix) if prefix.eq_ignore_ascii_case("sha256:") => &value[7..],
        _ => value,
    };
    rest.to_lowercase()
}

/// `hasParentTraversalSegment`.
fn has_parent_traversal_segment(path: &str) -> bool {
    path.split(['/', '\\']).any(|segment| segment == "..")
}

/// `hashFileOnDisk`.
fn hash_file_on_disk(root: &str, relative: &str) -> Option<String> {
    let bytes = std::fs::read(db_rs::paths::posix_join(&[root, relative])).ok()?;
    Some(sha256_envelope(&canonicalize_text(
        &String::from_utf8_lossy(&bytes),
    )))
}

const NOT_A_STRING: &str = "value.replace is not a function";

/// `diffDeployedFileHashes`. `expected` holds the lock's path to hash entries; `root_path` is
/// `options.rootPath`.
pub fn diff_deployed_file_hashes(
    expected: &[(String, String)],
    files: &[DeployedFile],
    root_path: Option<&str>,
) -> Result<Vec<DeployedHashIssue>, LockError> {
    let planned = deployed_file_hashes(files);
    let planned_hash = |p: &str| {
        planned
            .iter()
            .find(|(k, _)| k == p)
            .map(|(_, v)| v.as_str())
    };
    let expected_has =
        |p: &str| expected.iter().any(|(k, _)| k == p) || PROTOTYPE_NAMES.contains(&p);
    let mut keys: Vec<String> = expected.iter().map(|(k, _)| k.clone()).collect();
    sort_utf16(&mut keys);
    let mut issues = Vec::new();

    for path in &keys {
        if has_parent_traversal_segment(path) || path.starts_with('/') {
            issues.push(issue(IssueKind::UnsafePath, path, None, None));
        }
    }

    for path in &keys {
        let expected_hash = expected
            .iter()
            .find(|(k, _)| k == path)
            .map_or("", |(_, v)| v);
        match planned_hash(path) {
            Some(planned) => {
                if !expected_hash.is_empty()
                    && normalize_digest(expected_hash) != normalize_digest(planned)
                {
                    issues.push(issue(
                        IssueKind::Mismatch,
                        path,
                        Some(normalize_digest(expected_hash)),
                        Some(normalize_digest(planned)),
                    ));
                }
                continue;
            }
            // The plain object answers with an `Object.prototype` member, not `undefined`.
            None if PROTOTYPE_NAMES.contains(&path.as_str()) => {
                if !expected_hash.is_empty() {
                    return Err(LockError::Type(NOT_A_STRING));
                }
                continue;
            }
            None => {}
        }
        // In the lock but not in the new plan. With a root, that only fails when the file is
        // also gone from disk.
        if let Some(root) = root_path.filter(|r| !r.is_empty()) {
            if hash_file_on_disk(root, path).is_none() {
                issues.push(issue(
                    IssueKind::Missing,
                    path,
                    Some(expected_hash.to_owned()),
                    None,
                ));
            }
            continue;
        }
        issues.push(issue(
            IssueKind::Missing,
            path,
            Some(expected_hash.to_owned()),
            None,
        ));
    }

    let mut planned_keys: Vec<String> = planned.iter().map(|(k, _)| k.clone()).collect();
    sort_utf16(&mut planned_keys);
    for path in &planned_keys {
        if !expected_has(path) {
            let actual = planned_hash(path).map(str::to_owned);
            issues.push(issue(IssueKind::Extra, path, None, actual));
        }
    }
    Ok(issues)
}

fn issue(
    kind: IssueKind,
    path: &str,
    expected: Option<String>,
    actual: Option<String>,
) -> DeployedHashIssue {
    DeployedHashIssue {
        kind,
        path: path.to_owned(),
        expected,
        actual,
    }
}

/// `verifyDeployedFileHashes`: the first issue, as a `LockIntegrityError`.
pub fn verify_deployed_file_hashes(
    expected: &[(String, String)],
    files: &[DeployedFile],
    root_path: Option<&str>,
) -> Result<(), LockError> {
    let issues = diff_deployed_file_hashes(expected, files, root_path)?;
    let Some(first) = issues.first() else {
        return Ok(());
    };
    let path = &first.path;
    let message = match first.kind {
        IssueKind::UnsafePath => {
            format!("Unsafe local_deployed_file_hashes path {path}. Apply aborted closed.")
        }
        IssueKind::Missing => {
            format!("Deployed tree is missing {path} listed in local_deployed_file_hashes")
        }
        IssueKind::Mismatch => format!(
            "Hash mismatch for {path}: lockfile records {}, file is {}",
            first.expected.as_deref().unwrap_or("undefined"),
            first.actual.as_deref().unwrap_or("undefined"),
        ),
        IssueKind::Extra => format!(
            "Deployed tree contains extra file {path} that is not listed in local_deployed_file_hashes"
        ),
    };
    Err(LockError::Integrity(message))
}
