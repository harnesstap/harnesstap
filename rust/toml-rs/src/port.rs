//! The Rust port of `src/services/toml/` (all but `parseTransportToml` and `sortKeysDeep`,
//! which stay in the original). `formatTransportToml` reproduces smol-toml 1.6 `stringify`.

#![forbid(unsafe_code)]

use std::cmp::Ordering;

use serde_json::{Map, Value};

const MAX_DEPTH: i64 = 1000;

fn js_err(kind: &str, message: impl std::fmt::Display) -> String {
    format!("{kind}: {message}")
}

/// A key JS enumerates before all others, in numeric order: a canonical array index.
fn array_index(key: &str) -> Option<u32> {
    if key == "0" {
        return Some(0);
    }
    let first = key.as_bytes().first()?;
    if !(b'1'..=b'9').contains(first) || !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    key.parse::<u32>().ok().filter(|n| *n != u32::MAX)
}

/// Builds a map whose order is the order JS enumerates an object built by inserting `entries`
/// in turn: array indexes first, ascending, then the other keys by first insertion.
fn js_object(entries: impl IntoIterator<Item = (String, Value)>) -> Map<String, Value> {
    let mut indexed: Vec<(u32, String, Value)> = Vec::new();
    let mut named: Map<String, Value> = Map::new();
    for (key, value) in entries {
        match array_index(&key) {
            Some(n) => match indexed.iter_mut().find(|(m, _, _)| *m == n) {
                Some(slot) => slot.2 = value,
                None => indexed.push((n, key, value)),
            },
            None => {
                named.insert(key, value);
            }
        }
    }
    indexed.sort_by_key(|(n, _, _)| *n);
    let mut out: Map<String, Value> = indexed.into_iter().map(|(_, k, v)| (k, v)).collect();
    out.extend(named);
    out
}

/// `Array.prototype.sort()` with no comparator on strings: UTF-16 code unit order.
fn utf16_cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// `String.prototype.localeCompare` with the default locale and options (root collation).
fn locale_cmp(a: &str, b: &str) -> Ordering {
    use icu_collator::options::CollatorOptions;
    match icu_collator::Collator::try_new(Default::default(), CollatorOptions::default()) {
        Ok(collator) => collator.compare(a, b),
        // INFALLIBLE: the compiled root collation data is always present.
        Err(_) => utf16_cmp(a, b),
    }
}

/// `Object.keys(value)` for the values JSON can carry.
fn object_keys(value: &Value) -> Result<Vec<String>, String> {
    match value {
        Value::Null => Err(js_err(
            "TypeError",
            "Cannot convert undefined or null to object",
        )),
        Value::Object(map) => Ok(map.keys().cloned().collect()),
        Value::Array(items) => Ok((0..items.len()).map(|i| i.to_string()).collect()),
        Value::String(s) => Ok((0..s.encode_utf16().count())
            .map(|i| i.to_string())
            .collect()),
        Value::Bool(_) | Value::Number(_) => Ok(Vec::new()),
    }
}

fn number(value: &serde_json::Number) -> f64 {
    value.as_f64().unwrap_or(f64::NAN)
}

/// `String(value)`.
fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => crate::js::number_to_string(number(n)),
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| match item {
                Value::Null => String::new(),
                other => js_string(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

fn name_of(environment: &Value) -> Result<String, String> {
    match environment.get("name") {
        Some(Value::String(s)) => Ok(s.clone()),
        _ => Err(js_err(
            "TypeError",
            "left.name.localeCompare is not a function",
        )),
    }
}

/// `sortStringRecord` on a record: keys in code unit order, missing values as "".
fn sorted_record(record: &Value) -> Result<Value, String> {
    let mut keys = object_keys(record)?;
    keys.sort_by(|a, b| utf16_cmp(a, b));
    let entries = keys.into_iter().map(|key| {
        let value = match property(record, &key) {
            None | Some(Value::Null) => Value::String(String::new()),
            Some(v) => v,
        };
        (key, value)
    });
    Ok(Value::Object(js_object(entries)))
}

/// `environment.secret_refs && Object.keys(environment.secret_refs).length > 0`.
fn secret_refs_of(environment: &Value) -> Result<Option<Value>, String> {
    match environment.get("secret_refs") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(false)) => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(Value::Number(n)) if number(n) == 0.0 || number(n).is_nan() => Ok(None),
        Some(refs) => Ok((!object_keys(refs)?.is_empty()).then(|| refs.clone())),
    }
}

/// `record[key]` for objects, arrays (by index) and strings (one UTF-16 unit).
fn property(record: &Value, key: &str) -> Option<Value> {
    match record {
        Value::Object(map) => map.get(key).cloned(),
        Value::Array(items) => key
            .parse::<usize>()
            .ok()
            .and_then(|i| items.get(i).cloned()),
        Value::String(s) => {
            let units: Vec<u16> = s.encode_utf16().collect();
            let i = key.parse::<usize>().ok()?;
            units.get(i).map(|u| crate::js::utf16_string(&[*u]))
        }
        _ => None,
    }
}

/// `environment.values`. On an array that is `Array.prototype.values`, a function with no
/// own keys, which reads as an empty record.
fn values_of(environment: &Value) -> Value {
    match environment {
        Value::Array(_) => Value::Object(Map::new()),
        other => other.get("values").cloned().unwrap_or(Value::Null),
    }
}

/// Port of `environmentsToTomlRecord` (`src/services/toml/environment-document.ts:11`).
pub fn environments_to_toml_record(environments: Vec<Value>) -> Result<Value, String> {
    let mut named = environments
        .iter()
        .map(|e| Ok((name_of(e)?, e)))
        .collect::<Result<Vec<_>, String>>()?;
    named.sort_by(|(a, _), (b, _)| locale_cmp(a, b));
    let mut rows = Vec::new();
    for (name, environment) in named {
        let mut row = Vec::new();
        let values = values_of(environment);
        if !object_keys(&values)?.is_empty() {
            row.push(("values".to_string(), sorted_record(&values)?));
        }
        if let Some(refs) = secret_refs_of(environment)? {
            row.push(("secret_refs".to_string(), refs));
        }
        rows.push((name, Value::Object(js_object(row))));
    }
    Ok(Value::Object(js_object(rows)))
}

/// Port of `environmentsFromTomlRecord` (`src/services/toml/environment-document.ts:30`).
pub fn environments_from_toml_record(record: Value) -> Result<Vec<Value>, String> {
    let Value::Object(record) = record else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for (name, value) in &record {
        if !value.is_object() {
            return Err(js_err(
                "Error",
                format!("Environment {name} must be a table"),
            ));
        }
        let mut values = Vec::new();
        if let Some(Value::Object(raw)) = value.get("values") {
            for (key, entry) in raw {
                values.push((key.clone(), Value::String(js_string(entry))));
            }
        }
        let mut refs = Vec::new();
        if let Some(Value::Object(raw)) = value.get("secret_refs") {
            for (key, entry) in raw {
                if !entry.is_object() {
                    continue;
                }
                let field = |name: &str, default: &str| match entry.get(name) {
                    None | Some(Value::Null) => default.to_string(),
                    Some(v) => js_string(v),
                };
                let mut secret = Map::new();
                secret.insert("provider".into(), Value::String(field("provider", "env")));
                secret.insert("ref".into(), Value::String(field("ref", "")));
                refs.push((key.clone(), Value::Object(secret)));
            }
        }
        let mut environment = Map::new();
        environment.insert("name".into(), Value::String(name.clone()));
        environment.insert("values".into(), Value::Object(js_object(values)));
        if !refs.is_empty() {
            environment.insert("secret_refs".into(), Value::Object(js_object(refs)));
        }
        out.push((name.clone(), Value::Object(environment)));
    }
    out.sort_by(|(a, _), (b, _)| locale_cmp(a, b));
    Ok(out.into_iter().map(|(_, v)| v).collect())
}

/// Port of `environmentToTomlDocument` (`src/services/toml/environment-document.ts:71`).
pub fn environment_to_toml_document(environment: Value) -> Result<Value, String> {
    let mut document = Map::new();
    document.insert(
        "name".into(),
        environment
            .get("name")
            .cloned()
            .unwrap_or_else(crate::js::undefined),
    );
    document.insert("values".into(), sorted_record(&values_of(&environment))?);
    if let Some(refs) = secret_refs_of(&environment)? {
        document.insert("secret_refs".into(), refs);
    }
    Ok(Value::Object(document))
}

/// The message Node puts on an fs error for `syscall` on `path`.
fn fs_error(error: &std::io::Error, syscall: &str, path: &str) -> String {
    use std::io::ErrorKind;
    let (code, text) = match error.kind() {
        ErrorKind::NotFound => ("ENOENT", "no such file or directory"),
        ErrorKind::PermissionDenied => ("EACCES", "permission denied"),
        ErrorKind::IsADirectory => {
            return js_err("Error", "EISDIR: illegal operation on a directory, read");
        }
        ErrorKind::NotADirectory => ("ENOTDIR", "not a directory"),
        _ => return js_err("Error", error),
    };
    js_err("Error", format!("{code}: {text}, {syscall} '{path}'"))
}

/// Port of `readTransportFile` (`src/services/toml/read.ts:23`).
pub fn read_transport_file(file_path: String) -> Result<String, String> {
    assert_toml_extension(file_path.clone())?;
    let bytes = std::fs::read(&file_path).map_err(|e| fs_error(&e, "open", &file_path))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Port of `sortStringRecord` (`src/services/toml/sort.ts:17`).
pub fn sort_string_record(record: Value) -> Result<Value, String> {
    sorted_record(&record)
}

/// Node's POSIX `path.extname`.
fn extname(path: &str) -> &str {
    let bytes = path.as_bytes();
    let (mut start_dot, mut start_part, mut end): (Option<usize>, usize, Option<usize>) =
        (None, 0, None);
    let mut matched_slash = true;
    let mut pre_dot_state = 0;
    for i in (0..bytes.len()).rev() {
        let code = bytes[i];
        if code == b'/' {
            if !matched_slash {
                start_part = i + 1;
                break;
            }
            continue;
        }
        if end.is_none() {
            matched_slash = false;
            end = Some(i + 1);
        }
        if code == b'.' {
            if start_dot.is_none() {
                start_dot = Some(i);
            } else if pre_dot_state != 1 {
                pre_dot_state = 1;
            }
        } else if start_dot.is_some() {
            pre_dot_state = -1;
        }
    }
    let (Some(dot), Some(end)) = (start_dot, end) else {
        return "";
    };
    if pre_dot_state == 0 || (pre_dot_state == 1 && dot == end - 1 && dot == start_part + 1) {
        return "";
    }
    &path[dot..end]
}

/// Port of `assertTomlExtension` (`src/services/toml/validate.ts:5`).
pub fn assert_toml_extension(file_path: String) -> Result<(), String> {
    let extension = extname(&file_path).to_lowercase();
    if extension == ".json" || extension == ".jsonc" {
        return Err(js_err(
            "Error",
            "JSON transport was removed. Re-export with `ht migrate export --plugin <name>` or `ht migrate export <archive> --workspace`.",
        ));
    }
    if extension != ".toml" {
        return Err(js_err(
            "Error",
            format!("Expected a .toml file: {file_path}"),
        ));
    }
    Ok(())
}

/// Port of `readSchemaHeader` (`src/services/toml/validate.ts:17`).
pub fn read_schema_header(document: Value) -> Result<Value, String> {
    let schema = match document.get("schema") {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        _ => {
            return Err(js_err(
                "Error",
                "TOML file must include a non-empty schema string",
            ));
        }
    };
    let Some(version @ Value::Number(_)) = document.get("version") else {
        return Err(js_err("Error", "TOML file must include a numeric version"));
    };
    let mut out = Map::new();
    out.insert("schema".into(), Value::String(schema));
    out.insert("version".into(), version.clone());
    Ok(Value::Object(out))
}

/// The `sortKeysDeep` the original calls before `stringify`.
fn sort_keys_deep(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(sort_keys_deep).collect()),
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| utf16_cmp(a, b));
            Value::Object(js_object(
                keys.into_iter()
                    .map(|k| (k.clone(), sort_keys_deep(&map[k]))),
            ))
        }
        other => other.clone(),
    }
}

/// smol-toml `extendedTypeOf`: `null` is an `object` there, as `typeof` says.
fn is_objectish(value: &Value) -> bool {
    matches!(value, Value::Object(_) | Value::Null)
}

fn is_bare_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// `JSON.stringify(s).replace(/\x7f/g, '\\u007f')`.
fn format_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c == '\u{7f}' => {
                out.push_str(&format!("\\u{:04x}", c as u32))
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn format_key(key: &str) -> String {
    if is_bare_key(key) {
        key.to_string()
    } else {
        format_string(key)
    }
}

fn depth_error() -> String {
    js_err(
        "Error",
        "Could not stringify the object: maximum object depth exceeded",
    )
}

fn stringify_value(value: &Value, depth: i64) -> Result<String, String> {
    if depth == 0 {
        return Err(depth_error());
    }
    match value {
        Value::Number(n) => {
            let x = number(n);
            Ok(if x.is_nan() {
                "nan".into()
            } else if x == f64::INFINITY {
                "inf".into()
            } else if x == f64::NEG_INFINITY {
                "-inf".into()
            } else {
                crate::js::number_to_string(x)
            })
        }
        Value::Bool(b) => Ok(b.to_string()),
        Value::String(s) => Ok(format_string(s)),
        Value::Object(_) | Value::Null => stringify_inline_table(value, depth),
        Value::Array(items) => stringify_array(items, depth),
    }
}

fn stringify_inline_table(value: &Value, depth: i64) -> Result<String, String> {
    let Value::Object(map) = value else {
        return Err(js_err(
            "TypeError",
            "Cannot convert undefined or null to object",
        ));
    };
    if map.is_empty() {
        return Ok("{}".into());
    }
    let mut out = String::from("{ ");
    for (i, (key, item)) in map.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        out.push_str(&format_key(key));
        out.push_str(" = ");
        out.push_str(&stringify_value(item, depth - 1)?);
    }
    Ok(out + " }")
}

fn stringify_array(items: &[Value], depth: i64) -> Result<String, String> {
    if items.is_empty() {
        return Ok("[]".into());
    }
    let mut out = String::from("[ ");
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        if item.is_null() {
            return Err(js_err(
                "TypeError",
                "arrays cannot contain null or undefined values",
            ));
        }
        out.push_str(&stringify_value(item, depth - 1)?);
    }
    Ok(out + " ]")
}

fn stringify_array_table(items: &[Value], key: &str, depth: i64) -> Result<String, String> {
    if depth == 0 {
        return Err(depth_error());
    }
    let mut out = String::new();
    for item in items {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&format!("[[{key}]]\n"));
        out.push_str(&stringify_table(None, item, key, depth)?);
    }
    Ok(out)
}

fn stringify_table(
    table_key: Option<&str>,
    value: &Value,
    prefix: &str,
    depth: i64,
) -> Result<String, String> {
    if depth == 0 {
        return Err(depth_error());
    }
    let Value::Object(map) = value else {
        return Err(js_err(
            "TypeError",
            "Cannot convert undefined or null to object",
        ));
    };
    let mut preamble = String::new();
    let mut tables = String::new();
    for (k, item) in map {
        if item.is_null() {
            continue;
        }
        let key = format_key(k);
        let full = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        let section = match item {
            Value::Array(items) if !items.is_empty() && items.iter().all(is_objectish) => {
                Some(stringify_array_table(items, &full, depth - 1)?)
            }
            Value::Object(_) => Some(stringify_table(Some(&full), item, &full, depth - 1)?),
            _ => None,
        };
        match section {
            Some(section) => {
                if !tables.is_empty() {
                    tables.push('\n');
                }
                tables.push_str(&section);
            }
            None => {
                preamble.push_str(&key);
                preamble.push_str(" = ");
                preamble.push_str(&stringify_value(item, depth)?);
                preamble.push('\n');
            }
        }
    }
    if let Some(table_key) = table_key.filter(|k| !k.is_empty())
        && (!preamble.is_empty() || tables.is_empty())
    {
        let sep = if preamble.is_empty() { "" } else { "\n" };
        preamble = format!("[{table_key}]{sep}{preamble}");
    }
    Ok(match (preamble.is_empty(), tables.is_empty()) {
        (false, false) => format!("{preamble}\n{tables}"),
        (false, true) => preamble,
        _ => tables,
    })
}

/// smol-toml `stringify` with its default options.
fn stringify(document: &Value) -> Result<String, String> {
    if !document.is_object() {
        return Err(js_err(
            "TypeError",
            "stringify can only be called with an object",
        ));
    }
    let out = stringify_table(None, document, "", MAX_DEPTH)?;
    Ok(if out.ends_with('\n') { out } else { out + "\n" })
}

/// Port of `formatTransportToml` (`src/services/toml/write.ts:5`).
pub fn format_transport_toml(document: Value) -> Result<String, String> {
    Ok(format!("{}\n", stringify(&sort_keys_deep(&document))?))
}

/// Port of `writeTransportToml` (`src/services/toml/write.ts:9`).
pub fn write_transport_toml(file_path: String, document: Value) -> Result<(), String> {
    let text = format_transport_toml(document)?;
    std::fs::write(&file_path, text).map_err(|e| fs_error(&e, "open", &file_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extname_matches_node() {
        assert_eq!(extname("a.toml"), ".toml");
        assert_eq!(extname(".toml"), "");
        assert_eq!(extname("..toml"), ".toml");
        assert_eq!(extname("dir.toml/"), ".toml");
        assert_eq!(extname("x"), "");
        assert_eq!(extname("a.b.TOML"), ".TOML");
    }

    #[test]
    fn index_keys_enumerate_first() {
        let map = js_object([
            ("a".into(), json!(1)),
            ("10".into(), json!(2)),
            ("2".into(), json!(3)),
        ]);
        assert_eq!(map.keys().collect::<Vec<_>>(), ["2", "10", "a"]);
    }

    #[test]
    fn stringifies_like_smol_toml() {
        let doc = json!({"b": {"y": {"k": "v"}}, "a": [{"n": 1}], "c": "str"});
        assert_eq!(
            format_transport_toml(doc),
            Ok("c = \"str\"\n\n[[a]]\nn = 1\n\n[b.y]\nk = \"v\"\n\n".into())
        );
    }

    #[test]
    fn locale_order_is_case_insensitive_first() {
        assert_eq!(locale_cmp("a", "B"), Ordering::Less);
        assert_eq!(locale_cmp("e", "E"), Ordering::Less);
    }
}
