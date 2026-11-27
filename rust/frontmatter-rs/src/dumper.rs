//! js-yaml 3.14 `safeDump(value)` with the default options gray-matter passes (`indent` 2,
//! `lineWidth` 80, no `flowLevel`, no `sortKeys`, `noCompatMode` off), ported from
//! `lib/js-yaml/dumper.js`. Strings are handled as UTF-16 code units like the original, so
//! widths, folding points and `\U` escapes of astral characters come out the same.
//!
//! What the default options leave unreachable is folded in: flow style only ever writes an
//! empty collection (`{}`, `[]`), and the only explicit tag is `!!binary`. A [`JsValue`] is a
//! tree, so the original's `&ref_N` / `*ref_N` anchors for a shared object never apply here.

use crate::FrontmatterError;
use crate::loader::{U16s, V, YamlException, u16s};
use crate::schema::{BASE64_MAP, resolve_implicit};
use crate::value::{JsValue, to_iso_string};

const INDENT: usize = 2;
const LINE_WIDTH: i64 = 80;

const DEPRECATED_BOOLEANS_SYNTAX: [&str; 16] = [
    "y", "Y", "yes", "Yes", "YES", "on", "On", "ON", "n", "N", "no", "No", "NO", "off", "Off",
    "OFF",
];

type R<T> = Result<T, FrontmatterError>;

/// `safeDump(value)`.
pub(crate) fn safe_dump(value: &JsValue) -> R<String> {
    let mut out = write_node(0, value, true, false)?;
    out.push(0x0A);
    Ok(String::from_utf16_lossy(&out))
}

fn push(out: &mut U16s, s: &str) {
    out.extend(s.encode_utf16());
}

fn generate_next_line(out: &mut U16s, level: usize) {
    out.push(0x0A);
    out.extend(std::iter::repeat_n(0x20, INDENT * level));
}

/// `writeNode`, which here never skips a value (`skipInvalid` is off): it throws instead.
fn write_node(level: usize, value: &JsValue, compact: bool, iskey: bool) -> R<U16s> {
    Ok(match value {
        JsValue::Null => u16s("null"),
        JsValue::Bool(b) => u16s(if *b { "true" } else { "false" }),
        JsValue::Number(n) => u16s(&represent_number(*n)),
        JsValue::Date(ms) => u16s(
            &to_iso_string(*ms)
                .ok_or_else(|| FrontmatterError::Range("Invalid time value".into()))?,
        ),
        JsValue::Buffer(bytes) => {
            let mut out = u16s("!<tag:yaml.org,2002:binary> ");
            out.extend(write_scalar(&represent_binary(bytes), level, iskey));
            out
        }
        JsValue::String(s) => write_scalar(&u16s(s), level, iskey),
        JsValue::Object(entries) if entries.is_empty() => u16s("{}"),
        JsValue::Object(entries) => write_block_mapping(level, entries, compact)?,
        JsValue::Array(items) if items.is_empty() => u16s("[]"),
        JsValue::Array(items) => write_block_sequence(level, items, compact)?,
        JsValue::Undefined => {
            let reason = "unacceptable kind of an object to dump [object Undefined]";
            return Err(FrontmatterError::Yaml(YamlException {
                reason: reason.into(),
                message: reason.into(),
            }));
        }
    })
}

/// The int type (`toString(10)`) for integers, else the float type.
fn represent_number(n: f64) -> String {
    if n.is_nan() {
        return ".nan".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { ".inf" } else { "-.inf" }.into();
    }
    if n == 0.0 && n.is_sign_negative() {
        return "-0.0".into();
    }
    let res = ryu_js::Buffer::new().format(n).to_owned();
    if n.fract() == 0.0 {
        return res;
    }
    // `SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/`: `5e-7` becomes `5.e-7`.
    let digits = res.trim_start_matches(['-', '+']);
    let int_len = digits.bytes().take_while(u8::is_ascii_digit).count();
    if int_len > 0 && digits.as_bytes().get(int_len) == Some(&b'e') {
        res.replacen('e', ".e", 1)
    } else {
        res
    }
}

/// `representYamlBinary`, with its quirk: an empty buffer gives `AAAA`.
fn represent_binary(bytes: &[u8]) -> U16s {
    let map = BASE64_MAP.as_bytes();
    let mut out = U16s::new();
    let mut emit = |i: usize| out.push(u16::from(map[i]));
    let six = |i: i32| (i & 0x3F) as usize;
    let mut bits: i32 = 0;
    for (idx, &b) in bytes.iter().enumerate() {
        if idx % 3 == 0 && idx > 0 {
            emit(six(bits >> 18));
            emit(six(bits >> 12));
            emit(six(bits >> 6));
            emit(six(bits));
        }
        bits = bits.wrapping_shl(8).wrapping_add(i32::from(b));
    }
    match bytes.len() % 3 {
        0 => {
            emit(six(bits >> 18));
            emit(six(bits >> 12));
            emit(six(bits >> 6));
            emit(six(bits));
        }
        2 => {
            emit(six(bits >> 10));
            emit(six(bits >> 4));
            emit(six(bits << 2));
            emit(64);
        }
        _ => {
            emit(six(bits >> 2));
            emit(six(bits << 4));
            emit(64);
            emit(64);
        }
    }
    out
}

fn write_block_sequence(level: usize, items: &[JsValue], compact: bool) -> R<U16s> {
    let mut result = U16s::new();
    for (index, item) in items.iter().enumerate() {
        let dump = write_node(level + 1, item, true, false)?;
        if !compact || index != 0 {
            generate_next_line(&mut result, level);
        }
        push(
            &mut result,
            if dump.first() == Some(&0x0A) {
                "-"
            } else {
                "- "
            },
        );
        result.extend(dump);
    }
    Ok(result)
}

fn write_block_mapping(level: usize, entries: &[(String, JsValue)], compact: bool) -> R<U16s> {
    let mut result = U16s::new();
    for (index, (key, value)) in entries.iter().enumerate() {
        if !compact || index != 0 {
            generate_next_line(&mut result, level);
        }
        let key = write_scalar(&u16s(key), level + 1, true);
        let explicit_pair = key.len() > 1024;
        if explicit_pair {
            push(
                &mut result,
                if key.first() == Some(&0x0A) {
                    "?"
                } else {
                    "? "
                },
            );
        }
        result.extend(key);
        if explicit_pair {
            generate_next_line(&mut result, level);
        }
        let dump = write_node(level + 1, value, explicit_pair, false)?;
        push(
            &mut result,
            if dump.first() == Some(&0x0A) {
                ":"
            } else {
                ": "
            },
        );
        result.extend(dump);
    }
    Ok(result)
}

fn is_whitespace(c: u16) -> bool {
    c == 0x20 || c == 0x09
}

fn is_printable(c: u16) -> bool {
    (0x20..=0x7E).contains(&c)
        || ((0xA1..=0xD7FF).contains(&c) && c != 0x2028 && c != 0x2029)
        || ((0xE000..=0xFFFD).contains(&c) && c != 0xFEFF)
}

fn is_ns_char(c: u16) -> bool {
    is_printable(c) && !is_whitespace(c) && c != 0xFEFF && c != 0x0D && c != 0x0A
}

fn is_plain_safe(c: u16, prev: Option<u16>) -> bool {
    is_printable(c)
        && c != 0xFEFF
        && !matches!(c, 0x2C | 0x5B | 0x5D | 0x7B | 0x7D | 0x3A)
        && (c != 0x23 || prev.is_some_and(|p| p != 0 && is_ns_char(p)))
}

fn is_plain_safe_first(c: u16) -> bool {
    is_printable(c)
        && c != 0xFEFF
        && !is_whitespace(c)
        && !(c < 0x80 && b"-?:,[]{}#&*!|=>'\"%@`".contains(&(c as u8)))
}

/// `/^\n* /`.
fn need_indent_indicator(s: &[u16]) -> bool {
    s.iter().find(|&&c| c != 0x0A) == Some(&0x20)
}

enum Style {
    Plain,
    Single,
    Literal,
    Folded,
    Double,
}

fn choose_scalar_style(s: &[u16], single_line_only: bool, line_width: i64) -> Style {
    let mut has_line_break = false;
    let mut has_foldable_line = false;
    let mut previous_line_break: i64 = -1;
    let at = |i: i64| usize::try_from(i).ok().and_then(|i| s.get(i)).copied();
    let mut plain = is_plain_safe_first(s[0]) && !is_whitespace(s[s.len() - 1]);
    for (i, &c) in s.iter().enumerate() {
        let i = i as i64;
        if !single_line_only && c == 0x0A {
            has_line_break = true;
            has_foldable_line = has_foldable_line
                || (i - previous_line_break - 1 > line_width
                    && at(previous_line_break + 1) != Some(0x20));
            previous_line_break = i;
        } else if !is_printable(c) {
            return Style::Double;
        }
        plain = plain && is_plain_safe(c, at(i - 1));
    }
    if !single_line_only {
        let i = s.len() as i64;
        has_foldable_line = has_foldable_line
            || (i - previous_line_break - 1 > line_width
                && at(previous_line_break + 1) != Some(0x20));
    }
    if !has_line_break && !has_foldable_line {
        return if plain && resolve_implicit(&V::Str(s.to_vec())).is_none() {
            Style::Plain
        } else {
            Style::Single
        };
    }
    if has_foldable_line {
        Style::Folded
    } else {
        Style::Literal
    }
}

/// `writeScalar` for a string.
fn write_scalar(s: &[u16], level: usize, iskey: bool) -> U16s {
    if s.is_empty() {
        return u16s("''");
    }
    if DEPRECATED_BOOLEANS_SYNTAX.iter().any(|b| u16s(b) == s) {
        let mut out = vec![0x27];
        out.extend_from_slice(s);
        out.push(0x27);
        return out;
    }
    let indent = INDENT * level.max(1);
    let line_width = (LINE_WIDTH.min(40)).max(LINE_WIDTH - indent as i64);
    match choose_scalar_style(s, iskey, line_width) {
        Style::Plain => s.to_vec(),
        Style::Single => {
            let mut out = vec![0x27];
            for &c in s {
                out.push(c);
                if c == 0x27 {
                    out.push(0x27);
                }
            }
            out.push(0x27);
            out
        }
        Style::Literal => {
            let mut out = vec![u16::from(b'|')];
            out.extend(block_header(s));
            out.extend(drop_ending_newline(indent_string(s, indent)));
            out
        }
        Style::Folded => {
            let mut out = vec![u16::from(b'>')];
            out.extend(block_header(s));
            out.extend(drop_ending_newline(indent_string(
                &fold_string(s, line_width),
                indent,
            )));
            out
        }
        Style::Double => {
            let mut out = vec![0x22];
            out.extend(escape_string(s));
            out.push(0x22);
            out
        }
    }
}

fn block_header(s: &[u16]) -> U16s {
    let mut out = U16s::new();
    if need_indent_indicator(s) {
        push(&mut out, &INDENT.to_string());
    }
    let clip = s.last() == Some(&0x0A);
    let keep = clip && (s.len() == 1 || s[s.len() - 2] == 0x0A);
    if keep {
        push(&mut out, "+");
    } else if !clip {
        push(&mut out, "-");
    }
    out.push(0x0A);
    out
}

fn drop_ending_newline(mut s: U16s) -> U16s {
    if s.last() == Some(&0x0A) {
        s.pop();
    }
    s
}

/// Indents every line; empty lines (`\n` only) are not indented.
fn indent_string(s: &[u16], spaces: usize) -> U16s {
    let mut out = U16s::new();
    for line in s.split_inclusive(|&c| c == 0x0A) {
        if line != [0x0A] {
            out.extend(std::iter::repeat_n(0x20, spaces));
        }
        out.extend_from_slice(line);
    }
    out
}

fn fold_string(s: &[u16], width: i64) -> U16s {
    let next_lf = s.iter().position(|&c| c == 0x0A).unwrap_or(s.len());
    let mut result = fold_line(&s[..next_lf], width);
    let mut prev_more_indented = s.first().is_some_and(|&c| c == 0x0A || c == 0x20);
    // `/(\n+)([^\n]*)/g` from `next_lf` on.
    let mut p = next_lf;
    while p < s.len() {
        let breaks = s[p..].iter().take_while(|&&c| c == 0x0A).count();
        let line_start = p + breaks;
        let line_end = s[line_start..]
            .iter()
            .position(|&c| c == 0x0A)
            .map_or(s.len(), |i| line_start + i);
        let line = &s[line_start..line_end];
        let more_indented = line.first() == Some(&0x20);
        result.extend_from_slice(&s[p..line_start]);
        if !prev_more_indented && !more_indented && !line.is_empty() {
            result.push(0x0A);
        }
        result.extend(fold_line(line, width));
        prev_more_indented = more_indented;
        p = line_end;
    }
    result
}

/// Greedy line breaking at single spaces; a more-indented line is never folded.
fn fold_line(line: &[u16], width: i64) -> U16s {
    if line.is_empty() || line[0] == 0x20 {
        return line.to_vec();
    }
    let (mut start, mut curr) = (0usize, 0usize);
    let mut result = U16s::new();
    // `/ [^ ]/g`: a space followed by a non-space.
    for next in
        (0..line.len().saturating_sub(1)).filter(|&i| line[i] == 0x20 && line[i + 1] != 0x20)
    {
        if (next - start) as i64 > width {
            let end = if curr > start { curr } else { next };
            result.push(0x0A);
            result.extend_from_slice(&line[start..end]);
            start = end + 1;
        }
        curr = next;
    }
    result.push(0x0A);
    if (line.len() - start) as i64 > width && curr > start {
        result.extend_from_slice(&line[start..curr]);
        result.push(0x0A);
        result.extend_from_slice(&line[curr + 1..]);
    } else {
        result.extend_from_slice(&line[start..]);
    }
    result.remove(0);
    result
}

fn encode_hex(c: u32) -> String {
    let hex = format!("{c:X}");
    let (handle, len) = if c <= 0xFF {
        ('x', 2)
    } else if c <= 0xFFFF {
        ('u', 4)
    } else {
        ('U', 8)
    };
    format!("\\{handle}{hex:0>len$}")
}

fn escape_string(s: &[u16]) -> U16s {
    let mut out = U16s::new();
    let mut i = 0;
    while i < s.len() {
        let c = s[i];
        if (0xD800..=0xDBFF).contains(&c)
            && let Some(&next) = s.get(i + 1)
            && (0xDC00..=0xDFFF).contains(&next)
        {
            let cp = (u32::from(c) - 0xD800) * 0x400 + u32::from(next) - 0xDC00 + 0x10000;
            push(&mut out, &encode_hex(cp));
            i += 2;
            continue;
        }
        let esc = match c {
            0x00 => Some("\\0"),
            0x07 => Some("\\a"),
            0x08 => Some("\\b"),
            0x09 => Some("\\t"),
            0x0A => Some("\\n"),
            0x0B => Some("\\v"),
            0x0C => Some("\\f"),
            0x0D => Some("\\r"),
            0x1B => Some("\\e"),
            0x22 => Some("\\\""),
            0x5C => Some("\\\\"),
            0x85 => Some("\\N"),
            0xA0 => Some("\\_"),
            0x2028 => Some("\\L"),
            0x2029 => Some("\\P"),
            _ => None,
        };
        match esc {
            Some(e) => push(&mut out, e),
            None if is_printable(c) => out.push(c),
            None => push(&mut out, &encode_hex(u32::from(c))),
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_and_binary() {
        assert_eq!(represent_number(5e-7), "5.e-7");
        assert_eq!(represent_number(1.5e-7), "1.5e-7");
        assert_eq!(represent_number(1e21), "1e+21");
        assert_eq!(represent_number(-0.0), "-0.0");
        assert_eq!(String::from_utf16_lossy(&represent_binary(b"")), "AAAA");
        assert_eq!(
            String::from_utf16_lossy(&represent_binary(b"Hello")),
            "SGVsbG8="
        );
    }
}
