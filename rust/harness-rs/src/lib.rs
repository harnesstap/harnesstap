//! What `ht harness` reaches beyond the models: the non-interactive half of
//! `resolveHarnessSelection` (`src/services/harness-config.ts`) with the
//! `harness-targets.ts` and `parse-flags.ts` helpers, `detectPlatforms`
//! (`src/services/scanner.ts`), and the path-keyed half of
//! `src/services/project-identity.ts` with `getGitOrigin` (`src/services/git.ts`).

pub mod project_identity;
pub mod scanner;

use models_rs::harness::normalize_registered_harnesses;
use models_rs::js_trim;

/// `parseHarnessList` / `parseHarnessAliases` (`src/cli/handlers/parse-flags.ts`).
pub fn parse_harness_list(value: Option<&str>) -> Option<Vec<String>> {
    value.map(|v| {
        v.split(',')
            .map(js_trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect()
    })
}

/// `registeredFromLegacyParts` (`--main`/`--aliases`).
pub fn registered_from_legacy_parts(main: Option<&str>, aliases: Option<&[String]>) -> Vec<String> {
    let mut all: Vec<&str> = main.filter(|m| !m.is_empty()).into_iter().collect();
    all.extend(aliases.unwrap_or_default().iter().map(String::as_str));
    normalize_registered_harnesses(&all)
}

/// The inputs of `resolveHarnessSelection` once it does not prompt.
#[derive(Debug, Default)]
pub struct SelectionInput<'a> {
    pub harnesses: Option<&'a [String]>,
    pub main: Option<&'a str>,
    pub aliases: Option<&'a [String]>,
    /// `registeredHarnessesOf(options.current)`.
    pub current: Option<&'a [String]>,
    pub detected: &'a [String],
}

fn validate_harnesses(harnesses: &[String]) -> Result<(), String> {
    let invalid: Vec<&str> = harnesses
        .iter()
        .filter(|h| platforms_rs::get_platform(h).is_none())
        .map(String::as_str)
        .collect();
    if invalid.is_empty() {
        Ok(())
    } else {
        Err(format!("Unsupported harness: {}", invalid.join(", ")))
    }
}

/// `resolveHarnessSelection` with `nonInteractive` set or stdin not a TTY: the
/// registered set, or the error it throws.
pub fn resolve_harness_selection(input: &SelectionInput) -> Result<Vec<String>, String> {
    let registered = default_registered(input);
    validate_harnesses(&registered)?;
    Ok(registered)
}

fn default_registered(input: &SelectionInput) -> Vec<String> {
    if let Some(harnesses) = input.harnesses.filter(|h| !h.is_empty()) {
        return normalize_registered_harnesses(harnesses);
    }
    let from_flags = registered_from_legacy_parts(input.main, input.aliases);
    if !from_flags.is_empty() {
        return from_flags;
    }
    let current = normalize_registered_harnesses(input.current.unwrap_or_default());
    if !current.is_empty() {
        return current;
    }
    let detected = normalize_registered_harnesses(input.detected);
    if !detected.is_empty() {
        return detected;
    }
    platforms_rs::get_platform_ids()
        .first()
        .map(|id| vec![(*id).to_owned()])
        .unwrap_or_default()
}
