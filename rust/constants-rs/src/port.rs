//! The Rust port of `src/constants/`.

#![forbid(unsafe_code)]

use serde_json::Value;

pub const CANONICAL_CATALOG_BASELINE: &str = "engineering-foundation";
pub const CANONICAL_CATALOG_SEARCH_HINT: &str = "foundation";
pub const PROFILE_PLUGIN_TAG: &str = "profile";
pub const GLOBAL_DEFAULT_PROFILE_NAME: &str = "global default";
pub const LEGACY_DEFAULT_PROFILE_NAME: &str = "default";
pub const PROJECT_DEFAULT_PROFILE_NAME: &str = "project default";
pub const PROJECT_PROFILE_TAG: &str = "project";
pub const CLEARED_GLOBAL_PROFILE_NAME: &str = "empty";
pub const CLEARED_GLOBAL_PROFILE_PLUGIN_ID: &str = "builtin:empty";

/// Characters JavaScript's `String.prototype.trim` removes: WhiteSpace and LineTerminator.
fn is_js_trim(c: char) -> bool {
    matches!(
        c,
        '\u{9}'..='\u{d}'
            | ' '
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

/// `plugin.tags.includes(tag)`: strict equality against each element.
fn has_tag(plugin: &Value, tag: &str) -> Result<bool, String> {
    match plugin.get("tags") {
        Some(Value::Array(tags)) => Ok(tags.iter().any(|t| t.as_str() == Some(tag))),
        Some(Value::String(tags)) => Ok(tags.contains(tag)),
        _ => Err("TypeError: Cannot read properties of undefined (reading 'includes')".into()),
    }
}

/// Port of `isEmptyBuiltinProfile` (`src/constants/profile.ts:43`).
pub fn is_empty_builtin_profile(name: String) -> Result<bool, String> {
    Ok(name.trim_matches(is_js_trim) == CLEARED_GLOBAL_PROFILE_NAME)
}

/// Port of `isReservedProfileName` (`src/constants/profile.ts:47`).
pub fn is_reserved_profile_name(name: String) -> Result<bool, String> {
    is_empty_builtin_profile(name)
}

/// Port of `isProfilePlugin` (`src/constants/profile.ts:51`).
pub fn is_profile_plugin(plugin: Value) -> Result<bool, String> {
    has_tag(&plugin, PROFILE_PLUGIN_TAG)
}

/// Port of `isProjectProfilePlugin` (`src/constants/profile.ts:55`).
pub fn is_project_profile_plugin(plugin: Value) -> Result<bool, String> {
    Ok(has_tag(&plugin, PROFILE_PLUGIN_TAG)? && has_tag(&plugin, PROJECT_PROFILE_TAG)?)
}

/// Port of `isAutoSeededDefaultProfileName` (`src/constants/profile.ts:59`).
pub fn is_auto_seeded_default_profile_name(name: String) -> Result<bool, String> {
    Ok(name == LEGACY_DEFAULT_PROFILE_NAME || name == GLOBAL_DEFAULT_PROFILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn empty_profile_name_is_trimmed() {
        assert_eq!(
            is_empty_builtin_profile("\u{feff} empty\n".into()),
            Ok(true)
        );
        assert_eq!(is_empty_builtin_profile("\u{85}empty".into()), Ok(false));
    }

    #[test]
    fn project_profiles_need_both_tags() {
        assert_eq!(
            is_project_profile_plugin(json!({"tags": ["profile", "project"]})),
            Ok(true)
        );
        assert_eq!(
            is_project_profile_plugin(json!({"tags": ["project"]})),
            Ok(false)
        );
        assert!(is_profile_plugin(json!({})).is_err());
    }
}
