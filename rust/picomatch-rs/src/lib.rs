//! picomatch 4 (`node_modules/picomatch`) as HarnessTap calls it: `picomatch(pattern,
//! { dot: true })` on a POSIX platform, in `apm-policy.ts` (`matchPolicyPattern`) and
//! `scanner-ignore.ts`.
//!
//! `parse` turns the glob into the source of a JavaScript regular expression exactly as the
//! original does (the fixture compares the text), and [`regex`] runs that source on
//! `fancy-regex`. Other options (`windows`, `nocase`, `matchBase`, `capture`, ...) are not
//! ported; the app passes none of them.

#![forbid(unsafe_code)]

mod chars;
mod parse;
pub mod regex;

pub use parse::SyntaxError;

/// What `picomatch()` throws.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// `TypeError: Expected pattern to be a non-empty string`.
    EmptyPattern,
    /// A `SyntaxError` from the parser (a pattern longer than 64 KiB).
    Syntax(String),
}

/// `picomatch.makeRe(glob, { dot: true }).source`: `$^` when `new RegExp` throws, as
/// `toRegex` then falls back to `/$^/`.
pub fn make_re_source(glob: &str) -> Result<String, Error> {
    let source = regex_source(glob)?;
    Ok(if regex::compile_js(&source).is_some() {
        escape_source(&source)
    } else {
        "$^".to_owned()
    })
}

/// What `RegExp.prototype.source` prints for a pattern: `/` outside a class and line
/// terminators escaped.
fn escape_source(source: &str) -> String {
    let terminator = |c: char| match c {
        '\n' => Some("n"),
        '\r' => Some("r"),
        '\u{2028}' => Some("u2028"),
        '\u{2029}' => Some("u2029"),
        _ => None,
    };
    let mut out = String::new();
    let mut in_class = false;
    let mut it = source.chars();
    while let Some(c) = it.next() {
        match c {
            '\\' => {
                out.push('\\');
                if let Some(n) = it.next() {
                    match terminator(n) {
                        Some(t) => out.push_str(t),
                        None => out.push(n),
                    }
                }
                continue;
            }
            '[' => in_class = true,
            ']' => in_class = false,
            '/' if !in_class => {
                out.push_str("\\/");
                continue;
            }
            _ => {}
        }
        match terminator(c) {
            Some(t) => {
                out.push('\\');
                out.push_str(t);
            }
            None => out.push(c),
        }
    }
    out
}

/// The source `makeRe` hands to `new RegExp`.
fn regex_source(glob: &str) -> Result<String, Error> {
    if glob.is_empty() {
        return Err(Error::EmptyPattern);
    }
    let mut output = None;
    let mut negated = false;
    if glob.starts_with('.') || glob.starts_with('*') {
        output = parse::fastpaths(glob).map_err(|e| Error::Syntax(e.0))?;
    }
    let output = match output {
        Some(o) => o,
        None => {
            let parsed = parse::parse_with(glob, true).map_err(|e| Error::Syntax(e.0))?;
            negated = parsed.negated;
            parsed.output
        }
    };
    let source = format!("^(?:{output})$");
    Ok(if negated {
        format!("^(?!{source}).*$")
    } else {
        source
    })
}

/// The function `picomatch(glob, { dot: true })` returns.
#[derive(Debug)]
pub struct Matcher {
    glob: String,
    /// `None` where `new RegExp` throws: the original then uses `/$^/`, which matches nothing
    /// but the empty string, and empty input never reaches it.
    regex: Option<fancy_regex::Regex>,
}

impl Matcher {
    pub fn new(glob: &str) -> Result<Self, Error> {
        let source = regex_source(glob)?;
        Ok(Matcher {
            glob: glob.to_owned(),
            regex: regex::compile_js(&source),
        })
    }

    /// `matcher(input)`.
    pub fn is_match(&self, input: &str) -> bool {
        if input.is_empty() {
            return false;
        }
        if input == self.glob {
            return true;
        }
        self.regex
            .as_ref()
            .is_some_and(|r| r.is_match(input).unwrap_or(false))
    }
}

/// `picomatch(glob, { dot: true })(input)`.
pub fn is_match(glob: &str, input: &str) -> Result<bool, Error> {
    Ok(Matcher::new(glob)?.is_match(input))
}
