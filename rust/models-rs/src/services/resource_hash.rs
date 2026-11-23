//! The port of `src/services/resource-hash.ts` (without the status trace span).

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

/// `.replace(/\r\n/g, "\n").replace(/\n+$/, "")`.
fn normalize_text(content: &str) -> String {
    content
        .replace("\r\n", "\n")
        .trim_end_matches('\n')
        .to_owned()
}

/// `hashResourceBody`: `sha256:` plus the hex digest of
/// `JSON.stringify({ type, content, metadata })`.
pub fn hash_resource_body(resource_type: &str, content: &str, metadata: &Value) -> String {
    let content = normalize_text(content);
    let mut payload = Map::new();
    payload.insert("type".into(), Value::String(resource_type.to_owned()));
    payload.insert("content".into(), Value::String(content));
    payload.insert("metadata".into(), metadata.clone());
    let json = emit_rs::json::stringify(&Value::Object(payload), "");
    let digest = Sha256::digest(json.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("sha256:{hex}")
}
