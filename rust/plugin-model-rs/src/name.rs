//! The port of `src/services/agent-plugins/name.ts`: Agent Plugins package
//! names and Agent Skills names.

use regex::Regex;
use std::sync::LazyLock;

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).unwrap_or_else(|e| panic!("{e}"))
}

static AP_NAME_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| re("^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$"));
static AGENT_SKILL_NAME: LazyLock<Regex> = LazyLock::new(|| re("^[a-z0-9]+(?:-[a-z0-9]+)*$"));

/// `AP_NAME_MAX_LENGTH`.
pub const AP_NAME_MAX_LENGTH: usize = 64;

/// `isValidApName`.
pub fn is_valid_ap_name(name: &str) -> bool {
    AP_NAME_PATTERN.is_match(name) && !name.contains("--") && !name.contains("..")
}

/// `isValidAgentSkillName`. The length is in UTF-16 units, as in JS; a name
/// that passes the pattern is ASCII anyway.
pub fn is_valid_agent_skill_name(name: &str) -> bool {
    let len = name.encode_utf16().count();
    (1..=64).contains(&len) && AGENT_SKILL_NAME.is_match(name)
}

/// Replaces each run of characters outside `keep` with `-`.
fn replace_runs(source: &str, keep: impl Fn(char) -> bool) -> String {
    let mut out = String::with_capacity(source.len());
    let mut in_run = false;
    for c in source.chars() {
        if keep(c) {
            out.push(c);
            in_run = false;
        } else if !in_run {
            out.push('-');
            in_run = true;
        }
    }
    out
}

/// Collapses runs of `c` to one.
fn collapse(s: &str, c: char) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if ch == c && out.ends_with(c) {
            continue;
        }
        out.push(ch);
    }
    out
}

fn alnum(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit()
}

/// `slugifyAgentSkillName`.
pub fn slugify_agent_skill_name(source: &str) -> String {
    let lower = source.to_lowercase();
    let replaced = replace_runs(&lower, alnum);
    let mut slug = collapse(&replaced, '-')
        .trim_start_matches('-')
        .trim_end_matches('-')
        .to_owned();
    // Only ASCII is left, so byte and UTF-16 lengths agree.
    if slug.len() > 64 {
        slug = slug[..64].trim_end_matches('-').to_owned();
    }
    if slug.is_empty() {
        "skill".to_owned()
    } else {
        slug
    }
}

/// `slugifyApName`.
pub fn slugify_ap_name(source: &str) -> String {
    let lower = source.to_lowercase();
    let replaced = replace_runs(&lower, |c| alnum(c) || c == '.' || c == '-');
    let collapsed = collapse(&collapse(&replaced, '-'), '.');
    let mut slug = collapsed
        .trim_start_matches(|c: char| !alnum(c))
        .trim_end_matches(|c: char| !alnum(c))
        .to_owned();
    if slug.len() > AP_NAME_MAX_LENGTH {
        slug = slug[..AP_NAME_MAX_LENGTH]
            .trim_end_matches(|c: char| !alnum(c))
            .to_owned();
    }
    if slug.is_empty() {
        "plugin".to_owned()
    } else {
        slug
    }
}
