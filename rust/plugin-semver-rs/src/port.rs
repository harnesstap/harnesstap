//! The Rust port of `src/services/plugin-semver.ts`.

#![forbid(unsafe_code)]

use regex::Regex;
use std::sync::LazyLock;

/// Characters JavaScript's `String.prototype.trim` removes: WhiteSpace and LineTerminator.
fn is_js_trim(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_trim)
}

/// node-semver 7 `FULL` (strict): `v?` MAINVERSION PRERELEASE? BUILD?. `\d` is ASCII in JS.
static SEMVER_FULL: LazyLock<Regex> = LazyLock::new(|| {
    let num = "0|[1-9][0-9]*";
    let non_num = "[0-9]*[a-zA-Z-][a-zA-Z0-9-]*";
    let pre_id = format!("(?:{non_num}|{num})");
    let build_id = "[a-zA-Z0-9-]+";
    Regex::new(&format!(
        r"^v?({num})\.({num})\.({num})(?:-({pre_id}(?:\.{pre_id})*))?(?:\+({build_id}(?:\.{build_id})*))?$"
    ))
    .expect("valid pattern")
});

static GIT_SHA: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?i)[0-9a-f]{7,40}$").expect("valid pattern"));

/// `semver.valid(version)` is truthy.
fn semver_valid(version: &str) -> bool {
    const MAX_LENGTH: usize = 256;
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
    if version.encode_utf16().count() > MAX_LENGTH {
        return false;
    }
    let Some(m) = SEMVER_FULL.captures(js_trim(version)) else {
        return false;
    };
    (1..=3).all(|i| m[i].parse::<f64>().is_ok_and(|n| n <= MAX_SAFE_INTEGER))
}

/// Port of the private `gitBuildMetadata`.
fn git_build_metadata(sha: Option<&str>) -> Option<String> {
    let trimmed = js_trim(sha?);
    if trimmed.is_empty() {
        return None;
    }
    let compact: String = trimmed
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(12)
        .map(|c| c.to_ascii_lowercase())
        .collect();
    (!compact.is_empty()).then_some(compact)
}

/// Port of `semverSafePluginVersion` (`src/services/plugin-semver.ts:22`).
pub fn semver_safe_plugin_version(
    version: Option<String>,
    git_sha: Option<String>,
) -> Result<String, String> {
    let trimmed = version.as_deref().map(js_trim);
    if let Some(t) = trimmed
        && !t.is_empty()
        && semver_valid(t)
    {
        return Ok(t.to_owned());
    }
    let candidate = match trimmed {
        Some(t) if !t.is_empty() && GIT_SHA.is_match(t) => Some(t),
        _ => git_sha.as_deref(),
    };
    Ok(match git_build_metadata(candidate) {
        Some(sha) => format!("0.0.0+git.{sha}"),
        None => "0.0.0".to_owned(),
    })
}

/// Port of `pluginDescriptionFromManifest` (`src/services/plugin-semver.ts:37`).
pub fn plugin_description_from_manifest(description: Option<String>) -> Result<String, String> {
    Ok(description.as_deref().map(js_trim).unwrap_or("").to_owned())
}
