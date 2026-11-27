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

/// JavaScript's white space and line terminators (what `trim` removes, `\s` in a regex).
pub fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// `String.prototype.trim`.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_space)
}

/// `String(value)` for a JSON value (`null` is `"null"`; arrays join their elements with `,`,
/// printing `null` elements as empty; objects are `[object Object]`).
pub fn to_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => number_to_string(n),
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| match item {
                Value::Null => String::new(),
                other => to_string(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// `Number(value)` for a JSON value.
pub fn to_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => string_to_number(s),
        Value::Array(_) => string_to_number(&to_string(value)),
        Value::Object(_) => f64::NAN,
    }
}

/// `Number(string)`: the `StringNumericLiteral` grammar after trimming.
pub fn string_to_number(s: &str) -> f64 {
    let s = trim(s);
    if s.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = s.strip_prefix(prefix) {
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            return digits.chars().fold(0.0, |n, c| {
                n * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0))
            });
        }
    }
    let (sign, body) = match s.as_bytes()[0] {
        b'-' => (-1.0, &s[1..]),
        b'+' => (1.0, &s[1..]),
        _ => (1.0, s),
    };
    if body == "Infinity" {
        return sign * f64::INFINITY;
    }
    if !is_decimal_literal(body) {
        return f64::NAN;
    }
    body.parse::<f64>().map_or(f64::NAN, |n| sign * n)
}

/// `StrUnsignedDecimalLiteral`: `1`, `1.`, `.5`, `1.5e-3`.
fn is_decimal_literal(s: &str) -> bool {
    let (mantissa, exponent) = match s.find(['e', 'E']) {
        Some(i) => (&s[..i], Some(&s[i + 1..])),
        None => (s, None),
    };
    let digits = |t: &str| !t.is_empty() && t.bytes().all(|b| b.is_ascii_digit());
    let mantissa_ok = match mantissa.split_once('.') {
        Some((int, frac)) => {
            (digits(int) || int.is_empty())
                && (digits(frac) || frac.is_empty())
                && !(int.is_empty() && frac.is_empty())
        }
        None => digits(mantissa),
    };
    let exponent_ok = exponent.is_none_or(|e| digits(e.strip_prefix(['+', '-']).unwrap_or(e)));
    mantissa_ok && exponent_ok
}

/// A JavaScript number as `serde_json` holds it: integers as integers, `NaN` and the
/// infinities as `null` (what `JSON.stringify` prints for them).
pub fn number_value(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 9_007_199_254_740_992.0 && !(n == 0.0 && n.is_sign_negative())
    {
        return Value::Number(Number::from(n as i64));
    }
    Number::from_f64(n).map_or(Value::Null, Value::Number)
}

/// JavaScript truthiness for a JSON value.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
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
    fn coerces_like_javascript() {
        let v = |t: &str| serde_json::from_str::<Value>(t).unwrap();
        assert_eq!(
            to_string(&v(r#"[1, null, [2, "a"], {}]"#)),
            "1,,2,a,[object Object]"
        );
        for (text, want) in [
            ("\" 12 \"", 12.0),
            ("\"\"", 0.0),
            ("\"0x10\"", 16.0),
            ("\"0b11\"", 3.0),
            ("\"1e3\"", 1000.0),
            ("\".5\"", 0.5),
            ("\"5.\"", 5.0),
            ("[7]", 7.0),
            ("true", 1.0),
            ("\"-Infinity\"", f64::NEG_INFINITY),
        ] {
            assert_eq!(to_number(&v(text)), want, "{text}");
        }
        for text in [
            "\"abc\"", "\"inf\"", "\"-0x1\"", "\".\"", "{}", "[1, 2]", "\"1e\"",
        ] {
            assert!(to_number(&v(text)).is_nan(), "{text}");
        }
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
