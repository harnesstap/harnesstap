//! `internal/re.js`: the regular expressions, built from the same source text and passed through
//! the same `makeSafeRegex` rewrite, then translated to the `regex` crate's syntax (`\s` is
//! JavaScript's white space set, `\d` is ASCII).

use regex::{Regex, RegexBuilder};
use std::sync::LazyLock;

const MAX_LENGTH: usize = 256;
const MAX_SAFE_COMPONENT_LENGTH: usize = 16;
const MAX_SAFE_BUILD_LENGTH: usize = MAX_LENGTH - 6;
const LETTERDASHNUMBER: &str = "[a-zA-Z0-9-]";

/// JavaScript's `\s` (and what `String.prototype.trim` removes).
pub(crate) fn is_js_space(c: char) -> bool {
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

const JS_SPACE_CLASS: &str = r"[\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";

/// `String.prototype.trim`.
pub(crate) fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

fn make_safe(value: &str) -> String {
    let mut value = value.to_owned();
    for (token, max) in [
        (r"\s", 1),
        (r"\d", MAX_LENGTH),
        (LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH),
    ] {
        value = value
            .split(&format!("{token}*"))
            .collect::<Vec<_>>()
            .join(&format!("{token}{{0,{max}}}"));
        value = value
            .split(&format!("{token}+"))
            .collect::<Vec<_>>()
            .join(&format!("{token}{{1,{max}}}"));
    }
    value
}

fn translate(js: &str) -> String {
    js.replace(r"\s", JS_SPACE_CLASS).replace(r"\d", "[0-9]")
}

fn compile(js: &str) -> Regex {
    RegexBuilder::new(&translate(&make_safe(js)))
        .size_limit(1 << 30)
        .dfa_size_limit(1 << 28)
        .build()
        .unwrap_or_else(|e| panic!("semver regex {js}: {e}"))
}

pub(crate) struct Src {
    pub prerelease: String,
    pub build: String,
    pub fullplain: String,
    pub looseplain: String,
    pub gtlt: String,
    pub xrangeplain: String,
    pub xrangeplainloose: String,
    pub coerceplain: String,
    pub lonetilde: String,
    pub lonecaret: String,
}

pub(crate) static SRC: LazyLock<Src> = LazyLock::new(|| {
    let numericidentifier = r"0|[1-9]\d*".to_owned();
    let numericidentifierloose = r"\d+".to_owned();
    let nonnumericidentifier = format!(r"\d*[a-zA-Z-]{LETTERDASHNUMBER}*");
    let mainversion =
        format!(r"({numericidentifier})\.({numericidentifier})\.({numericidentifier})");
    let mainversionloose = format!(
        r"({numericidentifierloose})\.({numericidentifierloose})\.({numericidentifierloose})"
    );
    let prereleaseidentifier = format!("(?:{nonnumericidentifier}|{numericidentifier})");
    let prereleaseidentifierloose = format!("(?:{nonnumericidentifier}|{numericidentifierloose})");
    let prerelease = format!(r"(?:-({prereleaseidentifier}(?:\.{prereleaseidentifier})*))");
    let prereleaseloose =
        format!(r"(?:-?({prereleaseidentifierloose}(?:\.{prereleaseidentifierloose})*))");
    let buildidentifier = format!("{LETTERDASHNUMBER}+");
    let build = format!(r"(?:\+({buildidentifier}(?:\.{buildidentifier})*))");
    let fullplain = format!("v?{mainversion}{prerelease}?{build}?");
    let looseplain = format!(r"[v=\s]*{mainversionloose}{prereleaseloose}?{build}?");
    let gtlt = "((?:<|>)?=?)".to_owned();
    let xrangeidentifierloose = format!(r"{numericidentifierloose}|x|X|\*");
    let xrangeidentifier = format!(r"{numericidentifier}|x|X|\*");
    let xrangeplain = format!(
        r"[v=\s]*({xrangeidentifier})(?:\.({xrangeidentifier})(?:\.({xrangeidentifier})(?:{prerelease})?{build}?)?)?"
    );
    let xrangeplainloose = format!(
        r"[v=\s]*({xrangeidentifierloose})(?:\.({xrangeidentifierloose})(?:\.({xrangeidentifierloose})(?:{prereleaseloose})?{build}?)?)?"
    );
    let n = MAX_SAFE_COMPONENT_LENGTH;
    let coerceplain = format!(r"(^|[^\d])(\d{{1,{n}}})(?:\.(\d{{1,{n}}}))?(?:\.(\d{{1,{n}}}))?");
    Src {
        prerelease,
        build,
        fullplain,
        looseplain,
        gtlt,
        xrangeplain,
        xrangeplainloose,
        coerceplain,
        lonetilde: "(?:~>?)".to_owned(),
        lonecaret: r"(?:\^)".to_owned(),
    }
});

pub(crate) struct Re {
    pub build: Regex,
    pub full: Regex,
    pub loose: Regex,
    pub xrange: Regex,
    pub xrangeloose: Regex,
    pub coerce: Regex,
    pub coercefull: Regex,
    pub tildetrim: Regex,
    pub tilde: Regex,
    pub tildeloose: Regex,
    pub carettrim: Regex,
    pub caret: Regex,
    pub caretloose: Regex,
    pub comparatorloose: Regex,
    pub comparator: Regex,
    pub comparatortrim: Regex,
    pub hyphenrange: Regex,
    pub hyphenrangeloose: Regex,
    pub star: Regex,
    pub gte0: Regex,
    pub gte0pre: Regex,
    pub spaces: Regex,
}

pub(crate) static RE: LazyLock<Re> = LazyLock::new(|| {
    let s = &*SRC;
    Re {
        build: compile(&s.build),
        full: compile(&format!("^{}$", s.fullplain)),
        loose: compile(&format!("^{}$", s.looseplain)),
        xrange: compile(&format!(r"^{}\s*{}$", s.gtlt, s.xrangeplain)),
        xrangeloose: compile(&format!(r"^{}\s*{}$", s.gtlt, s.xrangeplainloose)),
        coerce: compile(&format!(r"{}(?:$|[^\d])", s.coerceplain)),
        coercefull: compile(&format!(
            r"{}(?:{})?(?:{})?(?:$|[^\d])",
            s.coerceplain, s.prerelease, s.build
        )),
        tildetrim: compile(&format!(r"(\s*){}\s+", s.lonetilde)),
        tilde: compile(&format!("^{}{}$", s.lonetilde, s.xrangeplain)),
        tildeloose: compile(&format!("^{}{}$", s.lonetilde, s.xrangeplainloose)),
        carettrim: compile(&format!(r"(\s*){}\s+", s.lonecaret)),
        caret: compile(&format!("^{}{}$", s.lonecaret, s.xrangeplain)),
        caretloose: compile(&format!("^{}{}$", s.lonecaret, s.xrangeplainloose)),
        comparatorloose: compile(&format!(r"^{}\s*({})$|^$", s.gtlt, s.looseplain)),
        comparator: compile(&format!(r"^{}\s*({})$|^$", s.gtlt, s.fullplain)),
        comparatortrim: compile(&format!(
            r"(\s*){}\s*({}|{})",
            s.gtlt, s.looseplain, s.xrangeplain
        )),
        hyphenrange: compile(&format!(
            r"^\s*({})\s+-\s+({})\s*$",
            s.xrangeplain, s.xrangeplain
        )),
        hyphenrangeloose: compile(&format!(
            r"^\s*({})\s+-\s+({})\s*$",
            s.xrangeplainloose, s.xrangeplainloose
        )),
        star: compile(r"(<|>)?=?\s*\*"),
        gte0: compile(r"^\s*>=\s*0\.0\.0\s*$"),
        gte0pre: compile(r"^\s*>=\s*0\.0\.0-0\s*$"),
        // `SPACE_CHARACTERS` and `split(/\s+/)`: not a semver token, so not made safe.
        spaces: RegexBuilder::new(&format!("{JS_SPACE_CLASS}+"))
            .build()
            .unwrap_or_else(|e| panic!("{e}")),
    }
});

/// `s.split(/\s+/)`.
pub(crate) fn split_spaces(s: &str) -> Vec<&str> {
    RE.spaces.split(s).collect()
}
