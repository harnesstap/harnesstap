//! The port of `src/db/write-generation.ts`: which statements can change
//! `ht status` output, and a counter the status cache compares.

use regex::Regex;
use std::sync::LazyLock;

/// JavaScript's `\s`.
const JS_SPACE: &str = r"[\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";

/// `/^\s*(?:WITH\b[\s\S]*?\b)?(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i`.
/// JavaScript's `\b` and `/i` (without `u`) are ASCII only.
static WRITE_STATEMENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"^{JS_SPACE}*(?:(?i-u:WITH)(?-u:\b)[\s\S]*?(?-u:\b))?(?i-u:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)(?-u:\b)"
    ))
    .expect("valid pattern")
});

/// Writes status reads fresh on every call, outside the cache.
static STATUS_IRRELEVANT_WRITE: LazyLock<Regex> = LazyLock::new(|| {
    let s = JS_SPACE;
    Regex::new(&format!(
        r"^{s}*(?:(?i-u:INSERT){s}+(?i-u:INTO){s}+(?i-u:resources)(?-u:\b)|(?:(?i-u:INSERT){s}+(?:(?i-u:OR){s}+[A-Za-z0-9_]+{s}+)?(?i-u:INTO)|(?i-u:UPDATE)|(?i-u:DELETE){s}+(?i-u:FROM)){s}+(?:(?i-u:upstream_checks)|(?i-u:notifications))(?-u:\b))"
    ))
    .expect("valid pattern")
});

static PRAGMA: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(r"^{JS_SPACE}*(?i-u:PRAGMA)(?-u:\b)")).expect("valid pattern")
});

/// `statementAffectsStatus`.
pub fn statement_affects_status(sql: &str) -> bool {
    WRITE_STATEMENT.is_match(sql) && !STATUS_IRRELEVANT_WRITE.is_match(sql)
}

fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| {
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
    })
}

/// `scriptAffectsStatus`: any statement of a script, split on `;`.
pub fn script_affects_status(sql: &str) -> bool {
    sql.split(';').any(|part| {
        !js_trim(part).is_empty() && !PRAGMA.is_match(part) && statement_affects_status(part)
    })
}

/// `statusWriteGeneration`: counts committed status-relevant writes.
#[derive(Debug, Default)]
pub struct WriteGeneration(std::sync::atomic::AtomicU64);

impl WriteGeneration {
    /// `readStatusWriteGeneration`.
    pub fn read(&self) -> u64 {
        self.0.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// `bumpStatusWriteGeneration`.
    pub fn bump(&self) {
        self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    /// What `trackStatusWrites` does after `run`.
    pub fn after_run(&self, sql: &str, changes: usize) {
        if changes > 0 && statement_affects_status(sql) {
            self.bump();
        }
    }

    /// What `trackStatusWrites` does after `exec`.
    pub fn after_exec(&self, sql: &str) {
        if script_affects_status(sql) {
            self.bump();
        }
    }
}
