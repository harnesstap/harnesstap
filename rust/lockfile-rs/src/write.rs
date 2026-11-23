//! `serializeLockDependency` and `writeLockfile`.

use serde_json::{Map, Value};

use crate::{LOCKFILE_VERSION, LockEntry, LockError, LockSource, Lockfile, lockfile_path};

fn set_truthy(out: &mut Map<String, Value>, key: &str, value: Option<&String>) {
    if let Some(v) = value.filter(|v| !v.is_empty()) {
        out.insert(key.to_owned(), Value::String(v.clone()));
    }
}

/// The optional fields both lists end with.
fn optional_fields(out: &mut Map<String, Value>, entry: &LockEntry) {
    set_truthy(out, "repo_url", entry.repo_url.as_ref());
    set_truthy(out, "resolved_commit", entry.resolved_commit.as_ref());
    set_truthy(out, "resolved_ref", entry.resolved_ref.as_ref());
    set_truthy(out, "constraint", entry.constraint.as_ref());
    set_truthy(out, "resolved_tag", entry.resolved_tag.as_ref());
    set_truthy(out, "virtual_path", entry.virtual_path.as_ref());
    set_truthy(out, "content_hash", entry.content_hash.as_ref());
    if let Some(status) = entry.exec_status {
        out.insert("exec_status".into(), status.as_str().into());
    }
    set_truthy(out, "declared_license", entry.declared_license.as_ref());
}

/// `serializeLockDependency`.
fn serialize_lock_dependency(entry: &LockEntry) -> Value {
    let mut out = Map::new();
    out.insert("name".into(), entry.name.clone().into());
    out.insert("version".into(), entry.version.clone().into());
    out.insert("depth".into(), emit_rs::js::number_value(entry.depth));
    match entry.source {
        LockSource::Local => _ = out.insert("source".into(), "local".into()),
        LockSource::Catalog => _ = out.insert("source".into(), "registry".into()),
        LockSource::Marketplace | LockSource::Git => {}
    }
    optional_fields(&mut out, entry);
    Value::Object(out)
}

fn plugin_entry(entry: &LockEntry) -> Value {
    let mut out = Map::new();
    out.insert("name".into(), entry.name.clone().into());
    out.insert("version".into(), entry.version.clone().into());
    out.insert("source".into(), entry.source.as_str().into());
    out.insert("integrity".into(), entry.integrity.clone().into());
    out.insert("depth".into(), emit_rs::js::number_value(entry.depth));
    out.insert("path".into(), entry.path.clone().into());
    optional_fields(&mut out, entry);
    Value::Object(out)
}

/// The text `writeLockfile` writes, with `PACKAGE_VERSION` passed in as `apm_version`.
pub fn lockfile_document(lock: &Lockfile, apm_version: &str) -> String {
    let mut dependencies: Vec<&LockEntry> = lock.plugins.iter().collect();
    dependencies.sort_by(|a, b| {
        let key = |e: &LockEntry| e.repo_url.clone().unwrap_or_else(|| e.name.clone());
        collate_rs::locale_compare(&key(a), &key(b))
    });
    let mut doc = Map::new();
    doc.insert("lockfile_version".into(), LOCKFILE_VERSION.into());
    doc.insert("generated_at".into(), lock.resolved_at.clone().into());
    doc.insert("apm_version".into(), apm_version.into());
    doc.insert(
        "dependencies".into(),
        Value::Array(
            dependencies
                .into_iter()
                .map(serialize_lock_dependency)
                .collect(),
        ),
    );
    if let Some(servers) = lock.mcp_servers.as_ref().filter(|s| !s.is_empty()) {
        let servers = servers
            .iter()
            .map(|s| {
                let mut out = Map::new();
                out.insert("name".into(), s.name.clone().into());
                for (key, value) in [
                    ("transport", &s.transport),
                    ("command", &s.command),
                    ("url", &s.url),
                ] {
                    if let Some(v) = value {
                        out.insert(key.into(), v.clone());
                    }
                }
                Value::Object(out)
            })
            .collect();
        doc.insert("mcp_servers".into(), Value::Array(servers));
    }
    if let Some(hashes) = &lock.deployed_file_hashes {
        let map: Map<String, Value> = hashes
            .iter()
            .map(|(k, v)| (k.clone(), Value::String(v.clone())))
            .collect();
        doc.insert("local_deployed_file_hashes".into(), Value::Object(map));
    }
    doc.insert("root".into(), lock.root.clone().into());
    doc.insert(
        "resource_map_hash".into(),
        lock.resource_map_hash.clone().into(),
    );
    if let Some(env) = lock.environment.as_ref().filter(|e| !e.is_empty()) {
        doc.insert("environment".into(), env.clone().into());
    }
    doc.insert(
        "plugins".into(),
        Value::Array(lock.plugins.iter().map(plugin_entry).collect()),
    );
    yaml_rs::stringify(&Value::Object(doc))
}

/// `writeLockfile`.
pub fn write_lockfile(
    project_root: &str,
    lock: &Lockfile,
    apm_version: &str,
) -> Result<(), LockError> {
    std::fs::write(
        lockfile_path(project_root),
        lockfile_document(lock, apm_version),
    )
    .map_err(LockError::Io)
}
