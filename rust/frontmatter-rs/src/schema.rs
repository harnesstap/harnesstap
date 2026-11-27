//! The js-yaml 3.14 `DEFAULT_SAFE_SCHEMA` types (`lib/js-yaml/type/*.js`): implicit resolution
//! of plain scalars, in the original order (null, bool, int, float, timestamp, merge), and the
//! explicit `!!` tags.

use std::sync::LazyLock;

use regex::Regex;

use crate::loader::{Kind, Obj, V, lossy, u16s};
use crate::value::days_from_civil;

/// The string as ASCII, or `None` when it has anything else (no resolver accepts that).
fn ascii(s: &[u16]) -> Option<String> {
    s.iter().all(|&c| c < 128).then(|| lossy(s))
}

fn str_of(v: &V) -> Option<&[u16]> {
    match v {
        V::Str(s) => Some(s),
        _ => None,
    }
}

fn resolve_null(data: &V) -> bool {
    match data {
        V::Null => true,
        V::Str(s) => matches!(lossy(s).as_str(), "~" | "null" | "Null" | "NULL"),
        _ => false,
    }
}

fn resolve_bool(data: &V) -> bool {
    str_of(data).is_some_and(|s| {
        matches!(
            lossy(s).as_str(),
            "true" | "True" | "TRUE" | "false" | "False" | "FALSE"
        )
    })
}

fn construct_bool(data: &V) -> V {
    V::Bool(str_of(data).is_some_and(|s| matches!(lossy(s).as_str(), "true" | "True" | "TRUE")))
}

static BASE60_TAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(:[0-5]?[0-9])+$").expect("valid regex"));

fn resolve_int(data: &V) -> bool {
    let Some(s) = str_of(data).and_then(ascii) else {
        return false;
    };
    let b = s.as_bytes();
    let max = b.len();
    if max == 0 {
        return false;
    }
    let at = |i: usize| b.get(i).copied();
    let mut index = 0;
    let mut ch = at(0);
    if ch == Some(b'-') || ch == Some(b'+') {
        index += 1;
        ch = at(index);
    }
    if ch == Some(b'0') {
        if index + 1 == max {
            return true;
        }
        index += 1;
        ch = at(index);
        let digits = |mut index: usize, ok: &dyn Fn(u8) -> bool| {
            let mut has_digits = false;
            let mut last = None;
            while index < max {
                last = at(index);
                index += 1;
                if last == Some(b'_') {
                    continue;
                }
                if !last.is_some_and(ok) {
                    return false;
                }
                has_digits = true;
            }
            has_digits && last != Some(b'_')
        };
        if ch == Some(b'b') {
            return digits(index + 1, &|c| c == b'0' || c == b'1');
        }
        if ch == Some(b'x') {
            return digits(index + 1, &|c| c.is_ascii_hexdigit());
        }
        return digits(index, &|c| (b'0'..=b'7').contains(&c));
    }
    if ch == Some(b'_') {
        return false;
    }
    let mut has_digits = false;
    while index < max {
        ch = at(index);
        if ch == Some(b'_') {
            index += 1;
            continue;
        }
        if ch == Some(b':') {
            break;
        }
        if !ch.is_some_and(|c| c.is_ascii_digit()) {
            return false;
        }
        has_digits = true;
        index += 1;
    }
    if !has_digits || ch == Some(b'_') {
        return false;
    }
    if ch != Some(b':') {
        return true;
    }
    BASE60_TAIL.is_match(&s[index..])
}

/// `parseInt(digits, radix)` for a string the resolver accepted: correctly rounded.
fn parse_int(digits: &str, radix: u32) -> f64 {
    if radix == 10 {
        return digits.parse::<f64>().unwrap_or(f64::NAN);
    }
    let bits = radix.trailing_zeros();
    let mut acc: u128 = 0;
    let mut shift: i32 = 0;
    let mut sticky = false;
    for c in digits.chars() {
        let Some(d) = c.to_digit(radix) else { break };
        if shift > 0 || acc.leading_zeros() < bits {
            shift += bits as i32;
            sticky |= d != 0;
        } else {
            acc = (acc << bits) | u128::from(d);
        }
    }
    if sticky {
        acc |= 1;
    }
    (acc as f64) * 2f64.powi(shift)
}

fn construct_int(data: &V) -> V {
    let mut value: String = str_of(data).map(lossy).unwrap_or_default().replace('_', "");
    let mut sign = 1.0;
    if value.starts_with('-') || value.starts_with('+') {
        if value.starts_with('-') {
            sign = -1.0;
        }
        value.remove(0);
    }
    if value == "0" {
        return V::Num(0.0);
    }
    if value.starts_with('0') {
        return V::Num(match value.as_bytes().get(1) {
            Some(b'b') => sign * parse_int(&value[2..], 2),
            Some(b'x') => sign * parse_int(&value[2..], 16),
            _ => sign * parse_int(&value, 8),
        });
    }
    if value.contains(':') {
        let mut total = 0.0;
        let mut base = 1.0;
        for part in value.split(':').rev() {
            total += parse_int(part, 10) * base;
            base *= 60.0;
        }
        return V::Num(sign * total);
    }
    V::Num(sign * parse_int(&value, 10))
}

static FLOAT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"^(?:[-+]?(?:0|[1-9][0-9_]*)(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?",
        r"|\.[0-9_]+(?:[eE][-+]?[0-9]+)?",
        r"|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*",
        r"|[-+]?\.(?:inf|Inf|INF)",
        r"|\.(?:nan|NaN|NAN))$"
    ))
    .expect("valid regex")
});

fn resolve_float(data: &V) -> bool {
    let Some(s) = str_of(data).and_then(ascii) else {
        return false;
    };
    FLOAT.is_match(&s) && !s.ends_with('_')
}

/// `parseFloat` of a decimal the float pattern accepted (`1.`, `.5`, `1.e5` included).
fn parse_float(s: &str) -> f64 {
    let fixed = if s.starts_with('.') {
        format!("0{s}")
    } else {
        s.to_owned()
    };
    let fixed = fixed.replace(".e", ".0e");
    let fixed = fixed.strip_suffix('.').unwrap_or(&fixed);
    fixed.parse::<f64>().unwrap_or(f64::NAN)
}

fn construct_float(data: &V) -> V {
    let mut value = str_of(data)
        .map(lossy)
        .unwrap_or_default()
        .replace('_', "")
        .to_lowercase();
    let sign = if value.starts_with('-') { -1.0 } else { 1.0 };
    if value.starts_with('-') || value.starts_with('+') {
        value.remove(0);
    }
    if value == ".inf" {
        return V::Num(sign * f64::INFINITY);
    }
    if value == ".nan" {
        return V::Num(f64::NAN);
    }
    if value.contains(':') {
        let mut total = 0.0;
        let mut base = 1.0;
        for part in value.split(':').rev() {
            total += parse_float(part) * base;
            base *= 60.0;
        }
        return V::Num(sign * total);
    }
    V::Num(sign * parse_float(&value))
}

static DATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$").expect("valid regex")
});
static TIMESTAMP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \t]+)",
        r"([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\.([0-9]*))?",
        r"(?:[ \t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
    ))
    .expect("valid regex")
});

fn resolve_timestamp(data: &V) -> bool {
    str_of(data)
        .and_then(ascii)
        .is_some_and(|s| DATE.is_match(&s) || TIMESTAMP.is_match(&s))
}

const MAX_TIME: f64 = 8.64e15;

fn time_clip(t: f64) -> f64 {
    if !t.is_finite() || t.abs() > MAX_TIME {
        f64::NAN
    } else {
        t
    }
}

/// `Date.UTC(year, month, day, h, m, s, ms)` with integer arguments (month from 0).
pub(crate) fn date_utc(year: i64, month: i64, day: i64, h: i64, mi: i64, s: i64, ms: i64) -> f64 {
    let year = if (0..=99).contains(&year) {
        1900 + year
    } else {
        year
    };
    let ym = year + month.div_euclid(12);
    let mn = month.rem_euclid(12);
    let days = days_from_civil(ym, mn + 1, 1) + day - 1;
    let t = days as f64 * 86_400_000.0 + (h * 3_600_000 + mi * 60_000 + s * 1000 + ms) as f64;
    time_clip(t)
}

fn construct_timestamp(data: &V) -> V {
    let s = str_of(data).map(lossy).unwrap_or_default();
    let caps = DATE.captures(&s).or_else(|| TIMESTAMP.captures(&s));
    let Some(caps) = caps else {
        return V::Date(f64::NAN);
    };
    let num = |i: usize| -> i64 { caps.get(i).map_or(0, |m| m.as_str().parse().unwrap_or(0)) };
    let (year, month, day) = (num(1), num(2) - 1, num(3));
    if caps.get(4).is_none_or(|m| m.as_str().is_empty()) {
        return V::Date(date_utc(year, month, day, 0, 0, 0, 0));
    }
    let mut fraction = 0;
    if let Some(f) = caps.get(7).filter(|m| !m.as_str().is_empty()) {
        let mut digits: String = f.as_str().chars().take(3).collect();
        while digits.len() < 3 {
            digits.push('0');
        }
        fraction = digits.parse().unwrap_or(0);
    }
    let mut delta = 0;
    if let Some(sign) = caps.get(9) {
        delta = (num(10) * 60 + num(11)) * 60_000;
        if sign.as_str() == "-" {
            delta = -delta;
        }
    }
    let t = date_utc(year, month, day, num(4), num(5), num(6), fraction);
    V::Date(if delta != 0 {
        time_clip(t - delta as f64)
    } else {
        t
    })
}

const BASE64_MAP: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";

fn base64_code(c: u16) -> Option<u32> {
    (c < 128)
        .then(|| BASE64_MAP.find(c as u8 as char))
        .flatten()
        .map(|i| i as u32)
}

fn resolve_binary(data: &V) -> bool {
    let Some(s) = str_of(data) else {
        return false;
    };
    let mut bitlen = 0;
    for &c in s {
        match base64_code(c) {
            None => return false,
            Some(code) if code > 64 => {}
            Some(_) => bitlen += 6,
        }
    }
    bitlen % 8 == 0
}

fn construct_binary(data: &V) -> V {
    let input: Vec<u32> = str_of(data)
        .unwrap_or_default()
        .iter()
        .filter(|&&c| c != u16::from(b'\r') && c != u16::from(b'\n') && c != u16::from(b'='))
        .map(|&c| base64_code(c).unwrap_or(u32::MAX))
        .collect();
    let mut bits: i32 = 0;
    let mut out = Vec::new();
    for (idx, &code) in input.iter().enumerate() {
        if idx % 4 == 0 && idx != 0 {
            out.push((bits >> 16) as u8);
            out.push((bits >> 8) as u8);
            out.push(bits as u8);
        }
        bits = bits.wrapping_shl(6) | code as i32;
    }
    match (input.len() % 4) * 6 {
        0 => {
            out.push((bits >> 16) as u8);
            out.push((bits >> 8) as u8);
            out.push(bits as u8);
        }
        18 => {
            out.push((bits >> 10) as u8);
            out.push((bits >> 2) as u8);
        }
        12 => out.push((bits >> 4) as u8),
        _ => {}
    }
    V::Buf(out)
}

/// `Object.prototype.toString.call(v) === "[object Object]"`.
fn plain_object(v: &V) -> Option<&Obj> {
    match v {
        V::Obj(o) => Some(o),
        _ => None,
    }
}

fn resolve_omap(data: &V) -> bool {
    let V::Arr(items) = data else {
        return matches!(data, V::Null);
    };
    let mut seen: Vec<&Vec<u16>> = Vec::new();
    for item in items {
        let Some(pair) = plain_object(item) else {
            return false;
        };
        let keys = pair.keys();
        if keys.len() != 1 || seen.contains(&keys[0]) {
            return false;
        }
        seen.push(keys[0]);
    }
    true
}

fn resolve_pairs(data: &V) -> bool {
    let V::Arr(items) = data else {
        return matches!(data, V::Null);
    };
    items
        .iter()
        .all(|item| plain_object(item).is_some_and(|o| o.keys().len() == 1))
}

fn construct_pairs(data: &V) -> V {
    let V::Arr(items) = data else {
        return V::Arr(Vec::new());
    };
    V::Arr(
        items
            .iter()
            .filter_map(plain_object)
            .map(|o| {
                let key = o.keys()[0].clone();
                let value = o.get(&key).cloned().unwrap_or(V::Undef);
                V::Arr(vec![V::Str(key), value])
            })
            .collect(),
    )
}

fn resolve_set(data: &V) -> bool {
    match data {
        V::Null => true,
        V::Obj(o) => o.entries.iter().all(|(_, v)| *v == V::Null),
        _ => false,
    }
}

/// The implicit types, tried in order on a plain scalar (or an empty `!<?>` node).
pub(crate) fn resolve_implicit(data: &V) -> Option<(V, &'static str)> {
    if resolve_null(data) {
        return Some((V::Null, "tag:yaml.org,2002:null"));
    }
    if resolve_bool(data) {
        return Some((construct_bool(data), "tag:yaml.org,2002:bool"));
    }
    if resolve_int(data) {
        return Some((construct_int(data), "tag:yaml.org,2002:int"));
    }
    if resolve_float(data) {
        return Some((construct_float(data), "tag:yaml.org,2002:float"));
    }
    if resolve_timestamp(data) {
        return Some((construct_timestamp(data), "tag:yaml.org,2002:timestamp"));
    }
    if matches!(data, V::Null) || str_of(data).is_some_and(|s| *s == u16s("<<")) {
        return Some((data.clone(), "tag:yaml.org,2002:merge"));
    }
    None
}

fn type_kind(tag: &str) -> Option<Kind> {
    Some(match tag.strip_prefix("tag:yaml.org,2002:")? {
        "null" | "bool" | "int" | "float" | "timestamp" | "merge" | "str" | "binary" => {
            Kind::Scalar
        }
        "seq" | "omap" | "pairs" => Kind::Sequence,
        "map" | "set" => Kind::Mapping,
        _ => return None,
    })
}

/// `state.typeMap[state.kind || "fallback"][tag]`: the type's kind when the tag is known there.
pub(crate) fn explicit_kind(kind: Option<Kind>, tag: &str) -> Option<Kind> {
    let found = type_kind(tag)?;
    (kind.is_none() || kind == Some(found)).then_some(found)
}

/// `type.resolve(data) ? type.construct(data) : <cannot resolve>`.
pub(crate) fn construct_explicit(tag: &str, data: &V) -> Option<V> {
    let name = tag.strip_prefix("tag:yaml.org,2002:")?;
    let or = |empty: V| -> V {
        if matches!(data, V::Null) {
            empty
        } else {
            data.clone()
        }
    };
    match name {
        "null" => resolve_null(data).then_some(V::Null),
        "bool" => resolve_bool(data).then(|| construct_bool(data)),
        "int" => resolve_int(data).then(|| construct_int(data)),
        "float" => resolve_float(data).then(|| construct_float(data)),
        "timestamp" => resolve_timestamp(data).then(|| construct_timestamp(data)),
        "merge" => (matches!(data, V::Null) || str_of(data).is_some_and(|s| *s == u16s("<<")))
            .then(|| data.clone()),
        "binary" => resolve_binary(data).then(|| construct_binary(data)),
        "str" => Some(or(V::Str(Vec::new()))),
        "seq" => Some(or(V::Arr(Vec::new()))),
        "map" => Some(or(V::Obj(Obj::default()))),
        "omap" => resolve_omap(data).then(|| or(V::Arr(Vec::new()))),
        "pairs" => resolve_pairs(data).then(|| construct_pairs(data)),
        "set" => resolve_set(data).then(|| or(V::Obj(Obj::default()))),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_int_rounds_like_v8() {
        assert_eq!(parse_int("ff", 16), 255.0);
        assert_eq!(
            parse_int("1".repeat(60).as_str(), 2),
            1_152_921_504_606_846_976.0
        );
        assert_eq!(parse_float("1."), 1.0);
        assert_eq!(parse_float(".5"), 0.5);
        assert_eq!(parse_float("1.e5"), 100_000.0);
    }
}
