//! The `yaml` package (2.8) as HarnessTap calls it.
//!
//! - [`parse`] is `parse(source)` with the default options: one document, the YAML 1.2 core
//!   schema, unique keys, no merge keys, numbers as doubles, and the result converted to plain
//!   JavaScript values (`doc.toJS()`), here a `serde_json::Value` built with `preserve_order`.
//! - [`stringify`] is `emit_rs::yaml::stringify`, the `{ indent: 2, lineWidth: 0,
//!   defaultKeyType: "PLAIN" }` call every YAML writer in `src/` uses.
//!
//! The YAML syntax is read by `saphyr-parser` (a YAML 1.2 parser); this crate does what the
//! `yaml` package's composer and core schema do with it: resolve plain scalars by the same
//! regular expressions, apply explicit tags, reject duplicate keys and multiple documents, and
//! build objects with JavaScript key semantics. Error messages are not the original's (it prints
//! line context); each error carries the original's code where there is one.
//!
//! Known gaps (recorded in `rust/MAP.md`): `.inf` and `.nan` come back as `null`, because a
//! `serde_json::Value` cannot hold them; collection keys, the YAML 1.1 tags (`!!binary`,
//! `!!timestamp`, `!!set`, `!!omap`, `!!pairs`) and the alias-count limit are not reproduced, and
//! the first two return [`YamlError::Unsupported`].

#![forbid(unsafe_code)]

use saphyr_parser::{Event, Parser, ScalarStyle, Tag};
use serde_json::{Map, Number, Value};
use std::collections::HashMap;

pub use emit_rs::yaml::stringify;

/// Why `parse` failed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum YamlError {
    /// The original throws a `YAMLParseError`; `code` is its code (`DUPLICATE_KEY`,
    /// `MULTIPLE_DOCS`, ...) or `None` for a syntax error found by the parser.
    Parse {
        code: Option<&'static str>,
        message: String,
    },
    /// Something the original accepts that this port does not reproduce.
    Unsupported(String),
}

impl std::fmt::Display for YamlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            YamlError::Parse { message, .. } => f.write_str(message),
            YamlError::Unsupported(m) => write!(f, "unsupported YAML: {m}"),
        }
    }
}

impl std::error::Error for YamlError {}

fn parse_error(code: &'static str, message: &str) -> YamlError {
    YamlError::Parse {
        code: Some(code),
        message: message.to_owned(),
    }
}

/// A composed node, before conversion to JavaScript values.
enum Node {
    Scalar {
        value: String,
        style: ScalarStyle,
        tag: Option<String>,
        anchor: usize,
    },
    Seq {
        items: Vec<Node>,
        anchor: usize,
        tag: Option<String>,
    },
    Map {
        pairs: Vec<(Node, Node)>,
        anchor: usize,
        tag: Option<String>,
    },
    Alias(usize),
}

fn tag_name(tag: &Tag) -> String {
    if tag.handle.is_empty() {
        // Verbatim (`!<...>`) or the non-specific `!`.
        tag.suffix.clone()
    } else {
        format!("{}{}", tag.handle, tag.suffix)
    }
}

/// `parse(source)`.
pub fn parse(source: &str) -> Result<Value, YamlError> {
    // The original's lexer skips a byte order mark at the start; saphyr reads it as content.
    let source = source.strip_prefix('\u{FEFF}').unwrap_or(source);
    if declares_yaml_1_1(source) {
        return Err(YamlError::Unsupported(
            "a %YAML 1.1 document (the original switches to the YAML 1.1 schema)".into(),
        ));
    }
    let mut patched: Option<String> = None;
    loop {
        let text = patched.as_deref().unwrap_or(source);
        match read_events(text).map(|_| ()) {
            Ok(()) => break,
            Err(e) => match tab_after_colon(text, &e) {
                Some(fixed) => patched = Some(fixed),
                None => {
                    return Err(YamlError::Parse {
                        code: None,
                        message: e.to_string(),
                    });
                }
            },
        }
    }
    let text = patched.as_deref().unwrap_or(source);
    let events = read_events(text).map_err(|e| YamlError::Parse {
        code: None,
        message: e.to_string(),
    })?;
    let mut docs = Vec::new();
    let mut i = 0;
    while i < events.len() {
        match &events[i] {
            Event::DocumentStart(_) => {
                i += 1;
                let node = if matches!(events.get(i), Some(Event::DocumentEnd)) {
                    None
                } else {
                    Some(compose(&events, &mut i)?)
                };
                docs.push(node);
            }
            _ => i += 1,
        }
    }
    if docs.len() > 1 {
        return Err(parse_error(
            "MULTIPLE_DOCS",
            "Source contains multiple documents; please use YAML.parseAllDocuments()",
        ));
    }
    match docs.pop().flatten() {
        None => Ok(Value::Null),
        Some(node) => {
            let mut anchors = HashMap::new();
            to_js(&node, &mut anchors)
        }
    }
}

fn read_events(source: &str) -> Result<Vec<Event<'_>>, saphyr_parser::ScanError> {
    let mut events = Vec::new();
    for item in Parser::new_from_str(source) {
        events.push(item?.0);
    }
    Ok(events)
}

/// saphyr rejects a tab between a `:` indicator and a value (`a:\tb`), which YAML 1.2 and the
/// original accept. The error points just past the separating white space, so the tabs there are
/// separation, not content: turn them into spaces and read again.
fn tab_after_colon(text: &str, e: &saphyr_parser::ScanError) -> Option<String> {
    if e.info() != "':' must be followed by a valid YAML whitespace" {
        return None;
    }
    let chars: Vec<char> = text.chars().collect();
    let end = e.marker().index().min(chars.len());
    let mut start = end;
    while start > 0 && matches!(chars[start - 1], ' ' | '\t') {
        start -= 1;
    }
    if start == 0 || chars[start - 1] != ':' || !chars[start..end].contains(&'\t') {
        return None;
    }
    let mut out = chars;
    for c in &mut out[start..end] {
        *c = ' ';
    }
    Some(out.into_iter().collect())
}

/// A `%YAML 1.1` directive before the first document.
fn declares_yaml_1_1(source: &str) -> bool {
    for line in source.lines() {
        if line.starts_with("---") || line.starts_with("...") {
            return false;
        }
        if let Some(rest) = line.strip_prefix("%YAML")
            && rest.split_whitespace().next() == Some("1.1")
        {
            return true;
        }
        if !line.starts_with('%') && !line.trim_start().is_empty() && !line.starts_with('#') {
            return false;
        }
    }
    false
}

/// Builds the node starting at `events[*i]`, leaving `*i` after it.
fn compose(events: &[Event<'_>], i: &mut usize) -> Result<Node, YamlError> {
    let event = &events[*i];
    *i += 1;
    match event {
        Event::Scalar(value, style, anchor, tag) => Ok(Node::Scalar {
            value: value.to_string(),
            style: *style,
            tag: tag.as_deref().map(tag_name),
            anchor: *anchor,
        }),
        Event::Alias(id) => Ok(Node::Alias(*id)),
        Event::SequenceStart(anchor, tag) => {
            let mut items = Vec::new();
            while !matches!(events.get(*i), Some(Event::SequenceEnd) | None) {
                items.push(compose(events, i)?);
            }
            *i += 1;
            Ok(Node::Seq {
                items,
                anchor: *anchor,
                tag: tag.as_deref().map(tag_name),
            })
        }
        Event::MappingStart(anchor, tag) => {
            let mut pairs = Vec::new();
            while !matches!(events.get(*i), Some(Event::MappingEnd) | None) {
                let key = compose(events, i)?;
                let value = compose(events, i)?;
                pairs.push((key, value));
            }
            *i += 1;
            Ok(Node::Map {
                pairs,
                anchor: *anchor,
                tag: tag.as_deref().map(tag_name),
            })
        }
        other => Err(parse_error("UNEXPECTED_TOKEN", &format!("{other:?}"))),
    }
}

const CORE: &str = "tag:yaml.org,2002:";

/// A number as `serde_json` holds what JavaScript would print the same way.
fn js_number(f: f64) -> Value {
    if !f.is_finite() {
        return Value::Null;
    }
    if f.fract() == 0.0 && f.abs() < 9_007_199_254_740_992.0 && !(f == 0.0 && f.is_sign_negative())
    {
        return Value::Number(Number::from(f as i64));
    }
    Number::from_f64(f).map_or(Value::Null, Value::Number)
}

fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// `parseInt(digits, radix)` for digits already checked by the tag's test.
fn parse_int(digits: &str, radix: u32) -> f64 {
    if radix == 10 {
        return digits.parse::<f64>().unwrap_or(f64::NAN);
    }
    let mut n = 0f64;
    for c in digits.chars() {
        n = n * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0));
    }
    n
}

/// The core schema's scalar tags, in the schema's order.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ScalarTag {
    Null,
    Bool,
    IntOct,
    Int,
    IntHex,
    FloatNaN,
    FloatExp,
    Float,
}

const SCALAR_TAGS: [ScalarTag; 8] = [
    ScalarTag::Null,
    ScalarTag::Bool,
    ScalarTag::IntOct,
    ScalarTag::Int,
    ScalarTag::IntHex,
    ScalarTag::FloatNaN,
    ScalarTag::FloatExp,
    ScalarTag::Float,
];

impl ScalarTag {
    fn name(self) -> &'static str {
        match self {
            ScalarTag::Null => "null",
            ScalarTag::Bool => "bool",
            ScalarTag::IntOct | ScalarTag::Int | ScalarTag::IntHex => "int",
            ScalarTag::FloatNaN | ScalarTag::FloatExp | ScalarTag::Float => "float",
        }
    }

    fn test(self, s: &str) -> bool {
        match self {
            ScalarTag::Null => matches!(s, "" | "~" | "null" | "Null" | "NULL"),
            ScalarTag::Bool => {
                matches!(s, "true" | "True" | "TRUE" | "false" | "False" | "FALSE")
            }
            ScalarTag::IntOct => s
                .strip_prefix("0o")
                .is_some_and(|d| !d.is_empty() && d.bytes().all(|b| (b'0'..=b'7').contains(&b))),
            ScalarTag::Int => is_digits(s.strip_prefix(['-', '+']).unwrap_or(s)),
            ScalarTag::IntHex => s
                .strip_prefix("0x")
                .is_some_and(|d| !d.is_empty() && d.bytes().all(|b| b.is_ascii_hexdigit())),
            ScalarTag::FloatNaN => matches!(
                s,
                ".inf"
                    | ".Inf"
                    | ".INF"
                    | "+.inf"
                    | "+.Inf"
                    | "+.INF"
                    | "-.inf"
                    | "-.Inf"
                    | "-.INF"
                    | ".nan"
                    | ".NaN"
                    | ".NAN"
            ),
            ScalarTag::FloatExp => {
                let Some(e) = s.find(['e', 'E']) else {
                    return false;
                };
                let (mantissa, exp) = (&s[..e], &s[e + 1..]);
                decimal(mantissa, true) && is_digits(exp.strip_prefix(['-', '+']).unwrap_or(exp))
            }
            ScalarTag::Float => decimal(s, false),
        }
    }

    fn resolve(self, s: &str) -> Value {
        match self {
            ScalarTag::Null => Value::Null,
            ScalarTag::Bool => Value::Bool(s.starts_with(['t', 'T'])),
            ScalarTag::IntOct => js_number(parse_int(&s[2..], 8)),
            ScalarTag::IntHex => js_number(parse_int(&s[2..], 16)),
            ScalarTag::Int => {
                let (neg, digits) = match s.as_bytes()[0] {
                    b'-' => (true, &s[1..]),
                    b'+' => (false, &s[1..]),
                    _ => (false, s),
                };
                let n = parse_int(digits, 10);
                js_number(if neg { -n } else { n })
            }
            // `.inf` and `.nan`: not representable (see the crate docs).
            ScalarTag::FloatNaN => Value::Null,
            ScalarTag::FloatExp | ScalarTag::Float => {
                js_number(s.parse::<f64>().unwrap_or(f64::NAN))
            }
        }
    }
}

/// `[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)` (`float`), or with `[0-9]+` alone allowed (`floatExp`).
fn decimal(s: &str, integer_ok: bool) -> bool {
    let s = s.strip_prefix(['-', '+']).unwrap_or(s);
    if let Some(frac) = s.strip_prefix('.') {
        return is_digits(frac);
    }
    match s.split_once('.') {
        Some((int, frac)) => is_digits(int) && (frac.is_empty() || is_digits(frac)),
        None => integer_ok && is_digits(s),
    }
}

/// `composeScalar` then `toJS` for one scalar.
fn scalar(value: &str, style: ScalarStyle, tag: Option<&str>) -> Result<Value, YamlError> {
    let Some(tag) = tag else {
        if style == ScalarStyle::Plain
            && let Some(t) = SCALAR_TAGS.iter().find(|t| t.test(value))
        {
            return Ok(t.resolve(value));
        }
        return Ok(Value::String(value.to_owned()));
    };
    // `findScalarTagByName`.
    if tag == "!" {
        return Ok(Value::String(value.to_owned()));
    }
    if let Some(name) = tag.strip_prefix(CORE) {
        if name == "str" {
            return Ok(Value::String(value.to_owned()));
        }
        if let Some(t) = SCALAR_TAGS
            .iter()
            .find(|t| t.name() == name && t.test(value))
        {
            return Ok(t.resolve(value));
        }
        if matches!(name, "binary" | "omap" | "pairs" | "set" | "timestamp") {
            return Err(YamlError::Unsupported(format!("the !!{name} tag")));
        }
    }
    // An unresolved tag is a warning; the value stays a string.
    Ok(Value::String(value.to_owned()))
}

/// The YAML 1.1 collection tags the original knows: `!!set` builds a `Set`, `!!omap` a `Map`,
/// `!!pairs` an array of pairs. Any other tag on a collection only warns.
fn collection_tag(tag: Option<&str>) -> Result<(), YamlError> {
    match tag.and_then(|t| t.strip_prefix(CORE)) {
        Some(name @ ("set" | "omap" | "pairs")) => {
            Err(YamlError::Unsupported(format!("the !!{name} tag")))
        }
        _ => Ok(()),
    }
}

/// `a.value === b.value` for two resolved scalar keys.
fn same_scalar(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        _ => a == b,
    }
}

/// `String(key)` for a key that resolves to `NaN` or an infinity, which `serde_json` cannot hold.
fn non_finite_key(node: &Node) -> Option<&'static str> {
    let Node::Scalar {
        value, style, tag, ..
    } = node
    else {
        return None;
    };
    let resolves = match tag.as_deref() {
        None => *style == ScalarStyle::Plain,
        Some(t) => t == "tag:yaml.org,2002:float",
    };
    if !resolves || !ScalarTag::FloatNaN.test(value) {
        return None;
    }
    if value.ends_with(['n', 'N']) {
        Some("NaN")
    } else if value.starts_with('-') {
        Some("-Infinity")
    } else {
        Some("Infinity")
    }
}

/// `stringifyKey` for a scalar's JavaScript value.
fn string_key(js_key: &Value) -> Result<String, YamlError> {
    Ok(match js_key {
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => emit_rs::js::number_to_string(n),
        Value::String(s) => s.clone(),
        Value::Array(_) | Value::Object(_) => {
            return Err(YamlError::Unsupported(
                "a collection as a mapping key".into(),
            ));
        }
    })
}

fn to_js(node: &Node, anchors: &mut HashMap<usize, Value>) -> Result<Value, YamlError> {
    let (value, anchor) = match node {
        Node::Alias(id) => {
            return anchors
                .get(id)
                .cloned()
                .ok_or_else(|| parse_error("BAD_ALIAS", "Aliased anchor not found"));
        }
        Node::Scalar {
            value,
            style,
            tag,
            anchor,
        } => (scalar(value, *style, tag.as_deref())?, *anchor),
        Node::Seq { items, anchor, tag } => {
            collection_tag(tag.as_deref())?;
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.push(to_js(item, anchors)?);
            }
            (Value::Array(out), *anchor)
        }
        Node::Map { pairs, anchor, tag } => {
            collection_tag(tag.as_deref())?;
            let mut map = Map::new();
            // Resolved scalar keys seen so far, for `uniqueKeys`.
            let mut seen: Vec<Value> = Vec::new();
            for (k, v) in pairs {
                let js_key = to_js(k, anchors)?;
                let non_finite = non_finite_key(k);
                if matches!(k, Node::Scalar { .. }) {
                    // `NaN !== NaN`; the infinities equal themselves and nothing else.
                    let compare = match non_finite {
                        Some("NaN") => None,
                        Some(name) => Some(Value::String(format!("\u{0}{name}"))),
                        None => Some(js_key.clone()),
                    };
                    if let Some(compare) = compare {
                        if seen.iter().any(|s| same_scalar(s, &compare)) {
                            return Err(parse_error("DUPLICATE_KEY", "Map keys must be unique"));
                        }
                        seen.push(compare);
                    }
                }
                let key = match non_finite {
                    Some(name) => name.to_owned(),
                    None => string_key(&js_key)?,
                };
                let value = to_js(v, anchors)?;
                map.insert(key, value);
            }
            (Value::Object(map), *anchor)
        }
    };
    if anchor != 0 {
        anchors.insert(anchor, value.clone());
    }
    Ok(value)
}
