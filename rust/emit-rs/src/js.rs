//! JavaScript semantics shared by the emitters.

use serde_json::{Map, Number, Value};

/// `String(n)` for a JSON number, as JavaScript prints it once it is a double.
pub fn number_to_string(n: &Number) -> String {
    let f = n.as_f64().unwrap_or(f64::NAN);
    if f == 0.0 {
        return "0".to_owned();
    }
    ryu_js::Buffer::new().format(f).to_owned()
}

/// True for a number that JavaScript holds as negative zero.
pub fn is_negative_zero(n: &Number) -> bool {
    n.as_f64().is_some_and(|f| f == 0.0 && f.is_sign_negative())
}

/// A canonical array index: what JavaScript enumerates first, ascending.
fn array_index(key: &str) -> Option<u32> {
    if key.is_empty() || (key.len() > 1 && key.starts_with('0')) {
        return None;
    }
    if !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    key.parse::<u32>().ok().filter(|&n| n != u32::MAX)
}

/// The entries of an object in `Object.keys` order.
pub fn ordered_entries(map: &Map<String, Value>) -> Vec<(&String, &Value)> {
    let mut indexed: Vec<(u32, (&String, &Value))> = Vec::new();
    let mut rest = Vec::new();
    for (k, v) in map {
        match array_index(k) {
            Some(n) => indexed.push((n, (k, v))),
            None => rest.push((k, v)),
        }
    }
    indexed.sort_by_key(|(n, _)| *n);
    indexed.into_iter().map(|(_, e)| e).chain(rest).collect()
}

/// `JSON.stringify(string)`.
pub fn quote(s: &str) -> String {
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
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The length JavaScript reports: UTF-16 code units.
pub fn utf16_len(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_follow_object_keys_order() {
        let v: Value =
            serde_json::from_str(r#"{"b":1,"10":2,"a":3,"2":4,"01":5,"4294967295":6}"#).unwrap();
        let keys: Vec<&str> = ordered_entries(v.as_object().unwrap())
            .into_iter()
            .map(|(k, _)| k.as_str())
            .collect();
        assert_eq!(keys, ["2", "10", "b", "a", "01", "4294967295"]);
    }

    #[test]
    fn numbers_print_like_javascript() {
        let v: Value =
            serde_json::from_str("[1, 1.5, 1e21, 1e-7, -0.0, 100000000000000000000]").unwrap();
        let out: Vec<String> = v
            .as_array()
            .unwrap()
            .iter()
            .map(|n| number_to_string(n.as_number().unwrap()))
            .collect();
        assert_eq!(
            out,
            ["1", "1.5", "1e+21", "1e-7", "0", "100000000000000000000"]
        );
    }
}
