//! `src/services/export/`: the SBOM `ht lock export` writes from a lockfile (`sbom.ts`,
//! `purl.ts`, `license.ts` without the manifest reader, `spdx-ids.ts`, `timestamp.ts`).

use serde_json::{Map, Value, json};

use crate::{LockEntry, LockSource, Lockfile};

/// `SbomFormat`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SbomFormat {
    CycloneDx,
    Spdx,
}

/// `parseSbomFormat`: the error is a `LockExportError` message.
pub fn parse_sbom_format(value: Option<&str>) -> Result<SbomFormat, String> {
    match value.unwrap_or("cyclonedx").to_lowercase().as_str() {
        "cyclonedx" => Ok(SbomFormat::CycloneDx),
        "spdx" => Ok(SbomFormat::Spdx),
        _ => Err(format!(
            "Unsupported SBOM format: {}. Use cyclonedx or spdx.",
            value.unwrap_or("undefined")
        )),
    }
}

/// JavaScript's `<` on strings: UTF-16 code unit order.
fn compare_utf16(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// `encodeURIComponent`.
fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for b in segment.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn encode_path(owner_repo: &str) -> String {
    owner_repo
        .split('/')
        .map(encode_segment)
        .collect::<Vec<_>>()
        .join("/")
}

/// `new URL(url)`, `None` where it throws.
fn parse_url(url: &str) -> Option<url::Url> {
    url::Url::parse(url).ok()
}

/// `scrubUrl`: drops userinfo and the query string.
pub fn scrub_url(url: &str) -> String {
    if url.is_empty() {
        return String::new();
    }
    match parse_url(url) {
        Some(parsed) => {
            let search = parsed.query().is_some_and(|q| !q.is_empty());
            if parsed.username().is_empty()
                && parsed.password().is_none_or(str::is_empty)
                && !search
            {
                return url.to_owned();
            }
            let port = parsed.port().map(|p| format!(":{p}")).unwrap_or_default();
            let hash = parsed
                .fragment()
                .filter(|f| !f.is_empty())
                .map(|f| format!("#{f}"))
                .unwrap_or_default();
            format!(
                "{}//{}{port}{}{hash}",
                protocol(&parsed),
                parsed.host_str().unwrap_or(""),
                parsed.path()
            )
        }
        None => {
            if url.starts_with("git@") || url.starts_with("ssh://") {
                return url.split('?').next().unwrap_or(url).to_owned();
            }
            let host_start = url.rfind('@').map_or(url, |at| &url[at + 1..]);
            host_start
                .split('?')
                .next()
                .unwrap_or(host_start)
                .to_owned()
        }
    }
}

fn protocol(url: &url::Url) -> String {
    format!("{}:", url.scheme())
}

fn canonical_repo_path(repo_url: &str) -> String {
    let scrubbed = scrub_url(repo_url);
    match parse_url(&scrubbed) {
        Some(parsed) => {
            let host = parsed.host_str().unwrap_or("").to_lowercase();
            let path = parsed.path().trim_start_matches('/').trim_end_matches('/');
            let path = match path.len().checked_sub(4) {
                Some(cut)
                    if path.is_char_boundary(cut) && path[cut..].eq_ignore_ascii_case(".git") =>
                {
                    &path[..cut]
                }
                _ => path,
            };
            if parsed.scheme() == "file" {
                return if path.is_empty() {
                    scrubbed
                } else {
                    format!("file:///{path}")
                };
            }
            if host.is_empty() {
                path.to_owned()
            } else {
                format!("{host}/{path}")
            }
        }
        None => match scrubbed
            .strip_prefix("git@")
            .and_then(|rest| rest.split_once(':'))
        {
            Some((host, rest)) if !host.is_empty() => format!("{}/{rest}", host.to_lowercase()),
            _ => scrubbed,
        },
    }
}

fn path_parts(repo_url: &str) -> Vec<String> {
    canonical_repo_path(repo_url)
        .split('/')
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect()
}

fn host_segment(repo_url: &str) -> String {
    match path_parts(repo_url).first() {
        Some(first) if first.contains('.') => first.to_lowercase(),
        _ => String::new(),
    }
}

fn owner_repo(repo_url: &str) -> String {
    let parts = path_parts(repo_url);
    match parts.first() {
        Some(first) if first.contains('.') => parts[1..].join("/"),
        _ => parts.join("/"),
    }
}

fn basename(repo_url: &str) -> String {
    let path = owner_repo(repo_url);
    path.split('/')
        .rfind(|s| !s.is_empty())
        .map_or_else(|| repo_url.to_owned(), str::to_owned)
}

fn purl_type_for(entry: &LockEntry, repo_url: &str) -> Option<&'static str> {
    let host = host_segment(repo_url);
    match host.as_str() {
        "github.com" => return Some("github"),
        "gitlab.com" => return Some("gitlab"),
        "bitbucket.org" => return Some("bitbucket"),
        _ => {}
    }
    (entry.source == LockSource::Git && host.is_empty() && owner_repo(repo_url).contains('/'))
        .then_some("github")
}

/// `a || b`: the first non-empty string.
fn or<'a>(values: &[Option<&'a str>]) -> Option<&'a str> {
    values.iter().flatten().copied().find(|s| !s.is_empty())
}

fn hash_version(entry: &LockEntry) -> Option<&str> {
    or(&[entry.content_hash.as_deref(), Some(&entry.integrity)])
}

/// `buildPurl`.
pub fn build_purl(entry: &LockEntry) -> String {
    let repo_url = entry.repo_url.as_deref().map(scrub_url).unwrap_or_default();
    let name_or = |fallback: &str| {
        if !entry.name.is_empty() {
            entry.name.clone()
        } else if !repo_url.is_empty() {
            basename(&repo_url)
        } else {
            fallback.to_owned()
        }
    };
    let with_version = |prefix: String, version: Option<&str>| match version {
        Some(v) => format!("{prefix}@{v}"),
        None => prefix,
    };
    match entry.source {
        LockSource::Local => {
            let name = encode_segment(&name_or("local"));
            return with_version(format!("pkg:generic/{name}"), hash_version(entry));
        }
        LockSource::Catalog | LockSource::Marketplace => {
            let name = encode_segment(&name_or("catalog"));
            let version = or(&[hash_version(entry), Some(&entry.version)]);
            return with_version(format!("pkg:generic/harnesstap/{name}"), version);
        }
        LockSource::Git => {}
    }
    let commit = entry.resolved_commit.as_deref().filter(|c| !c.is_empty());
    if let Some(commit) = commit {
        if !repo_url.is_empty() {
            if let Some(kind) = purl_type_for(entry, &repo_url) {
                return format!(
                    "pkg:{kind}/{}@{commit}",
                    encode_path(&owner_repo(&repo_url))
                );
            }
            return format!(
                "pkg:generic/{}@{commit}",
                encode_segment(&basename(&repo_url))
            );
        }
        let name = if entry.name.is_empty() {
            "package"
        } else {
            &entry.name
        };
        return format!("pkg:generic/{}@{commit}", encode_segment(name));
    }
    let name = encode_segment(&name_or("package"));
    let version = or(&[hash_version(entry), Some(&entry.version)]);
    with_version(format!("pkg:generic/{name}"), version)
}

/// `componentName`.
pub fn component_name(entry: &LockEntry) -> String {
    if let Some(repo_url) = entry.repo_url.as_deref().filter(|u| !u.is_empty()) {
        let path = owner_repo(&scrub_url(repo_url));
        if !path.is_empty() {
            return path;
        }
    }
    if entry.name.is_empty() {
        "package".to_owned()
    } else {
        entry.name.clone()
    }
}

/// `componentVersion`.
pub fn component_version(entry: &LockEntry) -> Option<&str> {
    or(&[
        Some(&entry.version),
        entry.resolved_commit.as_deref(),
        entry.content_hash.as_deref(),
        Some(&entry.integrity),
    ])
}

/// `LicenseKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LicenseKind {
    Id,
    Expression,
    Named,
}

const SPDX_LICENSE_IDS: &[&str] = &[
    "0BSD",
    "AAL",
    "AFL-1.1",
    "AFL-1.2",
    "AFL-2.0",
    "AFL-2.1",
    "AFL-3.0",
    "AGPL-1.0-only",
    "AGPL-1.0-or-later",
    "AGPL-3.0",
    "AGPL-3.0-only",
    "AGPL-3.0-or-later",
    "Apache-1.0",
    "Apache-1.1",
    "Apache-2.0",
    "APL-1.0",
    "APSL-1.0",
    "APSL-1.1",
    "APSL-1.2",
    "APSL-2.0",
    "Artistic-1.0",
    "Artistic-1.0-cl8",
    "Artistic-1.0-Perl",
    "Artistic-2.0",
    "BlueOak-1.0.0",
    "BSD-1-Clause",
    "BSD-2-Clause",
    "BSD-2-Clause-Patent",
    "BSD-3-Clause",
    "BSD-3-Clause-Clear",
    "BSD-3-Clause-LBNL",
    "BSD-4-Clause",
    "BSD-4-Clause-UC",
    "BSL-1.0",
    "CC-BY-4.0",
    "CC-BY-SA-4.0",
    "CC0-1.0",
    "CDDL-1.0",
    "CDDL-1.1",
    "CPL-1.0",
    "EPL-1.0",
    "EPL-2.0",
    "EUPL-1.1",
    "EUPL-1.2",
    "GPL-2.0",
    "GPL-2.0-only",
    "GPL-2.0-or-later",
    "GPL-3.0",
    "GPL-3.0-only",
    "GPL-3.0-or-later",
    "HPND",
    "ICU",
    "IJG",
    "ISC",
    "LGPL-2.0-only",
    "LGPL-2.0-or-later",
    "LGPL-2.1",
    "LGPL-2.1-only",
    "LGPL-2.1-or-later",
    "LGPL-3.0",
    "LGPL-3.0-only",
    "LGPL-3.0-or-later",
    "Libpng",
    "libpng-2.0",
    "Lil-1.0",
    "LPPL-1.3c",
    "MIT",
    "MIT-0",
    "MIT-CMU",
    "MIT-Modern-Variant",
    "MPL-1.0",
    "MPL-1.1",
    "MPL-2.0",
    "MPL-2.0-no-copyleft-exception",
    "MS-PL",
    "MS-RL",
    "NCSA",
    "OFL-1.0",
    "OFL-1.1",
    "OSL-3.0",
    "PostgreSQL",
    "Python-2.0",
    "Ruby",
    "Unlicense",
    "UPL-1.0",
    "W3C",
    "WTFPL",
    "X11",
    "Zlib",
    "ZPL-2.0",
    "ZPL-2.1",
];

const SPDX_EXCEPTION_IDS: &[&str] = &[
    "Autoconf-exception-2.0",
    "Autoconf-exception-3.0",
    "Bison-exception-2.2",
    "Classpath-exception-2.0",
    "Font-exception-2.0",
    "GCC-exception-2.0",
    "GCC-exception-3.1",
    "Libtool-exception",
    "Linux-syscall-note",
    "LLVM-exception",
    "openvpn-openssl-exception",
    "Qt-GPL-exception-1.0",
    "Qt-LGPL-exception-1.1",
    "Universal-FOSS-exception-1.0",
    "WxWindows-exception-3.1",
];

fn is_operator(token: &str) -> bool {
    token == "AND" || token == "OR"
}

fn is_valid_license_id(token: &str) -> bool {
    let bare = token.strip_suffix('+').unwrap_or(token);
    !bare.is_empty()
        && (SPDX_LICENSE_IDS.contains(&bare)
            || token.starts_with("LicenseRef-")
            || token.starts_with("DocumentRef-"))
}

/// `ExpressionParser`.
struct ExpressionParser<'a> {
    tokens: &'a [String],
    pos: usize,
}

impl ExpressionParser<'_> {
    fn parse(&mut self) -> bool {
        self.parse_or() && self.pos == self.tokens.len()
    }

    fn peek(&self) -> Option<&str> {
        self.tokens.get(self.pos).map(String::as_str)
    }

    fn advance(&mut self) -> Option<&str> {
        let token = self.tokens.get(self.pos).map(String::as_str);
        if token.is_some() {
            self.pos += 1;
        }
        token
    }

    fn parse_or(&mut self) -> bool {
        if !self.parse_unit() {
            return false;
        }
        while self.peek().is_some_and(|t| is_operator(&t.to_uppercase())) {
            self.advance();
            if !self.parse_unit() {
                return false;
            }
        }
        true
    }

    fn parse_unit(&mut self) -> bool {
        let Some(token) = self.peek() else {
            return false;
        };
        if token == "(" {
            self.advance();
            if !self.parse_or() {
                return false;
            }
            return self.advance() == Some(")");
        }
        if token == ")" || is_operator(token) || token.to_uppercase() == "WITH" {
            return false;
        }
        let valid = is_valid_license_id(token);
        self.advance();
        if !valid {
            return false;
        }
        if self.peek().is_some_and(|t| t.to_uppercase() == "WITH") {
            self.advance();
            return self
                .advance()
                .is_some_and(|e| SPDX_EXCEPTION_IDS.contains(&e));
        }
        true
    }
}

/// `classifyDeclaredLicense`.
pub fn classify_declared_license(declared: &str) -> (LicenseKind, String) {
    let value = emit_rs::js::trim(declared).to_owned();
    if value.is_empty() {
        return (LicenseKind::Named, value);
    }
    let upper = value.to_uppercase();
    if upper == "UNLICENSED" || upper.starts_with("SEE LICENSE IN ") {
        return (LicenseKind::Named, value);
    }
    let tokens: Vec<String> = value
        .replace('(', " ( ")
        .replace(')', " ) ")
        .split(emit_rs::js::is_space)
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
        .collect();
    let expression = tokens.iter().any(|t| {
        let upper = t.to_uppercase();
        t == "(" || t == ")" || is_operator(&upper) || upper == "WITH"
    });
    if !expression {
        if tokens.len() == 1 && is_valid_license_id(&tokens[0]) {
            return (LicenseKind::Id, value);
        }
        return (LicenseKind::Named, value);
    }
    let mut parser = ExpressionParser {
        tokens: &tokens,
        pos: 0,
    };
    if parser.parse() {
        (LicenseKind::Expression, value)
    } else {
        (LicenseKind::Named, value)
    }
}

/// `sha256Digest`.
fn sha256_digest(value: Option<&str>) -> Option<String> {
    let value = value.filter(|v| !v.is_empty())?;
    let hex = match value.get(..7) {
        Some(prefix) if prefix.eq_ignore_ascii_case("sha256:") => &value[7..],
        _ => value,
    };
    (hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit())).then(|| hex.to_lowercase())
}

fn recorded_hash(entry: &LockEntry) -> Option<String> {
    sha256_digest(entry.content_hash.as_deref()).or_else(|| sha256_digest(Some(&entry.integrity)))
}

fn sorted_entries(lock: &Lockfile) -> Vec<(String, &LockEntry)> {
    let mut entries: Vec<(String, &LockEntry)> =
        lock.plugins.iter().map(|e| (build_purl(e), e)).collect();
    entries.sort_by(|a, b| compare_utf16(&a.0, &b.0));
    entries
}

fn object(pairs: Vec<(&str, Value)>) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v))
            .collect::<Map<_, _>>(),
    )
}

fn build_cyclonedx(lock: &Lockfile, timestamp: &str) -> Value {
    let components: Vec<Value> = sorted_entries(lock)
        .into_iter()
        .map(|(purl, entry)| {
            let mut c = vec![
                ("type", json!("library")),
                ("name", json!(component_name(entry))),
                ("purl", json!(purl)),
                ("bom-ref", json!(purl)),
            ];
            if let Some(v) = component_version(entry) {
                c.push(("version", json!(v)));
            }
            if let Some(declared) = entry.declared_license.as_deref().filter(|d| !d.is_empty()) {
                let (kind, value) = classify_declared_license(declared);
                c.push((
                    "licenses",
                    match kind {
                        LicenseKind::Id => json!([{ "license": { "id": value } }]),
                        LicenseKind::Expression => json!([{ "expression": value }]),
                        LicenseKind::Named => json!([{ "license": { "name": value } }]),
                    },
                ));
            }
            if let Some(digest) = recorded_hash(entry) {
                c.push(("hashes", json!([{ "alg": "SHA-256", "content": digest }])));
            }
            if let Some(repo_url) = entry.repo_url.as_deref().filter(|u| !u.is_empty()) {
                let url = scrub_url(repo_url);
                if url.contains("://") {
                    c.push((
                        "externalReferences",
                        json!([{ "type": "distribution", "url": url }]),
                    ));
                }
            }
            object(c)
        })
        .collect();
    json!({
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "timestamp": timestamp,
            "tools": [{ "vendor": "HarnessTap", "name": "ht lock export" }],
        },
        "components": components,
    })
}

const NOASSERTION: &str = "NOASSERTION";

fn build_spdx(lock: &Lockfile, timestamp: &str) -> Value {
    let packages: Vec<Value> = sorted_entries(lock)
        .into_iter()
        .enumerate()
        .map(|(index, (purl, entry))| {
            let download = match entry.repo_url.as_deref() {
                Some(u) if !u.is_empty() && u.contains("://") => scrub_url(u),
                _ => NOASSERTION.to_owned(),
            };
            let download = if download.is_empty() {
                NOASSERTION.to_owned()
            } else {
                download
            };
            let mut p = vec![
                ("SPDXID", json!(format!("SPDXRef-Package-{index}"))),
                ("name", json!(component_name(entry))),
                ("downloadLocation", json!(download)),
                ("licenseConcluded", json!(NOASSERTION)),
                (
                    "licenseDeclared",
                    json!(entry.declared_license.as_deref().unwrap_or(NOASSERTION)),
                ),
                (
                    "externalRefs",
                    json!([{
                        "referenceCategory": "PACKAGE-MANAGER",
                        "referenceType": "purl",
                        "referenceLocator": purl,
                    }]),
                ),
            ];
            if let Some(v) = component_version(entry) {
                p.push(("versionInfo", json!(v)));
            }
            if let Some(digest) = recorded_hash(entry) {
                p.push((
                    "checksums",
                    json!([{ "algorithm": "SHA256", "checksumValue": digest }]),
                ));
            }
            object(p)
        })
        .collect();
    json!({
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": "harnesstap-sbom",
        "documentNamespace": format!("https://spdx.org/spdxdocs/harnesstap-sbom-{timestamp}"),
        "creationInfo": { "created": timestamp, "creators": ["Tool: ht lock export"] },
        "packages": packages,
    })
}

/// `sortKeys`: every object's keys in UTF-16 order.
fn sort_keys(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(sort_keys).collect()),
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().collect();
            entries.sort_by(|a, b| compare_utf16(&a.0, &b.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(k, v)| (k, sort_keys(v)))
                    .collect(),
            )
        }
        other => other,
    }
}

/// `exportSbom`: `JSON.stringify(sortKeys(document), null, 2)` and a newline.
pub fn export_sbom(lock: &Lockfile, format: SbomFormat, timestamp: &str) -> String {
    let document = match format {
        SbomFormat::CycloneDx => build_cyclonedx(lock, timestamp),
        SbomFormat::Spdx => build_spdx(lock, timestamp),
    };
    emit_rs::json::to_file_string(&sort_keys(document))
}

/// What `resolveExportTimestamp` throws, or input whose parse this port does not reproduce.
#[derive(Debug, PartialEq, Eq)]
pub enum TimestampError {
    /// `LockExportTimestampError`.
    Invalid(String),
    /// `RangeError: Invalid time value` from `toISOString`.
    Range,
    /// `Date.parse` would take a path the port does not follow (V8's legacy formats).
    Unsupported,
}

const MS_PER_DAY: i64 = 86_400_000;
const MAX_TIME: i64 = 8_640_000_000_000_000;

/// Days from 1970-01-01 to a proleptic Gregorian date.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
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
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// `formatUtc(new Date(ms))`: `toISOString().slice(0, 19) + "+00:00"`.
fn format_utc(ms: i64) -> Result<String, TimestampError> {
    if ms.abs() > MAX_TIME {
        return Err(TimestampError::Range);
    }
    let (y, m, d) = civil_from_days(ms.div_euclid(MS_PER_DAY));
    let rem = ms.rem_euclid(MS_PER_DAY) / 1000;
    let year = if (0..=9999).contains(&y) {
        format!("{y:04}")
    } else if y < 0 {
        format!("-{:06}", -y)
    } else {
        format!("+{y:06}")
    };
    let iso = format!(
        "{year}-{m:02}-{d:02}T{:02}:{:02}:{:02}",
        rem / 3600,
        rem / 60 % 60,
        rem % 60
    );
    Ok(format!("{}+00:00", &iso[..19]))
}

fn digits(s: &str) -> Option<i64> {
    (!s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        .then(|| s.parse().ok())
        .flatten()
}

/// `Date.parse` of `YYYY-MM-DDTHH:mm[:ss[.s+]]±HH:mm`, with V8's ranges: any day up to 31
/// (it rolls over into the next month), hour 24 only for midnight. `None` for another shape,
/// which V8 hands to its legacy parser; `Some(None)` for `NaN`.
fn parse_iso_with_offset(s: &str) -> Option<Option<i64>> {
    let (date, rest) = s.split_once('T')?;
    let mut date_parts = date.split('-');
    let (y, mo, d) = (date_parts.next()?, date_parts.next()?, date_parts.next()?);
    if date_parts.next().is_some() || y.len() != 4 || mo.len() != 2 || d.len() != 2 {
        return None;
    }
    let (y, mo, d) = (digits(y)?, digits(mo)?, digits(d)?);
    let sign_at = rest.rfind(['+', '-'])?;
    let (time, offset) = rest.split_at(sign_at);
    let (oh, om) = offset[1..].split_once(':')?;
    if oh.len() != 2 || om.len() != 2 {
        return None;
    }
    let (oh, om) = (digits(oh)?, digits(om)?);
    let (hms, fraction_ms) = match time.split_once('.') {
        Some((hms, f)) => {
            digits(f)?;
            let ms = format!("{f:0<3}");
            (hms, digits(&ms[..3])?)
        }
        None => (time, 0),
    };
    let parts: Vec<&str> = hms.split(':').collect();
    if !(2..=3).contains(&parts.len())
        || parts.iter().any(|p| p.len() != 2)
        || (parts.len() == 2 && time.contains('.'))
    {
        return None;
    }
    let h = digits(parts[0])?;
    let mi = digits(parts[1])?;
    let sec = parts.get(2).map_or(Some(0), |p| digits(p))?;
    let midnight = h == 24 && mi == 0 && sec == 0 && fraction_ms == 0;
    if !(1..=12).contains(&mo)
        || !(1..=31).contains(&d)
        || (h > 23 && !midnight)
        || mi > 59
        || sec > 59
        || oh > 23
        || om > 59
    {
        return Some(None);
    }
    let sign = if offset.starts_with('-') { -1 } else { 1 };
    let local =
        days_from_civil(y, mo, d) * MS_PER_DAY + ((h * 60 + mi) * 60 + sec) * 1000 + fraction_ms;
    Some(Some(local - sign * (oh * 60 + om) * 60_000))
}

/// `/(?:Z|[+-]\d{2}:\d{2})$/`.
fn has_timezone(s: &str) -> bool {
    let b = s.as_bytes();
    if b.last() == Some(&b'Z') {
        return true;
    }
    b.len() >= 6 && {
        let t = &b[b.len() - 6..];
        matches!(t[0], b'+' | b'-')
            && t[1].is_ascii_digit()
            && t[2].is_ascii_digit()
            && t[3] == b':'
            && t[4].is_ascii_digit()
            && t[5].is_ascii_digit()
    }
}

fn invalid(explicit: &str) -> TimestampError {
    TimestampError::Invalid(format!(
        "Invalid timestamp {}. Expected timezone-aware ISO 8601, e.g. 2024-06-01T00:00:00+00:00.",
        emit_rs::js::quote(explicit)
    ))
}

/// `resolveExportTimestamp(explicit, lockfileGeneratedAt, sourceDateEpoch)`.
pub fn resolve_export_timestamp(
    explicit: Option<&str>,
    generated_at: &str,
    source_date_epoch: Option<&str>,
) -> Result<String, TimestampError> {
    if let Some(explicit) = explicit {
        let trimmed = emit_rs::js::trim(explicit);
        if !has_timezone(trimmed) {
            return Err(invalid(explicit));
        }
        let normalized = match trimmed.strip_suffix('Z') {
            Some(rest) => format!("{rest}+00:00"),
            None => trimmed.to_owned(),
        };
        return match parse_iso_with_offset(&normalized) {
            None => Err(TimestampError::Unsupported),
            Some(None) => Err(invalid(explicit)),
            Some(Some(ms)) => format_utc(ms),
        };
    }
    if let Some(epoch) = source_date_epoch.filter(|s| !s.is_empty()) {
        let seconds = emit_rs::js::string_to_number(epoch);
        if seconds.is_finite() && seconds.fract() == 0.0 && seconds >= 0.0 {
            if seconds * 1000.0 > MAX_TIME as f64 {
                return Err(TimestampError::Range);
            }
            return format_utc((seconds * 1000.0) as i64);
        }
    }
    let generated = emit_rs::js::trim(generated_at);
    if !generated.is_empty() {
        return Ok(generated.to_owned());
    }
    Ok("1970-01-01T00:00:00+00:00".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps() {
        let r = |e: &str| resolve_export_timestamp(Some(e), "", None);
        assert_eq!(
            r("2024-06-01T02:30:00+02:00").as_deref(),
            Ok("2024-06-01T00:30:00+00:00")
        );
        assert_eq!(
            r(" 2024-06-01T00:00Z ").as_deref(),
            Ok("2024-06-01T00:00:00+00:00")
        );
        assert_eq!(
            r("0000-01-01T00:00+01:00").as_deref(),
            Ok("-000001-12-31T23:00+00:00")
        );
        assert!(matches!(r("2024-06-01"), Err(TimestampError::Invalid(_))));
        assert_eq!(r("June 1 2024 +00:00"), Err(TimestampError::Unsupported));
        assert_eq!(
            r("2024-02-29T23:59:59.999-00:30").as_deref(),
            Ok("2024-03-01T00:29:59+00:00")
        );
        assert_eq!(
            r("2023-02-31T00:00:00.1234+00:00").as_deref(),
            Ok("2023-03-03T00:00:00+00:00")
        );
        assert_eq!(
            r("2024-06-01T24:00Z").as_deref(),
            Ok("2024-06-02T00:00:00+00:00")
        );
        assert!(matches!(
            r("2024-13-01T00:00Z"),
            Err(TimestampError::Invalid(_))
        ));
        let epoch = |s: &str| resolve_export_timestamp(None, " g ", Some(s));
        assert_eq!(epoch("86400").as_deref(), Ok("1970-01-02T00:00:00+00:00"));
        assert_eq!(epoch("1.5").as_deref(), Ok("g"));
        assert_eq!(epoch("9e15"), Err(TimestampError::Range));
    }

    #[test]
    fn licenses() {
        assert_eq!(classify_declared_license("MIT").0, LicenseKind::Id);
        assert_eq!(
            classify_declared_license("(MIT OR Apache-2.0) and GPL-2.0+ WITH LLVM-exception").0,
            LicenseKind::Expression
        );
        assert_eq!(classify_declared_license("MIT or").0, LicenseKind::Named);
    }
}
