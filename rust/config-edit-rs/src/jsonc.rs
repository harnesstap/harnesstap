//! The parts of npm `jsonc-parser` 3.3.1 that `format-preserving-config.ts` calls: `parse`,
//! `modify` (`setProperty` with string path segments, with formatting) and `applyEdits`, with
//! the scanner, `parseTree`, `findNodeAtLocation` and `format` under them.
//!
//! Text is handled as UTF-16 code units, as the original indexes it, so every offset matches.

use serde_json::{Map, Value};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Tok {
    OpenBrace,
    CloseBrace,
    OpenBracket,
    CloseBracket,
    Comma,
    Colon,
    Null,
    True,
    False,
    Str,
    Num,
    LineComment,
    BlockComment,
    LineBreak,
    Trivia,
    Unknown,
    Eof,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ScanErr {
    None,
    EndOfComment,
    EndOfString,
    EndOfNumber,
    InvalidUnicode,
    InvalidEscape,
    InvalidChar,
}

/// `charCodeAt` past the end is `NaN`, which matches no character.
const NAN: u32 = u32::MAX;

fn is_ws(c: u32) -> bool {
    c == 32 || c == 9
}
fn is_lb(c: u32) -> bool {
    c == 10 || c == 13
}
fn is_digit(c: u32) -> bool {
    (48..=57).contains(&c)
}

/// `text.substring(a, b)`: clamped to the text, arguments swapped when out of order.
fn substring(text: &[u16], a: usize, b: usize) -> &[u16] {
    let (a, b) = (a.min(text.len()), b.min(text.len()));
    if a <= b { &text[a..b] } else { &text[b..a] }
}

struct Scanner<'a> {
    text: &'a [u16],
    pos: usize,
    value: Vec<u16>,
    token_offset: usize,
    token: Tok,
    err: ScanErr,
}

impl<'a> Scanner<'a> {
    fn new(text: &'a [u16]) -> Self {
        Scanner {
            text,
            pos: 0,
            value: Vec::new(),
            token_offset: 0,
            token: Tok::Unknown,
            err: ScanErr::None,
        }
    }

    fn at(&self, i: usize) -> u32 {
        self.text.get(i).map_or(NAN, |&c| u32::from(c))
    }

    fn token_length(&self) -> usize {
        self.pos - self.token_offset
    }

    fn scan_hex_digits(&mut self, count: usize) -> Option<u16> {
        let mut digits = 0;
        let mut value: u32 = 0;
        while digits < count {
            let ch = self.at(self.pos);
            let d = match ch {
                48..=57 => ch - 48,
                65..=70 => ch - 65 + 10,
                97..=102 => ch - 97 + 10,
                _ => break,
            };
            value = value * 16 + d;
            self.pos += 1;
            digits += 1;
        }
        // At most four digits, so the value fits a code unit.
        (digits == count).then_some(value as u16)
    }

    fn scan_number(&mut self) -> Vec<u16> {
        let start = self.pos;
        if self.at(self.pos) == 48 {
            self.pos += 1;
        } else {
            self.pos += 1;
            while is_digit(self.at(self.pos)) {
                self.pos += 1;
            }
        }
        if self.at(self.pos) == 46 {
            self.pos += 1;
            if is_digit(self.at(self.pos)) {
                self.pos += 1;
                while is_digit(self.at(self.pos)) {
                    self.pos += 1;
                }
            } else {
                self.err = ScanErr::EndOfNumber;
                return substring(self.text, start, self.pos).to_vec();
            }
        }
        let mut end = self.pos;
        if matches!(self.at(self.pos), 69 | 101) {
            self.pos += 1;
            if matches!(self.at(self.pos), 43 | 45) {
                self.pos += 1;
            }
            if is_digit(self.at(self.pos)) {
                self.pos += 1;
                while is_digit(self.at(self.pos)) {
                    self.pos += 1;
                }
                end = self.pos;
            } else {
                self.err = ScanErr::EndOfNumber;
            }
        }
        substring(self.text, start, end).to_vec()
    }

    fn scan_string(&mut self) -> Vec<u16> {
        let len = self.text.len();
        let mut result = Vec::new();
        let mut start = self.pos;
        loop {
            if self.pos >= len {
                result.extend_from_slice(substring(self.text, start, self.pos));
                self.err = ScanErr::EndOfString;
                break;
            }
            let ch = self.at(self.pos);
            if ch == 34 {
                result.extend_from_slice(substring(self.text, start, self.pos));
                self.pos += 1;
                break;
            }
            if ch == 92 {
                result.extend_from_slice(substring(self.text, start, self.pos));
                self.pos += 1;
                if self.pos >= len {
                    self.err = ScanErr::EndOfString;
                    break;
                }
                let ch2 = self.at(self.pos);
                self.pos += 1;
                match ch2 {
                    34 => result.push(34),
                    92 => result.push(92),
                    47 => result.push(47),
                    98 => result.push(8),
                    102 => result.push(12),
                    110 => result.push(10),
                    114 => result.push(13),
                    116 => result.push(9),
                    117 => match self.scan_hex_digits(4) {
                        Some(c) => result.push(c),
                        None => self.err = ScanErr::InvalidUnicode,
                    },
                    _ => self.err = ScanErr::InvalidEscape,
                }
                start = self.pos;
                continue;
            }
            if ch <= 0x1f {
                if is_lb(ch) {
                    result.extend_from_slice(substring(self.text, start, self.pos));
                    self.err = ScanErr::EndOfString;
                    break;
                }
                self.err = ScanErr::InvalidChar;
            }
            self.pos += 1;
        }
        result
    }

    fn is_unknown_content(c: u32) -> bool {
        !(is_ws(c) || is_lb(c) || matches!(c, 125 | 93 | 123 | 91 | 34 | 58 | 44 | 47))
    }

    fn scan(&mut self) -> Tok {
        self.token = self.scan_next();
        self.token
    }

    fn scan_next(&mut self) -> Tok {
        let len = self.text.len();
        self.value.clear();
        self.err = ScanErr::None;
        self.token_offset = self.pos;
        if self.pos >= len {
            self.token_offset = len;
            return Tok::Eof;
        }
        let mut code = self.at(self.pos);
        if is_ws(code) {
            while is_ws(self.at(self.pos)) {
                self.pos += 1;
            }
            return Tok::Trivia;
        }
        if is_lb(code) {
            self.pos += 1;
            if code == 13 && self.at(self.pos) == 10 {
                self.pos += 1;
            }
            return Tok::LineBreak;
        }
        match code {
            123 => {
                self.pos += 1;
                Tok::OpenBrace
            }
            125 => {
                self.pos += 1;
                Tok::CloseBrace
            }
            91 => {
                self.pos += 1;
                Tok::OpenBracket
            }
            93 => {
                self.pos += 1;
                Tok::CloseBracket
            }
            58 => {
                self.pos += 1;
                Tok::Colon
            }
            44 => {
                self.pos += 1;
                Tok::Comma
            }
            34 => {
                self.pos += 1;
                self.value = self.scan_string();
                Tok::Str
            }
            47 => {
                if self.at(self.pos + 1) == 47 {
                    self.pos += 2;
                    while self.pos < len && !is_lb(self.at(self.pos)) {
                        self.pos += 1;
                    }
                    return Tok::LineComment;
                }
                if self.at(self.pos + 1) == 42 {
                    self.pos += 2;
                    let safe_length = len.saturating_sub(1);
                    let mut closed = false;
                    while self.pos < safe_length {
                        let ch = self.at(self.pos);
                        if ch == 42 && self.at(self.pos + 1) == 47 {
                            self.pos += 2;
                            closed = true;
                            break;
                        }
                        self.pos += 1;
                        if ch == 13 && self.at(self.pos) == 10 {
                            self.pos += 1;
                        }
                    }
                    if !closed {
                        self.pos += 1;
                        self.err = ScanErr::EndOfComment;
                    }
                    return Tok::BlockComment;
                }
                self.pos += 1;
                Tok::Unknown
            }
            45 => {
                self.value.push(45);
                self.pos += 1;
                if self.pos == len || !is_digit(self.at(self.pos)) {
                    return Tok::Unknown;
                }
                let digits = self.scan_number();
                self.value.extend(digits);
                Tok::Num
            }
            48..=57 => {
                self.value = self.scan_number();
                Tok::Num
            }
            _ => {
                while self.pos < len && Self::is_unknown_content(code) {
                    self.pos += 1;
                    code = self.at(self.pos);
                }
                if self.token_offset != self.pos {
                    return match String::from_utf16_lossy(&self.text[self.token_offset..self.pos])
                        .as_str()
                    {
                        "true" => Tok::True,
                        "false" => Tok::False,
                        "null" => Tok::Null,
                        _ => Tok::Unknown,
                    };
                }
                self.pos += 1;
                Tok::Unknown
            }
        }
    }
}

/// What a visitor hears while `visit` walks the text.
enum Event {
    ObjectBegin(usize),
    Property(String, usize, usize),
    ObjectEnd(usize, usize),
    ArrayBegin(usize),
    ArrayEnd(usize, usize),
    Literal(Value, usize, usize),
    Separator(u8, usize),
    Error,
}

/// `visit(text, visitor, { allowTrailingComma })`, collecting the events in order.
fn visit(text: &[u16], allow_trailing_comma: bool) -> Vec<Event> {
    struct P<'a> {
        s: Scanner<'a>,
        events: Vec<Event>,
        trailing: bool,
    }
    impl P<'_> {
        fn off(&self) -> usize {
            self.s.token_offset
        }
        fn len(&self) -> usize {
            self.s.token_length()
        }
        fn scan_next(&mut self) -> Tok {
            loop {
                let token = self.s.scan();
                if self.s.err != ScanErr::None {
                    self.events.push(Event::Error);
                }
                match token {
                    Tok::LineComment | Tok::BlockComment | Tok::Trivia | Tok::LineBreak => {}
                    Tok::Unknown => self.events.push(Event::Error),
                    t => return t,
                }
            }
        }
        fn handle_error(&mut self, skip_after: &[Tok], skip_until: &[Tok]) {
            self.events.push(Event::Error);
            if skip_after.len() + skip_until.len() > 0 {
                let mut token = self.s.token;
                while token != Tok::Eof {
                    if skip_after.contains(&token) {
                        self.scan_next();
                        break;
                    } else if skip_until.contains(&token) {
                        break;
                    }
                    token = self.scan_next();
                }
            }
        }
        fn value_string(&self) -> String {
            String::from_utf16_lossy(&self.s.value)
        }
        fn parse_literal(&mut self) -> bool {
            let value = match self.s.token {
                Tok::Num => {
                    let n = emit_rs::js::string_to_number(&self.value_string());
                    if n.is_nan() {
                        self.handle_error(&[], &[]);
                        emit_rs::js::number_value(0.0)
                    } else {
                        emit_rs::js::number_value(n)
                    }
                }
                Tok::Null => Value::Null,
                Tok::True => Value::Bool(true),
                Tok::False => Value::Bool(false),
                _ => return false,
            };
            self.events
                .push(Event::Literal(value, self.off(), self.len()));
            self.scan_next();
            true
        }
        fn parse_property(&mut self) -> bool {
            if self.s.token != Tok::Str {
                self.handle_error(&[], &[Tok::CloseBrace, Tok::Comma]);
                return false;
            }
            self.events
                .push(Event::Property(self.value_string(), self.off(), self.len()));
            self.scan_next();
            if self.s.token == Tok::Colon {
                self.events.push(Event::Separator(b':', self.off()));
                self.scan_next();
                if !self.parse_value() {
                    self.handle_error(&[], &[Tok::CloseBrace, Tok::Comma]);
                }
            } else {
                self.handle_error(&[], &[Tok::CloseBrace, Tok::Comma]);
            }
            true
        }
        fn parse_container(&mut self, object: bool) -> bool {
            let (close, begin) = if object {
                (Tok::CloseBrace, Event::ObjectBegin(self.off()))
            } else {
                (Tok::CloseBracket, Event::ArrayBegin(self.off()))
            };
            self.events.push(begin);
            self.scan_next();
            let mut needs_comma = false;
            while self.s.token != close && self.s.token != Tok::Eof {
                if self.s.token == Tok::Comma {
                    if !needs_comma {
                        self.handle_error(&[], &[]);
                    }
                    self.events.push(Event::Separator(b',', self.off()));
                    self.scan_next();
                    if self.s.token == close && self.trailing {
                        break;
                    }
                } else if needs_comma {
                    self.handle_error(&[], &[]);
                }
                let ok = if object {
                    self.parse_property()
                } else {
                    self.parse_value()
                };
                if !ok {
                    self.handle_error(&[], &[close, Tok::Comma]);
                }
                needs_comma = true;
            }
            self.events.push(if object {
                Event::ObjectEnd(self.off(), self.len())
            } else {
                Event::ArrayEnd(self.off(), self.len())
            });
            if self.s.token != close {
                self.handle_error(&[close], &[]);
            } else {
                self.scan_next();
            }
            true
        }
        fn parse_value(&mut self) -> bool {
            match self.s.token {
                Tok::OpenBracket => self.parse_container(false),
                Tok::OpenBrace => self.parse_container(true),
                Tok::Str => {
                    self.events.push(Event::Literal(
                        Value::String(self.value_string()),
                        self.off(),
                        self.len(),
                    ));
                    self.scan_next();
                    true
                }
                _ => self.parse_literal(),
            }
        }
    }
    let mut p = P {
        s: Scanner::new(text),
        events: Vec::new(),
        trailing: allow_trailing_comma,
    };
    p.scan_next();
    if p.s.token == Tok::Eof {
        p.handle_error(&[], &[]);
        return p.events;
    }
    if !p.parse_value() {
        p.handle_error(&[], &[]);
        return p.events;
    }
    if p.s.token != Tok::Eof {
        p.handle_error(&[], &[]);
    }
    p.events
}

fn utf16(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

/// JavaScript property assignment (`obj[key] = value`): `__proto__` sets the prototype
/// instead of an own property, so it never shows up among the keys.
pub(crate) fn js_assign(map: &mut Map<String, Value>, key: &str, value: Value) {
    if key != "__proto__" {
        map.insert(key.to_owned(), value);
    }
}

/// `parse(text, errors, { allowTrailingComma: true })`: the value and whether any error was
/// reported.
pub fn parse(text: &str) -> (Option<Value>, bool) {
    enum Frame {
        Arr(Vec<Value>),
        Obj(Map<String, Value>, Option<String>),
    }
    fn on_value(stack: &mut [Frame], root: &mut Option<Value>, value: Value) {
        match stack.last_mut() {
            Some(Frame::Arr(items)) => items.push(value),
            Some(Frame::Obj(map, Some(key))) => js_assign(map, key, value),
            Some(Frame::Obj(_, None)) => {}
            None => {
                root.get_or_insert(value);
            }
        }
    }
    let mut stack: Vec<Frame> = Vec::new();
    let mut root = None;
    let mut errors = false;
    for event in visit(&utf16(text), true) {
        match event {
            Event::ObjectBegin(_) => stack.push(Frame::Obj(Map::new(), None)),
            Event::ArrayBegin(_) => stack.push(Frame::Arr(Vec::new())),
            Event::Property(name, _, _) => {
                if let Some(Frame::Obj(_, key)) = stack.last_mut() {
                    *key = Some(name);
                }
            }
            Event::ObjectEnd(..) | Event::ArrayEnd(..) => {
                // The original fills containers by reference; here they are filled on the
                // stack and handed to their parent when they close.
                let value = match stack.pop() {
                    Some(Frame::Arr(items)) => Value::Array(items),
                    Some(Frame::Obj(map, _)) => Value::Object(map),
                    None => continue,
                };
                on_value(&mut stack, &mut root, value);
            }
            Event::Literal(value, _, _) => on_value(&mut stack, &mut root, value),
            Event::Separator(..) => {}
            Event::Error => errors = true,
        }
    }
    (root, errors)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Object,
    Array,
    Property,
    Literal,
}

struct Node {
    kind: Kind,
    type_name: &'static str,
    offset: i64,
    length: i64,
    parent: usize,
    children: Vec<usize>,
    value: Option<Value>,
}

/// `parseTree`: nodes in an arena, index 0 being the artificial root array.
struct Tree {
    nodes: Vec<Node>,
}

fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
        Value::Null => "null",
    }
}

impl Tree {
    fn parse(text: &[u16]) -> Tree {
        let mut nodes = vec![Node {
            kind: Kind::Array,
            type_name: "array",
            offset: -1,
            length: -1,
            parent: 0,
            children: Vec::new(),
            value: None,
        }];
        let mut current = 0;
        let ensure_property_complete = |nodes: &mut Vec<Node>, current: &mut usize, end: usize| {
            if nodes[*current].kind == Kind::Property {
                nodes[*current].length = end as i64 - nodes[*current].offset;
                *current = nodes[*current].parent;
            }
        };
        let push = |nodes: &mut Vec<Node>,
                    parent: usize,
                    kind,
                    type_name,
                    offset: usize,
                    length: i64,
                    value| {
            nodes.push(Node {
                kind,
                type_name,
                offset: offset as i64,
                length,
                parent,
                children: Vec::new(),
                value,
            });
            let id = nodes.len() - 1;
            nodes[parent].children.push(id);
            id
        };
        for event in visit(text, false) {
            let is_object_end = matches!(event, Event::ObjectEnd(..));
            match event {
                Event::ObjectBegin(offset) => {
                    current = push(
                        &mut nodes,
                        current,
                        Kind::Object,
                        "object",
                        offset,
                        -1,
                        None,
                    );
                }
                Event::ArrayBegin(offset) => {
                    current = push(&mut nodes, current, Kind::Array, "array", offset, -1, None);
                }
                Event::Property(name, offset, length) => {
                    current = push(
                        &mut nodes,
                        current,
                        Kind::Property,
                        "property",
                        offset,
                        -1,
                        None,
                    );
                    push(
                        &mut nodes,
                        current,
                        Kind::Literal,
                        "string",
                        offset,
                        length as i64,
                        Some(Value::String(name)),
                    );
                }
                Event::ObjectEnd(offset, length) | Event::ArrayEnd(offset, length) => {
                    if is_object_end {
                        // A property left without a value ends with its object.
                        ensure_property_complete(&mut nodes, &mut current, offset + length);
                    }
                    nodes[current].length = (offset + length) as i64 - nodes[current].offset;
                    current = nodes[current].parent;
                    ensure_property_complete(&mut nodes, &mut current, offset + length);
                }
                Event::Literal(value, offset, length) => {
                    let name = type_name(&value);
                    push(
                        &mut nodes,
                        current,
                        Kind::Literal,
                        name,
                        offset,
                        length as i64,
                        Some(value),
                    );
                    ensure_property_complete(&mut nodes, &mut current, offset + length);
                }
                Event::Separator(sep, offset) => {
                    if nodes[current].kind == Kind::Property && sep == b',' {
                        ensure_property_complete(&mut nodes, &mut current, offset);
                    }
                }
                Event::Error => {}
            }
        }
        Tree { nodes }
    }

    fn root(&self) -> Option<usize> {
        self.nodes[0].children.first().copied()
    }

    /// `findNodeAtLocation(node, path)` for string segments.
    fn find(&self, node: Option<usize>, path: &[String]) -> Option<usize> {
        let mut node = node?;
        for segment in path {
            if self.nodes[node].kind != Kind::Object {
                return None;
            }
            node = self.nodes[node].children.iter().find_map(|&p| {
                let children = &self.nodes[p].children;
                let key = children.first().and_then(|&k| self.nodes[k].value.as_ref());
                (children.len() == 2 && key.and_then(Value::as_str) == Some(segment))
                    .then(|| children[1])
            })?;
        }
        Some(node)
    }
}

/// `FormattingOptions` as `format-preserving-config.ts` builds them (`keepLines` is off).
#[derive(Clone, Debug)]
pub struct Formatting {
    pub tab_size: usize,
    pub insert_spaces: bool,
    pub insert_final_newline: bool,
    pub eol: &'static str,
}

#[derive(Debug)]
struct Edit {
    offset: usize,
    length: usize,
    content: Vec<u16>,
}

fn apply_edit(text: &[u16], edit: &Edit) -> Vec<u16> {
    let mut out = substring(text, 0, edit.offset).to_vec();
    out.extend_from_slice(&edit.content);
    out.extend_from_slice(substring(text, edit.offset + edit.length, text.len()));
    out
}

fn is_eol(text: &[u16], offset: usize) -> bool {
    // `'\r\n'.indexOf(text.charAt(offset))`: past the end, `charAt` is "" and matches.
    text.get(offset).is_none_or(|&c| c == 10 || c == 13)
}

fn repeat(s: &[u16], count: i64) -> Vec<u16> {
    let mut out = Vec::new();
    for _ in 0..count.max(0) {
        out.extend_from_slice(s);
    }
    out
}

/// `format(documentText, range, options)` with `keepLines: false`.
/// An edit whose content is `undefined` makes `withFormatting` throw.
const UNDEFINED_CONTENT: &str = "Cannot read properties of undefined (reading 'length')";

fn format(
    doc: &[u16],
    range_start: usize,
    range_len: usize,
    options: &Formatting,
) -> Result<Vec<Edit>, String> {
    let range_end = range_start + range_len;
    let mut fts = range_start;
    while fts > 0 && !is_eol(doc, fts - 1) {
        fts -= 1;
    }
    let mut end_offset = range_end;
    while end_offset < doc.len() && !is_eol(doc, end_offset) {
        end_offset += 1;
    }
    let format_text = substring(doc, fts, end_offset);
    let tab_size = if options.tab_size == 0 {
        4
    } else {
        options.tab_size
    };
    let initial_indent_level = {
        let mut n = 0;
        for &c in format_text {
            match c {
                32 => n += 1,
                9 => n += tab_size,
                _ => break,
            }
        }
        (n / tab_size) as i64
    };
    let eol: Vec<u16> = {
        let found = doc.iter().position(|&c| c == 13 || c == 10).map(|i| {
            if doc[i] == 13 {
                if doc.get(i + 1) == Some(&10) {
                    "\r\n"
                } else {
                    "\r"
                }
            } else {
                "\n"
            }
        });
        utf16(found.unwrap_or(options.eol))
    };
    let indent_value: Vec<u16> = if options.insert_spaces {
        vec![32; tab_size]
    } else {
        vec![9]
    };
    let mut level: i64 = 0;
    // `None` is `undefined`: the original's cache of indented line breaks has 200 entries
    // (0 to 199), so exactly 200 indent characters read past it.
    let new_lines_and_indent = |level: i64| -> Option<Vec<u16>> {
        let amount = indent_value.len() as i64 * (initial_indent_level + level);
        if amount == 200 {
            return None;
        }
        let mut out = eol.clone();
        out.extend(repeat(&indent_value, initial_indent_level + level));
        Some(out)
    };
    let mut scanner = Scanner::new(format_text);
    let mut has_error = false;
    let mut line_breaks = 0;
    let scan_next = |scanner: &mut Scanner, has_error: &mut bool, line_breaks: &mut i32| -> Tok {
        let mut token = scanner.scan();
        *line_breaks = 0;
        while token == Tok::Trivia || token == Tok::LineBreak {
            if token == Tok::LineBreak {
                *line_breaks = 1;
            }
            token = scanner.scan();
        }
        *has_error = token == Tok::Unknown || scanner.err != ScanErr::None;
        token
    };
    let mut edits = Vec::new();
    let mut undefined = false;
    let mut add_edit = |edits: &mut Vec<Edit>,
                        has_error: bool,
                        text: Option<Vec<u16>>,
                        start: usize,
                        end: usize| {
        // `end < start` only follows an unclosed block comment at the very end (its token runs
        // one past the text), where the original makes a negative-length edit. That text never
        // parses, so it is never edited here.
        if has_error || start > end || start >= range_end || end <= range_start {
            return;
        }
        match text {
            None => undefined = true,
            Some(text) if substring(doc, start, end) != text.as_slice() => {
                edits.push(Edit {
                    offset: start,
                    length: end - start,
                    content: text,
                });
            }
            Some(_) => {}
        }
    };
    let mut first = scan_next(&mut scanner, &mut has_error, &mut line_breaks);
    if first != Tok::Eof {
        let first_token_start = scanner.token_offset + fts;
        add_edit(
            &mut edits,
            has_error,
            Some(repeat(&indent_value, initial_indent_level)),
            fts,
            first_token_start,
        );
    }
    let is_comment = |t: Tok| t == Tok::LineComment || t == Tok::BlockComment;
    while first != Tok::Eof {
        let mut first_token_end = scanner.token_offset + scanner.token_length() + fts;
        let mut second = scan_next(&mut scanner, &mut has_error, &mut line_breaks);
        let mut replace: Option<Vec<u16>> = Some(Vec::new());
        let mut needs_line_break = false;
        while line_breaks == 0 && is_comment(second) {
            let comment_start = scanner.token_offset + fts;
            add_edit(
                &mut edits,
                has_error,
                Some(vec![32]),
                first_token_end,
                comment_start,
            );
            first_token_end = scanner.token_offset + scanner.token_length() + fts;
            needs_line_break = second == Tok::LineComment;
            replace = if needs_line_break {
                new_lines_and_indent(level)
            } else {
                Some(Vec::new())
            };
            second = scan_next(&mut scanner, &mut has_error, &mut line_breaks);
        }
        if second == Tok::CloseBrace || second == Tok::CloseBracket {
            let open = if second == Tok::CloseBrace {
                Tok::OpenBrace
            } else {
                Tok::OpenBracket
            };
            if first != open {
                level -= 1;
                replace = new_lines_and_indent(level);
            }
        } else {
            match first {
                Tok::OpenBracket | Tok::OpenBrace => {
                    level += 1;
                    replace = new_lines_and_indent(level);
                }
                Tok::Comma | Tok::LineComment => replace = new_lines_and_indent(level),
                Tok::BlockComment => {
                    if line_breaks > 0 {
                        replace = new_lines_and_indent(level);
                    } else if !needs_line_break {
                        replace = Some(vec![32]);
                    }
                }
                Tok::Colon => {
                    if !needs_line_break {
                        replace = Some(vec![32]);
                    }
                }
                Tok::Str => {
                    if second == Tok::Colon && !needs_line_break {
                        replace = Some(Vec::new());
                    }
                }
                Tok::Null
                | Tok::True
                | Tok::False
                | Tok::Num
                | Tok::CloseBrace
                | Tok::CloseBracket => {
                    if is_comment(second) && !needs_line_break {
                        replace = Some(vec![32]);
                    } else if second != Tok::Comma && second != Tok::Eof {
                        has_error = true;
                    }
                }
                Tok::Unknown => has_error = true,
                _ => {}
            }
            if line_breaks > 0 && is_comment(second) {
                replace = new_lines_and_indent(level);
            }
        }
        if second == Tok::Eof {
            replace = if options.insert_final_newline {
                Some(eol.clone())
            } else {
                Some(Vec::new())
            };
        }
        let second_token_start = scanner.token_offset + fts;
        add_edit(
            &mut edits,
            has_error,
            replace,
            first_token_end,
            second_token_start,
        );
        first = second;
    }
    if undefined {
        return Err(UNDEFINED_CONTENT.into());
    }
    Ok(edits)
}

fn with_formatting(text: &[u16], edit: Edit, options: &Formatting) -> Result<Edit, String> {
    let mut new_text = apply_edit(text, &edit);
    let mut begin = edit.offset;
    let mut end = edit.offset + edit.content.len();
    if edit.length == 0 || edit.content.is_empty() {
        while begin > 0 && !is_eol(&new_text, begin - 1) {
            begin -= 1;
        }
        while end < new_text.len() && !is_eol(&new_text, end) {
            end += 1;
        }
    }
    let edits = format(&new_text, begin, end - begin, options)?;
    for e in edits.iter().rev() {
        new_text = apply_edit(&new_text, e);
        begin = begin.min(e.offset);
        end = end.max(e.offset + e.length);
        end = end + e.content.len() - e.length;
    }
    let length = text.len() + end - new_text.len() - begin;
    Ok(Edit {
        offset: begin,
        length,
        content: substring(&new_text, begin, end).to_vec(),
    })
}

fn stringify(value: &Value) -> Vec<u16> {
    utf16(&emit_rs::json::stringify(value, ""))
}

/// `applyEdits(text, modify(text, path, value, { formattingOptions }))` for a path of property
/// names; `None` removes the property. Errors carry the original's messages.
pub fn modify(
    text: &str,
    path: &[String],
    value: Option<&Value>,
    options: &Formatting,
) -> Result<String, String> {
    let text16 = utf16(text);
    let tree = Tree::parse(&text16);
    let root = tree.root();
    let mut path = path.to_vec();
    let mut value = value.cloned();
    let mut parent = None;
    let mut last = None;
    while let Some(segment) = path.pop() {
        parent = tree.find(root, &path);
        if parent.is_none()
            && let Some(v) = value.take()
        {
            let mut wrapped = Map::new();
            wrapped.insert(segment.clone(), v);
            value = Some(Value::Object(wrapped));
            last = Some(segment);
        } else {
            last = Some(segment);
            break;
        }
    }
    let edit = match parent {
        None => {
            let Some(value) = value else {
                return Err("Can not delete in empty document".into());
            };
            let (offset, length) = root.map_or((0, 0), |r| {
                (tree.nodes[r].offset as usize, tree.nodes[r].length as usize)
            });
            Edit {
                offset,
                length,
                content: stringify(&value),
            }
        }
        Some(parent) if tree.nodes[parent].kind == Kind::Object => {
            let segment = last.unwrap_or_default();
            let node = &tree.nodes[parent];
            match (
                tree.find(Some(parent), std::slice::from_ref(&segment)),
                value,
            ) {
                (Some(existing), None) => {
                    let property = tree.nodes[existing].parent;
                    let index = node
                        .children
                        .iter()
                        .position(|&c| c == property)
                        .unwrap_or(0);
                    let p = &tree.nodes[property];
                    let mut remove_end = (p.offset + p.length) as usize;
                    let remove_begin = if index > 0 {
                        let previous = &tree.nodes[node.children[index - 1]];
                        (previous.offset + previous.length) as usize
                    } else {
                        if node.children.len() > 1 {
                            remove_end = tree.nodes[node.children[1]].offset as usize;
                        }
                        node.offset as usize + 1
                    };
                    Edit {
                        offset: remove_begin,
                        length: remove_end - remove_begin,
                        content: Vec::new(),
                    }
                }
                (Some(existing), Some(value)) => {
                    let e = &tree.nodes[existing];
                    Edit {
                        offset: e.offset as usize,
                        length: e.length as usize,
                        content: stringify(&value),
                    }
                }
                (None, None) => return Ok(text.to_owned()),
                (None, Some(value)) => {
                    let mut property = stringify(&Value::String(segment));
                    property.extend(utf16(": "));
                    property.extend(stringify(&value));
                    match node.children.last() {
                        Some(&previous) => {
                            let p = &tree.nodes[previous];
                            let mut content = vec![44];
                            content.extend(property);
                            Edit {
                                offset: (p.offset + p.length) as usize,
                                length: 0,
                                content,
                            }
                        }
                        None => Edit {
                            offset: node.offset as usize + 1,
                            length: 0,
                            content: property,
                        },
                    }
                }
            }
        }
        Some(parent) => {
            return Err(format!(
                "Can not add index to parent of type {}",
                tree.nodes[parent].type_name
            ));
        }
    };
    let edit = with_formatting(&text16, edit, options)?;
    Ok(String::from_utf16_lossy(&apply_edit(&text16, &edit)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fmt() -> Formatting {
        Formatting {
            tab_size: 2,
            insert_spaces: true,
            insert_final_newline: true,
            eol: "\n",
        }
    }

    #[test]
    fn parses_with_comments_and_trailing_commas() {
        let (v, errors) = parse("{\n // c\n \"a\": [1, 2,], /* b */ \"b\": {\"__proto__\": 1},\n}");
        assert!(!errors);
        assert_eq!(v, Some(json!({"a": [1, 2], "b": {}})));
        assert!(parse("{\"a\": }").1);
    }

    #[test]
    fn inserts_and_replaces_with_formatting() {
        let text = "{\n  // keep\n  \"a\": 1\n}\n";
        let out = modify(text, &["b".into()], Some(&json!({"x": [1]})), &fmt()).unwrap();
        assert_eq!(
            out,
            "{\n  // keep\n  \"a\": 1,\n  \"b\": {\n    \"x\": [\n      1\n    ]\n  }\n}\n"
        );
        let out = modify(text, &["a".into()], None, &fmt()).unwrap();
        assert_eq!(out, "{\n}\n");
    }
}
