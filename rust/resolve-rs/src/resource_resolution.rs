//! `resolutionKey` and `resourceFingerprint` from `resource-resolution.ts`. The rest of that
//! file (the pass that picks winning resources) reads the database and lives in
//! `plugin-model-rs` (`resolve::resolve_resources`).

use models_rs::resource::Resource;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// The original reads `metadata.key` on an `env_var` whose metadata is `null` and throws a
/// `TypeError`. Stored resources always carry an object, so this only shows up in hand-built ones.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NullMetadata;

/// `resolutionKey`: `type:name`, or `env_var:<metadata.key || name>`.
pub fn resolution_key(resource: &Resource) -> Result<String, NullMetadata> {
    if resource.resource_type == "env_var" {
        let key = match &resource.metadata {
            Value::Null => return Err(NullMetadata),
            Value::Object(map) => map.get("key").filter(|k| emit_rs::js::truthy(k)),
            _ => None,
        };
        let key = key.map_or_else(|| resource.name.clone(), emit_rs::js::to_string);
        return Ok(format!("env_var:{key}"));
    }
    Ok(format!("{}:{}", resource.resource_type, resource.name))
}

/// `resourceFingerprint`: the stored `content_hash`, else the sha256 of the content, a NUL and
/// the JSON of the metadata.
pub fn resource_fingerprint(resource: &Resource) -> String {
    if !resource.content_hash.is_empty() {
        return resource.content_hash.clone();
    }
    let empty = Value::Object(serde_json::Map::new());
    let metadata = if resource.metadata.is_null() {
        &empty
    } else {
        &resource.metadata
    };
    let mut hash = Sha256::new();
    hash.update(resource.content.as_bytes());
    hash.update(b"\0");
    hash.update(emit_rs::json::stringify(metadata, "").as_bytes());
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}
