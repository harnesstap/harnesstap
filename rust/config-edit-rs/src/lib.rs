//! The port of `src/services/format-preserving-config.ts`: JSON(C) and TOML config edits that
//! keep the file's layout (comments, indentation, line endings).
//!
//! JSON edits go through [`jsonc`], a port of the `jsonc-parser` calls the original makes.
//! TOML reading follows `smol-toml` 1.6 `parse` on top of the `toml` crate, and
//! [`toml_stringify`] is smol-toml's `stringify`.
//!
//! Values are `serde_json::Value`s, iterated in JavaScript key order. A TOML date (smol-toml's
//! `TomlDate`) is an object holding only [`TOML_DATE_KEY`] with its `toISOString()`: it is an
//! object with no own keys for everything but `stringify`, as in the original.

#![forbid(unsafe_code)]

pub mod jsonc;

use std::sync::LazyLock;

use emit_rs::js::{is_space, ordered_entries, quote};
use regex::Regex;
use serde_json::{Map, Value};

pub use toml_doc::{parse_toml, toml_stringify};

mod toml_doc;

/// The key of the object that stands for a TOML date; its value is the date's `toISOString()`.
pub const TOML_DATE_KEY: &str = "\u{0}toml-date";

/// The `toISOString()` of a TOML date value.
pub fn toml_date(value: &Value) -> Option<&str> {
    match value {
        Value::Object(map) if map.len() == 1 => map.get(TOML_DATE_KEY)?.as_str(),
        _ => None,
    }
}

/// `Object.entries(record)`: own keys in JavaScript order (none for a TOML date).
fn entries(map: &Map<String, Value>) -> Vec<(&String, &Value)> {
    if map.len() == 1 && map.contains_key(TOML_DATE_KEY) {
        return Vec::new();
    }
    ordered_entries(map)
}

/// Keys every plain object inherits from `Object.prototype`: `key in object` is true for them
/// and `object[key]` is a function.
fn inherited(key: &str) -> bool {
    matches!(
        key,
        "constructor"
            | "hasOwnProperty"
            | "isPrototypeOf"
            | "propertyIsEnumerable"
            | "toLocaleString"
            | "toString"
            | "valueOf"
            | "__proto__"
            | "__defineGetter__"
            | "__defineSetter__"
            | "__lookupGetter__"
            | "__lookupSetter__"
    )
}

/// `key in record`.
fn has_key(map: &Map<String, Value>, key: &str) -> bool {
    inherited(key) || entries(map).iter().any(|(k, _)| *k == key)
}

/// `record[key]` for an own key.
fn own<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    entries(map)
        .into_iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v)
}

/// `ensureTrailingNewline(text)`.
pub fn ensure_trailing_newline(text: &str) -> String {
    if text.is_empty() || text.ends_with('\n') {
        text.to_owned()
    } else {
        format!("{text}\n")
    }
}

/// `canonicalJson(value)`; `None` stands for `undefined` (where `JSON.stringify` returns
/// `undefined` too).
pub fn canonical_json(value: Option<&Value>) -> Option<String> {
    let value = value?;
    Some(match value {
        Value::Array(items) => {
            let parts: Vec<String> = items
                .iter()
                .map(|v| canonical_json(Some(v)).unwrap_or_default())
                .collect();
            format!("[{}]", parts.join(","))
        }
        Value::Object(map) => {
            let mut keys: Vec<(&String, &Value)> = entries(map);
            // `Array.prototype.sort` compares UTF-16 code units.
            keys.sort_by(|(a, _), (b, _)| a.encode_utf16().cmp(b.encode_utf16()));
            let parts: Vec<String> = keys
                .into_iter()
                .map(|(k, v)| {
                    format!(
                        "{}:{}",
                        quote(k),
                        canonical_json(Some(v)).unwrap_or_default()
                    )
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
        other => emit_rs::json::stringify(other, ""),
    })
}

/// `jsonValuesEqual(left, right)`.
pub fn json_values_equal(left: Option<&Value>, right: Option<&Value>) -> bool {
    canonical_json(left) == canonical_json(right)
}

/// `parseJsonObject(raw)`: the object, or `None` when the text has any JSONC error or is not
/// an object.
pub fn parse_json_object(raw: &str) -> Option<Map<String, Value>> {
    match jsonc::parse(raw) {
        (Some(Value::Object(map)), false) => Some(map),
        _ => None,
    }
}

fn detect_json_formatting(text: &str) -> jsonc::Formatting {
    let insert_final_newline = text.ends_with('\n');
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    // `/\n\t\S/` or `/\n\t"/`
    let tabbed = text
        .match_indices("\n\t")
        .any(|(i, _)| text[i + 2..].chars().next().is_some_and(|c| !is_space(c)));
    if tabbed {
        return jsonc::Formatting {
            tab_size: 1,
            insert_spaces: false,
            insert_final_newline,
            eol,
        };
    }
    // `/\n( +)"/`
    let tab_size = text
        .match_indices('\n')
        .find_map(|(i, _)| {
            let rest = &text[i + 1..];
            let spaces = rest.len() - rest.trim_start_matches(' ').len();
            (spaces > 0 && rest[spaces..].starts_with('"')).then_some(spaces)
        })
        .unwrap_or(2);
    jsonc::Formatting {
        tab_size,
        insert_spaces: true,
        insert_final_newline,
        eol,
    }
}

fn stringify_new_json(value: &Map<String, Value>) -> String {
    emit_rs::json::to_file_string(&Value::Object(value.clone()))
}

/// `{ ...a, ...b }`.
fn spread(a: &Map<String, Value>, b: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    for (k, v) in entries(a).into_iter().chain(entries(b)) {
        out.insert(k.clone(), v.clone());
    }
    out
}

fn overlay_records(
    existing: &Map<String, Value>,
    overlay: &Map<String, Value>,
    merge_keys: &[String],
) -> Map<String, Value> {
    let mut merged = spread(existing, &Map::new());
    for (key, value) in entries(overlay) {
        let next = match (own(existing, key), value) {
            (Some(Value::Object(prev)), Value::Object(value)) if merge_keys.contains(key) => {
                Value::Object(spread(prev, value))
            }
            _ => value.clone(),
        };
        jsonc::js_assign(&mut merged, key, next);
    }
    merged
}

fn collect_changed_paths(
    existing: &Map<String, Value>,
    merged: &Map<String, Value>,
    prefix: &[String],
    merge_keys: &[String],
    remove_missing: bool,
    diffs: &mut Vec<(Vec<String>, Option<Value>)>,
) {
    for (key, next) in entries(merged) {
        let mut path = prefix.to_vec();
        path.push(key.clone());
        let prev = own(existing, key);
        if json_values_equal(prev, Some(next)) {
            continue;
        }
        if let (true, Some(Value::Object(prev)), Value::Object(next)) =
            (prefix.is_empty() && merge_keys.contains(key), prev, next)
        {
            collect_changed_paths(prev, next, &path, &[], remove_missing, diffs);
            continue;
        }
        diffs.push((path, Some(next.clone())));
    }
    if remove_missing {
        for (key, _) in entries(existing) {
            if !has_key(merged, key) {
                let mut path = prefix.to_vec();
                path.push(key.clone());
                diffs.push((path, None));
            }
        }
    }
}

/// `applyJsonObjectPreservingFormat(existingRaw, existing, merged, mergeObjectKeys,
/// removeMissing)`. Errors are the ones `jsonc-parser`'s `modify` throws.
pub fn apply_json_object_preserving_format(
    existing_raw: &str,
    existing: &Map<String, Value>,
    merged: &Map<String, Value>,
    merge_object_keys: &[String],
    remove_missing: bool,
) -> Result<String, String> {
    let (existing_v, merged_v) = (
        Value::Object(existing.clone()),
        Value::Object(merged.clone()),
    );
    if json_values_equal(Some(&existing_v), Some(&merged_v)) {
        return Ok(existing_raw.to_owned());
    }
    let formatting = detect_json_formatting(existing_raw);
    let mut diffs = Vec::new();
    collect_changed_paths(
        existing,
        merged,
        &[],
        merge_object_keys,
        remove_missing,
        &mut diffs,
    );
    let mut text = existing_raw.to_owned();
    for (path, value) in diffs {
        text = jsonc::modify(&text, &path, value.as_ref(), &formatting)?;
    }
    Ok(if formatting.insert_final_newline {
        ensure_trailing_newline(&text)
    } else {
        text
    })
}

/// What `overlayJsonPreservingFormat` does with existing text that does not parse.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum OnUnparseable {
    #[default]
    Replace,
    Keep,
}

/// `overlayJsonPreservingFormat(existingRaw, overlay, { mergeObjectKeys, onUnparseable })`.
pub fn overlay_json_preserving_format(
    existing_raw: Option<&str>,
    overlay: &Map<String, Value>,
    merge_object_keys: &[String],
    on_unparseable: OnUnparseable,
) -> Result<String, String> {
    let Some(raw) = existing_raw.filter(|r| !r.is_empty()) else {
        return Ok(stringify_new_json(overlay));
    };
    let Some(existing) = parse_json_object(raw) else {
        return Ok(match on_unparseable {
            OnUnparseable::Keep => raw.to_owned(),
            OnUnparseable::Replace => stringify_new_json(overlay),
        });
    };
    let merged = overlay_records(&existing, overlay, merge_object_keys);
    apply_json_object_preserving_format(raw, &existing, &merged, merge_object_keys, false)
}

/// `applyJsonObjectUpdatePreservingFormat(existingRaw, next)`.
pub fn apply_json_object_update_preserving_format(
    existing_raw: &str,
    next: &Map<String, Value>,
) -> Result<String, String> {
    match parse_json_object(existing_raw) {
        None => Ok(stringify_new_json(next)),
        Some(existing) => {
            apply_json_object_preserving_format(existing_raw, &existing, next, &[], true)
        }
    }
}

// ---- TOML ----

fn quote_toml_key(key: &str) -> String {
    if !key.is_empty()
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        key.to_owned()
    } else {
        quote(key)
    }
}

fn format_toml_scalar(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => quote(s),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => emit_rs::js::number_to_string(n),
        None | Some(Value::Null) => "\"\"".to_owned(),
        Some(Value::Array(items)) => {
            let parts: Vec<String> = items.iter().map(|v| format_toml_scalar(Some(v))).collect();
            format!("[{}]", parts.join(", "))
        }
        Some(Value::Object(map)) => {
            let parts: Vec<String> = entries(map)
                .into_iter()
                .map(|(k, v)| format!("{} = {}", quote_toml_key(k), format_toml_scalar(Some(v))))
                .collect();
            format!("{{ {} }}", parts.join(", "))
        }
    }
}

/// `recordFromPath(path, value)`: empty segments are skipped, and from a `__proto__` segment on
/// nothing lands in own keys (the assignment sets a prototype).
fn record_from_path(path: &[String], value: &Value) -> Map<String, Value> {
    let mut steps: Vec<(&String, bool)> = path[..path.len().saturating_sub(1)]
        .iter()
        .filter(|k| !k.is_empty())
        .map(|k| (k, false))
        .collect();
    if let Some(last) = path.last().filter(|k| !k.is_empty()) {
        steps.push((last, true));
    }
    if let Some(cut) = steps.iter().position(|(k, _)| *k == "__proto__") {
        steps.truncate(cut);
    }
    let mut acc = Map::new();
    for (key, leaf) in steps.into_iter().rev() {
        let child = if leaf {
            value.clone()
        } else {
            Value::Object(std::mem::take(&mut acc))
        };
        acc.insert(key.clone(), child);
    }
    acc
}

fn trim_end(s: &str) -> &str {
    s.trim_end_matches(is_space)
}

fn append_toml_fragment(text: &str, path: &[String], value: &Value) -> Result<String, String> {
    let fragment = toml_stringify(&record_from_path(path, value))?;
    let base = if text.ends_with('\n') || text.is_empty() {
        text.to_owned()
    } else {
        format!("{text}\n")
    };
    Ok(format!("{base}{}\n", trim_end(&fragment)))
}

/// Offset of the first `/^[ \t]*\[/m` match: a line start (after `\n`, `\r`, U+2028 or U+2029)
/// followed by blanks and `[`.
fn first_table_line(text: &str) -> Option<usize> {
    let starts = std::iter::once(0).chain(
        text.char_indices()
            .filter(|(_, c)| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
            .map(|(i, c)| i + c.len_utf8()),
    );
    starts
        .into_iter()
        .find(|&i| text[i..].trim_start_matches([' ', '\t']).starts_with('['))
}

fn insert_root_assignment(text: &str, key: &str, value: &Value) -> String {
    let formatted = format!(
        "{} = {}\n",
        quote_toml_key(key),
        format_toml_scalar(Some(value))
    );
    let Some(index) = first_table_line(text) else {
        return format!("{}{formatted}", ensure_trailing_newline(text));
    };
    let (prefix, suffix) = text.split_at(index);
    let base = if prefix.ends_with('\n') || prefix.is_empty() {
        prefix.to_owned()
    } else {
        format!("{prefix}\n")
    };
    format!("{base}{formatted}{suffix}")
}

/// JavaScript `\s`.
const JS_SPACE: &str = r"[\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";

fn assignment_pattern(key: &str, remove: bool) -> Regex {
    let source = if remove {
        format!(
            r"(^|\n)[ \t]*{}{JS_SPACE}*={JS_SPACE}*(?:\{{[^\n]*\}}|[^\n]+)\n?",
            regex::escape(key)
        )
    } else {
        format!(
            r"(^|\n)([ \t]*){}{JS_SPACE}*={JS_SPACE}*(?:\{{[^\n]*\}}|[^\n]+)",
            regex::escape(key)
        )
    };
    // INFALLIBLE: the key is escaped and the rest is fixed.
    Regex::new(&source).expect("valid pattern")
}

/// `text.replace(re, replacement)` for the first match, with JavaScript's `$` patterns
/// (`$$`, `$&`, `` $` ``, `$'`, `$1`..`$99`) in `replacement`.
fn js_replace(re: &Regex, text: &str, replacement: &str) -> String {
    let Some(caps) = re.captures(text) else {
        return text.to_owned();
    };
    let whole = caps.get(0).map_or(0..0, |m| m.range());
    let groups = caps.len() - 1;
    let group = |n: usize| caps.get(n).map_or("", |m| m.as_str());
    let mut out = String::from(&text[..whole.start]);
    let bytes = replacement.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'$' || i + 1 >= bytes.len() {
            let c = replacement[i..].chars().next().unwrap_or_default();
            out.push(c);
            i += c.len_utf8().max(1);
            continue;
        }
        let digit = |j: usize| {
            bytes
                .get(j)
                .filter(|b| b.is_ascii_digit())
                .map(|b| usize::from(b - b'0'))
        };
        match bytes[i + 1] {
            b'$' => {
                out.push('$');
                i += 2;
            }
            b'&' => {
                out.push_str(&text[whole.clone()]);
                i += 2;
            }
            b'`' => {
                out.push_str(&text[..whole.start]);
                i += 2;
            }
            b'\'' => {
                out.push_str(&text[whole.end..]);
                i += 2;
            }
            _ => match (digit(i + 1), digit(i + 2)) {
                (Some(a), Some(b)) if (1..=groups).contains(&(a * 10 + b)) => {
                    out.push_str(group(a * 10 + b));
                    i += 3;
                }
                (Some(a), _) if (1..=groups).contains(&a) => {
                    out.push_str(group(a));
                    i += 2;
                }
                _ => {
                    out.push('$');
                    i += 1;
                }
            },
        }
    }
    out.push_str(&text[whole.end..]);
    out
}

fn replace_toml_assignment(text: &str, key: &str, value: &Value) -> String {
    let formatted = format!(
        "{} = {}",
        quote_toml_key(key),
        format_toml_scalar(Some(value))
    );
    js_replace(
        &assignment_pattern(key, false),
        text,
        &format!("$1$2{formatted}"),
    )
}

fn table_header(path: &[String]) -> String {
    let parts: Vec<String> = path.iter().map(|p| quote_toml_key(p)).collect();
    format!("[{}]", parts.join("."))
}

static NEXT_HEADER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\n[ \t]*\[").expect("valid pattern"));

/// The end of the table section that starts at `after`: the next header line, or the end.
fn section_end(text: &str, after: usize) -> usize {
    NEXT_HEADER
        .find(&text[after..])
        .map_or(text.len(), |m| after + m.start())
}

fn replace_in_table(
    text: &str,
    table_path: &[String],
    key: &str,
    value: &Value,
) -> Result<String, String> {
    if table_path.is_empty() {
        let next = replace_toml_assignment(text, key, value);
        if next != text {
            return Ok(next);
        }
        if matches!(value, Value::Object(_)) {
            return append_toml_fragment(text, &[key.to_owned()], value);
        }
        return Ok(insert_root_assignment(text, key, value));
    }
    let header = table_header(table_path);
    let Some(start) = text.find(&header) else {
        let mut path = table_path.to_vec();
        path.push(key.to_owned());
        return append_toml_fragment(text, &path, value);
    };
    let end = section_end(text, start + header.len());
    let updated = replace_toml_assignment(&text[start..end], key, value);
    Ok(format!("{}{updated}{}", &text[..start], &text[end..]))
}

fn remove_toml_assignment(text: &str, key: &str) -> String {
    js_replace(&assignment_pattern(key, true), text, "$1")
}

fn remove_toml_table(text: &str, path: &[String]) -> String {
    let parts: Vec<String> = path.iter().map(|p| quote_toml_key(p)).collect();
    let dotted = parts.join(".");
    // INFALLIBLE: the key is escaped and the rest is fixed.
    let header = Regex::new(&format!(r"\[{}(?:\.[^\]]+)?\]", regex::escape(&dotted)))
        .expect("valid pattern");
    let mut next = text.to_owned();
    let mut removed = false;
    while let Some(m) = header.find(&next) {
        let start = m.start();
        let line_start = if start > 0 {
            next[..start].rfind('\n').map_or(0, |i| i + 1)
        } else {
            0
        };
        let end = section_end(&next, m.end());
        let tail = &next[end..];
        next = format!(
            "{}{}",
            &next[..line_start],
            tail.strip_prefix('\n').unwrap_or(tail)
        );
        removed = true;
    }
    if removed {
        static BLANKS: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\n{3,}").expect("valid pattern"));
        return BLANKS.replace_all(&next, "\n\n").into_owned();
    }
    remove_toml_assignment(text, path.last().map_or("", String::as_str))
}

fn upsert_toml_object(
    text: &str,
    table_path: &[String],
    existing: Option<&Map<String, Value>>,
    merged: &Map<String, Value>,
    remove_missing: bool,
) -> Result<String, String> {
    let mut next = text.to_owned();
    let child_path = |key: &str| {
        let mut path = table_path.to_vec();
        path.push(key.to_owned());
        path
    };
    for (key, value) in entries(merged) {
        let previous = existing.and_then(|e| own(e, key));
        if json_values_equal(previous, Some(value)) {
            continue;
        }
        match (value, previous) {
            (Value::Object(value), Some(Value::Object(previous))) => {
                next = upsert_toml_object(
                    &next,
                    &child_path(key),
                    Some(previous),
                    value,
                    remove_missing,
                )?;
            }
            // `previous === undefined`: an inherited name reads as a function.
            (Value::Object(_), None) if !(existing.is_some() && inherited(key)) => {
                next = append_toml_fragment(&next, &child_path(key), value)?;
            }
            _ => next = replace_in_table(&next, table_path, key, value)?,
        }
    }
    if remove_missing && let Some(existing) = existing {
        for (key, value) in entries(existing) {
            if has_key(merged, key) {
                continue;
            }
            if matches!(value, Value::Object(_)) {
                next = remove_toml_table(&next, &child_path(key));
                continue;
            }
            if table_path.is_empty() {
                next = remove_toml_assignment(&next, key);
                continue;
            }
            let header = table_header(table_path);
            let Some(start) = next.find(&header) else {
                continue;
            };
            let end = section_end(&next, start + header.len());
            let section = remove_toml_assignment(&next[start..end], key);
            next = format!("{}{section}{}", &next[..start], &next[end..]);
        }
    }
    Ok(next)
}

/// `overlayTomlPreservingFormat(existingRaw, overlay, mergeDocuments)`. Errors are smol-toml
/// `stringify`'s.
pub fn overlay_toml_preserving_format(
    existing_raw: Option<&str>,
    overlay: &Map<String, Value>,
    merge_documents: impl FnOnce(&Map<String, Value>, &Map<String, Value>) -> Map<String, Value>,
) -> Result<String, String> {
    let Some(raw) = existing_raw.filter(|r| !emit_rs::js::trim(r).is_empty()) else {
        return Ok(ensure_trailing_newline(&toml_stringify(overlay)?));
    };
    let Ok(existing) = parse_toml(raw) else {
        return Ok(ensure_trailing_newline(&toml_stringify(overlay)?));
    };
    let merged = merge_documents(&existing, overlay);
    if json_values_equal(
        Some(&Value::Object(existing.clone())),
        Some(&Value::Object(merged.clone())),
    ) {
        return Ok(raw.to_owned());
    }
    Ok(ensure_trailing_newline(&upsert_toml_object(
        raw,
        &[],
        Some(&existing),
        &merged,
        false,
    )?))
}

/// `applyTomlObjectUpdatePreservingFormat(existingRaw, next)`.
pub fn apply_toml_object_update_preserving_format(
    existing_raw: &str,
    next: &Map<String, Value>,
) -> Result<String, String> {
    let Ok(existing) = parse_toml(existing_raw) else {
        return Ok(ensure_trailing_newline(&toml_stringify(next)?));
    };
    if json_values_equal(
        Some(&Value::Object(existing.clone())),
        Some(&Value::Object(next.clone())),
    ) {
        return Ok(existing_raw.to_owned());
    }
    Ok(ensure_trailing_newline(&upsert_toml_object(
        existing_raw,
        &[],
        Some(&existing),
        next,
        true,
    )?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn replacement_patterns_follow_javascript() {
        let re = Regex::new(r"(a)(b)?").unwrap();
        assert_eq!(
            js_replace(&re, "xay", "[$1|$2|$&|$$|$`|$'|$3|$0]"),
            "x[a||a|$|x|y|$3|$0]y"
        );
    }

    #[test]
    fn record_from_path_skips_empty_and_proto_segments() {
        let v = json!(1);
        let p = |xs: &[&str]| xs.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            Value::Object(record_from_path(&p(&["a", "", "b"]), &v)),
            json!({"a": {"b": 1}})
        );
        assert_eq!(
            Value::Object(record_from_path(&p(&["a", "__proto__", "b"]), &v)),
            json!({"a": {}})
        );
        assert_eq!(
            Value::Object(record_from_path(&p(&["a", ""]), &v)),
            json!({"a": {}})
        );
    }
}
