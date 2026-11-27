//! The port of the CLI update notice in `src/services/self-update.ts`: what
//! `runHarnesstapCli` runs after a successful action (`maybeNotifyCliUpdate`)
//! and everything it reaches, recorded against the original by
//! `tests/make-fixtures.mjs`.
//!
//! HTTP goes through [`UpdateFetch`]; the clock (`now_ms`), the environment, the
//! Node-shaped argv (`[runtime, script, ...args]`) and the harnesstap directory
//! are parameters. The desktop update path of the same file is not ported here.

#![forbid(unsafe_code)]

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use emit_rs::js::trim as js_trim;
use node_semver_rs::Options;
use serde_json::{Map, Value};

pub const GITHUB_REPO: &str = "harnesstap/harnesstap";
pub const GITHUB_LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/harnesstap/harnesstap/releases/latest";
pub const NPM_LATEST_API: &str = "https://registry.npmjs.org/harnesstap/latest";
pub const NPM_PACKAGE_NAME: &str = "harnesstap";
pub const UPDATE_CHECK_MAX_AGE_MS: i64 = 24 * 60 * 60 * 1000;
pub const UPDATE_LOOKUP_TIMEOUT_MS: u64 = 2_500;
const UPDATE_CHECK_FILENAME: &str = "update-check.json";

/// `process.env`.
pub type Env = HashMap<String, String>;

/// `PublishedVersionChannel`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channel {
    Npm,
    Github,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Channel::Npm => "npm",
            Channel::Github => "github",
        }
    }
}

/// What an [`UpdateFetch`] got back: the status and the raw body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FetchResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

/// `UpdateFetch` as the lookups call it: one GET, no retries, aborted after
/// `timeout_ms`. `Err` is any failure to get a response (network, timeout).
pub trait UpdateFetch {
    fn fetch(
        &self,
        url: &str,
        headers: &[(&str, &str)],
        timeout_ms: u64,
    ) -> Result<FetchResponse, String>;
}

/// A release asset, kept as the JSON object it was read from: the cache keeps
/// any extra keys an asset had on disk.
pub type ReleaseAsset = Map<String, Value>;

/// `PublishedRelease`.
#[derive(Clone, Debug, PartialEq)]
pub struct PublishedRelease {
    pub version: String,
    pub notes: String,
    pub html_url: String,
    pub assets: Vec<ReleaseAsset>,
}

impl PublishedRelease {
    pub fn to_value(&self) -> Value {
        let mut m = Map::new();
        m.insert("version".into(), self.version.clone().into());
        m.insert("notes".into(), self.notes.clone().into());
        m.insert("htmlUrl".into(), self.html_url.clone().into());
        m.insert("assets".into(), assets_value(&self.assets));
        Value::Object(m)
    }
}

fn assets_value(assets: &[ReleaseAsset]) -> Value {
    Value::Array(assets.iter().cloned().map(Value::Object).collect())
}

/// `UpdateCheckCache`, the content of `update-check.json`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct UpdateCheckCache {
    pub last_lookup_at: Option<String>,
    pub latest_version: Option<String>,
    pub latest_notes: Option<String>,
    pub latest_html_url: Option<String>,
    pub assets: Vec<ReleaseAsset>,
    pub notified_version: Option<String>,
}

impl UpdateCheckCache {
    pub fn to_value(&self) -> Value {
        let s = |v: &Option<String>| v.clone().map_or(Value::Null, Value::String);
        let mut m = Map::new();
        m.insert("lastLookupAt".into(), s(&self.last_lookup_at));
        m.insert("latestVersion".into(), s(&self.latest_version));
        m.insert("latestNotes".into(), s(&self.latest_notes));
        m.insert("latestHtmlUrl".into(), s(&self.latest_html_url));
        m.insert("assets".into(), assets_value(&self.assets));
        m.insert("notifiedVersion".into(), s(&self.notified_version));
        Value::Object(m)
    }
}

/// `CliUpdateNotice`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CliUpdateNotice {
    pub current_version: String,
    pub latest_version: String,
    pub channel: Channel,
    pub install_hint: String,
    pub html_url: String,
}

impl CliUpdateNotice {
    pub fn to_value(&self) -> Value {
        let mut m = Map::new();
        m.insert("currentVersion".into(), self.current_version.clone().into());
        m.insert("latestVersion".into(), self.latest_version.clone().into());
        m.insert("channel".into(), self.channel.as_str().into());
        m.insert("installHint".into(), self.install_hint.clone().into());
        m.insert("htmlUrl".into(), self.html_url.clone().into());
        Value::Object(m)
    }
}

pub fn update_check_path(harnesstap_dir: &Path) -> PathBuf {
    harnesstap_dir.join(UPDATE_CHECK_FILENAME)
}

pub fn normalize_published_version(version: &str) -> String {
    let trimmed = js_trim(version);
    trimmed
        .strip_prefix(['v', 'V'])
        .unwrap_or(trimmed)
        .to_owned()
}

pub fn is_newer_published_version(latest: &str, current: &str) -> bool {
    let core = |v: &str| node_semver_rs::coerce(&normalize_published_version(v), Options::STRICT);
    match (core(latest), core(current)) {
        (Some(l), Some(c)) => {
            node_semver_rs::gt(&l.version, &c.version, Options::STRICT).unwrap_or(false)
        }
        _ => false,
    }
}

fn env_is(env: &Env, key: &str, value: &str) -> bool {
    env.get(key).is_some_and(|v| v == value)
}

pub fn detect_cli_install_channel(script_path: &str, env: &Env) -> Channel {
    match env.get("HARNESSTAP_UPDATE_CHANNEL").map(String::as_str) {
        Some("npm") => return Channel::Npm,
        Some("github") => return Channel::Github,
        _ => {}
    }
    if env_is(env, "npm_package_name", NPM_PACKAGE_NAME) {
        return Channel::Npm;
    }
    let normalized = script_path.replace('\\', "/");
    if [
        "/node_modules/harnesstap/",
        "/node_modules/.bin/",
        "/_npx/",
        "/.npm/_npx/",
    ]
    .iter()
    .any(|p| normalized.contains(p))
    {
        return Channel::Npm;
    }
    Channel::Github
}

/// True when the CLI runs from the Homebrew formula (its wrapper sets `HARNESSTAP_INSTALL_METHOD=brew`).
pub fn is_homebrew_cli_install(script_path: &str, env: &Env) -> bool {
    if env
        .get("HARNESSTAP_INSTALL_METHOD")
        .is_some_and(|m| js_trim(m).to_lowercase() == "brew")
    {
        return true;
    }
    script_path
        .replace('\\', "/")
        .to_lowercase()
        .contains("/cellar/harnesstap/")
}

pub fn cli_install_hint(channel: Channel, version: &str, homebrew: bool) -> String {
    let normalized = normalize_published_version(version);
    if homebrew {
        return "brew upgrade harnesstap".into();
    }
    match channel {
        Channel::Npm => format!("npm install -g {NPM_PACKAGE_NAME}@{normalized}"),
        Channel::Github => format!("https://github.com/{GITHUB_REPO}/releases/tag/v{normalized}"),
    }
}

pub fn github_release_html_url(version: &str) -> String {
    format!(
        "https://github.com/{GITHUB_REPO}/releases/tag/v{}",
        normalize_published_version(version)
    )
}

/// `{ name, browser_download_url }` when both are strings.
fn is_asset(v: &Value) -> bool {
    v.get("name").is_some_and(Value::is_string)
        && v.get("browser_download_url").is_some_and(Value::is_string)
}

pub fn load_update_check_cache(harnesstap_dir: &Path) -> UpdateCheckCache {
    let path = update_check_path(harnesstap_dir);
    // readFileSync(path, "utf-8"): lossy, and a BOM stays (so JSON.parse rejects it).
    let Ok(bytes) = fs::read(path) else {
        return UpdateCheckCache::default();
    };
    let Ok(Value::Object(raw)) = serde_json::from_str::<Value>(&String::from_utf8_lossy(&bytes))
    else {
        // `null` throws in the original and other non-objects read as all-null: both empty.
        return UpdateCheckCache::default();
    };
    let s = |k: &str| raw.get(k).and_then(Value::as_str).map(str::to_owned);
    UpdateCheckCache {
        last_lookup_at: s("lastLookupAt"),
        latest_version: s("latestVersion"),
        latest_notes: s("latestNotes"),
        latest_html_url: s("latestHtmlUrl"),
        assets: match raw.get("assets") {
            Some(Value::Array(items)) => items
                .iter()
                .filter(|a| is_asset(a))
                .filter_map(|a| a.as_object().cloned())
                .collect(),
            _ => Vec::new(),
        },
        notified_version: s("notifiedVersion"),
    }
}

pub fn save_update_check_cache(
    harnesstap_dir: &Path,
    cache: &UpdateCheckCache,
) -> std::io::Result<()> {
    fs::create_dir_all(harnesstap_dir)?;
    fs::write(
        update_check_path(harnesstap_dir),
        emit_rs::json::to_file_string(&cache.to_value()),
    )
}

pub fn is_update_lookup_fresh(cache: &UpdateCheckCache, now_ms: i64) -> bool {
    match cache.last_lookup_at.as_deref().and_then(date_parse) {
        Some(looked_up) => now_ms - looked_up <= UPDATE_CHECK_MAX_AGE_MS,
        None => false,
    }
}

pub fn published_release_user_agent(package_version: &str) -> String {
    format!("HarnessTap/{package_version} (+https://github.com/{GITHUB_REPO})")
}

/// `fetchFn(url, ...)` then `response.json()`; `None` for anything that throws.
fn fetch_json(fetch: &dyn UpdateFetch, url: &str, headers: &[(&str, &str)]) -> Option<Value> {
    let response = fetch.fetch(url, headers, UPDATE_LOOKUP_TIMEOUT_MS).ok()?;
    if !(200..300).contains(&response.status) {
        return None;
    }
    // Response.json() decodes UTF-8 (lossy, BOM dropped) before JSON.parse.
    let text = String::from_utf8_lossy(&response.body);
    serde_json::from_str(text.strip_prefix('\u{feff}').unwrap_or(&text)).ok()
}

pub fn fetch_npm_latest_version(fetch: &dyn UpdateFetch, package_version: &str) -> Option<String> {
    let ua = published_release_user_agent(package_version);
    let body = fetch_json(
        fetch,
        NPM_LATEST_API,
        &[("Accept", "application/json"), ("User-Agent", &ua)],
    )?;
    let version = body.get("version")?.as_str()?;
    if js_trim(version).is_empty() {
        return None;
    }
    Some(normalize_published_version(version))
}

pub fn fetch_github_latest_release(
    fetch: &dyn UpdateFetch,
    package_version: &str,
) -> Option<PublishedRelease> {
    let ua = published_release_user_agent(package_version);
    let body = fetch_json(
        fetch,
        GITHUB_LATEST_RELEASE_API,
        &[
            ("Accept", "application/vnd.github+json"),
            ("User-Agent", &ua),
            ("X-GitHub-Api-Version", "2022-11-28"),
        ],
    )?;
    let tag = body.get("tag_name")?.as_str()?;
    if js_trim(tag).is_empty() {
        return None;
    }
    let version = normalize_published_version(tag);
    let assets = match body.get("assets") {
        Some(Value::Array(items)) => items
            .iter()
            .filter(|a| is_asset(a))
            .map(|a| {
                let mut m = Map::new();
                m.insert("name".into(), a["name"].clone());
                m.insert(
                    "browser_download_url".into(),
                    a["browser_download_url"].clone(),
                );
                m
            })
            .collect(),
        _ => Vec::new(),
    };
    Some(PublishedRelease {
        notes: body
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        html_url: match body.get("html_url").and_then(Value::as_str) {
            Some(url) if !url.is_empty() => url.to_owned(),
            _ => github_release_html_url(&version),
        },
        version,
        assets,
    })
}

pub fn lookup_published_release(
    channel: Channel,
    fetch: &dyn UpdateFetch,
    package_version: &str,
) -> Option<PublishedRelease> {
    match channel {
        Channel::Github => fetch_github_latest_release(fetch, package_version),
        Channel::Npm => {
            let version = fetch_npm_latest_version(fetch, package_version)?;
            // npm is the CLI source of truth; GitHub notes are optional.
            match fetch_github_latest_release(fetch, package_version) {
                Some(github) if github.version == version => Some(github),
                _ => Some(PublishedRelease {
                    html_url: github_release_html_url(&version),
                    version,
                    notes: String::new(),
                    assets: Vec::new(),
                }),
            }
        }
    }
}

pub fn release_from_cache(cache: &UpdateCheckCache) -> Option<PublishedRelease> {
    let version = cache.latest_version.as_deref().filter(|v| !v.is_empty())?;
    Some(PublishedRelease {
        version: version.to_owned(),
        notes: cache.latest_notes.clone().unwrap_or_default(),
        html_url: cache
            .latest_html_url
            .clone()
            .unwrap_or_else(|| github_release_html_url(version)),
        assets: cache.assets.clone(),
    })
}

/// `resolvePublishedRelease` without `forceRefresh` (only the desktop path sets it).
pub fn resolve_published_release(
    channel: Channel,
    harnesstap_dir: &Path,
    now_ms: i64,
    fetch: &dyn UpdateFetch,
    package_version: &str,
) -> Option<PublishedRelease> {
    let cache = load_update_check_cache(harnesstap_dir);
    if is_update_lookup_fresh(&cache, now_ms) {
        return release_from_cache(&cache);
    }
    let Some(release) = lookup_published_release(channel, fetch, package_version) else {
        return release_from_cache(&cache);
    };
    let updated = UpdateCheckCache {
        last_lookup_at: Some(to_iso_string(now_ms)),
        latest_version: Some(release.version.clone()),
        latest_notes: Some(release.notes.clone()),
        latest_html_url: Some(release.html_url.clone()),
        assets: release.assets.clone(),
        ..cache.clone()
    };
    match save_update_check_cache(harnesstap_dir, &updated) {
        Ok(()) => Some(release),
        Err(_) => release_from_cache(&cache),
    }
}

pub fn format_cli_update_notice(notice: &CliUpdateNotice) -> String {
    format!(
        "A newer HarnessTap CLI is available: {} → {}. Install: {}",
        notice.current_version, notice.latest_version, notice.install_hint
    )
}

pub fn should_skip_cli_update_notice(argv: &[String], env: &Env) -> bool {
    if env_is(env, "HARNESSTAP_SKIP_UPDATE_CHECK", "1")
        || env_is(env, "HARNESSTAP_SKIP_UPDATE_CHECK", "true")
    {
        return true;
    }
    if !env_is(env, "HARNESSTAP_UPDATE_CHECK", "1")
        && (env.get("BUN_TEST").is_some_and(|v| !v.is_empty()) || env_is(env, "NODE_ENV", "test"))
    {
        return true;
    }
    let args = argv.get(2..).unwrap_or_default();
    if matches!(
        args.first().map(String::as_str),
        Some("__complete" | "completion")
    ) {
        return true;
    }
    if args.iter().any(|a| a == "--json") {
        return true;
    }
    args.iter().enumerate().any(|(i, token)| {
        (token == "--format" && args.get(i + 1).is_some_and(|n| n == "json"))
            || token == "--format=json"
    })
}

/// The inputs `maybeNotifyCliUpdate` reads from its options and from `process`.
pub struct NotifyOptions<'a> {
    /// Node-shaped: `[runtime, script, ...args]`; `argv[1]` picks the install channel.
    pub argv: &'a [String],
    pub env: &'a Env,
    pub harnesstap_dir: &'a Path,
    pub current_version: &'a str,
    /// `PACKAGE_VERSION`, for the lookups' User-Agent.
    pub package_version: &'a str,
    pub now_ms: i64,
    /// `process.exitCode` after the action.
    pub exit_code: Option<i32>,
}

/// `maybeNotifyCliUpdate`: prints the notice once per newer version. Never fails.
pub fn maybe_notify_cli_update(
    options: &NotifyOptions,
    fetch: &dyn UpdateFetch,
    write_notice: &mut dyn FnMut(&str),
) -> Option<CliUpdateNotice> {
    if should_skip_cli_update_notice(options.argv, options.env) {
        return None;
    }
    if options.exit_code.is_some_and(|c| c != 0) {
        return None;
    }
    let dir = options.harnesstap_dir;
    let script = options.argv.get(1).map_or("", String::as_str);
    let channel = detect_cli_install_channel(script, options.env);
    let release =
        resolve_published_release(channel, dir, options.now_ms, fetch, options.package_version)?;
    if !is_newer_published_version(&release.version, options.current_version) {
        return None;
    }
    if load_update_check_cache(dir).notified_version.as_deref() == Some(release.version.as_str()) {
        return None;
    }
    let notice = CliUpdateNotice {
        current_version: normalize_published_version(options.current_version),
        latest_version: release.version.clone(),
        channel,
        install_hint: cli_install_hint(
            channel,
            &release.version,
            is_homebrew_cli_install(script, options.env),
        ),
        html_url: release.html_url,
    };
    write_notice(&format_cli_update_notice(&notice));
    let cache = UpdateCheckCache {
        notified_version: Some(release.version),
        ..load_update_check_cache(dir)
    };
    // The original's swallow-all catch: a failed save drops the notice it already printed.
    save_update_check_cache(dir, &cache).ok()?;
    Some(notice)
}

const MAX_TIME_MS: i64 = 8_640_000_000_000_000;

/// `Date.parse` for the ECMAScript date time string format. A date-time with no
/// offset is read as UTC.
// ponytail: the original reads it in local time, and V8 also accepts legacy
// non-ISO forms; both are read as invalid here (a fresh lookup), see MAP.md.
pub fn date_parse(s: &str) -> Option<i64> {
    let mut c = Cursor {
        b: s.as_bytes(),
        i: 0,
    };
    let year = match c.peek() {
        Some(sign @ (b'+' | b'-')) => {
            c.i += 1;
            let y = c.digits(6)?;
            if sign == b'-' {
                if y == 0 {
                    return None;
                }
                -y
            } else {
                y
            }
        }
        _ => c.digits(4)?,
    };
    let (mut month, mut day) = (1, 1);
    if c.eat(b'-') {
        month = c.digits(2)?;
        if c.eat(b'-') {
            day = c.digits(2)?;
        }
    }
    let (mut h, mut m, mut sec, mut ms, mut offset) = (0, 0, 0, 0, 0);
    if c.eat(b'T') {
        h = c.digits(2)?;
        if !c.eat(b':') {
            return None;
        }
        m = c.digits(2)?;
        if c.eat(b':') {
            sec = c.digits(2)?;
            if c.eat(b'.') {
                let start = c.i;
                while c.peek().is_some_and(|b| b.is_ascii_digit()) {
                    c.i += 1;
                }
                let frac = &s[start..c.i];
                if frac.is_empty() {
                    return None;
                }
                ms = format!("{:0<3}", &frac[..frac.len().min(3)]).parse().ok()?;
            }
        }
        if !c.eat(b'Z')
            && let Some(sign @ (b'+' | b'-')) = c.peek()
        {
            c.i += 1;
            let oh = c.digits(2)?;
            if !c.eat(b':') {
                return None;
            }
            let om = c.digits(2)?;
            if oh > 23 || om > 59 {
                return None;
            }
            offset = (oh * 60 + om) * if sign == b'-' { -1 } else { 1 };
        }
    }
    let valid = c.i == s.len()
        && (1..=12).contains(&month)
        && (1..=31).contains(&day)
        && m <= 59
        && sec <= 59
        && (h < 24 || (h == 24 && m == 0 && sec == 0 && ms == 0));
    if !valid {
        return None;
    }
    let t = days_from_civil(year, month, day) * 86_400_000
        + ((h * 60 + m - offset) * 60 + sec) * 1000
        + ms;
    (t.abs() <= MAX_TIME_MS).then_some(t)
}

struct Cursor<'a> {
    b: &'a [u8],
    i: usize,
}

impl Cursor<'_> {
    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }
    fn eat(&mut self, b: u8) -> bool {
        let hit = self.peek() == Some(b);
        self.i += usize::from(hit);
        hit
    }
    fn digits(&mut self, n: usize) -> Option<i64> {
        let chunk = self.b.get(self.i..self.i + n)?;
        if !chunk.iter().all(u8::is_ascii_digit) {
            return None;
        }
        self.i += n;
        Some(
            chunk
                .iter()
                .fold(0, |acc, d| acc * 10 + i64::from(d - b'0')),
        )
    }
}

/// Days since 1970-01-01; a day past the month's end rolls over, like `MakeDay`.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + d - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

/// `new Date(ms).toISOString()`.
pub fn to_iso_string(ms: i64) -> String {
    let z = ms.div_euclid(86_400_000) + 719_468;
    let t = ms.rem_euclid(86_400_000);
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    let year = if (0..=9999).contains(&y) {
        format!("{y:04}")
    } else {
        format!("{}{:06}", if y < 0 { '-' } else { '+' }, y.abs())
    };
    format!(
        "{year}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        t / 3_600_000,
        t / 60_000 % 60,
        t / 1000 % 60,
        t % 1000
    )
}

/// An [`UpdateFetch`] over HTTPS with `ureq`.
#[cfg(feature = "http")]
pub struct HttpFetch;

#[cfg(feature = "http")]
impl UpdateFetch for HttpFetch {
    fn fetch(
        &self,
        url: &str,
        headers: &[(&str, &str)],
        timeout_ms: u64,
    ) -> Result<FetchResponse, String> {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_millis(timeout_ms)))
            .http_status_as_error(false)
            .build()
            .into();
        let mut request = agent.get(url);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let mut response = request.call().map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let body = response
            .body_mut()
            .read_to_vec()
            .map_err(|e| e.to_string())?;
        Ok(FetchResponse { status, body })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_dates_round_trip() {
        for ms in [
            0,
            1_795_773_600_123,
            -1,
            253_402_300_800_000,
            -62_198_755_200_000,
        ] {
            assert_eq!(
                date_parse(&to_iso_string(ms)),
                Some(ms),
                "{}",
                to_iso_string(ms)
            );
        }
        assert_eq!(
            to_iso_string(253_402_300_800_000),
            "+010000-01-01T00:00:00.000Z"
        );
        assert_eq!(date_parse("2026-02-30"), date_parse("2026-03-02"));
    }
}
