//! `lib/constants.js`: the POSIX regex pieces, `{ dot: true }` applied where the parser asks.

pub const DOT_LITERAL: &str = "\\.";
pub const PLUS_LITERAL: &str = "\\+";
pub const SLASH_LITERAL: &str = "\\/";
pub const ONE_CHAR: &str = "(?=.)";
pub const QMARK: &str = "[^/]";
pub const START_ANCHOR: &str = "(?:^|\\/)";
pub const DOTS_SLASH: &str = "\\.{1,2}(?:\\/|$)";
pub const NO_DOTS: &str = "(?!(?:^|\\/)\\.{1,2}(?:\\/|$))";
pub const NO_DOT_SLASH: &str = "(?!\\.{0,1}(?:\\/|$))";
pub const NO_DOTS_SLASH: &str = "(?!\\.{1,2}(?:\\/|$))";
pub const STAR: &str = "[^/]*?";

pub const MAX_LENGTH: usize = 1024 * 64;

/// `globstar(opts)` with `dot: true` and no capture.
pub fn globstar() -> String {
    format!("(?:(?:(?!{START_ANCHOR}{DOTS_SLASH}).)*?)")
}

/// `POSIX_REGEX_SOURCE`.
pub fn posix_class(name: &str) -> Option<&'static str> {
    Some(match name {
        "alnum" => "a-zA-Z0-9",
        "alpha" => "a-zA-Z",
        "ascii" => "\\x00-\\x7F",
        "blank" => " \\t",
        "cntrl" => "\\x00-\\x1F\\x7F",
        "digit" => "0-9",
        "graph" => "\\x21-\\x7E",
        "lower" => "a-z",
        "print" => "\\x20-\\x7E ",
        "punct" => "\\-!\"#$%&'()\\*+,./:;<=>?@[\\]^_`{|}~",
        "space" => " \\t\\r\\n\\v\\f",
        "upper" => "A-Z",
        "word" => "A-Za-z0-9_",
        "xdigit" => "A-Fa-f0-9",
        _ => return None,
    })
}

/// The extglob kinds of `extglobChars`: `(type, open, close)`.
pub fn extglob_chars(c: &str) -> (&'static str, &'static str, String) {
    match c {
        "!" => ("negate", "(?:(?!(?:", format!(")){STAR})")),
        "?" => ("qmark", "(?:", ")?".into()),
        "+" => ("plus", "(?:", ")+".into()),
        "*" => ("star", "(?:", ")*".into()),
        _ => ("at", "(?:", ")".into()),
    }
}

/// `REPLACEMENTS`.
pub fn replacement(input: &str) -> Option<&'static str> {
    match input {
        "***" => Some("*"),
        "**/**" | "**/**/**" => Some("**"),
        _ => None,
    }
}

/// `REGEX_SPECIAL_CHARS`: `[-*+?.^${}(|)[\]]`.
pub fn is_regex_special(c: char) -> bool {
    "-*+?.^${}(|)[]".contains(c)
}

/// `utils.escapeRegex`.
pub fn escape_regex(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if is_regex_special(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// `utils.hasRegexChars`.
pub fn has_regex_chars(s: &str) -> bool {
    s.chars().any(is_regex_special)
}

/// JavaScript's `\w`.
pub fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}
