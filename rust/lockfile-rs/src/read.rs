//! `readLockfile`.

use serde_json::{Map, Value};

use crate::{
    APM_LOCKFILE_FILENAME, ExecStatus, LOCKFILE_VERSION, LockEntry, LockError, LockMcpServer,
    LockSource, Lockfile, lockfile_path,
};
use emit_rs::js::{to_number, to_string};

/// `entry.key`, unless it is missing or `null` (what `??` falls through).
fn present<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    map.get(key).filter(|v| !v.is_null())
}

fn string_or_empty(map: &Map<String, Value>, key: &str) -> String {
    present(map, key).map(to_string).unwrap_or_default()
}

fn string_field(map: &Map<String, Value>, key: &str) -> Option<String> {
    map.get(key).and_then(Value::as_str).map(str::to_owned)
}

/// `parseLockSource`.
fn parse_lock_source(value: Option<&Value>) -> LockSource {
    match value.and_then(Value::as_str) {
        Some("marketplace") => LockSource::Marketplace,
        Some("git") => LockSource::Git,
        Some("catalog" | "registry") => LockSource::Catalog,
        _ => LockSource::Local,
    }
}

/// `parseHtPluginEntry`. `parseApmDependencyEntry` reads the same fields the same way.
fn parse_entry(entry: &Map<String, Value>) -> LockEntry {
    let integrity = present(entry, "integrity")
        .or_else(|| present(entry, "content_hash"))
        .map(to_string)
        .unwrap_or_default();
    LockEntry {
        name: string_or_empty(entry, "name"),
        version: string_or_empty(entry, "version"),
        source: parse_lock_source(entry.get("source")),
        integrity,
        depth: present(entry, "depth").map_or(1.0, to_number),
        path: match entry.get("path") {
            Some(Value::Array(items)) => items.iter().map(to_string).collect(),
            _ => Vec::new(),
        },
        repo_url: string_field(entry, "repo_url"),
        resolved_commit: string_field(entry, "resolved_commit"),
        resolved_ref: string_field(entry, "resolved_ref"),
        constraint: string_field(entry, "constraint"),
        resolved_tag: string_field(entry, "resolved_tag"),
        virtual_path: string_field(entry, "virtual_path"),
        content_hash: string_field(entry, "content_hash"),
        exec_status: entry.get("exec_status").and_then(ExecStatus::parse),
        declared_license: string_field(entry, "declared_license")
            .map(|l| emit_rs::js::trim(&l).to_owned())
            .filter(|l| !l.is_empty()),
    }
}

fn records(value: Option<&Value>) -> Option<impl Iterator<Item = &Map<String, Value>>> {
    match value {
        Some(Value::Array(items)) => Some(items.iter().filter_map(Value::as_object)),
        _ => None,
    }
}

/// `readLockfile`: `Ok(None)` when there is no lockfile.
pub fn read_lockfile(project_root: &str) -> Result<Option<Lockfile>, LockError> {
    let path = lockfile_path(project_root);
    let text = match std::fs::read(&path) {
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(LockError::Io(e)),
    };
    let parsed = yaml_rs::parse(&text).map_err(LockError::Yaml)?;
    let Value::Object(parsed) = parsed else {
        return Err(LockError::Invalid(format!(
            "Invalid lockfile in {path}: expected a YAML mapping"
        )));
    };
    let version = string_or_empty(&parsed, "lockfile_version");
    if version != LOCKFILE_VERSION && version != "2" {
        let shown = if version.is_empty() {
            "(missing)"
        } else {
            &version
        };
        return Err(LockError::Invalid(format!(
            "Unsupported lockfile_version: {shown}. Expected \"{LOCKFILE_VERSION}\". \
             Delete {APM_LOCKFILE_FILENAME} and re-run apply to regenerate it."
        )));
    }

    let ht: Vec<LockEntry> = records(parsed.get("plugins"))
        .map(|r| r.map(parse_entry).collect())
        .unwrap_or_default();
    let plugins = if ht.is_empty() {
        records(parsed.get("dependencies"))
            .map(|r| r.map(parse_entry).collect())
            .unwrap_or_default()
    } else {
        ht
    };

    let mcp_servers: Vec<LockMcpServer> = records(parsed.get("mcp_servers"))
        .map(|r| {
            r.map(|entry| {
                let text = |key: &str| string_field(entry, key).map(Value::String);
                LockMcpServer {
                    name: string_or_empty(entry, "name"),
                    transport: text("transport"),
                    command: text("command"),
                    url: text("url"),
                }
            })
            .collect()
        })
        .unwrap_or_default();

    let deployed_file_hashes = match parsed.get("local_deployed_file_hashes") {
        Some(Value::Object(map)) => Some(
            emit_rs::js::ordered_entries(map)
                .into_iter()
                .map(|(k, v)| (k.clone(), to_string(v)))
                .collect(),
        ),
        _ => None,
    };

    let resolved_at = present(&parsed, "generated_at")
        .or_else(|| present(&parsed, "resolved_at"))
        .map(to_string)
        .unwrap_or_default();
    Ok(Some(Lockfile {
        root: string_or_empty(&parsed, "root"),
        resolved_at,
        resource_map_hash: string_or_empty(&parsed, "resource_map_hash"),
        plugins,
        environment: string_field(&parsed, "environment"),
        mcp_servers: (!mcp_servers.is_empty()).then_some(mcp_servers),
        deployed_file_hashes,
    }))
}
