//! The port of `src/services/plugin-upstream.ts`: the upstream link of a
//! plugin (`extends` or `fork`), in the package format's shape.

use models_rs::{Ctx, Result};
use node_semver_rs::{self as semver, Options};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::LazyLock;

/// `UPSTREAM_KINDS`.
pub const UPSTREAM_KINDS: [&str; 2] = ["extends", "fork"];

/// JS `\s`, which differs from the regex crate's (no U+0085, with U+FEFF).
const JS_SPACE: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

static CATALOG_REF: LazyLock<Regex> = LazyLock::new(|| {
    let part = format!("[^/@{JS_SPACE}]+");
    Regex::new(&format!("^{part}/{part}/{part}@[^{JS_SPACE}]+$")).unwrap_or_else(|e| panic!("{e}"))
});

/// `PluginUpstream`. `kind` is one of [`UPSTREAM_KINDS`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginUpstream {
    pub kind: String,
    #[serde(rename = "ref")]
    pub reference: String,
    pub version_at_link: String,
}

/// The `upstream_*` columns of a `plugins` row; `None` is a missing or NULL column.
#[derive(Debug, Clone, Default)]
pub struct UpstreamRow {
    pub upstream_kind: Option<String>,
    pub upstream_ref: Option<String>,
    pub upstream_version_at_link: Option<String>,
    pub upstream_plugin_id: Option<String>,
}

fn truthy(s: &Option<String>) -> bool {
    s.as_deref().is_some_and(|s| !s.is_empty())
}

/// `upstreamFromRow`: `(upstream, upstream_plugin_id)`.
pub fn upstream_from_row(row: &UpstreamRow) -> (Option<PluginUpstream>, Option<String>) {
    let Some(kind) = row.upstream_kind.as_deref().filter(|k| !k.is_empty()) else {
        return (None, None);
    };
    if !UPSTREAM_KINDS.contains(&kind) || !truthy(&row.upstream_ref) {
        return (None, None);
    }
    let upstream = PluginUpstream {
        kind: kind.to_owned(),
        reference: row.upstream_ref.clone().unwrap_or_default(),
        version_at_link: row.upstream_version_at_link.clone().unwrap_or_default(),
    };
    let plugin_id = row.upstream_plugin_id.clone().filter(|s| !s.is_empty());
    (Some(upstream), plugin_id)
}

/// `isCatalogUpstreamRef`.
pub fn is_catalog_upstream_ref(reference: &str) -> bool {
    CATALOG_REF.is_match(reference)
}

fn valid(version: &str) -> bool {
    semver::valid(version, Options::STRICT).is_some()
}

/// `upstreamRange`: `^x.y.z` for a semver version (no automatic major), else `*`.
pub fn upstream_range(version: &str) -> String {
    if valid(version) {
        format!("^{version}")
    } else {
        "*".to_owned()
    }
}

/// `buildUpstream`.
pub fn build_upstream(kind: &str, base: &str, version: &str) -> PluginUpstream {
    PluginUpstream {
        kind: kind.to_owned(),
        reference: format!("{base}@{}", upstream_range(version)),
        version_at_link: if valid(version) {
            version.to_owned()
        } else {
            String::new()
        },
    }
}

/// `upstreamRefBase`: the ref without its range.
pub fn upstream_ref_base(reference: &str) -> &str {
    match reference.rfind('@') {
        Some(at) if at > 0 => &reference[..at],
        _ => reference,
    }
}

/// `formatUpstreamLabel`.
pub fn format_upstream_label(upstream: &PluginUpstream) -> String {
    if upstream.version_at_link.is_empty() {
        upstream.reference.clone()
    } else {
        format!(
            "{}@{}",
            upstream_ref_base(&upstream.reference),
            upstream.version_at_link
        )
    }
}

/// `exportableUpstream`: a complete catalog link, else nothing.
pub fn exportable_upstream(upstream: Option<&PluginUpstream>) -> Option<PluginUpstream> {
    let upstream = upstream?;
    if !is_catalog_upstream_ref(&upstream.reference) || !valid(&upstream.version_at_link) {
        return None;
    }
    Some(upstream.clone())
}

/// `parseUpstream`: `extensions["com.harnesstap"].upstream` from a package.
pub fn parse_upstream(raw: &Value) -> Option<PluginUpstream> {
    let record = raw.as_object()?;
    let kind = record.get("kind")?.as_str()?;
    let reference = record.get("ref")?.as_str()?;
    let version_at_link = record.get("version_at_link")?.as_str()?;
    if !UPSTREAM_KINDS.contains(&kind) {
        return None;
    }
    exportable_upstream(Some(&PluginUpstream {
        kind: kind.to_owned(),
        reference: reference.to_owned(),
        version_at_link: version_at_link.to_owned(),
    }))
}

/// `setPluginUpstream`.
pub fn set_plugin_upstream(
    ctx: &Ctx,
    plugin_id: &str,
    upstream: &PluginUpstream,
    upstream_plugin_id: &str,
) -> Result<()> {
    ctx.db.run(
        "UPDATE plugins\n       SET upstream_kind = ?, upstream_ref = ?, upstream_version_at_link = ?, upstream_plugin_id = ?\n       WHERE id = ?",
        [
            upstream.kind.as_str(),
            upstream.reference.as_str(),
            upstream.version_at_link.as_str(),
            upstream_plugin_id,
            plugin_id,
        ],
    )?;
    Ok(())
}
