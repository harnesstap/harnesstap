//! `apm-targets.ts`: OpenAPM target names to HarnessTap harnesses, target detection from the
//! project tree, and the compile target resolution. Also carries the three small helpers it
//! takes from `harness-targets.ts`.
//!
//! The alias and target tables are plain objects in the original, so a token named like an
//! `Object.prototype` member (`constructor`, ...) reads that member there; here it is an
//! unknown target. The recordings leave such tokens out.

use emit_rs::js::{to_string, trim};
use serde::Serialize;
use serde_json::{Map, Value};

/// What resolution throws.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TargetError {
    /// `TargetFlagError`, a `CliUsageError` with exit code 2.
    Flag(String),
    /// The plain `Error` of `assertSupportedHarnessTargets`.
    Unsupported(String),
}

impl TargetError {
    pub fn message(&self) -> &str {
        match self {
            Self::Flag(m) | Self::Unsupported(m) => m,
        }
    }
}

/// `CANONICAL_APM_TARGETS`.
pub const CANONICAL_APM_TARGETS: [&str; 11] = [
    "copilot",
    "claude",
    "grok-build",
    "cursor",
    "opencode",
    "codex",
    "gemini",
    "antigravity",
    "windsurf",
    "kiro",
    "agent-skills",
];

/// `APM_ALL_TARGETS`.
pub const APM_ALL_TARGETS: [&str; 10] = [
    "copilot",
    "claude",
    "grok-build",
    "cursor",
    "opencode",
    "codex",
    "gemini",
    "antigravity",
    "windsurf",
    "kiro",
];

/// `APM_TARGET_TO_HARNESS`, in its key order.
const TARGET_TO_HARNESS: [(&str, &str); 10] = [
    ("claude", "claude-code"),
    ("copilot", "github-copilot"),
    ("cursor", "cursor"),
    ("codex", "codex"),
    ("gemini", "gemini-cli"),
    ("antigravity", "antigravity"),
    ("opencode", "opencode"),
    ("windsurf", "windsurf"),
    ("grok-build", "grok-build"),
    ("kiro", "kiro"),
];

struct Catalog {
    deploy_dir: &'static str,
    signals: &'static [&'static str],
    explicit_only: bool,
    needs: &'static str,
}

/// `APM_TARGET_CATALOG`.
fn catalog(target: &str) -> Option<Catalog> {
    let c = |deploy_dir, signals, explicit_only, needs| Catalog {
        deploy_dir,
        signals,
        explicit_only,
        needs,
    };
    Some(match target {
        "copilot" => c(
            ".github/",
            &[
                ".github/copilot-instructions.md",
                ".github/instructions",
                ".github/agents",
                ".github/prompts",
                ".github/hooks",
            ],
            false,
            "needs .github/copilot-instructions.md",
        ),
        "claude" => c(
            ".claude/",
            &[".claude", "CLAUDE.md"],
            false,
            "needs .claude/ or CLAUDE.md",
        ),
        "grok-build" => c(".grok/", &[".grok"], false, "needs .grok/"),
        "cursor" => c(
            ".cursor/",
            &[".cursor", ".cursorrules"],
            false,
            "needs .cursor/ or .cursorrules",
        ),
        "opencode" => c(".opencode/", &[".opencode"], false, "needs .opencode/"),
        "codex" => c(".codex/", &[".codex"], false, "needs .codex/"),
        "gemini" => c(
            ".gemini/",
            &[".gemini", "GEMINI.md"],
            false,
            "needs .gemini/ or GEMINI.md",
        ),
        "antigravity" => c(".agents/", &[], true, "explicit-only (not auto-detected)"),
        "windsurf" => c(".windsurf/", &[".windsurf"], false, "needs .windsurf/"),
        "kiro" => c(".kiro/", &[".kiro"], false, "needs .kiro/"),
        "agent-skills" => c(
            ".agents/",
            &[],
            true,
            "meta-target; opt in via targets: or --target",
        ),
        _ => return None,
    })
}

fn target_to_harness(target: &str) -> Option<&'static str> {
    TARGET_TO_HARNESS
        .iter()
        .find(|(t, _)| *t == target)
        .map(|(_, h)| *h)
}

fn harness_to_apm(harness: &str) -> Option<&'static str> {
    TARGET_TO_HARNESS
        .iter()
        .find(|(_, h)| *h == harness)
        .map(|(t, _)| *t)
}

/// `parsePlatformFilter` (`harness-targets.ts`).
pub fn parse_platform_filter(platform: Option<&str>) -> Option<Vec<String>> {
    platform.map(|p| {
        p.split(',')
            .map(|s| trim(s).to_owned())
            .filter(|s| !s.is_empty())
            .collect()
    })
}

/// `uniqueHarnessTargets` (`harness-targets.ts`).
pub fn unique_harness_targets(harnesses: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for h in harnesses.iter().filter(|h| !h.is_empty()) {
        if !out.contains(h) {
            out.push(h.clone());
        }
    }
    out
}

/// `assertSupportedHarnessTargets` (`harness-targets.ts`).
pub fn assert_supported_harness_targets(harnesses: &[String]) -> Result<(), TargetError> {
    let invalid: Vec<&str> = harnesses
        .iter()
        .filter(|h| platforms_rs::get_platform(h).is_none())
        .map(String::as_str)
        .collect();
    if invalid.is_empty() {
        Ok(())
    } else {
        Err(TargetError::Unsupported(format!(
            "Unsupported harness: {}",
            invalid.join(", ")
        )))
    }
}

/// `/^x-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$/`.
fn is_vendor_target(token: &str) -> bool {
    let Some(rest) = token.strip_prefix("x-") else {
        return false;
    };
    let ok = |s: &str| {
        let mut chars = s.chars();
        chars.next().is_some_and(|c| c.is_ascii_lowercase())
            && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    };
    // Some split at a `-` must leave two valid parts; `[a-z0-9-]*` may hold dashes itself.
    rest.char_indices()
        .filter(|(_, c)| *c == '-')
        .any(|(i, _)| ok(&rest[..i]) && ok(&rest[i + 1..]))
}

/// `normalizeApmTargetToken`.
fn normalize(token: &str) -> String {
    let lowered = trim(token).to_lowercase();
    match lowered.as_str() {
        "vscode" | "agents" => "copilot".into(),
        _ => lowered,
    }
}

/// `aliasWarning`.
fn alias_warning(token: &str) -> Option<String> {
    let lowered = trim(token).to_lowercase();
    matches!(lowered.as_str(), "vscode" | "agents")
        .then(|| format!("APM target \"{token}\" is a deprecated alias for copilot"))
}

struct Mapped {
    harness: Option<String>,
    canonical: Option<String>,
    skip_reason: Option<String>,
}

/// `mapOneTarget`.
fn map_one_target(token: &str) -> Mapped {
    let none = Mapped {
        harness: None,
        canonical: None,
        skip_reason: None,
    };
    let normalized = normalize(token);
    if normalized == "agent-skills" {
        return Mapped {
            skip_reason: Some(format!(
                "APM target \"{token}\" is not a HarnessTap harness; skipping"
            )),
            ..none
        };
    }
    if normalized == "all" {
        return none;
    }
    if let Some(h) = target_to_harness(&normalized) {
        return Mapped {
            harness: Some(h.into()),
            canonical: Some(normalized),
            ..none
        };
    }
    if platforms_rs::get_platform(&normalized).is_some() {
        let canonical =
            harness_to_apm(&normalized).map_or_else(|| normalized.clone(), str::to_owned);
        return Mapped {
            harness: Some(normalized),
            canonical: Some(canonical),
            ..none
        };
    }
    if is_vendor_target(&normalized) {
        return Mapped {
            skip_reason: Some(format!("Unknown APM vendor target \"{token}\"; skipping")),
            ..none
        };
    }
    Mapped {
        skip_reason: Some(format!("Unknown APM target \"{token}\"; skipping")),
        ..none
    }
}

/// `collectApmTargetTokens`.
pub fn collect_apm_target_tokens(document: &Map<String, Value>) -> Vec<String> {
    let raw = document
        .get("targets")
        .filter(|v| !v.is_null())
        .or_else(|| document.get("target"));
    match raw {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(items)) => items.iter().map(to_string).collect(),
        _ => Vec::new(),
    }
}

/// `ApmTargetMapping`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApmTargetMapping {
    pub harness_targets: Vec<String>,
    pub skipped_targets: Vec<String>,
    pub warnings: Vec<String>,
    pub canonical_targets: Vec<String>,
}

/// `mapApmTargets`.
pub fn map_apm_targets(tokens: &[String]) -> ApmTargetMapping {
    let mut out = ApmTargetMapping::default();
    let has_all = tokens.iter().any(|t| normalize(t) == "all");
    let expanded: Vec<String> = if has_all {
        APM_ALL_TARGETS
            .iter()
            .map(|t| (*t).to_owned())
            .chain(tokens.iter().filter(|t| normalize(t) != "all").cloned())
            .collect()
    } else {
        tokens.to_vec()
    };
    let mut seen: Vec<String> = Vec::new();
    for token in &expanded {
        if let Some(w) = alias_warning(token) {
            out.warnings.push(w);
        }
        let mapped = map_one_target(token);
        if let Some(reason) = mapped.skip_reason {
            out.skipped_targets.push(token.clone());
            out.warnings.push(reason);
            continue;
        }
        let Some(harness) = mapped.harness.filter(|h| !h.is_empty()) else {
            continue;
        };
        if seen.contains(&harness) {
            continue;
        }
        seen.push(harness.clone());
        out.harness_targets.push(harness);
        if let Some(c) = mapped.canonical.filter(|c| !c.is_empty()) {
            out.canonical_targets.push(c);
        }
    }
    out
}

/// `ApmTargetSignal`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ApmTargetSignal {
    pub target: String,
    pub matched: String,
}

fn path_exists(root: &str, relative: &str) -> bool {
    std::fs::metadata(db_rs::paths::posix_join(&[root, relative])).is_ok()
}

fn is_directory(root: &str, relative: &str) -> bool {
    let path = db_rs::paths::posix_join(&[root, relative]);
    std::fs::metadata(&path).is_ok() && std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir())
}

/// `signalMatches`.
fn signal_matches(root: &str, signal: &str) -> bool {
    if (signal.contains('.') && !signal.starts_with('.'))
        || signal.ends_with(".md")
        || signal == ".cursorrules"
    {
        return path_exists(root, signal);
    }
    is_directory(root, signal)
}

/// `detectApmTargetSignals`.
pub fn detect_apm_target_signals(project_root: &str) -> Vec<ApmTargetSignal> {
    let mut detected = Vec::new();
    for target in CANONICAL_APM_TARGETS {
        let Some(catalog) = catalog(target).filter(|c| !c.explicit_only) else {
            continue;
        };
        if let Some(matched) = catalog
            .signals
            .iter()
            .find(|s| signal_matches(project_root, s))
        {
            let matched = if matched.ends_with(".md") || *matched == ".cursorrules" {
                (*matched).to_owned()
            } else {
                format!("{matched}/")
            };
            detected.push(ApmTargetSignal {
                target: target.into(),
                matched,
            });
        }
    }
    detected
}

/// `harnessSlugForApmTarget`.
pub fn harness_slug_for_apm_target(target: &str) -> Option<String> {
    map_one_target(target).harness
}

/// `apmTargetForHarness`.
pub fn apm_target_for_harness(harness: &str) -> String {
    harness_to_apm(harness).map_or_else(|| harness.to_owned(), str::to_owned)
}

/// `deployDirForApmTarget`.
pub fn deploy_dir_for_apm_target(target: &str) -> String {
    catalog(&normalize(target)).map_or_else(String::new, |c| c.deploy_dir.to_owned())
}

/// The flags `assertTargetSelectionFlags` checks.
#[derive(Clone, Debug, Default)]
pub struct ResolveCompileTargetsInput {
    pub project_root: String,
    pub cli_target: Option<String>,
    pub cli_all: bool,
    pub cli_harness: Option<String>,
    /// Already-mapped harness slugs from `apm.yml` `targets` / `compilation.target`.
    pub manifest_harness_targets: Option<Vec<String>>,
    /// Project/global harness preference slugs.
    pub preference_harnesses: Option<Vec<String>>,
    /// `detectPlatforms` slugs, used after the APM file system signals.
    pub fallback_harnesses: Option<Vec<String>>,
}

/// `assertTargetSelectionFlags`.
pub fn assert_target_selection_flags(
    cli_target: Option<&str>,
    cli_all: bool,
    cli_harness: Option<&str>,
) -> Result<(), TargetError> {
    let target = cli_target.is_some_and(|t| !t.is_empty());
    let harness = cli_harness.is_some_and(|h| !h.is_empty());
    let flag = |m: &str| Err(TargetError::Flag(m.to_owned()));
    if cli_all && target {
        return flag("error: cannot use --all together with --target");
    }
    if cli_all && harness {
        return flag("error: cannot use --all together with --harness");
    }
    if target && harness {
        return flag("error: cannot use --target together with --harness");
    }
    Ok(())
}

/// `TargetResolutionSource`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Cli,
    Manifest,
    Preference,
    Autodetect,
    Empty,
}

/// `ResolvedCompileTargets`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedCompileTargets {
    pub harness_targets: Vec<String>,
    pub canonical_targets: Vec<String>,
    pub source: Source,
    pub warnings: Vec<String>,
    pub skipped_targets: Vec<String>,
    pub detected_signals: Vec<ApmTargetSignal>,
}

fn from_mapping(
    mapping: ApmTargetMapping,
    source: Source,
    detected_signals: Vec<ApmTargetSignal>,
) -> Result<ResolvedCompileTargets, TargetError> {
    assert_supported_harness_targets(&mapping.harness_targets)?;
    Ok(ResolvedCompileTargets {
        harness_targets: unique_harness_targets(&mapping.harness_targets),
        canonical_targets: mapping.canonical_targets,
        source,
        warnings: mapping.warnings,
        skipped_targets: mapping.skipped_targets,
        detected_signals,
    })
}

fn from_harness_slugs(
    slugs: &[String],
    source: Source,
) -> Result<ResolvedCompileTargets, TargetError> {
    let unique = unique_harness_targets(slugs);
    assert_supported_harness_targets(&unique)?;
    Ok(ResolvedCompileTargets {
        canonical_targets: unique.iter().map(|h| apm_target_for_harness(h)).collect(),
        harness_targets: unique,
        source,
        warnings: Vec::new(),
        skipped_targets: Vec::new(),
        detected_signals: Vec::new(),
    })
}

/// `resolveCompileTargets`.
pub fn resolve_compile_targets(
    input: &ResolveCompileTargetsInput,
) -> Result<ResolvedCompileTargets, TargetError> {
    assert_target_selection_flags(
        input.cli_target.as_deref(),
        input.cli_all,
        input.cli_harness.as_deref(),
    )?;
    if input.cli_all {
        return from_mapping(
            map_apm_targets(&["all".to_owned()]),
            Source::Cli,
            Vec::new(),
        );
    }
    if let Some(target) = input.cli_target.as_deref().filter(|t| !trim(t).is_empty()) {
        let tokens = parse_platform_filter(Some(target)).unwrap_or_default();
        let mut mapped = map_apm_targets(&tokens);
        if tokens.iter().any(|t| normalize(t) == "all") {
            mapped
                .warnings
                .insert(0, "--target all is deprecated; prefer --all".into());
        }
        return from_mapping(mapped, Source::Cli, Vec::new());
    }
    if let Some(harness) = input.cli_harness.as_deref().filter(|h| !trim(h).is_empty()) {
        let slugs =
            unique_harness_targets(&parse_platform_filter(Some(harness)).unwrap_or_default());
        return from_harness_slugs(&slugs, Source::Cli);
    }
    if let Some(m) = input
        .manifest_harness_targets
        .as_ref()
        .filter(|m| !m.is_empty())
    {
        return from_harness_slugs(m, Source::Manifest);
    }
    if let Some(p) = input
        .preference_harnesses
        .as_ref()
        .filter(|p| !p.is_empty())
    {
        return from_harness_slugs(p, Source::Preference);
    }
    let detected = detect_apm_target_signals(&input.project_root);
    if !detected.is_empty() {
        let targets: Vec<String> = detected.iter().map(|d| d.target.clone()).collect();
        return from_mapping(map_apm_targets(&targets), Source::Autodetect, detected);
    }
    if let Some(f) = input.fallback_harnesses.as_ref().filter(|f| !f.is_empty()) {
        return from_harness_slugs(f, Source::Autodetect);
    }
    Ok(ResolvedCompileTargets {
        harness_targets: Vec::new(),
        canonical_targets: Vec::new(),
        source: Source::Empty,
        warnings: Vec::new(),
        skipped_targets: Vec::new(),
        detected_signals: Vec::new(),
    })
}

/// `TargetPreviewRow`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetPreviewRow {
    pub target: String,
    pub status: &'static str,
    pub source: String,
    pub deploy_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
}

/// `sourceLabel`.
fn source_label(resolved: &ResolvedCompileTargets, target: &str) -> String {
    let listed = resolved.canonical_targets.iter().any(|t| t == target);
    match resolved.source {
        Source::Cli if listed => return "--target / --all".into(),
        Source::Manifest if listed => return "apm.yml targets:".into(),
        Source::Autodetect => {
            if let Some(hit) = resolved
                .detected_signals
                .iter()
                .find(|d| d.target == target)
            {
                return hit.matched.clone();
            }
        }
        Source::Preference if listed => return "harness preference".into(),
        _ => {}
    }
    catalog(target).map_or_else(|| "inactive".into(), |c| c.needs.to_owned())
}

/// `previewApmTargets`.
pub fn preview_apm_targets(
    resolved: &ResolvedCompileTargets,
    include_agent_skills: bool,
) -> Vec<TargetPreviewRow> {
    let mut rows = Vec::new();
    for target in CANONICAL_APM_TARGETS {
        if target == "agent-skills" && !include_agent_skills {
            continue;
        }
        let catalog = catalog(target);
        let active = resolved.canonical_targets.iter().any(|t| t == target);
        rows.push(TargetPreviewRow {
            target: target.into(),
            status: if active { "active" } else { "inactive" },
            source: if active {
                source_label(resolved, target)
            } else {
                catalog
                    .as_ref()
                    .map_or_else(|| "inactive".into(), |c| c.needs.to_owned())
            },
            deploy_dir: catalog.map_or_else(String::new, |c| c.deploy_dir.to_owned()),
            harness: if active {
                harness_slug_for_apm_target(target).filter(|h| !h.is_empty())
            } else {
                None
            },
        });
    }
    rows
}
