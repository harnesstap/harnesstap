//! `stringify(value, { indent: 2, lineWidth: 0, defaultKeyType: "PLAIN" })`
//! from the `yaml` package (2.8), for JSON-like values.
//!
//! This follows `yaml/dist/stringify/*.js` step by step. With `lineWidth: 0`
//! nothing is folded, so the folding code has no counterpart here. Values never
//! carry comments, anchors, tags or flow style, so those branches are left out.

use crate::js;
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

const INDENT_STEP: &str = "  ";
const DOUBLE_QUOTED_MIN_MULTI_LINE_LENGTH: usize = 40;
const MAX_IMPLICIT_KEY_LENGTH: usize = 1024;

#[derive(Clone)]
struct Ctx {
    indent: String,
    implicit_key: bool,
}

/// The YAML text the original writes for `value`, trailing newline included.
pub fn stringify(value: &Value) -> String {
    let ctx = Ctx {
        indent: String::new(),
        implicit_key: false,
    };
    let mut out = node(value, &ctx);
    out.push('\n');
    out
}

fn node(value: &Value, ctx: &Ctx) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(b) => (if *b { "true" } else { "false" }).to_owned(),
        Value::Number(n) => {
            if js::is_negative_zero(n) {
                "-0".to_owned()
            } else {
                js::number_to_string(n)
            }
        }
        Value::String(s) => string(s, ctx),
        Value::Array(items) => {
            if items.is_empty() {
                return "[]".to_owned();
            }
            let item_ctx = Ctx {
                indent: format!("{}{INDENT_STEP}", ctx.indent),
                implicit_key: false,
            };
            let lines: Vec<String> = items
                .iter()
                .map(|item| format!("- {}", node(item, &item_ctx)))
                .collect();
            join_lines(&lines, &ctx.indent)
        }
        Value::Object(map) => {
            if map.is_empty() {
                return "{}".to_owned();
            }
            let lines: Vec<String> = js::ordered_entries(map)
                .into_iter()
                .map(|(k, v)| pair(k, v, &ctx.indent))
                .collect();
            join_lines(&lines, &ctx.indent)
        }
    }
}

fn join_lines(lines: &[String], indent: &str) -> String {
    let mut out = lines[0].clone();
    for line in &lines[1..] {
        out.push('\n');
        if !line.is_empty() {
            out.push_str(indent);
            out.push_str(line);
        }
    }
    out
}

fn is_collection(value: &Value) -> Option<usize> {
    match value {
        Value::Array(items) => Some(items.len()),
        Value::Object(map) => Some(map.len()),
        _ => None,
    }
}

fn pair(key: &str, value: &Value, indent: &str) -> String {
    let mut ctx = Ctx {
        indent: format!("{indent}{INDENT_STEP}"),
        implicit_key: true,
    };
    let key_str = string(key, &ctx);
    let explicit_key = js::utf16_len(&key_str) > MAX_IMPLICIT_KEY_LENGTH;
    let mut out = if explicit_key {
        format!("? {key_str}\n{indent}:")
    } else {
        format!("{key_str}:")
    };
    ctx.implicit_key = false;
    let value_str = node(value, &ctx);
    let mut ws = " ".to_owned();
    match is_collection(value) {
        Some(len) if !explicit_key => {
            let flow = len == 0;
            if value_str.contains('\n') || !flow {
                ws = format!("\n{}", ctx.indent);
            }
        }
        _ => {
            if value_str.is_empty() || value_str.starts_with('\n') {
                ws.clear();
            }
        }
    }
    out.push_str(&ws);
    out.push_str(&value_str);
    out
}

/// `/^(%|---|\.\.\.)/m`: JavaScript's `^` also matches after `\r`, U+2028 and U+2029.
fn contains_document_marker(s: &str) -> bool {
    let at =
        |rest: &str| rest.starts_with('%') || rest.starts_with("---") || rest.starts_with("...");
    if at(s) {
        return true;
    }
    s.char_indices()
        .filter(|(_, c)| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
        .any(|(i, c)| at(&s[i + c.len_utf8()..]))
}

fn needs_double_quotes(s: &str) -> bool {
    // /[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u; Rust strings hold no lone surrogates.
    s.chars().any(|c| {
        let n = c as u32;
        n <= 0x08 || (0x0b..=0x1f).contains(&n) || (0x7f..=0x9f).contains(&n)
    })
}

fn string(value: &str, ctx: &Ctx) -> String {
    if needs_double_quotes(value) {
        double_quoted(value, ctx)
    } else {
        plain(value, ctx)
    }
}

/// The first regex in `plainString`: text that cannot be a plain scalar.
fn not_plain(s: &str) -> bool {
    let b = s.as_bytes();
    if let Some(&first) = b.first()
        && b"\n\t ,[]{}#&*!|>'\"%@`".contains(&first)
    {
        return true;
    }
    if s == "?" || s == "-" {
        return true;
    }
    if b.len() >= 2 && (b[0] == b'?' || b[0] == b'-') && (b[1] == b' ' || b[1] == b'\t') {
        return true;
    }
    for w in b.windows(2) {
        let (x, y) = (w[0], w[1]);
        if (x == b'\n' || x == b':') && (y == b' ' || y == b'\t') {
            return true;
        }
        if (x == b' ' || x == b'\t') && y == b'\n' {
            return true;
        }
        if (x == b'\n' || x == b'\t' || x == b' ') && y == b'#' {
            return true;
        }
    }
    matches!(b.last(), Some(b'\n' | b'\t' | b' ' | b':'))
}

static CORE_TAG_TESTS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"^(?:~|[Nn]ull|NULL)?$",
        r"^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$",
        r"^0o[0-7]+$",
        r"^[-+]?[0-9]+$",
        r"^0x[0-9a-fA-F]+$",
        r"^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$",
        r"^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$",
        r"^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$",
    ]
    .iter()
    .map(|p| Regex::new(p).expect("valid pattern"))
    .collect()
});

fn plain(value: &str, ctx: &Ctx) -> String {
    if ctx.implicit_key && value.contains('\n') {
        return quoted(value, ctx);
    }
    if not_plain(value) {
        return if ctx.implicit_key || !value.contains('\n') {
            quoted(value, ctx)
        } else {
            block(value, ctx, false)
        };
    }
    if !ctx.implicit_key && value.contains('\n') {
        return block(value, ctx, false);
    }
    if contains_document_marker(value) {
        if ctx.indent.is_empty() {
            return block(value, ctx, true);
        } else if ctx.implicit_key && ctx.indent == INDENT_STEP {
            return quoted(value, ctx);
        }
    }
    if CORE_TAG_TESTS.iter().any(|re| re.is_match(value)) {
        return quoted(value, ctx);
    }
    value.to_owned()
}

fn quoted(value: &str, ctx: &Ctx) -> String {
    if value.contains('"') && !value.contains('\'') {
        single_quoted(value, ctx)
    } else {
        double_quoted(value, ctx)
    }
}

fn marker_indent(value: &str, ctx: &Ctx) -> String {
    if !ctx.indent.is_empty() {
        ctx.indent.clone()
    } else if contains_document_marker(value) {
        INDENT_STEP.to_owned()
    } else {
        String::new()
    }
}

/// `value.replace(/\n+/g, "$&" + suffix)`.
fn after_newline_runs(value: &str, suffix: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(c) = chars.next() {
        out.push(c);
        if c == '\n' && chars.peek() != Some(&'\n') {
            out.push_str(suffix);
        }
    }
    out
}

fn single_quoted(value: &str, ctx: &Ctx) -> String {
    let b = value.as_bytes();
    let ws_by_newline = b.windows(2).any(|w| {
        (matches!(w[0], b' ' | b'\t') && w[1] == b'\n')
            || (w[0] == b'\n' && matches!(w[1], b' ' | b'\t'))
    });
    if (ctx.implicit_key && value.contains('\n')) || ws_by_newline {
        return double_quoted(value, ctx);
    }
    let indent = marker_indent(value, ctx);
    let escaped = value.replace('\'', "''");
    format!("'{}'", after_newline_runs(&escaped, &format!("\n{indent}")))
}

fn double_quoted(value: &str, ctx: &Ctx) -> String {
    let json: Vec<char> = js::quote(value).chars().collect();
    let json_len = js::utf16_len(&js::quote(value));
    let indent = marker_indent(value, ctx);
    let at = |i: usize| json.get(i).copied();
    let slice = |a: usize, b: usize| json[a..b].iter().collect::<String>();
    let mut out = String::new();
    let mut start = 0;
    let mut i = 0;
    while i < json.len() {
        let mut ch = json[i];
        if ch == ' ' && at(i + 1) == Some('\\') && at(i + 2) == Some('n') {
            // a space before a newline is escaped so that it is not folded
            out.push_str(&slice(start, i));
            out.push_str("\\ ");
            i += 1;
            start = i;
            ch = '\\';
        }
        if ch == '\\' {
            match at(i + 1) {
                Some('u') => {
                    out.push_str(&slice(start, i));
                    let code = slice(i + 2, (i + 6).min(json.len()));
                    match code.as_str() {
                        "0000" => out.push_str("\\0"),
                        "0007" => out.push_str("\\a"),
                        "000b" => out.push_str("\\v"),
                        "001b" => out.push_str("\\e"),
                        "0085" => out.push_str("\\N"),
                        "00a0" => out.push_str("\\_"),
                        "2028" => out.push_str("\\L"),
                        "2029" => out.push_str("\\P"),
                        c if c.starts_with("00") => {
                            out.push_str("\\x");
                            out.push_str(&c[2..]);
                        }
                        _ => out.push_str(&slice(i, (i + 6).min(json.len()))),
                    }
                    i += 5;
                    start = i + 1;
                }
                Some('n') => {
                    if ctx.implicit_key
                        || at(i + 2) == Some('"')
                        || json_len < DOUBLE_QUOTED_MIN_MULTI_LINE_LENGTH
                    {
                        i += 1;
                    } else {
                        // folding eats the first newline
                        out.push_str(&slice(start, i));
                        out.push_str("\n\n");
                        while at(i + 2) == Some('\\')
                            && at(i + 3) == Some('n')
                            && at(i + 4) != Some('"')
                        {
                            out.push('\n');
                            i += 2;
                        }
                        out.push_str(&indent);
                        // a space after a newline is escaped so that it is not folded
                        if at(i + 2) == Some(' ') {
                            out.push('\\');
                        }
                        i += 1;
                        start = i + 1;
                    }
                }
                _ => i += 1,
            }
        }
        i += 1;
    }
    if start > 0 {
        out.push_str(&slice(start.min(json.len()), json.len()));
        out
    } else {
        json.into_iter().collect()
    }
}

/// `blockString` for a literal block (`lineWidth: 0` never folds).
fn block(value: &str, ctx: &Ctx, force_block_indent: bool) -> String {
    // a block cannot end in whitespace unless the last line is non-empty
    let trimmed = value.trim_end_matches([' ', '\t']);
    if trimmed.len() < value.len() && trimmed.ends_with('\n') {
        return quoted(value, ctx);
    }
    let indent = if !ctx.indent.is_empty() {
        ctx.indent.clone()
    } else if force_block_indent || contains_document_marker(value) {
        INDENT_STEP.to_owned()
    } else {
        String::new()
    };
    if value.is_empty() {
        return "|\n".to_owned();
    }
    let end_start = value.trim_end_matches(['\n', '\t', ' ']).len();
    let mut body = &value[..end_start];
    let end_raw = &value[end_start..];
    let chomp = match end_raw.find('\n') {
        None => "-",
        Some(pos) if value == end_raw || pos != end_raw.len() - 1 => "+",
        Some(_) => "",
    };
    let mut end = String::new();
    if !end_raw.is_empty() {
        let e = end_raw.strip_suffix('\n').unwrap_or(end_raw);
        end = indent_inner_newline_runs(e, &indent);
    }
    // the indentation indicator comes from whitespace at the start
    let mut start_with_space = false;
    let mut start_nl_pos: Option<usize> = None;
    for (i, c) in body.char_indices() {
        match c {
            ' ' => start_with_space = true,
            '\n' => start_nl_pos = Some(i),
            _ => break,
        }
    }
    let mut start = String::new();
    if let Some(pos) = start_nl_pos {
        start = after_newline_runs(&body[..=pos], &indent);
        body = &body[pos + 1..];
    }
    let indent_size = if indent.is_empty() { "1" } else { "2" };
    let header = format!("{}{chomp}", if start_with_space { indent_size } else { "" });
    let body = after_newline_runs(body, &indent);
    format!("|{header}\n{indent}{start}{body}{end}")
}

/// `end.replace(/(^|(?<!\n))\n+(?!\n|$)/g, "$&" + indent)`: every run of
/// newlines that does not reach the end of the string.
fn indent_inner_newline_runs(s: &str, indent: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\n' {
            let run_start = i;
            while i < b.len() && b[i] == b'\n' {
                i += 1;
            }
            out.push_str(&s[run_start..i]);
            if i < b.len() {
                out.push_str(indent);
            }
        } else {
            let c = s[i..].chars().next().unwrap_or(' ');
            out.push(c);
            i += c.len_utf8();
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writes_a_manifest_like_the_original() {
        let v = json!({"name": "demo", "version": "1.0", "dependencies": {"apm": ["a/b", "c"]}, "empty": [], "n": null});
        assert_eq!(
            stringify(&v),
            "name: demo\nversion: \"1.0\"\ndependencies:\n  apm:\n    - a/b\n    - c\nempty: []\nn: null\n"
        );
    }
}
