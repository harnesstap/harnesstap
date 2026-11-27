//! Frontmatter reading as `src/utils/frontmatter.ts` does it: gray-matter 4.0.3 called with
//! options (so without its content cache), whose YAML engine is js-yaml 3.14 `safeLoad`.
//!
//! The js-yaml loader is ported line by line ([`loader`], [`schema`]) so that the same inputs
//! throw, with the same messages, and load to the same values. Strings are handled as UTF-16
//! like the original; a lone surrogate (only reachable through a `\u` escape, or a split
//! astral character) comes out as U+FFFD.

mod dumper;
mod loader;
mod schema;
pub mod value;

use std::sync::LazyLock;

use regex::Regex;

pub use loader::{LoadError, YamlException};
pub use value::JsValue;

use loader::{Obj, U16s, V, js_string, lossy, u16s};

/// What `parseFrontmatter` (gray-matter) returns. Fields gray-matter leaves `undefined` are
/// `None`. `orig` (a Buffer of the input) and `stringify` are left out.
#[derive(Clone, Debug, PartialEq)]
pub struct GrayMatterFile {
    pub data: JsValue,
    pub content: String,
    pub excerpt: String,
    pub is_empty: Option<bool>,
    /// Set (to the whole input, BOM stripped) when the frontmatter block is empty.
    pub empty: Option<String>,
    pub language: Option<String>,
    pub matter: Option<String>,
}

/// Why `parseFrontmatter` throws.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FrontmatterError {
    /// A js-yaml `YAMLException`.
    Yaml(YamlException),
    /// `JSON.parse` failed (a `SyntaxError`). The message is serde_json's, not V8's.
    Json(String),
    /// A plain `Error`: `gray-matter engine "<name>" is not registered`, or `stringifying
    /// JavaScript is not supported`.
    Engine(String),
    /// A `TypeError` (`matter.stringify` with an engine that has no `stringify`).
    Type(String),
    /// A `RangeError` (`safeDump` of an invalid `Date`).
    Range(String),
    /// Something the port does not reproduce: the `javascript` engine (it evaluates the
    /// block), an engine name that is an `Object.prototype` member, or a cyclic alias.
    Unsupported(String),
}

impl FrontmatterError {
    /// The JavaScript error's `name`.
    pub fn name(&self) -> &'static str {
        match self {
            FrontmatterError::Yaml(_) => "YAMLException",
            FrontmatterError::Json(_) => "SyntaxError",
            FrontmatterError::Engine(_) => "Error",
            FrontmatterError::Type(_) => "TypeError",
            FrontmatterError::Range(_) => "RangeError",
            FrontmatterError::Unsupported(_) => "Unsupported",
        }
    }

    /// The JavaScript error's `message`.
    pub fn message(&self) -> &str {
        match self {
            FrontmatterError::Yaml(e) => &e.message,
            FrontmatterError::Json(m)
            | FrontmatterError::Engine(m)
            | FrontmatterError::Type(m)
            | FrontmatterError::Range(m)
            | FrontmatterError::Unsupported(m) => m,
        }
    }
}

impl std::fmt::Display for FrontmatterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.name(), self.message())
    }
}

impl std::error::Error for FrontmatterError {}

impl From<LoadError> for FrontmatterError {
    fn from(e: LoadError) -> Self {
        match e {
            LoadError::Yaml(y) => FrontmatterError::Yaml(y),
            LoadError::Unsupported(what) => FrontmatterError::Unsupported(what.to_owned()),
        }
    }
}

/// `jsyaml.safeLoad(text)`: `Ok(None)` is `undefined` (an empty stream).
pub fn yaml_safe_load(text: &str) -> Result<Option<JsValue>, LoadError> {
    Ok(loader::safe_load(text)?.map(|v| v.to_public()))
}

/// JavaScript `\s` (and what `String.prototype.trim` strips).
fn is_js_space(c: u16) -> bool {
    matches!(
        c,
        0x09..=0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F
            | 0x3000 | 0xFEFF
    )
}

fn is_line_terminator(c: u16) -> bool {
    matches!(c, 0x0A | 0x0D | 0x2028 | 0x2029)
}

fn trim16(s: &[u16]) -> &[u16] {
    let start = s.iter().position(|&c| !is_js_space(c)).unwrap_or(s.len());
    let end = s
        .iter()
        .rposition(|&c| !is_js_space(c))
        .map_or(start, |i| i + 1);
    &s[start..end.max(start)]
}

fn index_of(haystack: &[u16], needle: &[u16]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// `matter.replace(/^\s*#[^\n]+/gm, "")`.
fn strip_comment_lines(s: &[u16]) -> U16s {
    let mut out = Vec::with_capacity(s.len());
    let mut p = 0;
    while p < s.len() {
        if p == 0 || is_line_terminator(s[p - 1]) {
            let mut q = p;
            while q < s.len() && is_js_space(s[q]) {
                q += 1;
            }
            if q < s.len() && s[q] == u16::from(b'#') && q + 1 < s.len() && s[q + 1] != 0x0A {
                q += 1;
                while q < s.len() && s[q] != 0x0A {
                    q += 1;
                }
                p = q;
                continue;
            }
        }
        out.push(s[p]);
        p += 1;
    }
    out
}

/// A value is truthy in JavaScript.
fn truthy(v: &V) -> bool {
    match v {
        V::Undef | V::Null => false,
        V::Bool(b) => *b,
        V::Num(n) => *n != 0.0 && !n.is_nan(),
        V::Str(s) => !s.is_empty(),
        V::Arr(_) | V::Obj(_) | V::Date(_) | V::Buf(_) | V::Cycle(..) => true,
    }
}

fn json_to_v(v: serde_json::Value) -> V {
    match v {
        serde_json::Value::Null => V::Null,
        serde_json::Value::Bool(b) => V::Bool(b),
        serde_json::Value::Number(n) => V::Num(n.as_f64().unwrap_or(f64::NAN)),
        serde_json::Value::String(s) => V::Str(u16s(&s)),
        serde_json::Value::Array(items) => V::Arr(items.into_iter().map(json_to_v).collect()),
        serde_json::Value::Object(map) => {
            let mut obj = Obj::default();
            for (k, v) in map {
                obj.set(u16s(&k), json_to_v(v));
            }
            V::Obj(obj)
        }
    }
}

const PROTOTYPE_MEMBERS: [&str; 12] = [
    "constructor",
    "__proto__",
    "toString",
    "toLocaleString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
];

/// gray-matter's `getEngine(name)`: the engine's key in its engines object (the defaults, or an
/// `Object.prototype` member), `None` when it is not registered.
fn find_engine(name: &str) -> Option<&str> {
    let aliased = match name.to_lowercase().as_str() {
        "js" | "javascript" => "javascript",
        "yaml" | "yml" => "yaml",
        _ => name,
    };
    [name, aliased]
        .into_iter()
        .find(|n| matches!(*n, "yaml" | "json" | "javascript") || PROTOTYPE_MEMBERS.contains(n))
}

/// `parse(file.language, file.matter, opts)` with gray-matter's default engines, and the
/// collections YAML aliases named.
fn run_engine(language: &[u16], matter: &[u16]) -> Result<(V, Vec<V>), FrontmatterError> {
    let name = lossy(language);
    match find_engine(&name) {
        Some("yaml") => {
            let (v, shared) = loader::safe_load_shared(matter.to_vec())?;
            Ok((v.unwrap_or(V::Undef), shared))
        }
        Some("json") => serde_json::from_str::<serde_json::Value>(&lossy(matter))
            .map(|v| (json_to_v(v), Vec::new()))
            .map_err(|e| FrontmatterError::Json(e.to_string())),
        Some("javascript") => Err(FrontmatterError::Unsupported(
            "the javascript frontmatter engine (it evaluates the block)".into(),
        )),
        Some(member) => Err(FrontmatterError::Unsupported(format!(
            "an engine name that is an Object.prototype member ({member})"
        ))),
        None => Err(FrontmatterError::Engine(format!(
            "gray-matter engine \"{name}\" is not registered"
        ))),
    }
}

/// gray-matter's `excerpt(file, opts)` with no excerpt option: only `data.excerpt_separator`.
fn excerpt(data: &V, content: &[u16]) -> Option<U16s> {
    let V::Obj(obj) = data else { return None };
    let sep = obj.get(&u16s("excerpt_separator")).filter(|s| truthy(s))?;
    let delimiter = js_string(sep);
    index_of(content, &delimiter).map(|idx| content[..idx].to_vec())
}

struct File {
    content: U16s,
    data: V,
    is_empty: bool,
    empty: Option<U16s>,
    excerpt: U16s,
    language: U16s,
    matter: U16s,
    aliased: Vec<V>,
}

impl File {
    fn finish(self) -> GrayMatterFile {
        let data = match self.data {
            V::Undef | V::Null => JsValue::Object(Vec::new()),
            other => other.to_public(),
        };
        GrayMatterFile {
            data,
            content: lossy(&self.content),
            excerpt: lossy(&self.excerpt),
            is_empty: Some(self.is_empty),
            empty: self.empty.as_deref().map(lossy),
            language: Some(lossy(&self.language)),
            matter: Some(lossy(&self.matter)),
        }
    }
}

/// `matter(text, {})`, as `parseFrontmatter` calls it.
pub fn parse_frontmatter(text: &str) -> Result<GrayMatterFile, FrontmatterError> {
    Ok(parse_file(text)?.0)
}

/// [`parse_frontmatter`], and the collections YAML aliases named.
fn parse_file(text: &str) -> Result<(GrayMatterFile, Vec<JsValue>), FrontmatterError> {
    if text.is_empty() {
        return Ok((
            GrayMatterFile {
                data: JsValue::Object(Vec::new()),
                content: String::new(),
                excerpt: String::new(),
                is_empty: None,
                empty: None,
                language: None,
                matter: None,
            },
            Vec::new(),
        ));
    }
    let mut input = u16s(text);
    if input.first() == Some(&0xFEFF) {
        input.remove(0);
    }
    let mut file = File {
        content: input,
        data: V::Obj(Obj::default()),
        is_empty: false,
        empty: None,
        excerpt: Vec::new(),
        language: u16s("yaml"),
        matter: Vec::new(),
        aliased: Vec::new(),
    };
    let open = u16s("---");
    if !file.content.starts_with(&open) {
        return Ok((file.finish(), Vec::new()));
    }
    if file.content.get(3) == Some(&u16::from(b'-')) {
        return Ok((file.finish(), Vec::new()));
    }
    let mut s: U16s = file.content[3..].to_vec();
    let len = s.len();

    // `matter.language`: the text before the first line break (`slice(0, -1)` when none).
    let line_end = s
        .iter()
        .position(|&c| c == 0x0A)
        .map(|i| if i > 0 && s[i - 1] == 0x0D { i - 1 } else { i });
    let raw_end = line_end.unwrap_or(s.len().saturating_sub(1));
    let raw = s[..raw_end].to_vec();
    let name = trim16(&raw).to_vec();
    if !name.is_empty() {
        file.language = name;
        s.drain(..raw.len());
    }

    let close = u16s("\n---");
    let close_index = index_of(&s, &close).unwrap_or(len);
    file.matter = s[..close_index.min(s.len())].to_vec();
    let block = strip_comment_lines(&file.matter);
    if trim16(&block).is_empty() {
        file.is_empty = true;
        file.empty = Some(file.content.clone());
        file.data = V::Obj(Obj::default());
    } else {
        (file.data, file.aliased) = run_engine(&file.language, &file.matter)?;
    }
    if close_index == len {
        file.content = Vec::new();
    } else {
        let mut rest = &s[(close_index + close.len()).min(s.len())..];
        if rest.first() == Some(&0x0D) {
            rest = &rest[1..];
        }
        if rest.first() == Some(&0x0A) {
            rest = &rest[1..];
        }
        file.content = rest.to_vec();
    }
    if matches!(file.data, V::Undef | V::Null) {
        file.data = V::Obj(Obj::default());
    }
    if let Some(ex) = excerpt(&file.data, &file.content) {
        file.excerpt = ex;
    }
    let aliased = file.aliased.iter().map(V::to_public).collect();
    Ok((file.finish(), aliased))
}

static LENIENT_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)").expect("valid regex")
});

/// `/^([A-Za-z0-9_-]+):[ \t]*(.*)$/` on one line: the key and the rest (`.` stops at any line
/// terminator, so a line holding one does not match).
fn lenient_field(line: &str) -> Option<(&str, &str)> {
    let key_len = line
        .bytes()
        .take_while(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-')
        .count();
    if key_len == 0 || line.as_bytes().get(key_len) != Some(&b':') {
        return None;
    }
    let rest = &line[key_len + 1..];
    if rest.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    Some((&line[..key_len], rest))
}

/// `parseFrontmatterLenient`: when the strict read throws, read a flat block of `key: value`
/// lines as strings; anything else rethrows the strict error.
pub fn parse_frontmatter_lenient(text: &str) -> Result<GrayMatterFile, FrontmatterError> {
    let error = match parse_frontmatter(text) {
        Ok(file) => return Ok(file),
        Err(e @ FrontmatterError::Unsupported(_)) => return Err(e),
        Err(e) => e,
    };
    let Some(caps) = LENIENT_BLOCK.captures(text) else {
        return Err(error);
    };
    let whole = caps.get(0).map_or("", |m| m.as_str());
    let block = caps.get(1).map_or("", |m| m.as_str());
    let mut data = Obj::default();
    for line in block.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if emit_rs::js::trim(line).is_empty()
            || line
                .trim_start_matches(emit_rs::js::is_space)
                .starts_with('#')
        {
            continue;
        }
        let Some((key, rest)) = lenient_field(line) else {
            return Err(error);
        };
        let value = emit_rs::js::trim(rest);
        if value.is_empty() || value.starts_with(['[', '{', '|', '>', '&', '*', '!']) {
            return Err(error);
        }
        if key != "__proto__" {
            data.set(u16s(key), V::Str(u16s(value)));
        }
    }
    let strict = parse_frontmatter("---\n---\n")?;
    Ok(GrayMatterFile {
        data: V::Obj(data).to_public(),
        content: text[whole.len()..].to_owned(),
        language: None,
        matter: Some(block.to_owned()),
        ..strict
    })
}

/// `Object.assign(target, source)` for a frontmatter object: own enumerable properties in
/// `Object.keys` order; `__proto__` goes through the setter, so it never becomes a key.
fn assign(target: &mut Vec<(String, JsValue)>, source: &JsValue) {
    let entries: Vec<(String, JsValue)> = match source {
        JsValue::Object(entries) => entries.clone(),
        JsValue::Array(items) => items
            .iter()
            .enumerate()
            .map(|(i, v)| (i.to_string(), v.clone()))
            .collect(),
        JsValue::Buffer(bytes) => bytes
            .iter()
            .enumerate()
            .map(|(i, b)| (i.to_string(), JsValue::Number(f64::from(*b))))
            .collect(),
        // ponytail: a string spreads per UTF-16 unit; the halves of an astral character come
        // out as U+FFFD here (a lone surrogate in the original).
        JsValue::String(s) => s
            .encode_utf16()
            .enumerate()
            .map(|(i, c)| (i.to_string(), JsValue::String(lossy(&[c]))))
            .collect(),
        _ => Vec::new(),
    };
    for (key, value) in entries {
        if key == "__proto__" {
            continue;
        }
        match target.iter_mut().find(|(k, _)| *k == key) {
            Some((_, v)) => *v = value,
            None => target.push((key, value)),
        }
    }
}

/// Structural equality, with numbers compared bit for bit (so `NaN` equals itself).
fn same(a: &JsValue, b: &JsValue) -> bool {
    match (a, b) {
        (JsValue::Number(x), JsValue::Number(y)) | (JsValue::Date(x), JsValue::Date(y)) => {
            x.to_bits() == y.to_bits()
        }
        (JsValue::Array(x), JsValue::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(a, b)| same(a, b))
        }
        (JsValue::Object(x), JsValue::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|((ka, a), (kb, b))| ka == kb && same(a, b))
        }
        _ => a == b,
    }
}

fn collections<'a>(v: &'a JsValue, out: &mut Vec<&'a JsValue>) {
    let children: Box<dyn Iterator<Item = &JsValue>> = match v {
        JsValue::Array(items) => Box::new(items.iter()),
        JsValue::Object(entries) => Box::new(entries.iter().map(|(_, v)| v)),
        _ => return,
    };
    out.push(v);
    for child in children {
        collections(child, out);
    }
}

/// Whether the dumped object holds, twice, a collection an alias named (or one inside it, which
/// a merge shares too). A `JsValue` has no identity, so equal collections count as the same:
/// this can report sharing where the original has two equal but distinct objects, never miss
/// one.
fn shares_collection(merged: &JsValue, aliased: &[JsValue]) -> bool {
    let mut candidates = Vec::new();
    for v in aliased {
        collections(v, &mut candidates);
    }
    let mut nodes = Vec::new();
    if let JsValue::Object(entries) = merged {
        for (_, v) in entries {
            collections(v, &mut nodes);
        }
    }
    candidates
        .iter()
        .any(|c| nodes.iter().filter(|n| same(c, n)).count() > 1)
}

/// `newline(str)` in gray-matter's `stringify`.
fn newline(s: &str) -> String {
    if s.ends_with('\n') {
        s.to_owned()
    } else {
        format!("{s}\n")
    }
}

/// `matter.stringify(content, data)`: `content` is first read as a file (its own frontmatter
/// is merged under `data`, its language picks the engine), then the data is written with
/// js-yaml 3 `safeDump` (or `JSON.stringify(data, null, 2)` for `---json`) between `---` lines.
///
/// gray-matter reads `content` through its content cache (no options are passed); this reads
/// it fresh every time, which is what the original does the first time it sees a text.
/// `Unsupported` when the content's frontmatter shares a collection through a YAML alias (the
/// original writes `&ref_N` anchors for it).
pub fn stringify(content: &str, data: &JsValue) -> Result<String, FrontmatterError> {
    let (file, aliased) = parse_file(content)?;
    let language = file.language.as_deref().unwrap_or("yaml");
    let engine = find_engine(language);
    match engine {
        Some("yaml" | "json") => {}
        Some("javascript") => {
            return Err(FrontmatterError::Engine(
                "stringifying JavaScript is not supported".into(),
            ));
        }
        Some(_) => {
            return Err(FrontmatterError::Type(format!(
                "expected \"{language}.stringify\" to be a function"
            )));
        }
        None => {
            return Err(FrontmatterError::Engine(format!(
                "gray-matter engine \"{language}\" is not registered"
            )));
        }
    }
    let mut merged = Vec::new();
    assign(&mut merged, &file.data);
    assign(&mut merged, data);
    let (mut indexed, rest): (Vec<_>, Vec<_>) = merged
        .into_iter()
        .partition(|(k, _)| loader::array_index(&u16s(k)).is_some());
    indexed.sort_by_key(|(k, _)| loader::array_index(&u16s(k)));
    indexed.extend(rest);
    let merged = JsValue::Object(indexed);
    let matter = if engine == Some("json") {
        emit_rs::json::stringify(&merged.to_json(), "  ")
    } else {
        let dump = dumper::safe_dump(&merged)?;
        if shares_collection(&merged, &aliased) {
            return Err(FrontmatterError::Unsupported(
                "a collection shared through a YAML alias of the content's frontmatter (the \
                 original writes &ref_N anchors)"
                    .into(),
            ));
        }
        dump
    };
    let matter = emit_rs::js::trim(&matter);
    let mut buf = String::new();
    if matter != "{}" {
        buf = newline("---") + &newline(matter) + &newline("---");
    }
    // The excerpt (`excerpt_separator` in the content's frontmatter) is a prefix of the
    // content, so gray-matter never adds it again.
    Ok(buf + &newline(&file.content))
}

/// `emitFrontmatter(data, content)` (`base-serializer.ts`, `agent-plugins/files.ts`): only the
/// fields that are not `undefined`, `null` or `""`, and the content unchanged when none is left.
pub fn emit_frontmatter(
    data: &[(String, JsValue)],
    content: &str,
) -> Result<String, FrontmatterError> {
    let non_empty: Vec<(String, JsValue)> = data
        .iter()
        .filter(|(_, v)| {
            !matches!(v, JsValue::Undefined | JsValue::Null) && *v != JsValue::String(String::new())
        })
        .cloned()
        .collect();
    if non_empty.is_empty() {
        return Ok(content.to_owned());
    }
    stringify(content, &JsValue::Object(non_empty))
}
