//! JavaScript regular expression sources (no flags, not Unicode mode) run on `fancy-regex`.
//!
//! The sources come from the parser, but user patterns reach them almost verbatim, so this
//! rewrites the places where the two syntaxes mean different things: `.` (JavaScript stops at
//! four line terminators), `\d`, `\w`, `\s` (ASCII and JavaScript's space set), identity
//! escapes (`\a` is `a`), a lone `{` or `}`, `[` and set operators inside a class, and the
//! empty classes `[]` and `[^]`.

use fancy_regex::Regex;

const SPACES: &str = "\\t\\n\\x0B\\x0C\\r \\x{A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}";

/// `new RegExp(source)`, or `None` where the original would throw (approximately: where the
/// translation does not compile).
pub fn compile_js(source: &str) -> Option<Regex> {
    let translated = translate(source)?;
    fancy_regex::RegexBuilder::new(&translated)
        .backtrack_limit(10_000_000)
        .build()
        .ok()
}

fn push_literal(out: &mut String, c: char) {
    if c.is_ascii_punctuation() || c == ' ' {
        if c == ' ' {
            out.push(' ');
        } else {
            out.push('\\');
            out.push(c);
        }
    } else {
        out.push(c);
    }
}

/// `\d`, `\w`, `\s` and their negations as a class body or a negated class.
fn class_escape(c: char) -> Option<(&'static str, bool)> {
    Some(match c {
        'd' => ("0-9", false),
        'D' => ("0-9", true),
        'w' => ("A-Za-z0-9_", false),
        'W' => ("A-Za-z0-9_", true),
        's' => (SPACES, false),
        'S' => (SPACES, true),
        _ => return None,
    })
}

fn hex(chars: &[char], at: usize, n: usize) -> Option<u32> {
    let digits: String = chars.get(at..at + n)?.iter().collect();
    if digits.chars().all(|c| c.is_ascii_hexdigit()) {
        u32::from_str_radix(&digits, 16).ok()
    } else {
        None
    }
}

/// A character escape shared by both contexts: `(char, chars consumed after the backslash)`.
fn char_escape(chars: &[char], i: usize) -> (char, usize) {
    let c = chars[i];
    match c {
        'n' => ('\n', 1),
        'r' => ('\r', 1),
        't' => ('\t', 1),
        'v' => ('\u{0B}', 1),
        'f' => ('\u{0C}', 1),
        '0' if !chars.get(i + 1).is_some_and(char::is_ascii_digit) => ('\0', 1),
        'x' => match hex(chars, i + 1, 2) {
            Some(v) => (char::from_u32(v).unwrap_or('x'), 3),
            None => ('x', 1),
        },
        'u' => match hex(chars, i + 1, 4).and_then(char::from_u32) {
            Some(v) => (v, 5),
            None => ('u', 1),
        },
        _ => (c, 1),
    }
}

/// `{n}`, `{n,}` or `{n,m}` at `i`.
fn quantifier_len(chars: &[char], i: usize) -> Option<usize> {
    let mut j = i + 1;
    let digits = |j: &mut usize| {
        let s = *j;
        while chars.get(*j).is_some_and(char::is_ascii_digit) {
            *j += 1;
        }
        *j > s
    };
    if !digits(&mut j) {
        return None;
    }
    if chars.get(j) == Some(&',') {
        j += 1;
        digits(&mut j);
    }
    (chars.get(j) == Some(&'}')).then_some(j + 1 - i)
}

fn translate(source: &str) -> Option<String> {
    let chars: Vec<char> = source.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '\\' => {
                let next = *chars.get(i + 1)?;
                if let Some((body, negated)) = class_escape(next) {
                    out.push_str(&format!("[{}{body}]", if negated { "^" } else { "" }));
                    i += 2;
                } else if next.is_ascii_digit() && next != '0' {
                    // A back reference.
                    out.push('\\');
                    out.push(next);
                    i += 2;
                } else if next == 'b' || next == 'B' {
                    // JavaScript's word boundary is ASCII.
                    const W: &str = "[A-Za-z0-9_]";
                    out.push_str(&if next == 'b' {
                        format!("(?:(?<={W})(?!{W})|(?<!{W})(?={W}))")
                    } else {
                        format!("(?:(?<={W})(?={W})|(?<!{W})(?!{W}))")
                    });
                    i += 2;
                } else {
                    let (ch, used) = char_escape(&chars, i + 1);
                    push_literal(&mut out, ch);
                    i += 1 + used;
                }
            }
            // An empty group: `fancy-regex` will not repeat one, JavaScript will.
            '(' if chars.get(i + 1..i + 4) == Some(&['?', ':', ')']) => {
                out.push_str("(?:a{0})");
                i += 4;
            }
            '(' if chars.get(i + 1) == Some(&')') => {
                out.push_str("(a{0})");
                i += 2;
            }
            '.' => {
                out.push_str("[^\\n\\r\\x{2028}\\x{2029}]");
                i += 1;
            }
            '{' => match quantifier_len(&chars, i) {
                Some(n) => {
                    out.extend(&chars[i..i + n]);
                    i += n;
                    if chars.get(i) == Some(&'?') {
                        out.push('?');
                        i += 1;
                    }
                    if matches!(chars.get(i), Some('*' | '+' | '?'))
                        || (chars.get(i) == Some(&'{') && quantifier_len(&chars, i).is_some())
                    {
                        return None;
                    }
                }
                None => {
                    out.push_str("\\{");
                    i += 1;
                }
            },
            '}' => {
                out.push_str("\\}");
                i += 1;
            }
            ']' => {
                out.push_str("\\]");
                i += 1;
            }
            '[' => {
                i += 1;
                let negated = chars.get(i) == Some(&'^');
                if negated {
                    i += 1;
                }
                if chars.get(i) == Some(&']') {
                    out.push_str(if negated {
                        "[\\x{0}-\\x{10FFFF}]"
                    } else {
                        "[^\\x{0}-\\x{10FFFF}]"
                    });
                    i += 1;
                    continue;
                }
                out.push('[');
                if negated {
                    out.push('^');
                }
                // The class body as atoms: a char, or a class escape (`\\d`, ...).
                enum Atom {
                    Char(char),
                    Class(&'static str, bool),
                }
                let mut atoms: Vec<Atom> = Vec::new();
                // Which atoms were written without a backslash (only those can be a range dash).
                let mut raw: Vec<bool> = Vec::new();
                loop {
                    let c = *chars.get(i)?;
                    i += 1;
                    match c {
                        ']' => break,
                        '\\' => {
                            raw.push(false);
                            let next = *chars.get(i)?;
                            if let Some((body, negated)) = class_escape(next) {
                                atoms.push(Atom::Class(body, negated));
                                i += 1;
                            } else if next == 'b' {
                                atoms.push(Atom::Char('\u{08}'));
                                i += 1;
                            } else {
                                let (ch, used) = char_escape(&chars, i);
                                atoms.push(Atom::Char(ch));
                                i += used;
                            }
                        }
                        c => {
                            raw.push(true);
                            atoms.push(Atom::Char(c));
                        }
                    }
                }
                let lit = |out: &mut String, c: char| {
                    if c.is_ascii_punctuation() {
                        out.push('\\');
                    }
                    out.push(c);
                };
                let mut k = 0;
                while k < atoms.len() {
                    // `a-b`, unless the dash is last; a class escape on either side makes the
                    // dash literal (Annex B).
                    let dash = matches!(atoms.get(k + 1), Some(Atom::Char('-')))
                        && raw[k + 1]
                        && k + 2 < atoms.len();
                    match (&atoms[k], dash) {
                        (Atom::Char(a), true) => match &atoms[k + 2] {
                            Atom::Char(b) => {
                                if a > b {
                                    return None;
                                }
                                lit(&mut out, *a);
                                out.push('-');
                                lit(&mut out, *b);
                                k += 3;
                                continue;
                            }
                            Atom::Class(..) => {
                                lit(&mut out, *a);
                                k += 1;
                                continue;
                            }
                        },
                        (Atom::Char(a), false) => lit(&mut out, *a),
                        (Atom::Class(body, negated), _) => {
                            if *negated {
                                out.push_str(&format!("[^{body}]"));
                            } else {
                                out.push_str(body);
                            }
                        }
                    }
                    k += 1;
                }
                out.push(']');
            }
            '*' | '+' | '?' => {
                out.push(c);
                i += 1;
                if chars.get(i) == Some(&'?') {
                    out.push('?');
                    i += 1;
                }
                // JavaScript has no possessive or stacked quantifiers: "Nothing to repeat".
                if matches!(chars.get(i), Some('*' | '+' | '?'))
                    || (chars.get(i) == Some(&'{') && quantifier_len(&chars, i).is_some())
                {
                    return None;
                }
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    Some(out)
}
