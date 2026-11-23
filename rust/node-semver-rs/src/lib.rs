//! The npm `semver` package (7.8.0) as HarnessTap calls it. A port of `classes/semver.js`,
//! `classes/comparator.js`, `classes/range.js` and the functions the app imports, recorded against
//! the real package by `tests/make-fixtures.mjs`.
//!
//! Numbers are JavaScript numbers (`f64`), so `+M + 1` on a long numeric identifier rounds and
//! prints the way V8 does. Errors are the package's `TypeError` messages, as `"TypeError: ..."`.

#![forbid(unsafe_code)]

mod re;

use re::{RE, js_trim, split_spaces};

const MAX_LENGTH: usize = 256;
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// The options object: `loose` and `includePrerelease`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Options {
    pub loose: bool,
    pub include_prerelease: bool,
}

impl Options {
    pub const STRICT: Options = Options {
        loose: false,
        include_prerelease: false,
    };
    pub const INCLUDE_PRERELEASE: Options = Options {
        loose: false,
        include_prerelease: true,
    };
    pub const LOOSE: Options = Options {
        loose: true,
        include_prerelease: false,
    };
}

fn type_error(msg: impl std::fmt::Display) -> String {
    format!("TypeError: {msg}")
}

/// `String(n)` for a JavaScript number.
pub fn js_number(n: f64) -> String {
    if n == 0.0 {
        return "0".to_owned();
    }
    if n.is_nan() {
        return "NaN".to_owned();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    if n.abs() < 1e21 && n.abs() >= 1e-6 {
        return format!("{n}");
    }
    let s = format!("{n:e}");
    match s.split_once('e') {
        Some((m, e)) if !e.starts_with('-') => format!("{m}e+{e}"),
        _ => s,
    }
}

/// `+s` for a string of ASCII digits.
fn to_number(s: &str) -> f64 {
    s.parse::<f64>().unwrap_or(f64::NAN)
}

/// A prerelease identifier: a number below `MAX_SAFE_INTEGER`, or a string.
#[derive(Clone, Debug, PartialEq)]
pub enum Identifier {
    Num(f64),
    Str(String),
}

impl std::fmt::Display for Identifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Identifier::Num(n) => f.write_str(&js_number(*n)),
            Identifier::Str(s) => f.write_str(s),
        }
    }
}

fn is_numeric(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// `compareIdentifiers` from `internal/identifiers.js`.
fn compare_identifiers(a: &Identifier, b: &Identifier) -> i32 {
    fn num_cmp(a: f64, b: f64) -> i32 {
        if a == b {
            0
        } else if a < b {
            -1
        } else {
            1
        }
    }
    if let (Identifier::Num(a), Identifier::Num(b)) = (a, b) {
        return num_cmp(*a, *b);
    }
    let (sa, sb) = (a.to_string(), b.to_string());
    let (anum, bnum) = (is_numeric(&sa), is_numeric(&sb));
    if anum && bnum {
        return num_cmp(to_number(&sa), to_number(&sb));
    }
    if sa == sb {
        0
    } else if anum && !bnum {
        -1
    } else if bnum && !anum {
        1
    } else if sa.encode_utf16().lt(sb.encode_utf16()) {
        -1
    } else {
        1
    }
}

/// `classes/semver.js`.
#[derive(Clone, Debug, PartialEq)]
pub struct SemVer {
    pub raw: String,
    pub major: f64,
    pub minor: f64,
    pub patch: f64,
    pub prerelease: Vec<Identifier>,
    pub build: Vec<String>,
    pub version: String,
    pub loose: bool,
    pub include_prerelease: bool,
}

impl SemVer {
    /// `new SemVer(version, options)` for a string.
    pub fn parse(version: &str, options: Options) -> Result<SemVer, String> {
        if version.encode_utf16().count() > MAX_LENGTH {
            return Err(type_error(format!(
                "version is longer than {MAX_LENGTH} characters"
            )));
        }
        let re = if options.loose { &RE.loose } else { &RE.full };
        let Some(m) = re.captures(js_trim(version)) else {
            return Err(type_error(format!("Invalid Version: {version}")));
        };
        let group = |i: usize| m.get(i).map(|g| g.as_str());
        let major = to_number(group(1).unwrap_or(""));
        let minor = to_number(group(2).unwrap_or(""));
        let patch = to_number(group(3).unwrap_or(""));
        for (value, name) in [(major, "major"), (minor, "minor"), (patch, "patch")] {
            if value > MAX_SAFE_INTEGER || value < 0.0 {
                return Err(type_error(format!("Invalid {name} version")));
            }
        }
        let prerelease = match group(4) {
            Some(pr) if !pr.is_empty() => pr
                .split('.')
                .map(|id| {
                    if is_numeric(id) {
                        let num = to_number(id);
                        if (0.0..MAX_SAFE_INTEGER).contains(&num) {
                            return Identifier::Num(num);
                        }
                    }
                    Identifier::Str(id.to_owned())
                })
                .collect(),
            _ => Vec::new(),
        };
        let build = match group(5) {
            Some(b) if !b.is_empty() => b.split('.').map(str::to_owned).collect(),
            _ => Vec::new(),
        };
        let mut v = SemVer {
            raw: version.to_owned(),
            major,
            minor,
            patch,
            prerelease,
            build,
            version: String::new(),
            loose: options.loose,
            include_prerelease: options.include_prerelease,
        };
        v.format();
        Ok(v)
    }

    /// `new SemVer(instance, options)`: the same instance when the flags match, else a re-parse of
    /// its `version`.
    pub fn with_options(&self, options: Options) -> Result<SemVer, String> {
        if self.loose == options.loose && self.include_prerelease == options.include_prerelease {
            Ok(self.clone())
        } else {
            SemVer::parse(&self.version, options)
        }
    }

    fn options(&self) -> Options {
        Options {
            loose: self.loose,
            include_prerelease: self.include_prerelease,
        }
    }

    /// `format()`.
    pub fn format(&mut self) -> String {
        let mut version = format!(
            "{}.{}.{}",
            js_number(self.major),
            js_number(self.minor),
            js_number(self.patch)
        );
        if !self.prerelease.is_empty() {
            let pre: Vec<String> = self.prerelease.iter().map(ToString::to_string).collect();
            version.push('-');
            version.push_str(&pre.join("."));
        }
        self.version = version.clone();
        version
    }

    /// `compare(other)` with a `SemVer` argument.
    pub fn compare(&self, other: &SemVer) -> i32 {
        if other.version == self.version {
            return 0;
        }
        match self.compare_main(other) {
            0 => self.compare_pre(other),
            n => n,
        }
    }

    /// `compare(other)` with a string argument.
    pub fn compare_str(&self, other: &str) -> Result<i32, String> {
        if other == self.version {
            return Ok(0);
        }
        Ok(self.compare(&SemVer::parse(other, self.options())?))
    }

    fn compare_main(&self, other: &SemVer) -> i32 {
        for (a, b) in [
            (self.major, other.major),
            (self.minor, other.minor),
            (self.patch, other.patch),
        ] {
            if a < b {
                return -1;
            }
            if a > b {
                return 1;
            }
        }
        0
    }

    fn compare_pre(&self, other: &SemVer) -> i32 {
        match (self.prerelease.is_empty(), other.prerelease.is_empty()) {
            (false, true) => return -1,
            (true, false) => return 1,
            (true, true) => return 0,
            (false, false) => {}
        }
        compare_lists(&self.prerelease, &other.prerelease)
    }

    fn compare_build(&self, other: &SemVer) -> i32 {
        let a: Vec<Identifier> = self.build.iter().cloned().map(Identifier::Str).collect();
        let b: Vec<Identifier> = other.build.iter().cloned().map(Identifier::Str).collect();
        compare_lists(&a, &b)
    }
}

fn compare_lists(a: &[Identifier], b: &[Identifier]) -> i32 {
    let mut i = 0;
    loop {
        match (a.get(i), b.get(i)) {
            (None, None) => return 0,
            (Some(_), None) => return 1,
            (None, Some(_)) => return -1,
            (Some(x), Some(y)) if x == y => {}
            (Some(x), Some(y)) => return compare_identifiers(x, y),
        }
        i += 1;
    }
}

/// A version argument: a string, or an already-parsed `SemVer`.
#[derive(Clone, Copy, Debug)]
pub enum Version<'a> {
    Str(&'a str),
    Parsed(&'a SemVer),
}

impl<'a> From<&'a str> for Version<'a> {
    fn from(s: &'a str) -> Self {
        Version::Str(s)
    }
}

impl<'a> From<&'a String> for Version<'a> {
    fn from(s: &'a String) -> Self {
        Version::Str(s)
    }
}

impl<'a> From<&'a SemVer> for Version<'a> {
    fn from(v: &'a SemVer) -> Self {
        Version::Parsed(v)
    }
}

impl Version<'_> {
    /// `new SemVer(this, options)`.
    fn semver(self, options: Options) -> Result<SemVer, String> {
        match self {
            Version::Str(s) => SemVer::parse(s, options),
            Version::Parsed(v) => v.with_options(options),
        }
    }
}

/// `semver.parse(version, options)`.
pub fn parse<'a>(version: impl Into<Version<'a>>, options: Options) -> Option<SemVer> {
    match version.into() {
        Version::Parsed(v) => Some(v.clone()),
        Version::Str(s) => SemVer::parse(s, options).ok(),
    }
}

/// `semver.valid(version, options)`.
pub fn valid<'a>(version: impl Into<Version<'a>>, options: Options) -> Option<String> {
    parse(version, options).map(|v| v.version)
}

/// `semver.compare(a, b, options)`.
pub fn compare<'a, 'b>(
    a: impl Into<Version<'a>>,
    b: impl Into<Version<'b>>,
    options: Options,
) -> Result<i32, String> {
    let a = a.into().semver(options)?;
    let b = b.into().semver(options)?;
    Ok(a.compare(&b))
}

/// `semver.rcompare(a, b, options)`.
pub fn rcompare<'a, 'b>(
    a: impl Into<Version<'a>>,
    b: impl Into<Version<'b>>,
    options: Options,
) -> Result<i32, String> {
    compare(b, a, options)
}

/// `semver.compareBuild(a, b, options)`.
pub fn compare_build<'a, 'b>(
    a: impl Into<Version<'a>>,
    b: impl Into<Version<'b>>,
    options: Options,
) -> Result<i32, String> {
    let a = a.into().semver(options)?;
    let b = b.into().semver(options)?;
    Ok(match a.compare(&b) {
        0 => a.compare_build(&b),
        n => n,
    })
}

macro_rules! relation {
    ($(#[$doc:meta])* $name:ident, $test:expr) => {
        $(#[$doc])*
        pub fn $name<'a, 'b>(
            a: impl Into<Version<'a>>,
            b: impl Into<Version<'b>>,
            options: Options,
        ) -> Result<bool, String> {
            let test: fn(i32) -> bool = $test;
            Ok(test(compare(a, b, options)?))
        }
    };
}

relation!(
    /// `semver.eq`.
    eq,
    |n| n == 0
);
relation!(
    /// `semver.neq`.
    neq,
    |n| n != 0
);
relation!(
    /// `semver.gt`.
    gt,
    |n| n > 0
);
relation!(
    /// `semver.gte`.
    gte,
    |n| n >= 0
);
relation!(
    /// `semver.lt`.
    lt,
    |n| n < 0
);
relation!(
    /// `semver.lte`.
    lte,
    |n| n <= 0
);

/// `semver.major(version, options)`.
pub fn major<'a>(version: impl Into<Version<'a>>, options: Options) -> Result<f64, String> {
    Ok(version.into().semver(options)?.major)
}

/// `semver.prerelease(version, options)`.
pub fn prerelease<'a>(
    version: impl Into<Version<'a>>,
    options: Options,
) -> Option<Vec<Identifier>> {
    parse(version, options)
        .map(|v| v.prerelease)
        .filter(|p| !p.is_empty())
}

/// `semver.rsort(list, options)`: a stable sort by `compareBuild(b, a)`. An invalid version makes
/// the original throw.
pub fn rsort(list: &mut [String], options: Options) -> Result<(), String> {
    let mut parsed = Vec::with_capacity(list.len());
    for v in list.iter() {
        parsed.push((SemVer::parse(v, options)?, v.clone()));
    }
    parsed.sort_by(|(a, _), (b, _)| {
        let n = match b.compare(a) {
            0 => b.compare_build(a),
            n => n,
        };
        n.cmp(&0)
    });
    for (slot, (_, v)) in list.iter_mut().zip(parsed) {
        *slot = v;
    }
    Ok(())
}

/// `semver.coerce(version, options)` (left to right; `rtl` is not ported).
pub fn coerce(version: &str, options: Options) -> Option<SemVer> {
    let re = if options.include_prerelease {
        &RE.coercefull
    } else {
        &RE.coerce
    };
    let m = re.captures(version)?;
    let group = |i: usize| m.get(i).map(|g| g.as_str()).filter(|s| !s.is_empty());
    let major = group(2).unwrap_or("");
    let minor = group(3).unwrap_or("0");
    let patch = group(4).unwrap_or("0");
    let pre = match group(5) {
        Some(p) if options.include_prerelease => format!("-{p}"),
        _ => String::new(),
    };
    let build = match group(6) {
        Some(b) if options.include_prerelease => format!("+{b}"),
        _ => String::new(),
    };
    parse(
        format!("{major}.{minor}.{patch}{pre}{build}").as_str(),
        options,
    )
}

/// `classes/comparator.js`. `semver` is `None` for `Comparator.ANY`.
#[derive(Clone, Debug, PartialEq)]
pub struct Comparator {
    pub operator: String,
    pub semver: Option<SemVer>,
    pub value: String,
    pub options: Options,
}

impl Comparator {
    pub fn parse(comp: &str, options: Options) -> Result<Comparator, String> {
        let comp = split_spaces(js_trim(comp)).join(" ");
        let re = if options.loose {
            &RE.comparatorloose
        } else {
            &RE.comparator
        };
        let Some(m) = re.captures(&comp) else {
            return Err(type_error(format!("Invalid comparator: {comp}")));
        };
        let mut operator = m.get(1).map(|g| g.as_str().to_owned()).unwrap_or_default();
        if operator == "=" {
            operator.clear();
        }
        // `new SemVer(m[2], this.options.loose)`: a boolean, so `includePrerelease` is dropped.
        let semver = match m.get(2).map(|g| g.as_str()).filter(|s| !s.is_empty()) {
            None => None,
            Some(v) => Some(SemVer::parse(
                v,
                Options {
                    loose: options.loose,
                    include_prerelease: false,
                },
            )?),
        };
        let value = match &semver {
            None => String::new(),
            Some(v) => format!("{operator}{}", v.version),
        };
        Ok(Comparator {
            operator,
            semver,
            value,
            options,
        })
    }

    /// `test(version)` for a parsed version.
    pub fn test(&self, version: &SemVer) -> Result<bool, String> {
        let Some(semver) = &self.semver else {
            return Ok(true);
        };
        cmp(version, &self.operator, semver, self.options)
    }
}

/// `semver.cmp(a, op, b, options)` for the comparator operators.
fn cmp(a: &SemVer, op: &str, b: &SemVer, options: Options) -> Result<bool, String> {
    match op {
        "" | "=" | "==" => eq(a, b, options),
        "!=" => neq(a, b, options),
        ">" => gt(a, b, options),
        ">=" => gte(a, b, options),
        "<" => lt(a, b, options),
        "<=" => lte(a, b, options),
        "===" => Ok(a.version == b.version),
        "!==" => Ok(a.version != b.version),
        _ => Err(type_error(format!("Invalid operator: {op}"))),
    }
}

/// `classes/range.js`.
#[derive(Clone, Debug, PartialEq)]
pub struct Range {
    pub raw: String,
    pub set: Vec<Vec<Comparator>>,
    pub options: Options,
}

fn is_null_set(c: &Comparator) -> bool {
    c.value == "<0.0.0-0"
}

fn is_any(c: &Comparator) -> bool {
    c.value.is_empty()
}

impl Range {
    pub fn parse(range: &str, options: Options) -> Result<Range, String> {
        let raw = RE.spaces.replace_all(js_trim(range), " ").into_owned();
        let mut set = Vec::new();
        for part in raw.split("||") {
            let comps = parse_range(js_trim(part), options)?;
            if !comps.is_empty() {
                set.push(comps);
            }
        }
        if set.is_empty() {
            return Err(type_error(format!("Invalid SemVer Range: {raw}")));
        }
        if set.len() > 1 {
            let first = set[0].clone();
            set.retain(|c| !is_null_set(&c[0]));
            if set.is_empty() {
                set = vec![first];
            } else if set.len() > 1
                && let Some(any) = set.iter().find(|c| c.len() == 1 && is_any(&c[0]))
            {
                set = vec![any.clone()];
            }
        }
        Ok(Range { raw, set, options })
    }

    /// The `range` getter.
    pub fn range(&self) -> String {
        self.set
            .iter()
            .map(|comps| {
                comps
                    .iter()
                    .map(|c| js_trim(&c.value).to_owned())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .collect::<Vec<_>>()
            .join("||")
    }

    /// `test(version)`.
    pub fn test<'a>(&self, version: impl Into<Version<'a>>) -> Result<bool, String> {
        let version = match version.into() {
            Version::Str("") => return Ok(false),
            Version::Str(s) => match SemVer::parse(s, self.options) {
                Ok(v) => v,
                Err(_) => return Ok(false),
            },
            Version::Parsed(v) => v.clone(),
        };
        for comps in &self.set {
            if test_set(comps, &version, self.options)? {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

fn test_set(set: &[Comparator], version: &SemVer, options: Options) -> Result<bool, String> {
    for c in set {
        if !c.test(version)? {
            return Ok(false);
        }
    }
    if !version.prerelease.is_empty() && !options.include_prerelease {
        for c in set {
            let Some(allowed) = &c.semver else {
                continue;
            };
            if !allowed.prerelease.is_empty()
                && allowed.major == version.major
                && allowed.minor == version.minor
                && allowed.patch == version.patch
            {
                return Ok(true);
            }
        }
        return Ok(false);
    }
    Ok(true)
}

/// `parseRange(range)`.
fn parse_range(range: &str, options: Options) -> Result<Vec<Comparator>, String> {
    let loose = options.loose;
    let hr = if loose {
        &RE.hyphenrangeloose
    } else {
        &RE.hyphenrange
    };
    let range = match hr.captures(range) {
        Some(m) => hyphen_replace(&m, options.include_prerelease),
        None => range.to_owned(),
    };
    let range = RE.comparatortrim.replace_all(&range, "${1}${2}${3}");
    let range = RE.tildetrim.replace_all(&range, "${1}~");
    let range = RE.carettrim.replace_all(&range, "${1}^");
    let joined = range
        .split(' ')
        .map(|c| parse_comparator(c, options))
        .collect::<Vec<_>>()
        .join(" ");
    let mut list: Vec<String> = split_spaces(&joined)
        .into_iter()
        .map(|c| replace_gte0(c, options))
        .collect();
    if loose {
        list.retain(|c| RE.comparatorloose.is_match(c));
    }
    let comparators = list
        .iter()
        .map(|c| Comparator::parse(c, options))
        .collect::<Result<Vec<_>, _>>()?;
    let mut map: Vec<Comparator> = Vec::new();
    for comp in comparators {
        if is_null_set(&comp) {
            return Ok(vec![comp]);
        }
        match map.iter_mut().find(|c| c.value == comp.value) {
            Some(slot) => *slot = comp,
            None => map.push(comp),
        }
    }
    if map.len() > 1 {
        map.retain(|c| !c.value.is_empty());
    }
    Ok(map)
}

fn is_x(id: Option<&str>) -> bool {
    match id {
        None | Some("") => true,
        Some(id) => id.to_lowercase() == "x" || id == "*",
    }
}

/// `+s + 1`, printed.
fn plus_one(s: Option<&str>) -> String {
    js_number(to_number(s.unwrap_or("")) + 1.0)
}

fn undef(s: Option<&str>) -> &str {
    s.unwrap_or("undefined")
}

fn hyphen_replace(m: &regex::Captures<'_>, inc_pr: bool) -> String {
    let g = |i: usize| m.get(i).map(|g| g.as_str());
    let (from, f_m, f_mi, f_p, f_pr) = (g(1), g(2), g(3), g(4), g(5));
    let (to, t_m, t_mi, t_p, t_pr) = (g(7), g(8), g(9), g(10), g(11));
    let pre = if inc_pr { "-0" } else { "" };
    let from = if is_x(f_m) {
        String::new()
    } else if is_x(f_mi) {
        format!(">={}.0.0{pre}", undef(f_m))
    } else if is_x(f_p) {
        format!(">={}.{}.0{pre}", undef(f_m), undef(f_mi))
    } else if f_pr.is_some_and(|s| !s.is_empty()) {
        format!(">={}", undef(from))
    } else {
        format!(">={}{pre}", undef(from))
    };
    let to = if is_x(t_m) {
        String::new()
    } else if is_x(t_mi) {
        format!("<{}.0.0-0", plus_one(t_m))
    } else if is_x(t_p) {
        format!("<{}.{}.0-0", undef(t_m), plus_one(t_mi))
    } else if let Some(pr) = t_pr.filter(|s| !s.is_empty()) {
        format!("<={}.{}.{}-{pr}", undef(t_m), undef(t_mi), undef(t_p))
    } else if inc_pr {
        format!("<{}.{}.{}-0", undef(t_m), undef(t_mi), plus_one(t_p))
    } else {
        format!("<={}", undef(to))
    };
    js_trim(&format!("{from} {to}")).to_owned()
}

fn parse_comparator(comp: &str, options: Options) -> String {
    let comp = RE.build.replace(comp, "");
    let comp = replace_carets(&comp, options);
    let comp = replace_tildes(&comp, options);
    let comp = replace_x_ranges(&comp, options);
    replace_stars(&comp)
}

fn replace_tildes(comp: &str, options: Options) -> String {
    split_spaces(js_trim(comp))
        .into_iter()
        .map(|c| replace_tilde(c, options))
        .collect::<Vec<_>>()
        .join(" ")
}

fn replace_tilde(comp: &str, options: Options) -> String {
    let r = if options.loose {
        &RE.tildeloose
    } else {
        &RE.tilde
    };
    let Some(m) = r.captures(comp) else {
        return comp.to_owned();
    };
    let g = |i: usize| m.get(i).map(|g| g.as_str());
    let (big, mi, p, pr) = (g(1), g(2), g(3), g(4));
    let (bs, ms, ps) = (undef(big), undef(mi), undef(p));
    if is_x(big) {
        String::new()
    } else if is_x(mi) {
        format!(">={bs}.0.0 <{}.0.0-0", plus_one(big))
    } else if is_x(p) {
        format!(">={bs}.{ms}.0 <{bs}.{}.0-0", plus_one(mi))
    } else if let Some(pr) = pr.filter(|s| !s.is_empty()) {
        format!(">={bs}.{ms}.{ps}-{pr} <{bs}.{}.0-0", plus_one(mi))
    } else {
        format!(">={bs}.{ms}.{ps} <{bs}.{}.0-0", plus_one(mi))
    }
}

fn replace_carets(comp: &str, options: Options) -> String {
    split_spaces(js_trim(comp))
        .into_iter()
        .map(|c| replace_caret(c, options))
        .collect::<Vec<_>>()
        .join(" ")
}

fn replace_caret(comp: &str, options: Options) -> String {
    let r = if options.loose {
        &RE.caretloose
    } else {
        &RE.caret
    };
    let z = if options.include_prerelease { "-0" } else { "" };
    let Some(m) = r.captures(comp) else {
        return comp.to_owned();
    };
    let g = |i: usize| m.get(i).map(|g| g.as_str());
    let (big, mi, p, pr) = (g(1), g(2), g(3), g(4));
    let (bs, ms, ps) = (undef(big), undef(mi), undef(p));
    if is_x(big) {
        String::new()
    } else if is_x(mi) {
        format!(">={bs}.0.0{z} <{}.0.0-0", plus_one(big))
    } else if is_x(p) {
        if bs == "0" {
            format!(">={bs}.{ms}.0{z} <{bs}.{}.0-0", plus_one(mi))
        } else {
            format!(">={bs}.{ms}.0{z} <{}.0.0-0", plus_one(big))
        }
    } else if let Some(pr) = pr.filter(|s| !s.is_empty()) {
        if bs == "0" {
            if ms == "0" {
                format!(">={bs}.{ms}.{ps}-{pr} <{bs}.{ms}.{}-0", plus_one(p))
            } else {
                format!(">={bs}.{ms}.{ps}-{pr} <{bs}.{}.0-0", plus_one(mi))
            }
        } else {
            format!(">={bs}.{ms}.{ps}-{pr} <{}.0.0-0", plus_one(big))
        }
    } else if bs == "0" {
        if ms == "0" {
            format!(">={bs}.{ms}.{ps}{z} <{bs}.{ms}.{}-0", plus_one(p))
        } else {
            format!(">={bs}.{ms}.{ps}{z} <{bs}.{}.0-0", plus_one(mi))
        }
    } else {
        format!(">={bs}.{ms}.{ps} <{}.0.0-0", plus_one(big))
    }
}

fn replace_x_ranges(comp: &str, options: Options) -> String {
    split_spaces(comp)
        .into_iter()
        .map(|c| replace_x_range(c, options))
        .collect::<Vec<_>>()
        .join(" ")
}

fn replace_x_range(comp: &str, options: Options) -> String {
    let comp = js_trim(comp);
    let r = if options.loose {
        &RE.xrangeloose
    } else {
        &RE.xrange
    };
    let Some(m) = r.captures(comp) else {
        return comp.to_owned();
    };
    let g = |i: usize| m.get(i).map(|g| g.as_str());
    let mut gtlt = g(1).unwrap_or("").to_owned();
    let (big, mi, p) = (g(2), g(3), g(4));
    let x_big = is_x(big);
    let xm = x_big || is_x(mi);
    let xp = xm || is_x(p);
    let any_x = xp;
    if gtlt == "=" && any_x {
        gtlt.clear();
    }
    let mut pr = if options.include_prerelease { "-0" } else { "" };
    if x_big {
        if gtlt == ">" || gtlt == "<" {
            "<0.0.0-0".to_owned()
        } else {
            "*".to_owned()
        }
    } else if !gtlt.is_empty() && any_x {
        let mut big_s = undef(big).to_owned();
        let mut mi_s = if xm {
            "0".to_owned()
        } else {
            undef(mi).to_owned()
        };
        let p_s = "0".to_owned();
        if gtlt == ">" {
            gtlt = ">=".to_owned();
            if xm {
                big_s = plus_one(big);
                mi_s = "0".to_owned();
            } else {
                mi_s = plus_one(mi);
            }
        } else if gtlt == "<=" {
            gtlt = "<".to_owned();
            if xm {
                big_s = plus_one(big);
            } else {
                mi_s = plus_one(mi);
            }
        }
        if gtlt == "<" {
            pr = "-0";
        }
        format!("{gtlt}{big_s}.{mi_s}.{p_s}{pr}")
    } else if xm {
        format!(">={}.0.0{pr} <{}.0.0-0", undef(big), plus_one(big))
    } else if xp {
        format!(
            ">={}.{}.0{pr} <{}.{}.0-0",
            undef(big),
            undef(mi),
            undef(big),
            plus_one(mi)
        )
    } else {
        m.get(0).map(|g| g.as_str()).unwrap_or("").to_owned()
    }
}

fn replace_stars(comp: &str) -> String {
    RE.star.replace(js_trim(comp), "").into_owned()
}

fn replace_gte0(comp: &str, options: Options) -> String {
    let re = if options.include_prerelease {
        &RE.gte0pre
    } else {
        &RE.gte0
    };
    re.replace(js_trim(comp), "").into_owned()
}

/// `semver.satisfies(version, range, options)`.
pub fn satisfies<'a>(version: impl Into<Version<'a>>, range: &str, options: Options) -> bool {
    match Range::parse(range, options) {
        Ok(r) => r.test(version).unwrap_or(false),
        Err(_) => false,
    }
}

/// `semver.satisfies` where the original can throw: a comparison that re-parses a version out
/// of range (only `minVersion` builds those).
pub fn satisfies_checked<'a>(
    version: impl Into<Version<'a>>,
    range: &str,
    options: Options,
) -> Result<bool, String> {
    match Range::parse(range, options) {
        Ok(r) => r.test(version),
        Err(_) => Ok(false),
    }
}

/// `semver.validRange(range, options)`.
pub fn valid_range(range: &str, options: Options) -> Option<String> {
    let r = Range::parse(range, options).ok()?;
    let s = r.range();
    Some(if s.is_empty() { "*".to_owned() } else { s })
}

/// `semver.maxSatisfying(versions, range, options)`.
pub fn max_satisfying<S: AsRef<str>>(
    versions: &[S],
    range: &str,
    options: Options,
) -> Result<Option<String>, String> {
    let Ok(range) = Range::parse(range, options) else {
        return Ok(None);
    };
    let mut max: Option<(String, SemVer)> = None;
    for v in versions {
        let v = v.as_ref();
        if range.test(v)? {
            let replace = match &max {
                None => true,
                Some((_, sv)) => sv.compare_str(v)? == -1,
            };
            if replace {
                max = Some((v.to_owned(), SemVer::parse(v, options)?));
            }
        }
    }
    Ok(max.map(|(v, _)| v))
}

/// `semver.minVersion(range, options)`. Throws (here `Err`) on an invalid range.
pub fn min_version(range: &str, options: Options) -> Result<Option<SemVer>, String> {
    let range = Range::parse(range, options)?;
    let zero = SemVer::parse("0.0.0", Options::STRICT)?;
    if range.test(&zero)? {
        return Ok(Some(zero));
    }
    let zero_pre = SemVer::parse("0.0.0-0", Options::STRICT)?;
    if range.test(&zero_pre)? {
        return Ok(Some(zero_pre));
    }
    let mut minver: Option<SemVer> = None;
    for comparators in &range.set {
        let mut set_min: Option<SemVer> = None;
        for comparator in comparators {
            // `new SemVer(comparator.semver.version)`; `Comparator.ANY` has no `.version`, so the
            // original throws for it.
            let Some(sv) = &comparator.semver else {
                return Err(type_error(
                    "Invalid version. Must be a string. Got type \"undefined\".",
                ));
            };
            let mut compver = SemVer::parse(&sv.version, Options::STRICT)?;
            match comparator.operator.as_str() {
                ">" | "" | ">=" => {
                    if comparator.operator == ">" {
                        if compver.prerelease.is_empty() {
                            compver.patch += 1.0;
                        } else {
                            compver.prerelease.push(Identifier::Num(0.0));
                        }
                        compver.raw = compver.format();
                    }
                    let replace = match &set_min {
                        None => true,
                        Some(m) => gt(&compver, m, Options::STRICT)?,
                    };
                    if replace {
                        set_min = Some(compver);
                    }
                }
                "<" | "<=" => {}
                op => return Err(format!("Error: Unexpected operation: {op}")),
            }
        }
        if let Some(sm) = set_min {
            let replace = match &minver {
                None => true,
                Some(m) => gt(m, &sm, Options::STRICT)?,
            };
            if replace {
                minver = Some(sm);
            }
        }
    }
    match minver {
        Some(m) if range.test(&m)? => Ok(Some(m)),
        _ => Ok(None),
    }
}

/// `Array.prototype.sort` with `semver.rcompare` over valid versions (stable).
pub fn sort_rcompare(versions: &mut [String]) -> Result<(), String> {
    let mut parsed = Vec::with_capacity(versions.len());
    for v in versions.iter() {
        parsed.push((SemVer::parse(v, Options::STRICT)?, v.clone()));
    }
    parsed.sort_by(|(a, _), (b, _)| b.compare(a).cmp(&0));
    for (slot, (_, v)) in versions.iter_mut().zip(parsed) {
        *slot = v;
    }
    Ok(())
}
