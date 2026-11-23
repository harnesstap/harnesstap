//! `lib/parse.js`: a glob to the source of a JavaScript regular expression, with the options
//! the app passes (`{ dot: true }`) and the defaults for everything else.
//!
//! The original builds a list of token objects and edits them in place (a later star turns
//! the previous one into a globstar, a closing brace rewrites the tokens since its opening).
//! Here the tokens live in an arena and are referred to by index. Strings are measured in
//! chars where the original measures UTF-16 code units; they differ only outside the BMP.

use crate::chars::*;

#[derive(Clone, Debug, Default)]
struct Token {
    kind: &'static str,
    value: String,
    /// `undefined` is `None`; the original tells `''` and `undefined` apart.
    output: Option<String>,
    prev: Option<usize>,
    star: bool,
    posix: bool,
    extglob: bool,
    suffix: Option<String>,
    comma: bool,
    dots: bool,
    output_index: usize,
    tokens_index: usize,
}

impl Token {
    fn new(kind: &'static str, value: impl Into<String>, output: Option<String>) -> Self {
        Token {
            kind,
            value: value.into(),
            output,
            ..Token::default()
        }
    }
}

struct Extglob {
    kind: &'static str,
    close: String,
    inner: String,
    parens: i32,
    output: String,
    start_index: usize,
    tokens_index: usize,
}

/// What `parse` returns that `makeRe` reads.
pub struct Parsed {
    pub output: String,
    pub negated: bool,
}

/// A `SyntaxError` the original throws (only for patterns longer than 64 KiB here).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyntaxError(pub String);

fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// `s.slice(0, n)`.
fn take(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// `s.slice(0, -n)`, including its quirk: `slice(0, -0)` is empty.
fn drop_end(s: &str, n: usize) -> String {
    if n == 0 {
        return String::new();
    }
    let len = char_len(s);
    take(s, len.saturating_sub(n))
}

/// `utils.escapeLast`.
fn escape_last(input: &str, c: char, last: Option<usize>) -> String {
    let chars: Vec<char> = input.chars().collect();
    let end = last
        .unwrap_or(chars.len().saturating_sub(1))
        .min(chars.len().saturating_sub(1));
    if chars.is_empty() {
        return input.to_owned();
    }
    let Some(idx) = (0..=end).rev().find(|&i| chars[i] == c) else {
        return input.to_owned();
    };
    if idx > 0 && chars[idx - 1] == '\\' {
        return escape_last(input, c, Some(idx - 1));
    }
    let mut out: String = chars[..idx].iter().collect();
    out.push('\\');
    out.extend(&chars[idx..]);
    out
}

// ---- Repeated extglob analysis (`analyzeRepeatedExtglob` and its helpers). ----

/// `splitTopLevel`.
fn split_top_level(input: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let (mut bracket, mut paren, mut quote) = (0, 0, 0);
    let mut value = String::new();
    let mut escaped = false;
    for ch in input.chars() {
        if escaped {
            value.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            value.push(ch);
            escaped = true;
            continue;
        }
        if ch == '"' {
            quote = if quote == 1 { 0 } else { 1 };
            value.push(ch);
            continue;
        }
        if quote == 0 {
            if ch == '[' {
                bracket += 1;
            } else if ch == ']' && bracket > 0 {
                bracket -= 1;
            } else if bracket == 0 {
                if ch == '(' {
                    paren += 1;
                } else if ch == ')' && paren > 0 {
                    paren -= 1;
                } else if ch == '|' && paren == 0 {
                    parts.push(std::mem::take(&mut value));
                    continue;
                }
            }
        }
        value.push(ch);
    }
    parts.push(value);
    parts
}

/// JavaScript's `String.prototype.trim`.
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| {
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
    })
}

/// `isPlainBranch`.
fn is_plain_branch(branch: &str) -> bool {
    let mut escaped = false;
    for ch in branch.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if "?*+@!()[]{}".contains(ch) {
            return false;
        }
    }
    true
}

/// `/^@\([^\\()[\]{}|]+\)$/`.
fn is_simple_at(value: &str) -> bool {
    let Some(inner) = value.strip_prefix("@(").and_then(|v| v.strip_suffix(')')) else {
        return false;
    };
    !inner.is_empty() && !inner.chars().any(|c| "\\()[]{}|".contains(c))
}

/// `normalizeSimpleBranch`.
fn normalize_simple_branch(branch: &str) -> Option<String> {
    let mut value = js_trim(branch).to_owned();
    while is_simple_at(&value) {
        value = value[2..value.len() - 1].to_owned();
    }
    if !is_plain_branch(&value) {
        return None;
    }
    // `value.replace(/\\(.)/g, '$1')`: `.` does not match line terminators.
    let mut out = String::new();
    let mut it = value.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\\'
            && let Some(&n) = it.peek()
            && !matches!(n, '\n' | '\r' | '\u{2028}' | '\u{2029}')
        {
            out.push(n);
            it.next();
            continue;
        }
        out.push(c);
    }
    Some(out)
}

/// `hasRepeatedCharPrefixOverlap`.
fn has_repeated_char_prefix_overlap(branches: &[String]) -> bool {
    let values: Vec<String> = branches
        .iter()
        .filter_map(|b| normalize_simple_branch(b))
        .filter(|v| !v.is_empty())
        .collect();
    for i in 0..values.len() {
        for j in i + 1..values.len() {
            let (a, b) = (&values[i], &values[j]);
            let Some(c) = a.chars().next() else { continue };
            if a.chars().any(|x| x != c) || b.chars().any(|x| x != c) {
                continue;
            }
            if a == b || a.starts_with(b.as_str()) || b.starts_with(a.as_str()) {
                return true;
            }
        }
    }
    false
}

struct Repeated {
    kind: char,
    body: String,
    end: usize,
}

/// `parseRepeatedExtglob`.
fn parse_repeated_extglob(pattern: &[char], require_end: bool) -> Option<Repeated> {
    if !matches!(pattern.first(), Some('+' | '*')) || pattern.get(1) != Some(&'(') {
        return None;
    }
    let (mut bracket, mut paren, mut quote) = (0, 0, 0);
    let mut escaped = false;
    for i in 1..pattern.len() {
        let ch = pattern[i];
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            quote = if quote == 1 { 0 } else { 1 };
            continue;
        }
        if quote == 1 {
            continue;
        }
        if ch == '[' {
            bracket += 1;
            continue;
        }
        if ch == ']' && bracket > 0 {
            bracket -= 1;
            continue;
        }
        if bracket > 0 {
            continue;
        }
        if ch == '(' {
            paren += 1;
            continue;
        }
        if ch == ')' {
            paren -= 1;
            if paren == 0 {
                if require_end && i != pattern.len() - 1 {
                    return None;
                }
                return Some(Repeated {
                    kind: pattern[0],
                    body: pattern[2..i].iter().collect(),
                    end: i,
                });
            }
        }
    }
    None
}

/// `getStarExtglobSequenceOutput`.
fn star_extglob_sequence_output(pattern: &str) -> Option<String> {
    let chars: Vec<char> = pattern.chars().collect();
    let mut index = 0;
    let mut found: Vec<String> = Vec::new();
    while index < chars.len() {
        let m = parse_repeated_extglob(&chars[index..], false)?;
        if m.kind != '*' {
            return None;
        }
        let branches = split_top_level(&m.body);
        if branches.len() != 1 {
            return None;
        }
        let branch = normalize_simple_branch(js_trim(&branches[0]))?;
        if char_len(&branch) != 1 {
            return None;
        }
        found.push(branch);
        index += m.end + 1;
    }
    if found.is_empty() {
        return None;
    }
    let source = if found.len() == 1 {
        escape_regex(&found[0])
    } else {
        format!(
            "[{}]",
            found.iter().map(|c| escape_regex(c)).collect::<String>()
        )
    };
    Some(format!("{source}*"))
}

/// `repeatedExtglobRecursion`.
fn repeated_extglob_recursion(pattern: &str) -> usize {
    let mut depth = 0;
    let mut value: Vec<char> = js_trim(pattern).chars().collect();
    while let Some(m) = parse_repeated_extglob(&value, true) {
        depth += 1;
        value = js_trim(&m.body).chars().collect();
    }
    depth
}

/// `analyzeRepeatedExtglob` with the default `maxExtglobRecursion` (0): `(risky, safeOutput)`.
fn analyze_repeated_extglob(body: &str) -> (bool, Option<String>) {
    let branches: Vec<String> = split_top_level(body)
        .iter()
        .map(|b| js_trim(b).to_owned())
        .collect();
    if branches.len() > 1
        && (branches.iter().any(|b| b.is_empty())
            || branches
                .iter()
                .any(|b| !b.is_empty() && b.chars().all(|c| c == '*' || c == '?'))
            || has_repeated_char_prefix_overlap(&branches))
    {
        return (true, None);
    }
    for branch in &branches {
        if let Some(safe) = star_extglob_sequence_output(branch) {
            return (true, Some(safe));
        }
        if repeated_extglob_recursion(branch) > 0 {
            return (true, None);
        }
    }
    (false, None)
}

// ---- `expandRange`. ----

/// `new RegExp(value)` succeeds for `[a-b-c]`-style sources the brace range builds: the only
/// failures that construction can produce are an out-of-order range and a bad trailing escape
/// or group, which this checks.
fn js_class_source_is_valid(source: &str) -> bool {
    crate::regex::compile_js(source).is_some()
}

/// `expandRange(args)`: default sort, then a class, or the escaped values joined by `..`.
fn expand_range(mut args: Vec<String>) -> String {
    args.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    let value = format!("[{}]", args.join("-"));
    if js_class_source_is_valid(&value) {
        return value;
    }
    args.iter()
        .map(|v| escape_regex(v))
        .collect::<Vec<_>>()
        .join("..")
}

// ---- The parser. ----

struct Parser {
    input: Vec<char>,
    index: isize,
    start: usize,
    output: String,
    backtrack: bool,
    negated: bool,
    brackets: i32,
    braces: i32,
    parens: i32,
    quotes: i32,
    arena: Vec<Token>,
    tokens: Vec<usize>,
    extglobs: Vec<Extglob>,
    braces_stack: Vec<usize>,
    stack: Vec<&'static str>,
    prev: usize,
}

const BOS: usize = 0;

impl Parser {
    fn len(&self) -> isize {
        self.input.len() as isize
    }
    fn eos(&self) -> bool {
        self.index == self.len() - 1
    }
    fn peek(&self, n: isize) -> Option<char> {
        let i = self.index + n;
        (i >= 0)
            .then(|| self.input.get(i as usize).copied())
            .flatten()
    }
    fn advance(&mut self) -> String {
        self.index += 1;
        self.input
            .get(self.index as usize)
            .map(|c| c.to_string())
            .unwrap_or_default()
    }
    fn remaining(&self) -> String {
        let from = (self.index + 1).max(0) as usize;
        self.input
            .get(from..)
            .map(|s| s.iter().collect())
            .unwrap_or_default()
    }
    fn tok(&self, i: usize) -> &Token {
        &self.arena[i]
    }
    fn tok_mut(&mut self, i: usize) -> &mut Token {
        &mut self.arena[i]
    }
    /// `token.output != null ? token.output : token.value`.
    fn shown(t: &Token) -> &str {
        t.output.as_deref().unwrap_or(&t.value)
    }

    fn increment(&mut self, kind: &'static str) {
        match kind {
            "parens" => self.parens += 1,
            "braces" => self.braces += 1,
            _ => self.brackets += 1,
        }
        self.stack.push(kind);
    }
    fn decrement(&mut self, kind: &'static str) {
        match kind {
            "parens" => self.parens -= 1,
            "braces" => self.braces -= 1,
            _ => self.brackets -= 1,
        }
        self.stack.pop();
    }

    /// `append`, for a token that is not kept.
    fn append_value(&mut self, value: &str) {
        self.output.push_str(value);
    }

    /// `push`.
    fn push(&mut self, tok: Token) -> Option<usize> {
        let prev = self.prev;
        if self.tok(prev).kind == "globstar" {
            let is_brace = self.braces > 0 && (tok.kind == "comma" || tok.kind == "brace");
            let is_extglob = tok.extglob
                || (!self.extglobs.is_empty() && (tok.kind == "pipe" || tok.kind == "paren"));
            if tok.kind != "slash" && tok.kind != "paren" && !is_brace && !is_extglob {
                let n = char_len(Self::shown_output_or_empty(self.tok(prev)));
                self.output = drop_end(&self.output, n);
                let p = self.tok_mut(prev);
                p.kind = "star";
                p.value = "*".into();
                p.output = Some(STAR.into());
                self.output.push_str(STAR);
            }
        }
        if !self.extglobs.is_empty() && tok.kind != "paren" {
            self.extglobs.last_mut().unwrap().inner.push_str(&tok.value);
        }
        if !tok.value.is_empty() || tok.output.as_deref().is_some_and(|o| !o.is_empty()) {
            let shown = Self::shown(&tok).to_owned();
            self.output.push_str(&shown);
        }
        if self.tok(prev).kind == "text" && tok.kind == "text" {
            let p = self.tok_mut(prev);
            let base = match &p.output {
                Some(o) if !o.is_empty() => o.clone(),
                _ => p.value.clone(),
            };
            p.output = Some(base + &tok.value);
            p.value.push_str(&tok.value);
            return None;
        }
        let mut tok = tok;
        tok.prev = Some(prev);
        self.arena.push(tok);
        let id = self.arena.len() - 1;
        self.tokens.push(id);
        self.prev = id;
        Some(id)
    }

    /// `prev.output.length` where the original reads it as a string (`undefined` never
    /// reaches here: globstar tokens always carry an output).
    fn shown_output_or_empty(t: &Token) -> &str {
        t.output.as_deref().unwrap_or("")
    }

    fn extglob_open(&mut self, kind: &'static str, value: &str) {
        let (_, open, close) = extglob_chars(value);
        let token = Extglob {
            kind,
            close,
            inner: String::new(),
            parens: self.parens,
            output: self.output.clone(),
            start_index: self.index as usize,
            tokens_index: self.tokens.len(),
        };
        self.increment("parens");
        let first = if self.output.is_empty() { ONE_CHAR } else { "" };
        self.push(Token::new(kind, value, Some(first.into())));
        let paren = self.advance();
        let mut t = Token::new("paren", paren, Some(open.into()));
        t.extglob = true;
        self.push(t);
        self.extglobs.push(token);
    }

    fn extglob_close(&mut self, mut token: Extglob, value: &str) -> Result<(), SyntaxError> {
        let idx = self.index as usize;
        let literal: String = self.input[token.start_index..=idx].iter().collect();
        let body: String = self.input[(token.start_index + 2).min(idx)..idx]
            .iter()
            .collect();
        let (risky, safe) = analyze_repeated_extglob(&body);

        if (token.kind == "plus" || token.kind == "star") && risky {
            let safe_output = safe.map(|s| {
                let lead = if token.output.is_empty() {
                    ONE_CHAR
                } else {
                    ""
                };
                format!("{lead}{s}")
            });
            let open = self.tokens[token.tokens_index];
            {
                let o = self.tok_mut(open);
                o.kind = "text";
                o.value = literal.clone();
                o.output = Some(safe_output.unwrap_or_else(|| escape_regex(&literal)));
            }
            for i in token.tokens_index + 1..self.tokens.len() {
                let t = self.tokens[i];
                let t = self.tok_mut(t);
                t.value = String::new();
                t.output = Some(String::new());
                t.suffix = None;
            }
            let open_output = Self::shown_output_or_empty(self.tok(open)).to_owned();
            self.output = token.output.clone() + &open_output;
            self.backtrack = true;
            let mut t = Token::new("paren", value, Some(String::new()));
            t.extglob = true;
            self.push(t);
            self.decrement("parens");
            return Ok(());
        }

        let mut output = token.close.clone();
        if token.kind == "negate" {
            let mut extglob_star = STAR.to_owned();
            if char_len(&token.inner) > 1 && token.inner.contains('/') {
                extglob_star = globstar();
            }
            let rest = self.remaining();
            if extglob_star != STAR
                || self.eos()
                || (!rest.is_empty() && rest.chars().all(|c| c == ')'))
            {
                token.close = format!(")$)){extglob_star}");
                output = token.close.clone();
            }
            if token.inner.contains('*') && !rest.is_empty() && is_dot_extension(&rest) {
                let expression = parse_with(&rest, false)?.output;
                token.close = format!("){expression}){extglob_star})");
                output = token.close.clone();
            }
        }
        let mut t = Token::new("paren", value, Some(output));
        t.extglob = true;
        self.push(t);
        self.decrement("parens");
        Ok(())
    }

    fn negate(&mut self) {
        let mut count = 1;
        while self.peek(1) == Some('!') && (self.peek(2) != Some('(') || self.peek(3) == Some('?'))
        {
            self.advance();
            self.start += 1;
            count += 1;
        }
        if count % 2 == 0 {
            return;
        }
        self.negated = true;
        self.start += 1;
    }
}

/// `/^\.[^\\/.]+$/`.
fn is_dot_extension(rest: &str) -> bool {
    let Some(tail) = rest.strip_prefix('.') else {
        return false;
    };
    !tail.is_empty()
        && !tail
            .chars()
            .any(|c| matches!(c, '\\' | '/' | '.' | '\n' | '\r' | '\u{2028}' | '\u{2029}'))
}

/// `REGEX_NON_SPECIAL_CHARS`: `/^[^@![\].,$*+?^{}()|\\/]+/`.
fn non_special_prefix(rest: &str) -> &str {
    let end = rest
        .char_indices()
        .find(|(_, c)| "@![].,$*+?^{}()|\\/".contains(*c))
        .map_or(rest.len(), |(i, _)| i);
    &rest[..end]
}

/// The fast path inside `parse` for globs with no slash, bracket, brace, paren or quote and
/// no leading `*` or `!`.
fn parse_fast(input: &[char]) -> String {
    let mut out = String::new();
    let mut backslashes = false;
    let mut i = 0;
    while i < input.len() {
        // `/(\\?)((\W)(\3*))/g`
        let (esc, first, start) =
            if input[i] == '\\' && input.get(i + 1).is_some_and(|c| !is_word(*c)) {
                (true, input[i + 1], i + 1)
            } else if !is_word(input[i]) {
                (false, input[i], i)
            } else {
                out.push(input[i]);
                i += 1;
                continue;
            };
        let mut end = start + 1;
        while input.get(end) == Some(&first) {
            end += 1;
        }
        let whole: String = input[i..end].iter().collect();
        let rest = end - start - 1;
        let chars = end - start;
        let replaced = if first == '\\' {
            backslashes = true;
            whole
        } else if first == '?' {
            if esc {
                format!("\\?{}", QMARK.repeat(rest))
            } else if i == 0 {
                // `qmarkNoDot` is `QMARK` with `dot: true`.
                format!("{QMARK}{}", QMARK.repeat(rest))
            } else {
                QMARK.repeat(chars)
            }
        } else if first == '.' {
            DOT_LITERAL.repeat(chars)
        } else if first == '*' {
            if esc {
                format!("\\*{}", if rest > 0 { STAR } else { "" })
            } else {
                STAR.to_owned()
            }
        } else if esc {
            whole
        } else {
            format!("\\{whole}")
        };
        out.push_str(&replaced);
        i = end;
    }
    if backslashes {
        // `output.replace(/\\+/g, m => m.length % 2 === 0 ? '\\\\' : '\\')`
        let mut collapsed = String::new();
        let mut run = 0;
        let flush = |run: &mut usize, collapsed: &mut String| {
            if *run > 0 {
                collapsed.push_str(if (*run).is_multiple_of(2) {
                    "\\\\"
                } else {
                    "\\"
                });
                *run = 0;
            }
        };
        for c in out.chars() {
            if c == '\\' {
                run += 1;
                continue;
            }
            flush(&mut run, &mut collapsed);
            collapsed.push(c);
        }
        flush(&mut run, &mut collapsed);
        out = collapsed;
    }
    out
}

/// `parse(input, { dot: true })`; `fastpaths: false` for the nested parse of a negated
/// extglob's tail.
pub fn parse_with(input: &str, fastpaths: bool) -> Result<Parsed, SyntaxError> {
    let input = replacement(input).unwrap_or(input);
    let len = input.encode_utf16().count();
    if len > MAX_LENGTH {
        return Err(SyntaxError(format!(
            "Input length: {len}, exceeds maximum allowed length: {MAX_LENGTH}"
        )));
    }
    let input = input.strip_prefix("./").unwrap_or(input);
    let chars: Vec<char> = input.chars().collect();

    // Fast path.
    let has_special =
        matches!(chars.first(), Some('*' | '!')) || chars.iter().any(|c| "/()[]{}\"".contains(*c));
    if fastpaths && !has_special {
        let output = parse_fast(&chars);
        return Ok(Parsed {
            output: format!("^(?:{output})$"),
            negated: false,
        });
    }

    let mut p = Parser {
        input: chars,
        index: -1,
        start: 0,
        output: String::new(),
        backtrack: false,
        negated: false,
        brackets: 0,
        braces: 0,
        parens: 0,
        quotes: 0,
        arena: vec![Token::new("bos", "", Some(String::new()))],
        tokens: vec![BOS],
        extglobs: Vec::new(),
        braces_stack: Vec::new(),
        stack: Vec::new(),
        prev: BOS,
    };

    while !p.eos() {
        let mut value = p.advance();
        if value == "\0" {
            continue;
        }

        // Escaped characters.
        if value == "\\" {
            let next = p.peek(1);
            if next == Some('/') || next == Some('.') || next == Some(';') {
                continue;
            }
            if next.is_none() {
                value.push('\\');
                p.push(Token::new("text", value, None));
                continue;
            }
            let rest = p.remaining();
            let slashes = rest.chars().take_while(|c| *c == '\\').count();
            if slashes > 2 {
                p.index += slashes as isize;
                if slashes % 2 != 0 {
                    value.push('\\');
                }
            }
            let next = p.advance();
            value.push_str(&next);
            if p.brackets == 0 {
                p.push(Token::new("text", value, None));
                continue;
            }
        }

        // Inside a character class, until the closing bracket.
        let prev = p.prev;
        if p.brackets > 0 && (value != "]" || p.tok(prev).value == "[" || p.tok(prev).value == "[^")
        {
            if value == ":" {
                let pv = p.tok(prev).value.clone();
                let inner: String = pv.chars().skip(1).collect();
                if inner.contains('[') {
                    p.tok_mut(prev).posix = true;
                    if inner.contains(':') {
                        let idx = pv.rfind('[').unwrap();
                        let pre = &pv[..idx];
                        let rest: String = pv[idx..].chars().skip(2).collect();
                        if let Some(posix) = posix_class(&rest) {
                            p.tok_mut(prev).value = format!("{pre}{posix}");
                            p.backtrack = true;
                            p.advance();
                            let at = p.tokens.iter().position(|&t| t == prev);
                            if p.tok(BOS).output.as_deref().unwrap_or("").is_empty()
                                && at == Some(1)
                            {
                                p.tok_mut(BOS).output = Some(ONE_CHAR.into());
                            }
                            continue;
                        }
                    }
                }
            }
            if (value == "[" && p.peek(1) != Some(':')) || (value == "-" && p.peek(1) == Some(']'))
            {
                value = format!("\\{value}");
            }
            if value == "]" && (p.tok(prev).value == "[" || p.tok(prev).value == "[^") {
                value = format!("\\{value}");
            }
            p.tok_mut(prev).value.push_str(&value);
            p.append_value(&value);
            continue;
        }

        // Inside a quoted string, until the closing quote.
        if p.quotes == 1 && value != "\"" {
            let value = escape_regex(&value);
            p.tok_mut(prev).value.push_str(&value);
            p.append_value(&value);
            continue;
        }

        if value == "\"" {
            p.quotes = if p.quotes == 1 { 0 } else { 1 };
            continue;
        }

        if value == "(" {
            p.increment("parens");
            p.push(Token::new("paren", value, None));
            continue;
        }

        if value == ")" {
            let parens = p.parens;
            if let Some(ext) = p.extglobs.pop_if(|ext| parens == ext.parens + 1) {
                p.extglob_close(ext, &value)?;
                continue;
            }
            let output = if p.parens != 0 { ")" } else { "\\)" };
            p.push(Token::new("paren", value, Some(output.into())));
            p.decrement("parens");
            continue;
        }

        if value == "[" {
            if !p.remaining().contains(']') {
                value = format!("\\{value}");
            } else {
                p.increment("brackets");
            }
            p.push(Token::new("bracket", value, None));
            continue;
        }

        if value == "]" {
            if p.tok(prev).kind == "bracket" && char_len(&p.tok(prev).value) == 1 {
                p.push(Token::new("text", value, Some("\\]".into())));
                continue;
            }
            if p.brackets == 0 {
                p.push(Token::new("text", value, Some("\\]".into())));
                continue;
            }
            p.decrement("brackets");
            let prev_value: String = p.tok(prev).value.chars().skip(1).collect();
            if !p.tok(prev).posix && prev_value.starts_with('^') && !prev_value.contains('/') {
                value = format!("/{value}");
            }
            p.tok_mut(prev).value.push_str(&value);
            p.append_value(&value);
            if has_regex_chars(&prev_value) {
                continue;
            }
            let pv = p.tok(prev).value.clone();
            let escaped = escape_regex(&pv);
            p.output = drop_end(&p.output, char_len(&pv));
            let both = format!("(?:{escaped}|{pv})");
            p.tok_mut(prev).value = both.clone();
            p.output.push_str(&both);
            continue;
        }

        if value == "{" {
            p.increment("braces");
            let mut open = Token::new("brace", value, Some("(".into()));
            open.output_index = char_len(&p.output);
            open.tokens_index = p.tokens.len();
            let id = p.push(open).expect("a brace token is kept");
            p.braces_stack.push(id);
            continue;
        }

        if value == "}" {
            let Some(&brace) = p.braces_stack.last() else {
                p.push(Token::new("text", value.clone(), Some(value)));
                continue;
            };
            let mut output = ")".to_owned();
            if p.tok(brace).dots {
                let arr = p.tokens.clone();
                let mut range: Vec<String> = Vec::new();
                for &t in arr.iter().rev() {
                    p.tokens.pop();
                    if p.tok(t).kind == "brace" {
                        break;
                    }
                    if p.tok(t).kind != "dots" {
                        range.insert(0, p.tok(t).value.clone());
                    }
                }
                output = expand_range(range);
                p.backtrack = true;
            }
            if !p.tok(brace).comma && !p.tok(brace).dots {
                let out = take(&p.output, p.tok(brace).output_index);
                let toks: Vec<usize> =
                    p.tokens[p.tok(brace).tokens_index.min(p.tokens.len())..].to_vec();
                {
                    let b = p.tok_mut(brace);
                    b.value = "\\{".into();
                    b.output = Some("\\{".into());
                }
                value = "\\}".into();
                output = "\\}".into();
                p.output = out;
                for t in toks {
                    let t = p.tok(t);
                    let shown = match &t.output {
                        Some(o) if !o.is_empty() => o.clone(),
                        _ => t.value.clone(),
                    };
                    p.output.push_str(&shown);
                }
            }
            p.push(Token::new("brace", value, Some(output)));
            p.decrement("braces");
            p.braces_stack.pop();
            continue;
        }

        if value == "|" {
            p.push(Token::new("text", value, None));
            continue;
        }

        if value == "," {
            let mut output = value.clone();
            if let Some(&brace) = p.braces_stack.last()
                && p.stack.last() == Some(&"braces")
            {
                p.tok_mut(brace).comma = true;
                output = "|".into();
            }
            p.push(Token::new("comma", value, Some(output)));
            continue;
        }

        if value == "/" {
            if p.tok(prev).kind == "dot" && p.index == p.start as isize + 1 {
                p.start = (p.index + 1) as usize;
                p.output = String::new();
                p.tokens.pop();
                p.prev = BOS;
                continue;
            }
            p.push(Token::new("slash", value, Some(SLASH_LITERAL.into())));
            continue;
        }

        if value == "." {
            if p.braces > 0 && p.tok(prev).kind == "dot" {
                let brace = *p
                    .braces_stack
                    .last()
                    .expect("a dot inside braces has an open brace");
                let t = p.tok_mut(prev);
                if t.value == "." {
                    t.output = Some(DOT_LITERAL.into());
                }
                t.kind = "dots";
                t.output = Some(t.output.clone().unwrap_or_else(|| "undefined".into()) + &value);
                t.value.push_str(&value);
                p.tok_mut(brace).dots = true;
                continue;
            }
            if p.braces + p.parens == 0 && p.tok(prev).kind != "bos" && p.tok(prev).kind != "slash"
            {
                p.push(Token::new("text", value, Some(DOT_LITERAL.into())));
                continue;
            }
            p.push(Token::new("dot", value, Some(DOT_LITERAL.into())));
            continue;
        }

        if value == "?" {
            let is_group = p.tok(prev).value == "(";
            if !is_group && p.peek(1) == Some('(') && p.peek(2) != Some('?') {
                p.extglob_open("qmark", &value);
                continue;
            }
            if p.tok(prev).kind == "paren" {
                let next = p.peek(1);
                let mut output = value.clone();
                let lookaround_next = next.is_some_and(|c| "!=<:".contains(c));
                if (p.tok(prev).value == "(" && !lookaround_next)
                    || (next == Some('<') && !is_lookbehind_or_name(&p.remaining()))
                {
                    output = format!("\\{value}");
                }
                p.push(Token::new("text", value, Some(output)));
                continue;
            }
            p.push(Token::new("qmark", value, Some(QMARK.into())));
            continue;
        }

        if value == "!" {
            if p.peek(1) == Some('(')
                && (p.peek(2) != Some('?') || !p.peek(3).is_some_and(|c| "!=<:".contains(c)))
            {
                p.extglob_open("negate", &value);
                continue;
            }
            if p.index == 0 {
                p.negate();
                continue;
            }
        }

        if value == "+" {
            if p.peek(1) == Some('(') && p.peek(2) != Some('?') {
                p.extglob_open("plus", &value);
                continue;
            }
            if p.tok(prev).value == "(" {
                p.push(Token::new("plus", value, Some(PLUS_LITERAL.into())));
                continue;
            }
            if matches!(p.tok(prev).kind, "bracket" | "paren" | "brace") || p.parens > 0 {
                p.push(Token::new("plus", value, None));
                continue;
            }
            p.push(Token::new("plus", PLUS_LITERAL, None));
            continue;
        }

        if value == "@" {
            if p.peek(1) == Some('(') && p.peek(2) != Some('?') {
                let mut t = Token::new("at", value, Some(String::new()));
                t.extglob = true;
                p.push(t);
                continue;
            }
            p.push(Token::new("text", value, None));
            continue;
        }

        if value != "*" {
            if value == "$" || value == "^" {
                value = format!("\\{value}");
            }
            let rest = p.remaining();
            let more = non_special_prefix(&rest);
            if !more.is_empty() {
                value.push_str(more);
                p.index += char_len(more) as isize;
            }
            p.push(Token::new("text", value, None));
            continue;
        }

        // Stars.
        if p.tok(prev).kind == "globstar" || p.tok(prev).star {
            let t = p.tok_mut(prev);
            t.kind = "star";
            t.star = true;
            t.value.push_str(&value);
            t.output = Some(STAR.into());
            p.backtrack = true;
            continue;
        }

        let mut rest = p.remaining();
        if rest.starts_with('(') && rest.chars().nth(1).is_some_and(|c| c != '?') {
            p.extglob_open("star", &value);
            continue;
        }

        if p.tok(prev).kind == "star" {
            let prior = p.tok(prev).prev.expect("a star follows a token");
            let before = p.tok(prior).prev;
            let prior_kind = p.tok(prior).kind;
            let is_start = prior_kind == "slash" || prior_kind == "bos";
            let after_star = before.is_some_and(|b| matches!(p.tok(b).kind, "star" | "globstar"));
            let is_brace = p.braces > 0 && (prior_kind == "comma" || prior_kind == "brace");
            let is_extglob =
                !p.extglobs.is_empty() && (prior_kind == "pipe" || prior_kind == "paren");
            if !is_start && prior_kind != "paren" && !is_brace && !is_extglob {
                p.push(Token::new("star", value, Some(String::new())));
                continue;
            }

            while rest.starts_with("/**") {
                let after = p.input.get((p.index + 4) as usize).copied();
                if after.is_some_and(|a| a != '/') {
                    break;
                }
                rest = rest.chars().skip(3).collect();
                p.index += 3;
            }

            let prior_prev_kind = p.tok(prior).prev.map(|pp| p.tok(pp).kind);
            if prior_kind == "bos" && p.eos() {
                let t = p.tok_mut(prev);
                t.kind = "globstar";
                t.value.push_str(&value);
                t.output = Some(globstar());
                p.output = globstar();
                continue;
            }

            if prior_kind == "slash" && prior_prev_kind != Some("bos") && !after_star && p.eos() {
                let both = char_len(Parser::opt(&p.tok(prior).output))
                    + char_len(Parser::opt(&p.tok(prev).output));
                p.output = drop_end(&p.output, both);
                let prior_out = format!("(?:{}", Parser::opt(&p.tok(prior).output));
                p.tok_mut(prior).output = Some(prior_out.clone());
                let prev_out = format!("{}|$)", globstar());
                let t = p.tok_mut(prev);
                t.kind = "globstar";
                t.output = Some(prev_out.clone());
                t.value.push_str(&value);
                p.output.push_str(&(prior_out + &prev_out));
                continue;
            }

            if prior_kind == "slash" && prior_prev_kind != Some("bos") && rest.starts_with('/') {
                let end = if rest.chars().nth(1).is_some() {
                    "|$"
                } else {
                    ""
                };
                let both = char_len(Parser::opt(&p.tok(prior).output))
                    + char_len(Parser::opt(&p.tok(prev).output));
                p.output = drop_end(&p.output, both);
                let prior_out = format!("(?:{}", Parser::opt(&p.tok(prior).output));
                p.tok_mut(prior).output = Some(prior_out.clone());
                let prev_out = format!("{}{SLASH_LITERAL}|{SLASH_LITERAL}{end})", globstar());
                let t = p.tok_mut(prev);
                t.kind = "globstar";
                t.output = Some(prev_out.clone());
                t.value.push_str(&value);
                p.output.push_str(&(prior_out + &prev_out));
                p.advance();
                p.push(Token::new("slash", "/", Some(String::new())));
                continue;
            }

            if prior_kind == "bos" && rest.starts_with('/') {
                let out = format!("(?:^|{SLASH_LITERAL}|{}{SLASH_LITERAL})", globstar());
                let t = p.tok_mut(prev);
                t.kind = "globstar";
                t.value.push_str(&value);
                t.output = Some(out.clone());
                p.output = out;
                p.advance();
                p.push(Token::new("slash", "/", Some(String::new())));
                continue;
            }

            let n = char_len(Parser::opt(&p.tok(prev).output));
            p.output = drop_end(&p.output, n);
            let t = p.tok_mut(prev);
            t.kind = "globstar";
            t.output = Some(globstar());
            t.value.push_str(&value);
            p.output.push_str(&globstar());
            continue;
        }

        let token = Token::new("star", value, Some(STAR.into()));
        if p.index == p.start as isize || matches!(p.tok(prev).kind, "slash" | "dot") {
            let guard = if p.tok(prev).kind == "dot" {
                NO_DOT_SLASH
            } else {
                NO_DOTS_SLASH
            };
            let mut add = guard.to_owned();
            if p.peek(1) != Some('*') {
                add.push_str(ONE_CHAR);
            }
            p.output.push_str(&add);
            let t = p.tok_mut(prev);
            t.output = Some(t.output.clone().unwrap_or_else(|| "undefined".into()) + &add);
        }
        p.push(token);
    }

    while p.brackets > 0 {
        p.output = escape_last(&p.output, '[', None);
        p.decrement("brackets");
    }
    while p.parens > 0 {
        p.output = escape_last(&p.output, '(', None);
        p.decrement("parens");
    }
    while p.braces > 0 {
        p.output = escape_last(&p.output, '{', None);
        p.decrement("braces");
    }

    if matches!(p.tok(p.prev).kind, "star" | "bracket") {
        p.push(Token::new(
            "maybe_slash",
            "",
            Some(format!("{SLASH_LITERAL}?")),
        ));
    }

    if p.backtrack {
        let mut out = String::new();
        for &t in &p.tokens {
            let t = p.tok(t);
            out.push_str(Parser::shown(t));
            if let Some(s) = &t.suffix {
                out.push_str(s);
            }
        }
        p.output = out;
    }

    Ok(Parsed {
        output: p.output,
        negated: p.negated,
    })
}

impl Parser {
    fn opt(o: &Option<String>) -> &str {
        o.as_deref().unwrap_or("")
    }
}

/// `/<([!=]|\w+>)/.test(rest)`.
fn is_lookbehind_or_name(rest: &str) -> bool {
    let chars: Vec<char> = rest.chars().collect();
    (0..chars.len()).any(|i| {
        if chars[i] != '<' {
            return false;
        }
        match chars.get(i + 1) {
            Some('!' | '=') => true,
            Some(c) if is_word(*c) => {
                let mut j = i + 1;
                while chars.get(j).is_some_and(|c| is_word(*c)) {
                    j += 1;
                }
                chars.get(j) == Some(&'>')
            }
            _ => false,
        }
    })
}

/// `parse.fastpaths(input, { dot: true })`: `None` when no fast path applies.
pub fn fastpaths(input: &str) -> Result<Option<String>, SyntaxError> {
    let len = input.encode_utf16().count();
    if len > MAX_LENGTH {
        return Err(SyntaxError(format!(
            "Input length: {len}, exceeds maximum allowed length: {MAX_LENGTH}"
        )));
    }
    let input = replacement(input).unwrap_or(input);
    let input = input.strip_prefix("./").unwrap_or(input);
    Ok(create(input).map(|s| format!("{s}{SLASH_LITERAL}?")))
}

fn create(s: &str) -> Option<String> {
    let nodot = NO_DOTS;
    let slash_dot = NO_DOTS_SLASH;
    let g = globstar();
    Some(match s {
        "*" => format!("{nodot}{ONE_CHAR}{STAR}"),
        ".*" => format!("{DOT_LITERAL}{ONE_CHAR}{STAR}"),
        "*.*" => format!("{nodot}{STAR}{DOT_LITERAL}{ONE_CHAR}{STAR}"),
        "*/*" => format!("{nodot}{STAR}{SLASH_LITERAL}{ONE_CHAR}{slash_dot}{STAR}"),
        "**" => format!("{nodot}{g}"),
        "**/*" => format!("(?:{nodot}{g}{SLASH_LITERAL})?{slash_dot}{ONE_CHAR}{STAR}"),
        "**/*.*" => {
            format!("(?:{nodot}{g}{SLASH_LITERAL})?{slash_dot}{STAR}{DOT_LITERAL}{ONE_CHAR}{STAR}")
        }
        "**/.*" => format!("(?:{nodot}{g}{SLASH_LITERAL})?{DOT_LITERAL}{ONE_CHAR}{STAR}"),
        _ => {
            // `/^(.*?)\.(\w+)$/`: `.` stops at line terminators.
            if s.chars()
                .any(|c| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
            {
                return None;
            }
            let dot = s.rfind('.')?;
            let (head, ext) = (&s[..dot], &s[dot + 1..]);
            if ext.is_empty() || !ext.chars().all(is_word) {
                return None;
            }
            let source = create(head)?;
            return Some(format!("{source}{DOT_LITERAL}{ext}"));
        }
    })
}
