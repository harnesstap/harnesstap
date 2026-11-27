//! smol-toml 1.6 `parse` (on the `toml` crate) and `stringify`, over JSON-like values.

use emit_rs::js::{number_to_string, number_value, quote};
use serde_json::{Map, Value};

use crate::{TOML_DATE_KEY, entries, toml_date};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// smol-toml's `TomlDate.toISOString()`: the value as written, with milliseconds.
fn date_iso(dt: &toml::value::Datetime) -> String {
    let date = dt
        .date
        .map(|d| format!("{:04}-{:02}-{:02}", d.year, d.month, d.day));
    let time = dt.time.map(|t| {
        let ms = t.nanosecond.unwrap_or(0) / 1_000_000;
        format!(
            "{:02}:{:02}:{:02}.{ms:03}",
            t.hour,
            t.minute,
            t.second.unwrap_or(0)
        )
    });
    let offset = dt.offset.map(|o| match o {
        toml::value::Offset::Z => "Z".to_owned(),
        toml::value::Offset::Custom { minutes } => {
            let sign = if minutes < 0 { '-' } else { '+' };
            let m = minutes.unsigned_abs();
            format!("{sign}{:02}:{:02}", m / 60, m % 60)
        }
    });
    match (date, time) {
        (Some(d), Some(t)) => format!("{d}T{t}{}", offset.unwrap_or_default()),
        (Some(d), None) => d,
        (None, Some(t)) => t,
        (None, None) => String::new(),
    }
}

fn from_toml(value: toml::Value) -> Result<Value, String> {
    Ok(match value {
        toml::Value::String(s) => Value::String(s),
        toml::Value::Integer(i) => {
            if i.abs() > MAX_SAFE_INTEGER {
                return Err("integer value cannot be represented losslessly".into());
            }
            number_value(i as f64)
        }
        // `nan` and `inf` have no JSON value; they read as `null` here.
        toml::Value::Float(f) => number_value(f),
        toml::Value::Boolean(b) => Value::Bool(b),
        toml::Value::Datetime(dt) => {
            if dt.time.is_some_and(|t| t.second == Some(60)) {
                return Err("invalid value".into());
            }
            let mut map = Map::new();
            map.insert(TOML_DATE_KEY.to_owned(), Value::String(date_iso(&dt)));
            Value::Object(map)
        }
        toml::Value::Array(items) => {
            Value::Array(items.into_iter().map(from_toml).collect::<Result<_, _>>()?)
        }
        toml::Value::Table(table) => Value::Object(from_table(table)?),
    })
}

fn from_table(table: toml::Table) -> Result<Map<String, Value>, String> {
    let mut map = Map::new();
    // smol-toml defines `__proto__` as an own key, so every key is a plain insert.
    for (k, v) in table {
        map.insert(k, from_toml(v)?);
    }
    Ok(map)
}

/// smol-toml `parse(text)`. The error text is the `toml` crate's, not smol-toml's.
pub fn parse_toml(text: &str) -> Result<Map<String, Value>, String> {
    let table = text.parse::<toml::Table>().map_err(|e| e.to_string())?;
    from_table(table)
}

const DEPTH_ERROR: &str = "Could not stringify the object: maximum object depth exceeded";
const NULL_OBJECT_ERROR: &str = "Cannot convert undefined or null to object";

fn format_string(s: &str) -> String {
    quote(s).replace('\x7f', "\\u007f")
}

fn bare_or_quoted(k: &str) -> String {
    if !k.is_empty()
        && k.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        k.to_owned()
    } else {
        format_string(k)
    }
}

/// `extendedTypeOf(value) === "object"`: plain objects and `null`, not dates or arrays.
fn is_object_type(v: &Value) -> bool {
    matches!(v, Value::Null) || (matches!(v, Value::Object(_)) && toml_date(v).is_none())
}

fn stringify_value(v: &Value, depth: usize) -> Result<String, String> {
    if depth == 0 {
        return Err(DEPTH_ERROR.into());
    }
    if let Some(iso) = toml_date(v) {
        return Ok(iso.to_owned());
    }
    Ok(match v {
        Value::Number(n) => number_to_string(n),
        Value::Bool(b) => b.to_string(),
        Value::String(s) => format_string(s),
        Value::Null => return Err(NULL_OBJECT_ERROR.into()),
        Value::Object(map) => {
            let parts = entries(map)
                .into_iter()
                .map(|(k, v)| {
                    Ok(format!(
                        "{} = {}",
                        bare_or_quoted(k),
                        stringify_value(v, depth - 1)?
                    ))
                })
                .collect::<Result<Vec<_>, String>>()?;
            if parts.is_empty() {
                "{}".into()
            } else {
                format!("{{ {} }}", parts.join(", "))
            }
        }
        Value::Array(items) => {
            if items.is_empty() {
                return Ok("[]".into());
            }
            let parts = items
                .iter()
                .map(|item| match item {
                    Value::Null => Err("arrays cannot contain null or undefined values".to_owned()),
                    item => stringify_value(item, depth - 1),
                })
                .collect::<Result<Vec<_>, String>>()?;
            format!("[ {} ]", parts.join(", "))
        }
    })
}

fn stringify_table(
    table_key: Option<&str>,
    obj: &Value,
    prefix: &str,
    depth: usize,
) -> Result<String, String> {
    if depth == 0 {
        return Err(DEPTH_ERROR.into());
    }
    let Value::Object(map) = obj else {
        return Err(NULL_OBJECT_ERROR.into());
    };
    let mut preamble = String::new();
    let mut tables = String::new();
    let join = |tables: &mut String, part: String| {
        if !tables.is_empty() {
            tables.push('\n');
        }
        tables.push_str(&part);
    };
    for (k, v) in entries(map) {
        if v.is_null() {
            continue;
        }
        let key = bare_or_quoted(k);
        let full = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        match v {
            Value::Array(items) if !items.is_empty() && items.iter().all(is_object_type) => {
                let mut res = String::new();
                if depth - 1 == 0 {
                    return Err(DEPTH_ERROR.into());
                }
                for item in items {
                    if !res.is_empty() {
                        res.push('\n');
                    }
                    res.push_str(&format!("[[{full}]]\n"));
                    res.push_str(&stringify_table(None, item, &full, depth - 1)?);
                }
                join(&mut tables, res);
            }
            v if is_object_type(v) => {
                join(
                    &mut tables,
                    stringify_table(Some(&full), v, &full, depth - 1)?,
                );
            }
            v => {
                preamble.push_str(&format!("{key} = {}\n", stringify_value(v, depth)?));
            }
        }
    }
    if let Some(table_key) = table_key
        && (!preamble.is_empty() || tables.is_empty())
    {
        preamble = if preamble.is_empty() {
            format!("[{table_key}]")
        } else {
            format!("[{table_key}]\n{preamble}")
        };
    }
    Ok(match (preamble.is_empty(), tables.is_empty()) {
        (false, false) => format!("{preamble}\n{tables}"),
        (false, true) => preamble,
        _ => tables,
    })
}

/// smol-toml `stringify(object)`.
pub fn toml_stringify(obj: &Map<String, Value>) -> Result<String, String> {
    let mut out = stringify_table(None, &Value::Object(obj.clone()), "", 1000)?;
    if !out.ends_with('\n') {
        out.push('\n');
    }
    Ok(out)
}
