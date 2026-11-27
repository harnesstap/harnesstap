//! js-yaml 3.14 `safeLoad` (`lib/js-yaml/loader.js` with the default safe schema), ported line
//! by line. The input is read as UTF-16 code units, like the original's `charCodeAt`, so
//! positions, columns and error snippets come out the same.

use std::collections::{HashMap, HashSet};

use crate::schema;
use crate::value::JsValue;

pub(crate) type U16s = Vec<u16>;

/// A value while loading: strings stay UTF-16 until the end.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum V {
    Undef,
    Null,
    Bool(bool),
    Num(f64),
    Str(U16s),
    Arr(Vec<V>),
    Obj(Obj),
    Date(f64),
    Buf(Vec<u8>),
    /// An alias to a collection still being read (its id, and whether it is a sequence): the
    /// original shares the unfinished object, so the value would be cyclic.
    Cycle(usize, bool),
}

/// A plain object: own properties in insertion order; [`Obj::keys`] gives `Object.keys` order.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Obj {
    pub entries: Vec<(U16s, V)>,
}

/// An array index key (`"0"` to `"4294967294"` in canonical form) sorts first, numerically.
pub(crate) fn array_index(key: &[u16]) -> Option<u32> {
    if key.is_empty() || key.len() > 10 || (key.len() > 1 && key[0] == u16::from(b'0')) {
        return None;
    }
    let mut n: u64 = 0;
    for &c in key {
        if !(0x30..=0x39).contains(&c) {
            return None;
        }
        n = n * 10 + u64::from(c - 0x30);
    }
    (n < 4_294_967_295).then_some(n as u32)
}

impl Obj {
    pub fn has(&self, key: &[u16]) -> bool {
        self.entries.iter().any(|(k, _)| k == key)
    }

    pub fn get(&self, key: &[u16]) -> Option<&V> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    /// `object[key] = value` (or `defineProperty` for `__proto__`): an existing key keeps its
    /// place.
    pub fn set(&mut self, key: U16s, value: V) {
        match self.entries.iter_mut().find(|(k, _)| *k == key) {
            Some((_, v)) => *v = value,
            None => self.entries.push((key, value)),
        }
    }

    /// `Object.keys(object)`.
    pub fn keys(&self) -> Vec<&U16s> {
        let mut indexed: Vec<(u32, &U16s)> = self
            .entries
            .iter()
            .filter_map(|(k, _)| array_index(k).map(|i| (i, k)))
            .collect();
        indexed.sort_by_key(|(i, _)| *i);
        let mut out: Vec<&U16s> = indexed.into_iter().map(|(_, k)| k).collect();
        out.extend(
            self.entries
                .iter()
                .filter(|(k, _)| array_index(k).is_none())
                .map(|(k, _)| k),
        );
        out
    }
}

pub(crate) fn u16s(s: &str) -> U16s {
    s.encode_utf16().collect()
}

pub(crate) fn lossy(s: &[u16]) -> String {
    String::from_utf16_lossy(s)
}

impl V {
    pub fn to_public(&self) -> JsValue {
        match self {
            V::Undef => JsValue::Undefined,
            V::Null => JsValue::Null,
            V::Bool(b) => JsValue::Bool(*b),
            V::Num(n) => JsValue::Number(*n),
            V::Str(s) => JsValue::String(lossy(s)),
            V::Arr(a) => JsValue::Array(a.iter().map(V::to_public).collect()),
            V::Obj(o) => JsValue::Object(
                o.keys()
                    .into_iter()
                    .map(|k| {
                        let v = o.get(k).map_or(JsValue::Undefined, V::to_public);
                        (lossy(k), v)
                    })
                    .collect(),
            ),
            V::Date(d) => JsValue::Date(*d),
            V::Buf(b) => JsValue::Buffer(b.clone()),
            V::Cycle(..) => JsValue::Undefined,
        }
    }

    /// `typeof v === "object" && v !== null` (`common.isObject`).
    fn is_object(&self) -> bool {
        matches!(
            self,
            V::Arr(_) | V::Obj(_) | V::Date(_) | V::Buf(_) | V::Cycle(..)
        )
    }

    /// `Object.keys(v)` with the values, for an object.
    fn own_entries(&self) -> Vec<(U16s, V)> {
        match self {
            V::Obj(o) => o
                .keys()
                .into_iter()
                .map(|k| (k.clone(), o.get(k).cloned().unwrap_or(V::Undef)))
                .collect(),
            V::Arr(a) => a
                .iter()
                .enumerate()
                .map(|(i, v)| (u16s(&i.to_string()), v.clone()))
                .collect(),
            V::Buf(b) => b
                .iter()
                .enumerate()
                .map(|(i, v)| (u16s(&i.to_string()), V::Num(f64::from(*v))))
                .collect(),
            _ => Vec::new(),
        }
    }
}

/// `String(value)` for what a mapping key can be.
pub(crate) fn js_string(v: &V) -> U16s {
    match v {
        V::Undef => u16s("undefined"),
        V::Null => u16s("null"),
        V::Bool(b) => u16s(if *b { "true" } else { "false" }),
        V::Num(n) => u16s(&node_semver_rs::js_number(*n)),
        V::Str(s) => s.clone(),
        V::Arr(items) => {
            let mut out = Vec::new();
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(u16::from(b','));
                }
                if !matches!(item, V::Undef | V::Null) {
                    out.extend(js_string(item));
                }
            }
            out
        }
        V::Obj(_) => u16s("[object Object]"),
        V::Date(ms) => u16s(&crate::value::to_date_string(*ms)),
        V::Buf(b) => u16s(&String::from_utf8_lossy(b)),
        V::Cycle(_, true) => Vec::new(),
        V::Cycle(_, false) => u16s("[object Object]"),
    }
}

fn contains_cycle(v: &V) -> bool {
    match v {
        V::Cycle(..) => true,
        V::Arr(items) => items.iter().any(contains_cycle),
        V::Obj(o) => o.entries.iter().any(|(_, v)| contains_cycle(v)),
        _ => false,
    }
}

/// `YAMLException`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct YamlException {
    /// `reason`.
    pub reason: String,
    /// `message`: the reason, then ` at line L, column C:` and a snippet when there is a mark.
    pub message: String,
}

/// Why a document is not loaded. `Unsupported` covers what the port does not reproduce.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadError {
    Yaml(YamlException),
    /// An alias to a collection from inside that collection: the original builds a cyclic
    /// object.
    Unsupported(&'static str),
}

type R<T> = Result<T, LoadError>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Ctx {
    FlowIn,
    FlowOut,
    BlockIn,
    BlockOut,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Scalar,
    Sequence,
    Mapping,
}

#[derive(Clone, Debug)]
enum Anchor {
    Ready(V),
    /// A collection still being read, with a unique id and whether it is a sequence.
    Pending(usize, bool),
}

/// `charCodeAt` past the end: `NaN`, which equals nothing.
const NAN: u32 = u32::MAX;

fn is_eol(c: u32) -> bool {
    c == 0x0A || c == 0x0D
}
fn is_white_space(c: u32) -> bool {
    c == 0x09 || c == 0x20
}
fn is_ws_or_eol(c: u32) -> bool {
    c == 0x09 || c == 0x20 || c == 0x0A || c == 0x0D
}
fn is_flow_indicator(c: u32) -> bool {
    matches!(c, 0x2C | 0x5B | 0x5D | 0x7B | 0x7D)
}
fn from_hex_code(c: u32) -> i64 {
    if (0x30..=0x39).contains(&c) {
        return i64::from(c - 0x30);
    }
    let lc = c | 0x20;
    if (0x61..=0x66).contains(&lc) {
        return i64::from(lc - 0x61 + 10);
    }
    -1
}
fn escaped_hex_len(c: u32) -> u32 {
    match c {
        0x78 => 2,
        0x75 => 4,
        0x55 => 8,
        _ => 0,
    }
}
fn from_decimal_code(c: u32) -> i64 {
    if (0x30..=0x39).contains(&c) {
        i64::from(c - 0x30)
    } else {
        -1
    }
}
fn simple_escape(c: u32) -> Option<u16> {
    Some(match c {
        0x30 => 0x00,
        0x61 => 0x07,
        0x62 => 0x08,
        0x74 | 0x09 => 0x09,
        0x6E => 0x0A,
        0x76 => 0x0B,
        0x66 => 0x0C,
        0x72 => 0x0D,
        0x65 => 0x1B,
        0x20 => 0x20,
        0x22 => 0x22,
        0x2F => 0x2F,
        0x5C => 0x5C,
        0x4E => 0x85,
        0x5F => 0xA0,
        0x4C => 0x2028,
        0x50 => 0x2029,
        _ => return None,
    })
}

/// `charFromCodepoint`, then `String.fromCharCode` (which keeps the low 16 bits of each unit).
fn char_from_codepoint(c: i64, out: &mut U16s) {
    if c <= 0xFFFF {
        out.push(c as u16);
    } else {
        out.push((((c - 0x10000) >> 10) + 0xD800) as u16);
        out.push((((c - 0x10000) & 0x3FF) + 0xDC00) as u16);
    }
}

fn is_high(c: u16) -> bool {
    (0xD800..=0xDBFF).contains(&c)
}
fn is_low(c: u16) -> bool {
    (0xDC00..=0xDFFF).contains(&c)
}

/// `PATTERN_NON_PRINTABLE`, on UTF-16 units like the original's non-unicode regex.
fn has_non_printable(s: &[u16]) -> bool {
    s.iter().enumerate().any(|(i, &c)| {
        matches!(c, 0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F | 0x7F..=0x84 | 0x86..=0x9F | 0xFFFE | 0xFFFF)
            || (is_high(c) && !s.get(i + 1).is_some_and(|&n| is_low(n)))
            || (is_low(c) && (i == 0 || !is_high(s[i - 1])))
    })
}

/// `PATTERN_TAG_HANDLE`: `/^(?:!|!!|![a-z\-]+!)$/i`.
fn is_tag_handle(s: &[u16]) -> bool {
    let bang = u16::from(b'!');
    match s.len() {
        0 => false,
        1 => s[0] == bang,
        2 => s[0] == bang && s[1] == bang,
        n => {
            s[0] == bang
                && s[n - 1] == bang
                && s[1..n - 1]
                    .iter()
                    .all(|&c| c == u16::from(b'-') || (c < 128 && (c as u8).is_ascii_alphabetic()))
        }
    }
}

fn is_uri_char(c: u16) -> bool {
    c < 128 && {
        let b = c as u8;
        b.is_ascii_alphanumeric() || b"-#;/?:@&=+$,_.!~*'()[]".contains(&b)
    }
}

/// `PATTERN_TAG_URI`:
/// `/^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i`.
fn is_tag_uri(s: &[u16]) -> bool {
    let Some(&first) = s.first() else {
        return false;
    };
    if matches!(first, 0x2C | 0x5B | 0x5D | 0x7B | 0x7D) {
        return false;
    }
    let hex = |i: usize| s.get(i).is_some_and(|&h| from_hex_code(u32::from(h)) >= 0);
    let mut i = 1;
    while i < s.len() {
        if s[i] == u16::from(b'%') && hex(i + 1) && hex(i + 2) {
            i += 3;
        } else if is_uri_char(s[i]) {
            i += 1;
        } else {
            return false;
        }
    }
    true
}

/// `PATTERN_FLOW_INDICATORS` anywhere in the string.
fn has_flow_indicator(s: &[u16]) -> bool {
    s.iter()
        .any(|&c| matches!(c, 0x2C | 0x5B | 0x5D | 0x7B | 0x7D))
}

fn kind_name(kind: Option<Kind>) -> &'static str {
    match kind {
        Some(Kind::Scalar) => "scalar",
        Some(Kind::Sequence) => "sequence",
        Some(Kind::Mapping) => "mapping",
        None => "null",
    }
}

struct Mark<'a> {
    buffer: &'a [u16],
    position: usize,
    line: i64,
    column: i64,
}

fn is_snippet_break(c: u16) -> bool {
    matches!(c, 0x00 | 0x0D | 0x0A | 0x85 | 0x2028 | 0x2029)
}

impl Mark<'_> {
    /// `Mark.prototype.getSnippet(4, 75)`.
    fn snippet(&self) -> Option<String> {
        if self.buffer.is_empty() {
            return None;
        }
        let half = 75.0 / 2.0 - 1.0;
        let mut head = "";
        let mut start = self.position;
        while start > 0 && !is_snippet_break(self.buffer[start - 1]) {
            start -= 1;
            if (self.position - start) as f64 > half {
                head = " ... ";
                start += 5;
                break;
            }
        }
        let mut tail = "";
        let mut end = self.position;
        while end < self.buffer.len() && !is_snippet_break(self.buffer[end]) {
            end += 1;
            if (end - self.position) as f64 > half {
                tail = " ... ";
                end -= 5;
                break;
            }
        }
        let snippet = if start < end {
            lossy(&self.buffer[start..end])
        } else {
            String::new()
        };
        Some(format!(
            "    {head}{snippet}{tail}\n{}^",
            " ".repeat(4 + self.position - start + head.len())
        ))
    }

    fn describe(&self) -> String {
        let mut out = format!("at line {}, column {}", self.line + 1, self.column + 1);
        if let Some(s) = self.snippet() {
            out.push_str(":\n");
            out.push_str(&s);
        }
        out
    }
}

fn make_error(reason: &str, mark: Option<&Mark<'_>>) -> YamlException {
    YamlException {
        reason: reason.to_owned(),
        message: match mark {
            Some(m) => format!("{reason} {}", m.describe()),
            None => reason.to_owned(),
        },
    }
}

struct State {
    input: U16s,
    /// The input length before the `\0` terminator.
    length: usize,
    position: usize,
    line: i64,
    line_start: usize,
    line_indent: i64,
    documents: Vec<V>,
    version: bool,
    tag_map: HashMap<U16s, U16s>,
    anchor_map: HashMap<U16s, Anchor>,
    next_pending: usize,
    /// What each anchored collection being read holds so far (a merge of it copies that).
    partials: HashMap<usize, V>,
    /// A cyclic value went through a step the port only approximates (a key or a tag).
    approx: bool,
    /// The collections aliases named: the original shares each such object (and, through a
    /// merge, the collections it holds), which `safeDump` writes with `&ref_N` anchors.
    aliased: Vec<V>,
    tag: Option<U16s>,
    anchor: Option<U16s>,
    kind: Option<Kind>,
    result: V,
}

const MERGE_TAG: &str = "tag:yaml.org,2002:merge";

impl State {
    fn ch(&self, i: usize) -> u32 {
        self.input.get(i).map_or(NAN, |&c| u32::from(c))
    }

    fn cur(&self) -> u32 {
        self.ch(self.position)
    }

    fn error(&self, message: &str) -> LoadError {
        let mark = Mark {
            buffer: &self.input,
            position: self.position,
            line: self.line,
            column: self.position as i64 - self.line_start as i64,
        };
        LoadError::Yaml(make_error(message, Some(&mark)))
    }

    fn handle_yaml_directive(&mut self, args: &[U16s]) -> R<()> {
        if self.version {
            return Err(self.error("duplication of %YAML directive"));
        }
        if args.len() != 1 {
            return Err(self.error("YAML directive accepts exactly one argument"));
        }
        let arg = lossy(&args[0]);
        let digits = |x: &str| !x.is_empty() && x.bytes().all(|c| c.is_ascii_digit());
        let Some((major, _)) = arg.split_once('.').filter(|(a, b)| digits(a) && digits(b)) else {
            return Err(self.error("ill-formed argument of the YAML directive"));
        };
        if major.trim_start_matches('0') != "1" {
            return Err(self.error("unacceptable YAML version of the document"));
        }
        self.version = true;
        Ok(())
    }

    fn handle_tag_directive(&mut self, args: &[U16s]) -> R<()> {
        if args.len() != 2 {
            return Err(self.error("TAG directive accepts exactly two arguments"));
        }
        let (handle, prefix) = (&args[0], &args[1]);
        if !is_tag_handle(handle) {
            return Err(self.error("ill-formed tag handle (first argument) of the TAG directive"));
        }
        if self.tag_map.contains_key(handle) {
            return Err(self.error(&format!(
                "there is a previously declared suffix for \"{}\" tag handle",
                lossy(handle)
            )));
        }
        if !is_tag_uri(prefix) {
            return Err(self.error("ill-formed tag prefix (second argument) of the TAG directive"));
        }
        self.tag_map.insert(handle.clone(), prefix.clone());
        Ok(())
    }

    /// `state.result` as the string being built.
    fn result_str(&mut self) -> &mut U16s {
        if !matches!(self.result, V::Str(_)) {
            self.result = V::Str(Vec::new());
        }
        match &mut self.result {
            V::Str(s) => s,
            _ => unreachable!("just set"),
        }
    }

    fn capture_segment(&mut self, start: usize, end: usize, check_json: bool) -> R<()> {
        if start < end {
            let seg = self.input[start..end].to_vec();
            if check_json {
                if seg.iter().any(|&c| !(c == 0x09 || c >= 0x20)) {
                    return Err(self.error("expected valid JSON character"));
                }
            } else if has_non_printable(&seg) {
                return Err(self.error("the stream contains non-printable characters"));
            }
            self.result_str().extend(seg);
        }
        Ok(())
    }

    fn merge_mappings(
        &mut self,
        dest: &mut Obj,
        source: &V,
        overridable: &mut HashSet<U16s>,
    ) -> R<()> {
        let snapshot;
        let source = match source {
            V::Cycle(id, is_seq) => {
                snapshot = self.partial(*id, *is_seq);
                &snapshot
            }
            other => other,
        };
        if !source.is_object() {
            return Err(
                self.error("cannot merge mappings; the provided source object is unacceptable")
            );
        }
        for (key, value) in source.own_entries() {
            if !dest.has(&key) {
                dest.set(key.clone(), value);
                // `overridableKeys.__proto__ = true` only touches the prototype.
                if key != u16s("__proto__") {
                    overridable.insert(key);
                }
            }
        }
        Ok(())
    }

    fn store_mapping_pair(
        &mut self,
        result: Option<Obj>,
        overridable: &mut HashSet<U16s>,
        key_tag: Option<&U16s>,
        key_node: V,
        value_node: V,
        start: Option<(i64, usize)>,
    ) -> R<Obj> {
        let key_node = match self.fill(&key_node) {
            V::Arr(mut items) => {
                for item in &mut items {
                    if matches!(item, V::Arr(_)) {
                        return Err(self.error("nested arrays are not supported inside keys"));
                    }
                    if matches!(item, V::Obj(_)) {
                        *item = V::Str(u16s("[object Object]"));
                    }
                }
                V::Arr(items)
            }
            V::Obj(_) => V::Str(u16s("[object Object]")),
            other => other,
        };
        if contains_cycle(&key_node) {
            self.approx = true;
        }
        let key = js_string(&key_node);
        let mut result = result.unwrap_or_default();

        if key_tag.is_some_and(|t| *t == u16s(MERGE_TAG)) {
            if let V::Arr(items) = &value_node {
                for item in items {
                    self.merge_mappings(&mut result, item, overridable)?;
                }
            } else {
                self.merge_mappings(&mut result, &value_node, overridable)?;
            }
        } else {
            if !overridable.contains(&key) && result.has(&key) {
                if let Some((line, pos)) = start {
                    // `startLine || state.line`, `startPos || state.position`.
                    if line != 0 {
                        self.line = line;
                    }
                    if pos != 0 {
                        self.position = pos;
                    }
                }
                return Err(self.error("duplicated mapping key"));
            }
            result.set(key.clone(), value_node);
            overridable.remove(&key);
        }
        Ok(result)
    }

    fn read_line_break(&mut self) -> R<()> {
        let ch = self.cur();
        if ch == 0x0A {
            self.position += 1;
        } else if ch == 0x0D {
            self.position += 1;
            if self.cur() == 0x0A {
                self.position += 1;
            }
        } else {
            return Err(self.error("a line break is expected"));
        }
        self.line += 1;
        self.line_start = self.position;
        Ok(())
    }

    /// `skipSeparationSpace`. Its indent check only warns, and nothing listens.
    fn skip_separation_space(&mut self, allow_comments: bool) -> R<i64> {
        let mut line_breaks = 0;
        let mut ch = self.cur();
        while ch != 0 {
            while is_white_space(ch) {
                self.position += 1;
                ch = self.cur();
            }
            if allow_comments && ch == 0x23 {
                loop {
                    self.position += 1;
                    ch = self.cur();
                    if ch == 0x0A || ch == 0x0D || ch == 0 {
                        break;
                    }
                }
            }
            if is_eol(ch) {
                self.read_line_break()?;
                ch = self.cur();
                line_breaks += 1;
                self.line_indent = 0;
                while ch == 0x20 {
                    self.line_indent += 1;
                    self.position += 1;
                    ch = self.cur();
                }
            } else {
                break;
            }
        }
        Ok(line_breaks)
    }

    fn test_document_separator(&self) -> bool {
        let p = self.position;
        let ch = self.ch(p);
        if (ch == 0x2D || ch == 0x2E) && ch == self.ch(p + 1) && ch == self.ch(p + 2) {
            let next = self.ch(p + 3);
            return next == 0 || is_ws_or_eol(next);
        }
        false
    }

    fn write_folded_lines(&mut self, count: i64) {
        if count == 1 {
            self.result_str().push(0x20);
        } else if count > 1 {
            self.push_newlines(count - 1);
        }
    }

    fn push_newlines(&mut self, count: i64) {
        let s = self.result_str();
        for _ in 0..count.max(0) {
            s.push(0x0A);
        }
    }

    fn register_pending(&mut self, is_seq: bool) -> Option<usize> {
        let anchor = self.anchor.clone()?;
        let id = self.next_pending;
        self.next_pending += 1;
        self.set_anchor(anchor, Anchor::Pending(id, is_seq));
        Some(id)
    }

    /// The collection registered as `id` is done: anchors still naming it now hold `value`
    /// (in the original they share the object, which is complete from here on).
    fn finish_pending(&mut self, id: Option<usize>, value: &V) {
        let Some(id) = id else { return };
        for slot in self.anchor_map.values_mut() {
            if matches!(slot, Anchor::Pending(p, _) if *p == id) {
                *slot = Anchor::Ready(value.clone());
            }
        }
    }

    /// `state.anchorMap[name] = value`: `__proto__` only touches the prototype.
    fn set_anchor(&mut self, name: U16s, value: Anchor) {
        if name != u16s("__proto__") {
            self.anchor_map.insert(name, value);
        }
    }

    /// What a cycle marker stands for right now: the collection's content so far.
    fn partial(&self, id: usize, is_seq: bool) -> V {
        self.partials.get(&id).cloned().unwrap_or(if is_seq {
            V::Arr(Vec::new())
        } else {
            V::Obj(Obj::default())
        })
    }

    /// `v` with a cycle marker at the top or among its direct children replaced by the
    /// collection's content so far, for the steps that look one level in (key strings, tag
    /// resolution).
    fn fill(&self, v: &V) -> V {
        let one = |x: &V| match x {
            V::Cycle(id, is_seq) => self.partial(*id, *is_seq),
            other => other.clone(),
        };
        match one(v) {
            V::Arr(items) => V::Arr(items.iter().map(one).collect()),
            V::Obj(o) => V::Obj(Obj {
                entries: o.entries.iter().map(|(k, x)| (k.clone(), one(x))).collect(),
            }),
            other => other,
        }
    }

    /// The current result is, or directly holds, a cycle marker (what [`State::fill`] replaces).
    fn has_direct_cycle(&self) -> bool {
        match &self.result {
            V::Cycle(..) => true,
            V::Arr(items) => items.iter().any(|x| matches!(x, V::Cycle(..))),
            V::Obj(o) => o.entries.iter().any(|(_, x)| matches!(x, V::Cycle(..))),
            _ => false,
        }
    }

    fn snapshot(&mut self, pending: Option<usize>, value: impl FnOnce() -> V) {
        if let Some(id) = pending {
            self.partials.insert(id, value());
        }
    }

    fn store_result_anchor(&mut self) {
        if let Some(anchor) = self.anchor.clone() {
            let value = self.result.clone();
            self.set_anchor(anchor, Anchor::Ready(value));
        }
    }

    fn read_plain_scalar(&mut self, node_indent: i64, within_flow: bool) -> R<bool> {
        let saved_kind = self.kind;
        let saved_result = self.result.clone();
        let mut ch = self.cur();
        if is_ws_or_eol(ch)
            || is_flow_indicator(ch)
            || matches!(
                ch,
                0x23 | 0x26 | 0x2A | 0x21 | 0x7C | 0x3E | 0x27 | 0x22 | 0x25 | 0x40 | 0x60
            )
        {
            return Ok(false);
        }
        if ch == 0x3F || ch == 0x2D {
            let following = self.ch(self.position + 1);
            if is_ws_or_eol(following) || (within_flow && is_flow_indicator(following)) {
                return Ok(false);
            }
        }
        self.kind = Some(Kind::Scalar);
        self.result = V::Str(Vec::new());
        let mut capture_start = self.position;
        let mut capture_end = self.position;
        let mut has_pending = false;
        let mut saved_line = self.line;
        while ch != 0 {
            if ch == 0x3A {
                let following = self.ch(self.position + 1);
                if is_ws_or_eol(following) || (within_flow && is_flow_indicator(following)) {
                    break;
                }
            } else if ch == 0x23 {
                let preceding = if self.position == 0 {
                    NAN
                } else {
                    self.ch(self.position - 1)
                };
                if is_ws_or_eol(preceding) {
                    break;
                }
            } else if (self.position == self.line_start && self.test_document_separator())
                || (within_flow && is_flow_indicator(ch))
            {
                break;
            } else if is_eol(ch) {
                saved_line = self.line;
                let saved_line_start = self.line_start;
                let saved_indent = self.line_indent;
                self.skip_separation_space(false)?;
                if self.line_indent >= node_indent {
                    has_pending = true;
                    ch = self.cur();
                    continue;
                }
                self.position = capture_end;
                self.line = saved_line;
                self.line_start = saved_line_start;
                self.line_indent = saved_indent;
                break;
            }
            if has_pending {
                self.capture_segment(capture_start, capture_end, false)?;
                self.write_folded_lines(self.line - saved_line);
                capture_start = self.position;
                capture_end = self.position;
                has_pending = false;
            }
            if !is_white_space(ch) {
                capture_end = self.position + 1;
            }
            self.position += 1;
            ch = self.cur();
        }
        self.capture_segment(capture_start, capture_end, false)?;
        if matches!(&self.result, V::Str(s) if !s.is_empty()) {
            return Ok(true);
        }
        self.kind = saved_kind;
        self.result = saved_result;
        Ok(false)
    }

    fn read_single_quoted_scalar(&mut self, node_indent: i64) -> R<bool> {
        if self.cur() != 0x27 {
            return Ok(false);
        }
        let _ = node_indent;
        self.kind = Some(Kind::Scalar);
        self.result = V::Str(Vec::new());
        self.position += 1;
        let mut capture_start = self.position;
        let mut capture_end = self.position;
        loop {
            let ch = self.cur();
            if ch == 0 {
                break;
            }
            if ch == 0x27 {
                self.capture_segment(capture_start, self.position, true)?;
                self.position += 1;
                if self.cur() == 0x27 {
                    capture_start = self.position;
                    self.position += 1;
                    capture_end = self.position;
                } else {
                    return Ok(true);
                }
            } else if is_eol(ch) {
                self.capture_segment(capture_start, capture_end, true)?;
                let n = self.skip_separation_space(false)?;
                self.write_folded_lines(n);
                capture_start = self.position;
                capture_end = self.position;
            } else if self.position == self.line_start && self.test_document_separator() {
                return Err(
                    self.error("unexpected end of the document within a single quoted scalar")
                );
            } else {
                self.position += 1;
                capture_end = self.position;
            }
        }
        Err(self.error("unexpected end of the stream within a single quoted scalar"))
    }

    fn read_double_quoted_scalar(&mut self) -> R<bool> {
        if self.cur() != 0x22 {
            return Ok(false);
        }
        self.kind = Some(Kind::Scalar);
        self.result = V::Str(Vec::new());
        self.position += 1;
        let mut capture_start = self.position;
        let mut capture_end = self.position;
        loop {
            let mut ch = self.cur();
            if ch == 0 {
                break;
            }
            if ch == 0x22 {
                self.capture_segment(capture_start, self.position, true)?;
                self.position += 1;
                return Ok(true);
            } else if ch == 0x5C {
                self.capture_segment(capture_start, self.position, true)?;
                self.position += 1;
                ch = self.cur();
                if is_eol(ch) {
                    self.skip_separation_space(false)?;
                } else if let Some(c) = (ch < 256).then(|| simple_escape(ch)).flatten() {
                    self.result_str().push(c);
                    self.position += 1;
                } else if escaped_hex_len(ch) > 0 {
                    let mut hex_result: i32 = 0;
                    for _ in 0..escaped_hex_len(ch) {
                        self.position += 1;
                        let digit = from_hex_code(self.cur());
                        if digit < 0 {
                            return Err(self.error("expected hexadecimal character"));
                        }
                        // `(hexResult << 4) + tmp` on int32.
                        hex_result = hex_result.wrapping_shl(4).wrapping_add(digit as i32);
                    }
                    char_from_codepoint(i64::from(hex_result), self.result_str());
                    self.position += 1;
                } else {
                    return Err(self.error("unknown escape sequence"));
                }
                capture_start = self.position;
                capture_end = self.position;
            } else if is_eol(ch) {
                self.capture_segment(capture_start, capture_end, true)?;
                let n = self.skip_separation_space(false)?;
                self.write_folded_lines(n);
                capture_start = self.position;
                capture_end = self.position;
            } else if self.position == self.line_start && self.test_document_separator() {
                return Err(
                    self.error("unexpected end of the document within a double quoted scalar")
                );
            } else {
                self.position += 1;
                capture_end = self.position;
            }
        }
        Err(self.error("unexpected end of the stream within a double quoted scalar"))
    }

    fn read_flow_collection(&mut self, node_indent: i64) -> R<bool> {
        let saved_tag = self.tag.clone();
        let saved_anchor = self.anchor.clone();
        let (terminator, is_mapping) = match self.cur() {
            0x5B => (0x5D, false),
            0x7B => (0x7D, true),
            _ => return Ok(false),
        };
        let pending = self.register_pending(!is_mapping);
        let mut seq: Vec<V> = Vec::new();
        let mut map: Option<Obj> = Some(Obj::default());
        let mut overridable = HashSet::new();
        let mut read_next = true;
        self.position += 1;
        let mut ch = self.cur();
        while ch != 0 {
            self.skip_separation_space(true)?;
            ch = self.cur();
            if ch == terminator {
                self.position += 1;
                self.tag = saved_tag;
                self.anchor = saved_anchor;
                self.kind = Some(if is_mapping {
                    Kind::Mapping
                } else {
                    Kind::Sequence
                });
                self.result = if is_mapping {
                    V::Obj(map.unwrap_or_default())
                } else {
                    V::Arr(seq)
                };
                let result = self.result.clone();
                self.finish_pending(pending, &result);
                return Ok(true);
            } else if !read_next {
                return Err(self.error("missed comma between flow collection entries"));
            }
            let mut is_pair = false;
            let mut is_explicit_pair = false;
            let mut value_node = V::Null;
            if ch == 0x3F && is_ws_or_eol(self.ch(self.position + 1)) {
                is_pair = true;
                is_explicit_pair = true;
                self.position += 1;
                self.skip_separation_space(true)?;
            }
            let line = self.line;
            self.compose_node(node_indent, Ctx::FlowIn, false, true)?;
            let key_tag = self.tag.clone();
            let key_node = std::mem::replace(&mut self.result, V::Null);
            self.skip_separation_space(true)?;
            ch = self.cur();
            if (is_explicit_pair || self.line == line) && ch == 0x3A {
                is_pair = true;
                self.position += 1;
                self.skip_separation_space(true)?;
                self.compose_node(node_indent, Ctx::FlowIn, false, true)?;
                value_node = std::mem::replace(&mut self.result, V::Null);
            }
            if is_mapping {
                let current = map.take();
                map = Some(self.store_mapping_pair(
                    current,
                    &mut overridable,
                    key_tag.as_ref(),
                    key_node,
                    value_node,
                    None,
                )?);
            } else if is_pair {
                let pair = self.store_mapping_pair(
                    None,
                    &mut overridable,
                    key_tag.as_ref(),
                    key_node,
                    value_node,
                    None,
                )?;
                seq.push(V::Obj(pair));
            } else {
                seq.push(key_node);
            }
            if is_mapping {
                let current = map.clone().unwrap_or_default();
                self.snapshot(pending, || V::Obj(current));
            } else {
                self.snapshot(pending, || V::Arr(seq.clone()));
            }
            self.skip_separation_space(true)?;
            ch = self.cur();
            if ch == 0x2C {
                read_next = true;
                self.position += 1;
                ch = self.cur();
            } else {
                read_next = false;
            }
        }
        Err(self.error("unexpected end of the stream within a flow collection"))
    }

    fn read_block_scalar(&mut self, node_indent: i64) -> R<bool> {
        let mut ch = self.cur();
        let folding = match ch {
            0x7C => false,
            0x3E => true,
            _ => return Ok(false),
        };
        // 0 clip, 1 keep, -1 strip.
        let mut chomping = 0;
        let mut did_read_content = false;
        let mut detected_indent = false;
        let mut text_indent = node_indent;
        let mut empty_lines: i64 = 0;
        let mut at_more_indented = false;
        self.kind = Some(Kind::Scalar);
        self.result = V::Str(Vec::new());
        while ch != 0 {
            self.position += 1;
            ch = self.cur();
            if ch == 0x2B || ch == 0x2D {
                if chomping == 0 {
                    chomping = if ch == 0x2B { 1 } else { -1 };
                } else {
                    return Err(self.error("repeat of a chomping mode identifier"));
                }
            } else {
                let tmp = from_decimal_code(ch);
                if tmp < 0 {
                    break;
                }
                if tmp == 0 {
                    return Err(self.error(
                        "bad explicit indentation width of a block scalar; it cannot be less than one",
                    ));
                } else if !detected_indent {
                    text_indent = node_indent + tmp - 1;
                    detected_indent = true;
                } else {
                    return Err(self.error("repeat of an indentation width identifier"));
                }
            }
        }
        if is_white_space(ch) {
            loop {
                self.position += 1;
                ch = self.cur();
                if !is_white_space(ch) {
                    break;
                }
            }
            if ch == 0x23 {
                loop {
                    self.position += 1;
                    ch = self.cur();
                    if is_eol(ch) || ch == 0 {
                        break;
                    }
                }
            }
        }
        while ch != 0 {
            self.read_line_break()?;
            self.line_indent = 0;
            ch = self.cur();
            while (!detected_indent || self.line_indent < text_indent) && ch == 0x20 {
                self.line_indent += 1;
                self.position += 1;
                ch = self.cur();
            }
            if !detected_indent && self.line_indent > text_indent {
                text_indent = self.line_indent;
            }
            if is_eol(ch) {
                empty_lines += 1;
                continue;
            }
            if self.line_indent < text_indent {
                if chomping == 1 {
                    self.push_newlines(if did_read_content {
                        1 + empty_lines
                    } else {
                        empty_lines
                    });
                } else if chomping == 0 && did_read_content {
                    self.push_newlines(1);
                }
                break;
            }
            if folding {
                if is_white_space(ch) {
                    at_more_indented = true;
                    self.push_newlines(if did_read_content {
                        1 + empty_lines
                    } else {
                        empty_lines
                    });
                } else if at_more_indented {
                    at_more_indented = false;
                    self.push_newlines(empty_lines + 1);
                } else if empty_lines == 0 {
                    if did_read_content {
                        self.result_str().push(0x20);
                    }
                } else {
                    self.push_newlines(empty_lines);
                }
            } else {
                self.push_newlines(if did_read_content {
                    1 + empty_lines
                } else {
                    empty_lines
                });
            }
            did_read_content = true;
            detected_indent = true;
            empty_lines = 0;
            let capture_start = self.position;
            while !is_eol(ch) && ch != 0 {
                self.position += 1;
                ch = self.cur();
            }
            self.capture_segment(capture_start, self.position, false)?;
        }
        Ok(true)
    }

    fn read_block_sequence(&mut self, node_indent: i64) -> R<bool> {
        let saved_tag = self.tag.clone();
        let saved_anchor = self.anchor.clone();
        let pending = self.register_pending(true);
        let mut result: Vec<V> = Vec::new();
        let mut detected = false;
        let mut ch = self.cur();
        while ch != 0 {
            if ch != 0x2D || !is_ws_or_eol(self.ch(self.position + 1)) {
                break;
            }
            detected = true;
            self.position += 1;
            if self.skip_separation_space(true)? != 0 && self.line_indent <= node_indent {
                result.push(V::Null);
                self.snapshot(pending, || V::Arr(result.clone()));
                ch = self.cur();
                continue;
            }
            let line = self.line;
            self.compose_node(node_indent, Ctx::BlockIn, false, true)?;
            result.push(std::mem::replace(&mut self.result, V::Null));
            self.snapshot(pending, || V::Arr(result.clone()));
            self.skip_separation_space(true)?;
            ch = self.cur();
            if (self.line == line || self.line_indent > node_indent) && ch != 0 {
                return Err(self.error("bad indentation of a sequence entry"));
            } else if self.line_indent < node_indent {
                break;
            }
        }
        let value = V::Arr(result);
        self.finish_pending(pending, &value);
        if detected {
            self.tag = saved_tag;
            self.anchor = saved_anchor;
            self.kind = Some(Kind::Sequence);
            self.result = value;
            return Ok(true);
        }
        Ok(false)
    }

    fn read_block_mapping(&mut self, node_indent: i64, flow_indent: i64) -> R<bool> {
        let saved_tag = self.tag.clone();
        let saved_anchor = self.anchor.clone();
        let pending = self.register_pending(false);
        let mut result: Option<Obj> = Some(Obj::default());
        let mut overridable = HashSet::new();
        let mut key_tag: Option<U16s> = None;
        let mut key_node = V::Null;
        let mut value_node = V::Null;
        let mut at_explicit_key = false;
        let mut detected = false;
        let mut allow_compact: bool;
        let mut ch = self.cur();
        while ch != 0 {
            let following = self.ch(self.position + 1);
            let line = self.line;
            let pos = self.position;
            if (ch == 0x3F || ch == 0x3A) && is_ws_or_eol(following) {
                if ch == 0x3F {
                    if at_explicit_key {
                        let current = result.take();
                        result = Some(self.store_mapping_pair(
                            current,
                            &mut overridable,
                            key_tag.as_ref(),
                            std::mem::replace(&mut key_node, V::Null),
                            V::Null,
                            None,
                        )?);
                        let current = result.clone().unwrap_or_default();
                        self.snapshot(pending, || V::Obj(current));
                        key_tag = None;
                        value_node = V::Null;
                    }
                    detected = true;
                    at_explicit_key = true;
                    allow_compact = true;
                } else if at_explicit_key {
                    at_explicit_key = false;
                    allow_compact = true;
                } else {
                    return Err(self.error(
                        "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line",
                    ));
                }
                self.position += 1;
                ch = following;
            } else if self.compose_node(flow_indent, Ctx::FlowOut, false, true)? {
                if self.line == line {
                    ch = self.cur();
                    while is_white_space(ch) {
                        self.position += 1;
                        ch = self.cur();
                    }
                    if ch == 0x3A {
                        self.position += 1;
                        ch = self.cur();
                        if !is_ws_or_eol(ch) {
                            return Err(self.error(
                                "a whitespace character is expected after the key-value separator within a block mapping",
                            ));
                        }
                        if at_explicit_key {
                            let current = result.take();
                            result = Some(self.store_mapping_pair(
                                current,
                                &mut overridable,
                                key_tag.as_ref(),
                                std::mem::replace(&mut key_node, V::Null),
                                V::Null,
                                None,
                            )?);
                            let current = result.clone().unwrap_or_default();
                            self.snapshot(pending, || V::Obj(current));
                            value_node = V::Null;
                        }
                        detected = true;
                        at_explicit_key = false;
                        allow_compact = false;
                        key_tag = self.tag.clone();
                        key_node = self.result.clone();
                    } else if detected {
                        return Err(
                            self.error("can not read an implicit mapping pair; a colon is missed")
                        );
                    } else {
                        self.tag = saved_tag;
                        self.anchor = saved_anchor;
                        self.finish_pending(pending, &V::Obj(Obj::default()));
                        return Ok(true);
                    }
                } else if detected {
                    return Err(self.error(
                        "can not read a block mapping entry; a multiline key may not be an implicit key",
                    ));
                } else {
                    self.tag = saved_tag;
                    self.anchor = saved_anchor;
                    self.finish_pending(pending, &V::Obj(Obj::default()));
                    return Ok(true);
                }
            } else {
                break;
            }

            if self.line == line || self.line_indent > node_indent {
                if self.compose_node(node_indent, Ctx::BlockOut, true, allow_compact)? {
                    if at_explicit_key {
                        key_node = self.result.clone();
                    } else {
                        value_node = self.result.clone();
                    }
                }
                if !at_explicit_key {
                    let current = result.take();
                    result = Some(self.store_mapping_pair(
                        current,
                        &mut overridable,
                        key_tag.as_ref(),
                        std::mem::replace(&mut key_node, V::Null),
                        std::mem::replace(&mut value_node, V::Null),
                        Some((line, pos)),
                    )?);
                    let current = result.clone().unwrap_or_default();
                    self.snapshot(pending, || V::Obj(current));
                    key_tag = None;
                }
                self.skip_separation_space(true)?;
                ch = self.cur();
            }
            if self.line_indent > node_indent && ch != 0 {
                return Err(self.error("bad indentation of a mapping entry"));
            } else if self.line_indent < node_indent {
                break;
            }
        }
        if at_explicit_key {
            let current = result.take();
            result = Some(self.store_mapping_pair(
                current,
                &mut overridable,
                key_tag.as_ref(),
                key_node,
                V::Null,
                None,
            )?);
            let current = result.clone().unwrap_or_default();
            self.snapshot(pending, || V::Obj(current));
        }
        let value = V::Obj(result.unwrap_or_default());
        self.finish_pending(pending, &value);
        if detected {
            self.tag = saved_tag;
            self.anchor = saved_anchor;
            self.kind = Some(Kind::Mapping);
            self.result = value;
        }
        Ok(detected)
    }

    fn read_tag_property(&mut self) -> R<bool> {
        if self.cur() != 0x21 {
            return Ok(false);
        }
        if self.tag.is_some() {
            return Err(self.error("duplication of a tag property"));
        }
        self.position += 1;
        let mut ch = self.cur();
        let mut is_verbatim = false;
        let mut is_named = false;
        let mut tag_handle = u16s("!");
        if ch == 0x3C {
            is_verbatim = true;
            self.position += 1;
            ch = self.cur();
        } else if ch == 0x21 {
            is_named = true;
            tag_handle = u16s("!!");
            self.position += 1;
            ch = self.cur();
        }
        let mut start = self.position;
        let tag_name: U16s;
        if is_verbatim {
            loop {
                self.position += 1;
                ch = self.cur();
                if ch == 0 || ch == 0x3E {
                    break;
                }
            }
            if self.position < self.length {
                tag_name = self.input[start..self.position].to_vec();
                self.position += 1;
            } else {
                return Err(self.error("unexpected end of the stream within a verbatim tag"));
            }
        } else {
            while ch != 0 && !is_ws_or_eol(ch) {
                if ch == 0x21 {
                    if is_named {
                        return Err(self.error("tag suffix cannot contain exclamation marks"));
                    }
                    tag_handle = self.input[start - 1..self.position + 1].to_vec();
                    if !is_tag_handle(&tag_handle) {
                        return Err(self.error("named tag handle cannot contain such characters"));
                    }
                    is_named = true;
                    start = self.position + 1;
                }
                self.position += 1;
                ch = self.cur();
            }
            tag_name = self.input[start..self.position].to_vec();
            if has_flow_indicator(&tag_name) {
                return Err(self.error("tag suffix cannot contain flow indicator characters"));
            }
        }
        if !tag_name.is_empty() && !is_tag_uri(&tag_name) {
            return Err(self.error(&format!(
                "tag name cannot contain such characters: {}",
                lossy(&tag_name)
            )));
        }
        self.tag = Some(if is_verbatim {
            tag_name
        } else if let Some(prefix) = self.tag_map.get(&tag_handle) {
            [prefix.clone(), tag_name].concat()
        } else if tag_handle == u16s("!") {
            [u16s("!"), tag_name].concat()
        } else if tag_handle == u16s("!!") {
            [u16s("tag:yaml.org,2002:"), tag_name].concat()
        } else {
            return Err(self.error(&format!("undeclared tag handle \"{}\"", lossy(&tag_handle))));
        });
        Ok(true)
    }

    fn read_anchor_property(&mut self) -> R<bool> {
        if self.cur() != 0x26 {
            return Ok(false);
        }
        if self.anchor.is_some() {
            return Err(self.error("duplication of an anchor property"));
        }
        self.position += 1;
        let start = self.position;
        let mut ch = self.cur();
        while ch != 0 && !is_ws_or_eol(ch) && !is_flow_indicator(ch) {
            self.position += 1;
            ch = self.cur();
        }
        if self.position == start {
            return Err(self.error("name of an anchor node must contain at least one character"));
        }
        self.anchor = Some(self.input[start..self.position].to_vec());
        Ok(true)
    }

    fn read_alias(&mut self) -> R<bool> {
        if self.cur() != 0x2A {
            return Ok(false);
        }
        self.position += 1;
        let start = self.position;
        let mut ch = self.cur();
        while ch != 0 && !is_ws_or_eol(ch) && !is_flow_indicator(ch) {
            self.position += 1;
            ch = self.cur();
        }
        if self.position == start {
            return Err(self.error("name of an alias node must contain at least one character"));
        }
        let alias = self.input[start..self.position].to_vec();
        match self.anchor_map.get(&alias) {
            None => {
                return Err(self.error(&format!("unidentified alias \"{}\"", lossy(&alias))));
            }
            // The value would be cyclic, which the port does not build. Reading goes on with a
            // marker, so a later error, or a merge of what the collection holds so far, still
            // comes out as in the original; a marker left in the result is unsupported.
            Some(Anchor::Pending(id, is_seq)) => self.result = V::Cycle(*id, *is_seq),
            Some(Anchor::Ready(v)) => {
                if matches!(v, V::Arr(_) | V::Obj(_)) {
                    self.aliased.push(v.clone());
                }
                self.result = v.clone();
            }
        }
        self.skip_separation_space(true)?;
        Ok(true)
    }

    fn indent_status(&self, parent_indent: i64) -> i32 {
        match self.line_indent.cmp(&parent_indent) {
            std::cmp::Ordering::Greater => 1,
            std::cmp::Ordering::Equal => 0,
            std::cmp::Ordering::Less => -1,
        }
    }

    fn compose_node(
        &mut self,
        parent_indent: i64,
        ctx: Ctx,
        allow_to_seek: bool,
        allow_compact: bool,
    ) -> R<bool> {
        self.tag = None;
        self.anchor = None;
        self.kind = None;
        self.result = V::Null;
        let block = ctx == Ctx::BlockOut || ctx == Ctx::BlockIn;
        let allow_block_styles = block;
        let allow_block_scalars = block;
        let mut allow_block_collections = block;
        let mut indent_status = 1;
        let mut at_new_line = false;
        let mut has_content = false;

        if allow_to_seek && self.skip_separation_space(true)? != 0 {
            at_new_line = true;
            indent_status = self.indent_status(parent_indent);
        }
        if indent_status == 1 {
            while self.read_tag_property()? || self.read_anchor_property()? {
                if self.skip_separation_space(true)? != 0 {
                    at_new_line = true;
                    allow_block_collections = allow_block_styles;
                    indent_status = self.indent_status(parent_indent);
                } else {
                    allow_block_collections = false;
                }
            }
        }
        if allow_block_collections {
            allow_block_collections = at_new_line || allow_compact;
        }
        if indent_status == 1 || ctx == Ctx::BlockOut {
            let flow_indent = if ctx == Ctx::FlowIn || ctx == Ctx::FlowOut {
                parent_indent
            } else {
                parent_indent + 1
            };
            let block_indent = self.position as i64 - self.line_start as i64;
            if indent_status == 1 {
                if (allow_block_collections
                    && (self.read_block_sequence(block_indent)?
                        || self.read_block_mapping(block_indent, flow_indent)?))
                    || self.read_flow_collection(flow_indent)?
                {
                    has_content = true;
                } else {
                    if (allow_block_scalars && self.read_block_scalar(flow_indent)?)
                        || self.read_single_quoted_scalar(flow_indent)?
                        || self.read_double_quoted_scalar()?
                    {
                        has_content = true;
                    } else if self.read_alias()? {
                        has_content = true;
                        if self.tag.is_some() || self.anchor.is_some() {
                            return Err(self.error("alias node should not have any properties"));
                        }
                    } else if self.read_plain_scalar(flow_indent, ctx == Ctx::FlowIn)? {
                        has_content = true;
                        if self.tag.is_none() {
                            self.tag = Some(u16s("?"));
                        }
                    }
                    self.store_result_anchor();
                }
            } else if indent_status == 0 {
                has_content = allow_block_collections && self.read_block_sequence(block_indent)?;
            }
        }

        if let Some(tag) = self.tag.clone().filter(|t| *t != u16s("!")) {
            if tag == u16s("?") {
                if self.result != V::Null && self.kind != Some(Kind::Scalar) {
                    return Err(self.error(&format!(
                        "unacceptable node kind for !<?> tag; it should be \"scalar\", not \"{}\"",
                        kind_name(self.kind)
                    )));
                }
                if let Some((value, type_tag)) = schema::resolve_implicit(&self.result) {
                    self.result = value;
                    self.tag = Some(u16s(type_tag));
                    self.store_result_anchor();
                }
            } else if let Some(type_kind) = schema::explicit_kind(self.kind, &lossy(&tag)) {
                if self.result != V::Null && Some(type_kind) != self.kind {
                    return Err(self.error(&format!(
                        "unacceptable node kind for !<{}> tag; it should be \"{}\", not \"{}\"",
                        lossy(&tag),
                        kind_name(Some(type_kind)),
                        kind_name(self.kind)
                    )));
                }
                let probe = self.fill(&self.result);
                match schema::construct_explicit(&lossy(&tag), &probe) {
                    Some(value) => {
                        if self.has_direct_cycle() {
                            self.approx = true;
                        }
                        self.result = value;
                        self.store_result_anchor();
                    }
                    None => {
                        return Err(self.error(&format!(
                            "cannot resolve a node with !<{}> explicit tag",
                            lossy(&tag)
                        )));
                    }
                }
            } else {
                return Err(self.error(&format!("unknown tag !<{}>", lossy(&tag))));
            }
        }
        Ok(self.tag.is_some() || self.anchor.is_some() || has_content)
    }

    fn read_document(&mut self) -> R<()> {
        let mut has_directives = false;
        self.version = false;
        self.tag_map.clear();
        self.anchor_map.clear();
        while self.cur() != 0 {
            self.skip_separation_space(true)?;
            let mut ch = self.cur();
            if self.line_indent > 0 || ch != 0x25 {
                break;
            }
            has_directives = true;
            self.position += 1;
            ch = self.cur();
            let start = self.position;
            while ch != 0 && !is_ws_or_eol(ch) {
                self.position += 1;
                ch = self.cur();
            }
            let name = self.input[start..self.position].to_vec();
            let mut args: Vec<U16s> = Vec::new();
            if name.is_empty() {
                return Err(
                    self.error("directive name must not be less than one character in length")
                );
            }
            while ch != 0 {
                while is_white_space(ch) {
                    self.position += 1;
                    ch = self.cur();
                }
                if ch == 0x23 {
                    loop {
                        self.position += 1;
                        ch = self.cur();
                        if ch == 0 || is_eol(ch) {
                            break;
                        }
                    }
                    break;
                }
                if is_eol(ch) {
                    break;
                }
                let arg_start = self.position;
                while ch != 0 && !is_ws_or_eol(ch) {
                    self.position += 1;
                    ch = self.cur();
                }
                args.push(self.input[arg_start..self.position].to_vec());
            }
            if ch != 0 {
                self.read_line_break()?;
            }
            if name == u16s("YAML") {
                self.handle_yaml_directive(&args)?;
            } else if name == u16s("TAG") {
                self.handle_tag_directive(&args)?;
            }
        }
        self.skip_separation_space(true)?;
        if self.line_indent == 0
            && self.cur() == 0x2D
            && self.ch(self.position + 1) == 0x2D
            && self.ch(self.position + 2) == 0x2D
        {
            self.position += 3;
            self.skip_separation_space(true)?;
        } else if has_directives {
            return Err(self.error("directives end mark is expected"));
        }
        self.compose_node(self.line_indent - 1, Ctx::BlockOut, false, true)?;
        self.skip_separation_space(true)?;
        let result = std::mem::replace(&mut self.result, V::Null);
        self.documents.push(result);
        if self.position == self.line_start && self.test_document_separator() {
            if self.cur() == 0x2E {
                self.position += 3;
                self.skip_separation_space(true)?;
            }
            return Ok(());
        }
        if (self.position as i64) < self.length as i64 - 1 {
            return Err(self.error("end of the stream or a document separator is expected"));
        }
        Ok(())
    }
}

/// `jsyaml.safeLoad(input)`: `None` stands for `undefined` (an empty stream).
pub(crate) fn safe_load(input: &str) -> Result<Option<V>, LoadError> {
    safe_load_utf16(u16s(input))
}

pub(crate) fn safe_load_utf16(input: U16s) -> Result<Option<V>, LoadError> {
    Ok(safe_load_shared(input)?.0)
}

/// [`safe_load_utf16`], and the collections aliases named (see `State::aliased`).
pub(crate) fn safe_load_shared(mut input: U16s) -> Result<(Option<V>, Vec<V>), LoadError> {
    if let Some(&last) = input.last() {
        if last != 0x0A && last != 0x0D {
            input.push(0x0A);
        }
        if input[0] == 0xFEFF {
            input.remove(0);
        }
    }
    let length = input.len();
    let mut state = State {
        input,
        length,
        position: 0,
        line: 0,
        line_start: 0,
        line_indent: 0,
        documents: Vec::new(),
        version: false,
        tag_map: HashMap::new(),
        anchor_map: HashMap::new(),
        next_pending: 0,
        partials: HashMap::new(),
        approx: false,
        aliased: Vec::new(),
        tag: None,
        anchor: None,
        kind: None,
        result: V::Null,
    };
    if let Some(nullpos) = state.input.iter().position(|&c| c == 0) {
        state.position = nullpos;
        return Err(state.error("null byte is not allowed in input"));
    }
    state.input.push(0);
    while state.cur() == 0x20 {
        state.line_indent += 1;
        state.position += 1;
    }
    let read = (|| {
        while (state.position as i64) < state.length as i64 - 1 {
            state.read_document()?;
        }
        Ok(())
    })();
    let cyclic = LoadError::Unsupported("an alias to an enclosing collection (a cyclic value)");
    if state.approx {
        return Err(cyclic);
    }
    read?;
    if state.documents.iter().any(contains_cycle) {
        return Err(cyclic);
    }
    let shared = state.aliased;
    let mut documents = state.documents;
    match documents.len() {
        0 => Ok((None, shared)),
        1 => Ok((documents.pop(), shared)),
        _ => Err(LoadError::Yaml(make_error(
            "expected a single document in the stream, but found more",
            None,
        ))),
    }
}
