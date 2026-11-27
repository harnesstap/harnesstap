//! Port of the decision logic in `src/services/apm-git-resolve.ts`: ref classification, the
//! canonical lockfile `repo_url`, virtual path checks, `git ls-remote` parsing, semver tag
//! selection, lock replay, and `resolveApmGitDependency` with `git` behind a callback. Also
//! `githubHttpsRemoteForAuth` from `github-credentials.ts`.
//!
//! Not ported here: the checkout (`checkoutApmGitCommit`), the package cache entry, and token
//! resolution. The caller passes the remote rewrite (`authorizedGitRemote`) and runs `git` with
//! its credential `-c` arguments; the callback sees the arguments after them.

use lockfile_rs::LockEntry;
use node_semver_rs::Options;
use serde::Serialize;

use crate::dependencies::{ParsedApmDependency, SourceKind, clone_url_from_origin};

/// `ApmGitResolveError`, or the `PathEscapeError` that `assertContainedPath` throws.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitResolveError {
    pub name: &'static str,
    pub message: String,
}

impl GitResolveError {
    fn resolve(message: String) -> Self {
        Self {
            name: "ApmGitResolveError",
            message,
        }
    }
}

impl std::fmt::Display for GitResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.name, self.message)
    }
}

impl std::error::Error for GitResolveError {}

/// `ApmGitRefKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    Semver,
    Literal,
    None,
}

/// `/^[0-9a-f]{40}$/i`.
pub fn is_full_sha(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `/^v?\d+\.\d+\.\d+$/`.
fn is_literal_semver_tag(s: &str) -> bool {
    let s = s.strip_prefix('v').unwrap_or(s);
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

/// `/[\^~><*=xX]| \|\|| - /`.
fn has_range_operator(s: &str) -> bool {
    s.contains(['^', '~', '>', '<', '*', '=', 'x', 'X']) || s.contains(" ||") || s.contains(" - ")
}

/// `classifyApmGitRef`.
pub fn classify_apm_git_ref(git_ref: Option<&str>) -> RefKind {
    let Some(r) = git_ref else {
        return RefKind::None;
    };
    let trimmed = emit_rs::js::trim(r);
    if trimmed.is_empty() {
        return RefKind::None;
    }
    if is_full_sha(trimmed) || is_literal_semver_tag(trimmed) {
        return RefKind::Literal;
    }
    if node_semver_rs::valid_range(trimmed, Options::STRICT).is_some()
        && has_range_operator(trimmed)
    {
        return RefKind::Semver;
    }
    RefKind::Literal
}

/// JavaScript's `.` : anything but a line terminator.
fn has_line_terminator(s: &str) -> bool {
    s.contains(['\n', '\r', '\u{2028}', '\u{2029}'])
}

/// `canonicalApmRepoUrl`: host plus repository path, no scheme or `.git`.
pub fn canonical_apm_repo_url(origin_ref: &str) -> String {
    let clone_url = clone_url_from_origin(emit_rs::js::trim(origin_ref));

    // /^git@([^:]+):(.+)$/
    if let Some(rest) = clone_url.strip_prefix("git@")
        && let Some((host, path)) = rest.split_once(':')
        && !host.is_empty()
        && !path.is_empty()
        && !has_line_terminator(path)
    {
        return format!("{}/{}", host.to_lowercase(), strip_git_suffix(path));
    }

    // /^ssh:\/\/git@([^/]+)\/(.+)$/
    if let Some(rest) = clone_url.strip_prefix("ssh://git@")
        && let Some((host, path)) = rest.split_once('/')
        && !host.is_empty()
        && !path.is_empty()
        && !has_line_terminator(path)
    {
        return format!(
            "{}/{}",
            host_without_default_port(host),
            strip_git_suffix(path)
        );
    }

    match url::Url::parse(&clone_url) {
        Ok(parsed) => {
            let host = host_without_default_port(&url_host(&parsed));
            let path = strip_git_suffix(parsed.path().trim_start_matches('/'));
            if parsed.scheme() == "file" {
                return format!("file:///{path}");
            }
            if host.is_empty() {
                path
            } else {
                format!("{host}/{path}")
            }
        }
        Err(_) => {
            let without = clone_url
                .strip_prefix("https://")
                .or_else(|| clone_url.strip_prefix("http://"))
                .unwrap_or(&clone_url);
            strip_git_suffix(without)
        }
    }
}

/// `URL.prototype.host`: hostname plus a non-default port.
fn url_host(parsed: &url::Url) -> String {
    match (parsed.host_str(), parsed.port()) {
        (Some(h), Some(p)) => format!("{h}:{p}"),
        (Some(h), None) => h.to_owned(),
        (None, _) => String::new(),
    }
}

/// `hostWithoutDefaultPort`: each suffix is stripped once, in this order.
fn host_without_default_port(host: &str) -> String {
    let mut s = host.to_lowercase();
    for port in [":443", ":22", ":80", ":9418"] {
        if let Some(stripped) = s.strip_suffix(port) {
            s = stripped.to_owned();
        }
    }
    s
}

/// `stripGitSuffix`.
fn strip_git_suffix(value: &str) -> String {
    let trimmed = value.trim_end_matches('/');
    let n = trimmed.len();
    if n >= 4 && trimmed.is_char_boundary(n - 4) && trimmed[n - 4..].eq_ignore_ascii_case(".git") {
        trimmed[..n - 4].to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// `hasParentTraversalSegment`.
fn has_parent_traversal_segment(entry: &str) -> bool {
    entry.split(['\\', '/']).any(|s| s == "..")
}

/// `assertSafeApmVirtualPath`.
pub fn assert_safe_apm_virtual_path(path: &str) -> Result<(), GitResolveError> {
    let replaced = path.replace('\\', "/");
    let normalized = replaced.strip_prefix("./").unwrap_or(&replaced);
    if normalized.is_empty() || normalized == "." {
        return Err(GitResolveError::resolve(
            "dependencies.apm path must be a non-empty repository subpath".into(),
        ));
    }
    if normalized.starts_with('/') || has_parent_traversal_segment(normalized) {
        return Err(GitResolveError::resolve(format!(
            "Unsafe dependencies.apm path {path}: apply aborted closed"
        )));
    }
    // assertContainedPath(".", normalized): with no `..` and no leading `/`, the only way out
    // is a path that resolves to the root itself (only `.` and empty segments).
    if normalized.split('/').all(|s| s.is_empty() || s == ".") {
        return Err(GitResolveError {
            name: "PathEscapeError",
            message: format!("Path escapes the package root: {normalized} (root: .)"),
        });
    }
    Ok(())
}

/// `isApmVirtualFilePath`.
pub fn is_apm_virtual_file_path(path: &str) -> bool {
    let lowered = path.replace('\\', "/").to_lowercase();
    [".prompt.md", ".instructions.md", ".agent.md"]
        .iter()
        .any(|s| lowered.ends_with(s))
}

/// `RemoteRef`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RemoteRef {
    pub sha: String,
    pub name: String,
    pub peeled: bool,
}

/// `parseLsRemote`.
pub fn parse_ls_remote(stdout: &str) -> Vec<RemoteRef> {
    let mut refs = Vec::new();
    for line in stdout.split('\n') {
        let Some(tab) = line.find('\t') else { continue };
        if tab == 0 {
            continue;
        }
        let sha = emit_rs::js::trim(&line[..tab]).to_lowercase();
        let raw_name = emit_rs::js::trim(&line[tab + 1..]);
        if !is_full_sha(&sha) || raw_name.is_empty() {
            continue;
        }
        let (name, peeled) = match raw_name.strip_suffix("^{}") {
            Some(n) => (n, true),
            None => (raw_name, false),
        };
        refs.push(RemoteRef {
            sha,
            name: name.to_owned(),
            peeled,
        });
    }
    refs
}

/// `shaForRefName`.
pub fn sha_for_ref_name(refs: &[RemoteRef], name: &str) -> Option<String> {
    let suffix = format!("/{name}");
    let matches: Vec<&RemoteRef> = refs
        .iter()
        .filter(|e| e.name == name || e.name.ends_with(&suffix))
        .collect();
    matches
        .iter()
        .find(|e| e.peeled)
        .or(matches.first())
        .map(|e| e.sha.clone())
}

/// A selected tag: `{ tag, version }`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SemverTag {
    pub tag: String,
    pub version: String,
}

/// `tagSemver`.
fn tag_semver(tag_name: &str) -> Option<SemverTag> {
    let name = tag_name.strip_prefix("refs/tags/").unwrap_or(tag_name);
    let without_v = name.strip_prefix('v').unwrap_or(name);
    node_semver_rs::valid(without_v, Options::STRICT)?;
    Some(SemverTag {
        tag: name.to_owned(),
        version: without_v.to_owned(),
    })
}

/// `selectSemverTag`.
pub fn select_semver_tag<S: AsRef<str>>(range: &str, tag_names: &[S]) -> Option<SemverTag> {
    let mut candidates: Vec<SemverTag> = tag_names
        .iter()
        .filter_map(|t| tag_semver(t.as_ref()))
        .filter(|c| node_semver_rs::satisfies(c.version.as_str(), range, Options::STRICT))
        .collect();
    // A stable sort, like V8's: rcompare on version, then the tag in reverse UTF-16 order.
    candidates.sort_by(|l, r| {
        let by_version =
            node_semver_rs::rcompare(l.version.as_str(), r.version.as_str(), Options::STRICT)
                .unwrap_or(0);
        if by_version != 0 {
            return by_version.cmp(&0);
        }
        r.tag.encode_utf16().cmp(l.tag.encode_utf16())
    });
    candidates.into_iter().next()
}

/// `lockMatchesDependency`.
fn lock_matches_dependency(entry: &LockEntry, dependency: &ParsedApmDependency) -> bool {
    let repo_url = canonical_apm_repo_url(&dependency.origin_ref);
    let entry_repo = entry.repo_url.as_deref().filter(|s| !s.is_empty());
    match entry_repo {
        Some(r) if r != repo_url => return false,
        None if entry.name != dependency.name => return false,
        _ => {}
    }
    entry.virtual_path.as_deref().unwrap_or("") == dependency.path.as_deref().unwrap_or("")
}

/// `findLockedGit`.
pub fn find_locked_git<'a>(
    lock: Option<&'a [LockEntry]>,
    dependency: &ParsedApmDependency,
) -> Option<&'a LockEntry> {
    lock?
        .iter()
        .find(|e| lock_matches_dependency(e, dependency))
}

/// `canReplayLock`.
pub fn can_replay_lock(entry: &LockEntry, dependency: &ParsedApmDependency, kind: RefKind) -> bool {
    match entry.resolved_commit.as_deref() {
        Some(c) if !c.is_empty() && is_full_sha(c) => {}
        _ => return false,
    }
    match kind {
        RefKind::None => true,
        RefKind::Semver => {
            let constraint = dependency
                .version_constraint
                .as_deref()
                .or(dependency.git_ref.as_deref())
                .unwrap_or("");
            entry
                .constraint
                .as_deref()
                .is_some_and(|c| !c.is_empty() && c == constraint)
        }
        RefKind::Literal => {
            let declared = dependency
                .git_ref
                .as_deref()
                .or(dependency.version_constraint.as_deref())
                .unwrap_or("");
            let locked = entry.resolved_ref.as_deref().unwrap_or("");
            declared == locked
        }
    }
}

/// `CommandResult`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// `ApmGitResolution`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApmGitResolution {
    pub name: String,
    pub clone_url: String,
    pub repo_url: String,
    pub commit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub constraint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub virtual_path: Option<String>,
    pub replayed: bool,
}

/// `ResolveApmGitOptions`, with `runCommand` split out.
#[derive(Clone, Copy, Debug, Default)]
pub struct ResolveOptions<'a> {
    pub update: bool,
    /// `lock?.plugins`.
    pub lock: Option<&'a [LockEntry]>,
}

/// How `resolveApmGitDependency` reaches git: `authorizedGitRemote` and `runGit` (which adds
/// the credential arguments and the clone timeout).
pub trait Git {
    fn authorized_remote(&mut self, url: &str) -> String;
    fn run(&mut self, args: &[String]) -> CommandResult;
}

fn failure(stderr: &str, fallback: &str) -> String {
    let t = emit_rs::js::trim(stderr);
    if t.is_empty() { fallback } else { t }.to_owned()
}

fn list_remote_tags(git: &mut dyn Git, clone_url: &str) -> Result<Vec<RemoteRef>, GitResolveError> {
    let remote = git.authorized_remote(clone_url);
    let result = git.run(&["ls-remote".into(), "--tags".into(), remote]);
    if result.exit_code != 0 {
        return Err(GitResolveError::resolve(format!(
            "Failed to list tags for {clone_url}: {}",
            failure(&result.stderr, "git ls-remote failed")
        )));
    }
    Ok(parse_ls_remote(&result.stdout))
}

fn resolve_literal_ref(
    git: &mut dyn Git,
    clone_url: &str,
    r: &str,
) -> Result<String, GitResolveError> {
    if is_full_sha(r) {
        let remote = git.authorized_remote(clone_url);
        let probe = git.run(&["ls-remote".into(), remote, r.into()]);
        if probe.exit_code == 0 {
            let sha = parse_ls_remote(&probe.stdout)
                .into_iter()
                .next()
                .map(|e| e.sha)
                .unwrap_or_else(|| r.to_lowercase());
            if is_full_sha(&sha) {
                return Ok(sha);
            }
        }
        return Ok(r.to_lowercase());
    }
    let remote = git.authorized_remote(clone_url);
    let listed = git.run(&[
        "ls-remote".into(),
        remote,
        r.into(),
        format!("refs/heads/{r}"),
        format!("refs/tags/{r}"),
    ]);
    if listed.exit_code != 0 {
        return Err(GitResolveError::resolve(format!(
            "Failed to resolve {r} for {clone_url}: {}",
            failure(&listed.stderr, "git ls-remote failed")
        )));
    }
    let refs = parse_ls_remote(&listed.stdout);
    sha_for_ref_name(&refs, &format!("refs/tags/{r}"))
        .or_else(|| sha_for_ref_name(&refs, &format!("refs/heads/{r}")))
        .or_else(|| sha_for_ref_name(&refs, r))
        .or_else(|| refs.first().map(|e| e.sha.clone()))
        .ok_or_else(|| {
            GitResolveError::resolve(format!(
                "Could not resolve git ref {r} for {clone_url}: apply aborted closed"
            ))
        })
}

fn resolve_head(git: &mut dyn Git, clone_url: &str) -> Result<String, GitResolveError> {
    let remote = git.authorized_remote(clone_url);
    let result = git.run(&["ls-remote".into(), remote, "HEAD".into()]);
    if result.exit_code != 0 {
        return Err(GitResolveError::resolve(format!(
            "Failed to resolve HEAD for {clone_url}: {}",
            failure(&result.stderr, "git ls-remote failed")
        )));
    }
    parse_ls_remote(&result.stdout)
        .into_iter()
        .next()
        .map(|e| e.sha)
        .ok_or_else(|| {
            GitResolveError::resolve(format!(
                "Could not resolve HEAD for {clone_url}: apply aborted closed"
            ))
        })
}

fn nonempty(s: Option<&str>) -> Option<String> {
    s.filter(|s| !s.is_empty()).map(str::to_owned)
}

/// `resolveApmGitDependency`. `now` is `new Date().toISOString()`.
pub fn resolve_apm_git_dependency(
    dependency: &ParsedApmDependency,
    options: ResolveOptions<'_>,
    git: &mut dyn Git,
    now: &str,
) -> Result<ApmGitResolution, GitResolveError> {
    if dependency.source_kind != SourceKind::Git {
        let kind = serde_json::to_value(dependency.source_kind).unwrap_or_default();
        return Err(GitResolveError::resolve(format!(
            "Expected a git dependency, got {}",
            kind.as_str().unwrap_or("")
        )));
    }
    let virtual_path = nonempty(dependency.path.as_deref());
    if let Some(p) = &virtual_path {
        assert_safe_apm_virtual_path(p)?;
    }

    let clone_url = clone_url_from_origin(&dependency.origin_ref);
    let repo_url = canonical_apm_repo_url(&clone_url);
    let declared = dependency
        .git_ref
        .as_deref()
        .or(dependency.version_constraint.as_deref());
    let kind = classify_apm_git_ref(declared);
    let locked = if options.update {
        None
    } else {
        find_locked_git(options.lock, dependency)
    };

    let base = |commit: String| ApmGitResolution {
        name: dependency.name.clone(),
        clone_url: clone_url.clone(),
        repo_url: repo_url.clone(),
        commit,
        resolved_ref: None,
        constraint: None,
        resolved_tag: None,
        resolved_at: None,
        virtual_path: virtual_path.clone(),
        replayed: false,
    };

    if let Some(locked) = locked
        && can_replay_lock(locked, dependency, kind)
    {
        // canReplayLock already checked the commit, so the original's second check never throws.
        let commit = locked
            .resolved_commit
            .as_deref()
            .unwrap_or("")
            .to_lowercase();
        return Ok(ApmGitResolution {
            resolved_ref: nonempty(locked.resolved_ref.as_deref()),
            constraint: nonempty(locked.constraint.as_deref()),
            resolved_tag: nonempty(locked.resolved_tag.as_deref()),
            replayed: true,
            ..base(commit)
        });
    }

    let declared = declared.unwrap_or("").to_owned();
    match kind {
        RefKind::Semver => {
            let tags = list_remote_tags(git, &clone_url)?;
            let mut tag_names: Vec<String> = Vec::new();
            for t in &tags {
                let n = t.name.strip_prefix("refs/tags/").unwrap_or(&t.name);
                if !tag_names.iter().any(|x| x == n) {
                    tag_names.push(n.to_owned());
                }
            }
            let selected = select_semver_tag(&declared, &tag_names).ok_or_else(|| {
                GitResolveError::resolve(format!(
                    "No git tag satisfies {declared} for {clone_url}: apply aborted closed"
                ))
            })?;
            let sha = match sha_for_ref_name(&tags, &format!("refs/tags/{}", selected.tag)) {
                Some(s) => s,
                None => resolve_literal_ref(git, &clone_url, &selected.tag)?,
            };
            Ok(ApmGitResolution {
                resolved_ref: Some(declared.clone()),
                constraint: Some(declared),
                resolved_tag: Some(selected.tag),
                resolved_at: Some(now.to_owned()),
                ..base(sha)
            })
        }
        RefKind::None => Ok(base(resolve_head(git, &clone_url)?)),
        RefKind::Literal => {
            let commit = resolve_literal_ref(git, &clone_url, &declared)?;
            Ok(ApmGitResolution {
                resolved_ref: Some(declared),
                ..base(commit)
            })
        }
    }
}

/// `githubHttpsRemoteForAuth`.
pub fn github_https_remote_for_auth(url: &str, token: Option<&str>) -> String {
    if token.is_none_or(str::is_empty) {
        return url.to_owned();
    }
    let trimmed = emit_rs::js::trim(url);
    if trimmed.is_empty() {
        return url.to_owned();
    }
    if let Ok(parsed) = url::Url::parse(trimmed)
        && matches!(parsed.scheme(), "https" | "http")
        && matches!(
            parsed.host_str(),
            Some("github.com" | "www.github.com" | "gist.github.com")
        )
    {
        return trimmed.to_owned();
    }
    if let Some((host, path)) = github_scp(trimmed) {
        let path = strip_git_suffix_once(path.trim_start_matches('/'));
        return format!("https://{host}/{path}.git");
    }
    url.to_owned()
}

/// `/\.git$/i` once, with no trailing-slash trim.
fn strip_git_suffix_once(value: &str) -> &str {
    let n = value.len();
    if n >= 4 && value.is_char_boundary(n - 4) && value[n - 4..].eq_ignore_ascii_case(".git") {
        &value[..n - 4]
    } else {
        value
    }
}

/// `/^(?:ssh:\/\/)?(?:[^@/\s]+@)?(github\.com|gist\.github\.com)[:/](.+)$/i`: returns the host
/// as written and the path.
fn github_scp(s: &str) -> Option<(&str, &str)> {
    let mut starts = vec![s];
    if s.len() >= 6 && s.is_char_boundary(6) && s[..6].eq_ignore_ascii_case("ssh://") {
        starts.insert(0, &s[6..]);
    }
    for rest in starts {
        let mut candidates = vec![rest];
        if let Some(at) = rest.find('@') {
            let user = &rest[..at];
            if !user.is_empty() && !user.contains('/') && !user.chars().any(emit_rs::js::is_space) {
                candidates.insert(0, &rest[at + 1..]);
            }
        }
        for c in candidates {
            for host in ["gist.github.com", "github.com"] {
                if c.len() > host.len()
                    && c.is_char_boundary(host.len())
                    && c[..host.len()].eq_ignore_ascii_case(host)
                {
                    let after = &c[host.len()..];
                    if let Some(path) = after.strip_prefix([':', '/'])
                        && !path.is_empty()
                        && !has_line_terminator(path)
                    {
                        return Some((&c[..host.len()], path));
                    }
                }
            }
        }
    }
    None
}
