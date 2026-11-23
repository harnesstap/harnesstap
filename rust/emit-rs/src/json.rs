//! `JSON.stringify(value, null, indent)`.

use crate::js;
use serde_json::Value;

/// `JSON.stringify(value, null, indent)` where `indent` is the gap string
/// (`"  "` for the usual `2`; empty for compact output).
pub fn stringify(value: &Value, indent: &str) -> String {
    let mut out = String::new();
    write(value, indent, "", &mut out);
    out
}

/// `JSON.stringify(value, null, 2) + "\n"`, the form the original writes to disk.
pub fn to_file_string(value: &Value) -> String {
    let mut out = stringify(value, "  ");
    out.push('\n');
    out
}

fn write(value: &Value, gap: &str, current: &str, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&js::number_to_string(n)),
        Value::String(s) => out.push_str(&js::quote(s)),
        Value::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            let inner = format!("{current}{gap}");
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                if !gap.is_empty() {
                    out.push('\n');
                    out.push_str(&inner);
                }
                write(item, gap, &inner, out);
            }
            if !gap.is_empty() {
                out.push('\n');
                out.push_str(current);
            }
            out.push(']');
        }
        Value::Object(map) => {
            if map.is_empty() {
                out.push_str("{}");
                return;
            }
            let inner = format!("{current}{gap}");
            out.push('{');
            for (i, (k, v)) in js::ordered_entries(map).into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                if !gap.is_empty() {
                    out.push('\n');
                    out.push_str(&inner);
                }
                out.push_str(&js::quote(k));
                out.push(':');
                if !gap.is_empty() {
                    out.push(' ');
                }
                write(v, gap, &inner, out);
            }
            if !gap.is_empty() {
                out.push('\n');
                out.push_str(current);
            }
            out.push('}');
        }
    }
}
