//! The Rust port of `src/version.ts`.

#![forbid(unsafe_code)]

use serde_json::Value;

/// The npm package version, read from the repository's `package.json` at build time.
const PACKAGE_JSON: &str = include_str!("../../../package.json");

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

/// JavaScript truthiness of a JSON value (`undefined` and `null` are falsy).
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// Port of the private `compactGitSha`: 7 to 40 hex digits, lowercased, cut to 7.
fn compact_git_sha(sha: Option<&str>) -> Option<String> {
    let trimmed = js_trim(sha?).to_lowercase();
    let is_sha =
        (7..=40).contains(&trimmed.len()) && trimmed.bytes().all(|b| b.is_ascii_hexdigit());
    if !is_sha {
        return None;
    }
    Some(trimmed[..7].to_string())
}

/// Reads one variable from the given env object, or from the process when there is none.
fn env_var(env: Option<&Value>, name: &str) -> Result<Option<String>, String> {
    match env {
        None => Ok(std::env::var(name).ok()),
        Some(Value::Object(map)) => match map.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(s)) => Ok(Some(s.clone())),
            Some(other) => Err(format!("TypeError: {name} is not a string: {other}")),
        },
        Some(other) => Err(format!("TypeError: env is not an object: {other}")),
    }
}

/// Port of `isReleaseBuild` (`src/version.ts:22`).
pub fn is_release_build(env: Option<Value>) -> Result<bool, String> {
    let env = env.as_ref();
    Ok(env_var(env, "HT_RELEASE")?.as_deref() == Some("1")
        || env_var(env, "HARNESSTAP_RELEASE")?.as_deref() == Some("1"))
}

/// Port of `readGitSha` (`src/version.ts:27`).
pub fn read_git_sha(env: Option<Value>, cwd: Option<String>) -> Result<Option<String>, String> {
    let env = env.as_ref();
    // `env.HT_GIT_SHA ?? env.GITHUB_SHA`: an empty string does not fall through.
    let from_env = match env_var(env, "HT_GIT_SHA")? {
        Some(sha) => Some(sha),
        None => env_var(env, "GITHUB_SHA")?,
    };
    if let Some(sha) = compact_git_sha(from_env.as_deref()) {
        return Ok(Some(sha));
    }
    let mut git = std::process::Command::new("git");
    git.args(["rev-parse", "HEAD"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if let Some(dir) = cwd {
        git.current_dir(dir);
    }
    match git.output() {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            Ok(compact_git_sha(Some(js_trim(&text))))
        }
        _ => Ok(None),
    }
}

/// Port of `formatDevBuildVersion` (`src/version.ts:52`).
pub fn format_dev_build_version(version: String, options: Option<Value>) -> Result<String, String> {
    let trimmed = js_trim(&version);
    let options = options.unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    if truthy(options.get("isRelease")) {
        return Ok(trimmed.to_string());
    }
    if trimmed.contains("-dev+") {
        return Ok(trimmed.to_string());
    }
    let git_sha = match options.get("gitSha") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.as_str()),
        Some(other) => return Err(format!("TypeError: gitSha is not a string: {other}")),
    };
    Ok(match compact_git_sha(git_sha) {
        None => format!("{trimmed}-dev"),
        Some(sha) => format!("{trimmed}-dev+{sha}"),
    })
}

/// The `version` field of `package.json`.
fn package_version() -> Result<String, String> {
    let manifest: Value = serde_json::from_str(PACKAGE_JSON)
        .map_err(|e| format!("Error: cannot parse package.json: {e}"))?;
    manifest
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Error: package.json has no version".to_string())
}

/// Port of `resolveBuildVersion` (`src/version.ts:71`).
pub fn resolve_build_version(env: Option<Value>) -> Result<String, String> {
    let is_release = is_release_build(env.clone())?;
    let git_sha = read_git_sha(env, None)?;
    let mut options = serde_json::Map::new();
    options.insert("isRelease".into(), Value::Bool(is_release));
    options.insert("gitSha".into(), git_sha.map_or(Value::Null, Value::String));
    format_dev_build_version(package_version()?, Some(Value::Object(options)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compacts_only_hex_shas() {
        assert_eq!(
            compact_git_sha(Some(" ABCDEF1234 ")),
            Some("abcdef1".into())
        );
        assert_eq!(compact_git_sha(Some("abc")), None);
        assert_eq!(
            compact_git_sha(Some("\u{feff}abcdef1")),
            Some("abcdef1".into())
        );
        assert_eq!(compact_git_sha(Some(&"a".repeat(41))), None);
    }

    #[test]
    fn empty_ht_git_sha_does_not_fall_back_to_github_sha() {
        let env = json!({"HT_GIT_SHA": "", "GITHUB_SHA": "abcdef1"});
        assert_eq!(
            read_git_sha(Some(env), Some("/nonexistent-dir".into())),
            Ok(None)
        );
    }

    #[test]
    fn formats_dev_versions() {
        let opts = json!({"gitSha": "ABCDEF1234"});
        assert_eq!(
            format_dev_build_version("1.6.3".into(), Some(opts)),
            Ok("1.6.3-dev+abcdef1".into())
        );
        assert_eq!(
            format_dev_build_version(" 1.6.3 ".into(), None),
            Ok("1.6.3-dev".into())
        );
        let release = json!({"isRelease": true});
        assert_eq!(
            format_dev_build_version("1.6.3".into(), Some(release)),
            Ok("1.6.3".into())
        );
    }
}
