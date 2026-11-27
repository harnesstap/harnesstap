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

/// `writeLockfile`. Leaves the file alone when only its `generated_at:` line differs (#658).
pub fn write_lockfile(
    project_root: &str,
    lock: &Lockfile,
    apm_version: &str,
) -> Result<(), LockError> {
    let path = lockfile_path(project_root);
    let rendered = lockfile_document(lock, apm_version);
    if std::fs::metadata(&path).is_ok() {
        let existing = std::fs::read(&path).map_err(LockError::Io)?;
        if without_generated_at(&String::from_utf8_lossy(&existing))
            == without_generated_at(&rendered)
        {
            return Ok(());
        }
    }
    std::fs::write(path, rendered).map_err(LockError::Io)
}

/// `text.replace(/^generated_at:.*$/m, "generated_at:")`: the first such line only, where a
/// line ends at any JavaScript line terminator.
fn without_generated_at(text: &str) -> String {
    const KEY: &str = "generated_at:";
    let is_terminator = |c: char| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}');
    let mut line_start = 0;
    loop {
        if text[line_start..].starts_with(KEY) {
            let rest = &text[line_start..];
            let end = line_start + rest.find(is_terminator).unwrap_or(rest.len());
            return format!("{}{KEY}{}", &text[..line_start], &text[end..]);
        }
        match text[line_start..].find(is_terminator) {
            Some(i) => {
                let c = text[line_start + i..].chars().next().unwrap_or('\n');
                line_start += i + c.len_utf8();
            }
            None => return text.to_owned(),
        }
    }
}
