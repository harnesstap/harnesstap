//! The JavaScript values a frontmatter read can produce.

use serde_json::{Map, Number, Value};

/// A value as JavaScript holds it after `safeLoad` or `JSON.parse`.
#[derive(Clone, Debug, PartialEq)]
pub enum JsValue {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    /// Strings are UTF-16 in JavaScript; a lone surrogate (only reachable through a `\u`
    /// escape) comes out here as U+FFFD.
    String(String),
    Array(Vec<JsValue>),
    /// Own properties in `Object.keys` order.
    Object(Vec<(String, JsValue)>),
    /// A `Date`, as milliseconds since the epoch (`NaN` when invalid).
    Date(f64),
    /// A Node `Buffer` (`!!binary`).
    Buffer(Vec<u8>),
}

impl JsValue {
    /// The property `key` of an object.
    pub fn get(&self, key: &str) -> Option<&JsValue> {
        match self {
            JsValue::Object(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// `JSON.parse(JSON.stringify(value))`: dates become ISO strings, buffers
    /// `{ type: "Buffer", data }`, non-finite numbers `null`, and `undefined` drops out of
    /// objects (and is `null` in arrays and at the top).
    pub fn to_json(&self) -> Value {
        match self {
            JsValue::Undefined | JsValue::Null => Value::Null,
            JsValue::Bool(b) => Value::Bool(*b),
            JsValue::Number(n) => emit_rs::js::number_value(*n),
            JsValue::String(s) => Value::String(s.clone()),
            JsValue::Array(items) => Value::Array(items.iter().map(JsValue::to_json).collect()),
            JsValue::Object(entries) => Value::Object(
                entries
                    .iter()
                    .filter(|(_, v)| *v != JsValue::Undefined)
                    .map(|(k, v)| (k.clone(), v.to_json()))
                    .collect::<Map<_, _>>(),
            ),
            JsValue::Date(ms) => to_iso_string(*ms).map_or(Value::Null, Value::String),
            JsValue::Buffer(bytes) => {
                let mut m = Map::new();
                m.insert("type".into(), Value::String("Buffer".into()));
                m.insert(
                    "data".into(),
                    Value::Array(
                        bytes
                            .iter()
                            .map(|b| Value::Number(Number::from(*b)))
                            .collect(),
                    ),
                );
                Value::Object(m)
            }
        }
    }
}

/// Days from 1970-01-01 to the given proleptic Gregorian date (month 1 to 12).
pub(crate) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

const MAX_TIME: f64 = 8.64e15;

/// `Date.prototype.toISOString`, or `None` for an invalid date (where `toJSON` gives `null`).
pub fn to_iso_string(ms: f64) -> Option<String> {
    if !ms.is_finite() || ms.abs() > MAX_TIME {
        return None;
    }
    let ms = ms as i64;
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    let year = if (0..=9999).contains(&y) {
        format!("{y:04}")
    } else if y < 0 {
        format!("-{:06}", -y)
    } else {
        format!("+{y:06}")
    };
    Some(format!(
        "{year}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    ))
}

/// `Date.prototype.toString` with the process time zone set to UTC (the original prints local
/// time; the recordings run with `TZ=UTC`).
pub fn to_date_string(ms: f64) -> String {
    if !ms.is_finite() || ms.abs() > MAX_TIME {
        return "Invalid Date".into();
    }
    let ms = ms as i64;
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    const DAYS: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let year = if y < 0 {
        format!("-{:06}", -y)
    } else {
        format!("{y:04}")
    };
    format!(
        "{} {} {d:02} {year} {:02}:{:02}:{:02} GMT+0000 (Coordinated Universal Time)",
        DAYS[days.rem_euclid(7) as usize],
        MONTHS[(m - 1) as usize],
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
    )
}
