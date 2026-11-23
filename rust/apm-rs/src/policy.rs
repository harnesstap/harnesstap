//! `apm-policy.ts`: the `apm-policy.yml` document, the install plan it is checked against, and
//! the evaluation.
//!
//! Two inputs come from code not ported yet, so the caller passes them in:
//! - `overlayPrimitives(projectRoot)` (it needs `inspectApmOverlay`, which needs gray-matter):
//!   [`build_audit_install_plan`] takes the overlay's primitives;
//! - `getPluginById` plus `recoverOriginLocator` (the plugin model): [`build_apply_install_plan`]
//!   takes a function from a plugin id to its [`PluginLocator`].

use std::path::Path;

use emit_rs::js::{ordered_entries, trim};
use lockfile_rs::{LockEntry, LockMcpServer, LockSource};
use models_rs::resource::Resource;
use resolve_rs::types::{DependencySourceKind, ResourceDecision, SelectedPlugin};
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{Map, Value};
use sha2::Digest;

use crate::dependencies::{ParsedApmDependency, ParsedMcpDependency, SourceKind};
use crate::git_resolve::canonical_apm_repo_url;

pub const APM_POLICY_FILENAME: &str = "apm-policy.yml";
const APM_MANIFEST_FILENAME: &str = "apm.yml";

/// `PolicyError`, or another error the original lets through (a picomatch `SyntaxError`, an
/// unreadable policy path).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolicyError {
    pub name: &'static str,
    pub message: String,
}

impl PolicyError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            name: "PolicyError",
            message: message.into(),
        }
    }
}

impl std::fmt::Display for PolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.name, self.message)
    }
}

impl std::error::Error for PolicyError {}

type Result<T> = std::result::Result<T, PolicyError>;

/// `PolicyHashAlgorithm`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HashAlgorithm {
    Sha256,
    Sha384,
    Sha512,
}

impl HashAlgorithm {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "sha256" => Some(Self::Sha256),
            "sha384" => Some(Self::Sha384),
            "sha512" => Some(Self::Sha512),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sha256 => "sha256",
            Self::Sha384 => "sha384",
            Self::Sha512 => "sha512",
        }
    }
}

/// `PolicyEnforcement`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Enforcement {
    Off,
    Warn,
    Block,
}

/// `PolicyFetchFailure`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FetchFailure {
    Warn,
    Block,
}

/// `PolicyPrimitive`. The derived order is the alphabetical one `.sort()` gives.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Primitive {
    Agent,
    Command,
    Hook,
    Instruction,
    Mcp,
    Skill,
}

impl Primitive {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Command => "command",
            Self::Hook => "hook",
            Self::Instruction => "instruction",
            Self::Mcp => "mcp",
            Self::Skill => "skill",
        }
    }
}

/// `ApmPolicyPin`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicyPin {
    pub hash: String,
    pub algorithm: HashAlgorithm,
}

/// `OrgExecutablePolicy`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgExecutablePolicy {
    pub present: bool,
    pub non_empty: bool,
    pub deny_all: bool,
    pub deny: Vec<String>,
    pub require: Vec<String>,
    pub recommend: Vec<String>,
    pub enforce: Vec<String>,
    pub warnings: Vec<String>,
}

/// `ApmPolicyDocument`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDocument {
    pub name: String,
    pub version: String,
    pub enforcement: Enforcement,
    pub fetch_failure: FetchFailure,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extends: Option<String>,
    pub dependencies_allow: Option<Vec<String>>,
    pub dependencies_deny: Option<Vec<String>>,
    pub mcp_allow: Option<Vec<String>>,
    pub mcp_deny: Option<Vec<String>>,
    pub trust_transitive: bool,
    pub content_types_allow: Option<Vec<String>>,
    pub executables: OrgExecutablePolicy,
    pub bin_deploy_deny_all: bool,
    pub bin_deploy_deny: Vec<String>,
    pub bin_deploy_non_empty: bool,
    pub warnings: Vec<String>,
}

fn js_number<S: Serializer>(n: &f64, s: S) -> std::result::Result<S::Ok, S::Error> {
    emit_rs::js::number_value(*n).serialize(s)
}

/// `PolicyPlanSource`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlanSource {
    pub kind: SourceKind,
    pub name: String,
    pub identity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(serialize_with = "js_number")]
    pub depth: f64,
}

/// `PolicyPlanMcp`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanMcp {
    pub name: String,
    pub identity: String,
    #[serde(serialize_with = "js_number")]
    pub depth: f64,
    pub declared_in_manifest: bool,
}

/// `PolicyInstallPlan`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct InstallPlan {
    pub sources: Vec<PlanSource>,
    pub primitives: Vec<Primitive>,
    pub mcp: Vec<PlanMcp>,
}

/// `PolicyViolation`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Violation {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
}

/// `PolicyLoadStatus`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LoadStatus {
    Evaluated,
    Skipped,
    Failed,
}

/// `PolicyLoadResult`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub status: LoadStatus,
    /// Always `"no-policy"` when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped_reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy: Option<PolicyDocument>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pin: Option<PolicyPin>,
    pub warnings: Vec<String>,
    pub violations: Vec<Violation>,
}

/// `PolicyEvaluation`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evaluation {
    pub status: LoadStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped_reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub enforcement: Enforcement,
    pub warnings: Vec<String>,
    pub violations: Vec<Violation>,
    pub blocks: bool,
}

fn as_record(value: Option<&Value>) -> Option<&Map<String, Value>> {
    value.and_then(Value::as_object)
}

fn is_absent(value: Option<&Value>) -> bool {
    matches!(value, None | Some(Value::Null))
}

/// `/^x-[a-z][a-z0-9-]*$/`.
fn is_vendor_extension_key(key: &str) -> bool {
    let Some(rest) = key.strip_prefix("x-") else {
        return false;
    };
    let mut chars = rest.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// `stringList`.
fn string_list(value: Option<&Value>, field: &str) -> Result<Option<Vec<String>>> {
    if is_absent(value) {
        return Ok(None);
    }
    let Some(Value::Array(items)) = value else {
        return Err(PolicyError::new(format!("{field} must be a list or null")));
    };
    items
        .iter()
        .enumerate()
        .map(|(i, entry)| match entry {
            Value::String(s) if !trim(s).is_empty() => Ok(trim(s).to_owned()),
            _ => Err(PolicyError::new(format!(
                "{field}[{i}] must be a non-empty string"
            ))),
        })
        .collect::<Result<Vec<_>>>()
        .map(Some)
}

/// `parseEnum`.
fn parse_enum<T: Copy>(
    value: Option<&Value>,
    allowed: &[(&str, T)],
    field: &str,
    fallback: T,
) -> Result<T> {
    match value {
        None | Some(Value::Null) => Ok(fallback),
        Some(Value::String(s)) if s.is_empty() => Ok(fallback),
        Some(Value::String(s)) => match allowed.iter().find(|(name, _)| name == s) {
            Some((_, v)) => Ok(*v),
            None => Err(enum_error(allowed, field)),
        },
        Some(_) => Err(enum_error(allowed, field)),
    }
}

fn enum_error<T>(allowed: &[(&str, T)], field: &str) -> PolicyError {
    let names: Vec<&str> = allowed.iter().map(|(n, _)| *n).collect();
    PolicyError::new(format!("{field} must be one of: {}", names.join(", ")))
}

const ENFORCEMENTS: &[(&str, Enforcement)] = &[
    ("off", Enforcement::Off),
    ("warn", Enforcement::Warn),
    ("block", Enforcement::Block),
];
const FETCH_FAILURES: &[(&str, FetchFailure)] =
    &[("warn", FetchFailure::Warn), ("block", FetchFailure::Block)];

const KNOWN_TOP_LEVEL: &[&str] = &[
    "name",
    "version",
    "extends",
    "enforcement",
    "fetch_failure",
    "cache",
    "dependencies",
    "mcp",
    "compilation",
    "manifest",
    "unmanaged_files",
    "security",
    "registry_source",
    "executables",
    "bin_deploy",
    "discovery",
];

/// `parsePolicyHashAlgorithm`.
pub fn parse_policy_hash_algorithm(hash: &str, explicit: Option<&Value>) -> Result<HashAlgorithm> {
    const BAD: &str = "policy.hash_algorithm must be sha256, sha384, or sha512";
    match explicit {
        None | Some(Value::Null) => {}
        Some(Value::String(s)) if s.is_empty() => {}
        Some(Value::String(s)) => {
            return HashAlgorithm::parse(&s.to_lowercase()).ok_or_else(|| PolicyError::new(BAD));
        }
        Some(_) => return Err(PolicyError::new("policy.hash_algorithm must be a string")),
    }
    let prefix = hash.split(':').next().unwrap_or("").to_lowercase();
    HashAlgorithm::parse(&prefix).ok_or_else(|| {
        PolicyError::new(
            "policy.hash must include a sha256:, sha384:, or sha512: prefix, or set policy.hash_algorithm",
        )
    })
}

/// `parseApmPolicyPin`.
pub fn parse_apm_policy_pin(value: Option<&Value>) -> Result<Option<PolicyPin>> {
    if is_absent(value) {
        return Ok(None);
    }
    let Some(record) = as_record(value) else {
        return Err(PolicyError::new("apm.yml policy must be a mapping"));
    };
    let hash = match record.get("hash") {
        Some(Value::String(h)) if !trim(h).is_empty() => trim(h).to_owned(),
        _ => return Ok(None),
    };
    let algorithm = parse_policy_hash_algorithm(&hash, record.get("hash_algorithm"))?;
    Ok(Some(PolicyPin { hash, algorithm }))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `hashPolicyBytes`.
pub fn hash_policy_bytes(bytes: &[u8], algorithm: HashAlgorithm) -> String {
    let digest = match algorithm {
        HashAlgorithm::Sha256 => hex(&sha2::Sha256::digest(bytes)),
        HashAlgorithm::Sha384 => hex(&sha2::Sha384::digest(bytes)),
        HashAlgorithm::Sha512 => hex(&sha2::Sha512::digest(bytes)),
    };
    format!("{}:{digest}", algorithm.as_str())
}

/// `policyHashesMatch`.
pub fn policy_hashes_match(expected: &str, actual: &str) -> bool {
    trim(expected).to_lowercase() == trim(actual).to_lowercase()
}

/// `normalizeContentType`.
pub fn normalize_content_type(value: &str) -> Option<Primitive> {
    match trim(value).to_lowercase().as_str() {
        "skill" | "skills" => Some(Primitive::Skill),
        "agent" | "agents" => Some(Primitive::Agent),
        "command" | "commands" | "prompt" | "prompts" => Some(Primitive::Command),
        "hook" | "hooks" => Some(Primitive::Hook),
        "instruction" | "instructions" | "rule" | "rules" => Some(Primitive::Instruction),
        "mcp" | "mcp_server" | "mcp-server" => Some(Primitive::Mcp),
        _ => None,
    }
}

/// `primitiveFromResourceType`.
pub fn primitive_from_resource_type(resource_type: &str) -> Option<Primitive> {
    match resource_type {
        "skill" => Some(Primitive::Skill),
        "agent" => Some(Primitive::Agent),
        "command" => Some(Primitive::Command),
        "hook" => Some(Primitive::Hook),
        "instruction" | "rule" => Some(Primitive::Instruction),
        "mcp_server" => Some(Primitive::Mcp),
        _ => None,
    }
}

/// `parseYamlMapping`. The `yaml` package's error text is not reproduced by `yaml-rs`, so the
/// part after `Invalid YAML in <path>: ` differs from the original's.
fn parse_yaml_mapping(raw: &str, file_path: &str) -> Result<Map<String, Value>> {
    match yaml_rs::parse(raw) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err(PolicyError::new(format!(
            "{file_path} must be a YAML mapping"
        ))),
        Err(e) => Err(PolicyError::new(format!(
            "Invalid YAML in {file_path}: {e}"
        ))),
    }
}

/// `parseApmPolicyDocument`.
pub fn parse_apm_policy_document(raw: &str, file_path: &str) -> Result<PolicyDocument> {
    let document = parse_yaml_mapping(raw, file_path)?;
    let mut warnings = Vec::new();
    for (key, _) in ordered_entries(&document) {
        if is_vendor_extension_key(key) || KNOWN_TOP_LEVEL.contains(&key.as_str()) {
            continue;
        }
        warnings.push(format!("Unknown top-level policy key {key} is ignored"));
    }

    let empty = Map::new();
    let dependencies = as_record(document.get("dependencies")).unwrap_or(&empty);
    let mcp = as_record(document.get("mcp")).unwrap_or(&empty);
    let manifest = as_record(document.get("manifest")).unwrap_or(&empty);
    let content_types = as_record(manifest.get("content_types")).unwrap_or(&empty);

    let content_types_allow =
        string_list(content_types.get("allow"), "manifest.content_types.allow")?;
    for entry in content_types_allow.iter().flatten() {
        if normalize_content_type(entry).is_none() {
            return Err(PolicyError::new(format!(
                "manifest.content_types.allow entry {entry} is not a supported primitive"
            )));
        }
    }

    let extends_ref = match document.get("extends") {
        Some(Value::String(s)) if !trim(s).is_empty() => Some(trim(s).to_owned()),
        _ => None,
    };
    let fetch_failure = parse_enum(
        document.get("fetch_failure"),
        FETCH_FAILURES,
        "fetch_failure",
        FetchFailure::Warn,
    )?;
    if extends_ref.is_some() {
        let message =
            "apm-policy.yml extends is not fetched in this slice; inline the parent rules";
        if fetch_failure == FetchFailure::Block {
            return Err(PolicyError::new(message));
        }
        warnings.push(message.to_owned());
    }

    let executables = parse_org_executables(document.get("executables"))?;
    let (bin_deny_all, bin_deny, bin_non_empty) = parse_bin_deploy(document.get("bin_deploy"))?;
    warnings.extend(executables.warnings.iter().cloned());

    let text = |key: &str| match document.get(key) {
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };
    Ok(PolicyDocument {
        name: text("name"),
        version: text("version"),
        enforcement: parse_enum(
            document.get("enforcement"),
            ENFORCEMENTS,
            "enforcement",
            Enforcement::Warn,
        )?,
        fetch_failure,
        extends: extends_ref,
        dependencies_allow: string_list(dependencies.get("allow"), "dependencies.allow")?,
        dependencies_deny: string_list(dependencies.get("deny"), "dependencies.deny")?,
        mcp_allow: string_list(mcp.get("allow"), "mcp.allow")?,
        mcp_deny: string_list(mcp.get("deny"), "mcp.deny")?,
        trust_transitive: mcp.get("trust_transitive") == Some(&Value::Bool(true)),
        content_types_allow,
        executables,
        bin_deploy_deny_all: bin_deny_all,
        bin_deploy_deny: bin_deny,
        bin_deploy_non_empty: bin_non_empty,
        warnings,
    })
}

fn check_deny_all(value: &Map<String, Value>, field: &str) -> Result<bool> {
    match value.get("deny_all") {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(PolicyError::new(format!(
            "{field}.deny_all must be a boolean"
        ))),
    }
}

/// `parseOrgExecutables`. `None` is `undefined` (no key), `Some(Null)` is an explicit null.
pub fn parse_org_executables(value: Option<&Value>) -> Result<OrgExecutablePolicy> {
    let record = match value {
        None => return Ok(OrgExecutablePolicy::default()),
        Some(Value::Null) => {
            return Ok(OrgExecutablePolicy {
                present: true,
                ..Default::default()
            });
        }
        Some(Value::Object(m)) => m,
        Some(_) => return Err(PolicyError::new("executables must be a mapping")),
    };
    let list = |key: &str| -> Result<Vec<String>> {
        Ok(string_list(record.get(key), &format!("executables.{key}"))?.unwrap_or_default())
    };
    let deny = list("deny")?;
    let require = list("require")?;
    let recommend = list("recommend")?;
    let enforce = list("enforce")?;
    let mut warnings = Vec::new();
    if !enforce.is_empty() {
        warnings.push(
            "executables.enforce is accepted but inert in this release; treated as recommend"
                .to_owned(),
        );
    }
    let deny_all = check_deny_all(record, "executables")?;
    let mut merged: Vec<String> = Vec::new();
    for item in recommend.iter().chain(&enforce) {
        if !merged.contains(item) {
            merged.push(item.clone());
        }
    }
    Ok(OrgExecutablePolicy {
        present: true,
        non_empty: !record.is_empty(),
        deny_all,
        deny,
        require,
        recommend: merged,
        enforce,
        warnings,
    })
}

/// `parseBinDeploy`: `(denyAll, deny, nonEmpty)`.
fn parse_bin_deploy(value: Option<&Value>) -> Result<(bool, Vec<String>, bool)> {
    if is_absent(value) {
        return Ok((false, Vec::new(), false));
    }
    let Some(record) = as_record(value) else {
        return Err(PolicyError::new("bin_deploy must be a mapping"));
    };
    let deny_all = check_deny_all(record, "bin_deploy")?;
    let deny = string_list(record.get("deny"), "bin_deploy.deny")?.unwrap_or_default();
    Ok((deny_all, deny, !record.is_empty()))
}

/// `projectPolicyPath`.
pub fn project_policy_path(project_root: &str) -> String {
    posix_normalize(&format!("{project_root}/{APM_POLICY_FILENAME}"))
}

/// `path.posix.normalize` for a non-empty path.
fn posix_normalize(path: &str) -> String {
    let absolute = path.starts_with('/');
    let trailing = path.ends_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|p| *p != "..") {
                    parts.pop();
                } else if !absolute {
                    parts.push("..");
                }
            }
            s => parts.push(s),
        }
    }
    let mut out = parts.join("/");
    if out.is_empty() && !absolute {
        out.push('.');
    }
    if trailing && !out.is_empty() {
        out.push('/');
    }
    if absolute { format!("/{out}") } else { out }
}

/// `path.resolve(...)` on POSIX.
fn posix_resolve(parts: &[&str]) -> String {
    let mut acc = String::new();
    for p in parts.iter().rev() {
        if p.is_empty() {
            continue;
        }
        acc = if acc.is_empty() {
            (*p).to_owned()
        } else {
            format!("{p}/{acc}")
        };
        if p.starts_with('/') {
            break;
        }
    }
    if !acc.starts_with('/') {
        let cwd = std::env::current_dir()
            .map(|d| d.to_string_lossy().into_owned())
            .unwrap_or_else(|_| "/".into());
        acc = if acc.is_empty() {
            cwd
        } else {
            format!("{cwd}/{acc}")
        };
    }
    let n = posix_normalize(&acc);
    if n.len() > 1 {
        n.trim_end_matches('/').to_owned()
    } else {
        n
    }
}

/// `path.relative(from, to)` on POSIX.
fn posix_relative(from: &str, to: &str) -> String {
    let from = posix_resolve(&[from]);
    let to = posix_resolve(&[to]);
    if from == to {
        return String::new();
    }
    let f: Vec<&str> = from.split('/').filter(|s| !s.is_empty()).collect();
    let t: Vec<&str> = to.split('/').filter(|s| !s.is_empty()).collect();
    let common = f.iter().zip(&t).take_while(|(a, b)| a == b).count();
    let mut out: Vec<&str> = vec![".."; f.len() - common];
    out.extend(&t[common..]);
    out.join("/")
}

/// `assertContainedPath(root, entry)` on POSIX.
fn assert_contained_path(root: &str, entry: &str) -> Result<()> {
    let escapes = entry.starts_with('/') || entry.split(['\\', '/']).any(|s| s == "..") || {
        let resolved_root = posix_resolve(&[root]);
        let rel = posix_relative(&resolved_root, &posix_resolve(&[&resolved_root, entry]));
        rel.is_empty() || rel == ".." || rel.starts_with("../") || rel.starts_with('/')
    };
    if escapes {
        return Err(PolicyError {
            name: "PathEscapeError",
            message: format!("Path escapes the package root: {entry} (root: {root})"),
        });
    }
    Ok(())
}

/// `resolvePolicyFile`.
fn resolve_policy_file(project_root: &str, policy_path: Option<&str>) -> Result<Option<String>> {
    if let Some(p) = policy_path.filter(|p| !trim(p).is_empty()) {
        let resolved = if p.starts_with('/') {
            posix_resolve(&[p])
        } else {
            posix_resolve(&[project_root, p])
        };
        let rel = posix_relative(project_root, &resolved).replace('\\', "/");
        assert_contained_path(project_root, &rel)?;
        return Ok(Some(resolved));
    }
    let discovered = project_policy_path(project_root);
    Ok(Path::new(&discovered).exists().then_some(discovered))
}

fn pin_violation(code: &str, message: String) -> Violation {
    Violation {
        code: code.to_owned(),
        message,
        subject: None,
    }
}

/// `loadProjectPolicy`'s options.
#[derive(Clone, Debug, Default)]
pub struct LoadOptions<'a> {
    pub project_root: &'a str,
    pub policy_path: Option<&'a str>,
    pub pin: Option<PolicyPin>,
    pub require_policy: bool,
}

/// `loadProjectPolicy`. The error is what the original throws past its own handling: reading a
/// policy path that exists but is not a readable file.
pub fn load_project_policy(options: LoadOptions<'_>) -> std::io::Result<LoadResult> {
    let project_root = posix_resolve(&[options.project_root]);
    let pin = options.pin;
    let failed = |source: Option<String>, pin: Option<PolicyPin>, v: Violation| LoadResult {
        status: LoadStatus::Failed,
        skipped_reason: None,
        source,
        policy: None,
        pin,
        warnings: Vec::new(),
        violations: vec![v],
    };

    let file_path = match resolve_policy_file(&project_root, options.policy_path) {
        Ok(p) => p,
        Err(e) => return Ok(failed(None, pin, pin_violation("policy-path", e.message))),
    };
    let Some(file_path) = file_path.filter(|p| Path::new(p).exists()) else {
        if pin.is_some() {
            return Ok(failed(
                None,
                pin,
                pin_violation(
                    "policy-missing",
                    format!("apm.yml pins policy.hash but {APM_POLICY_FILENAME} is missing"),
                ),
            ));
        }
        if options.require_policy {
            return Ok(failed(
                None,
                None,
                pin_violation(
                    "policy-required",
                    format!("No {APM_POLICY_FILENAME} found (required by --require-policy)"),
                ),
            ));
        }
        return Ok(LoadResult {
            status: LoadStatus::Skipped,
            skipped_reason: Some("no-policy"),
            source: None,
            policy: None,
            pin: None,
            warnings: Vec::new(),
            violations: Vec::new(),
        });
    };

    let bytes = std::fs::read(&file_path)?;
    let rel = posix_relative(&project_root, &file_path).replace('\\', "/");
    let source = Some(if rel.is_empty() {
        APM_POLICY_FILENAME.to_owned()
    } else {
        rel
    });
    if let Some(p) = &pin {
        let actual = hash_policy_bytes(&bytes, p.algorithm);
        if !policy_hashes_match(&p.hash, &actual) {
            return Ok(failed(
                source,
                pin,
                pin_violation(
                    "policy-hash-mismatch",
                    format!("Pinned policy.hash does not match {APM_POLICY_FILENAME} ({actual})"),
                ),
            ));
        }
    }

    match parse_apm_policy_document(&String::from_utf8_lossy(&bytes), &file_path) {
        Ok(policy) => Ok(LoadResult {
            status: LoadStatus::Evaluated,
            skipped_reason: None,
            source,
            warnings: policy.warnings.clone(),
            policy: Some(policy),
            pin,
            violations: Vec::new(),
        }),
        Err(e) => Ok(failed(
            source,
            pin,
            pin_violation("policy-parse", e.message),
        )),
    }
}

/// `hostFromCanonicalRepo`.
fn host_from_canonical_repo(repo_url: &str) -> Option<String> {
    if repo_url.starts_with("file://") {
        return None;
    }
    let host = repo_url.split('/').next().unwrap_or("");
    (!host.is_empty() && (host.contains('.') || host == "localhost")).then(|| host.to_lowercase())
}

fn unique(items: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for i in items {
        if !out.contains(&i) {
            out.push(i);
        }
    }
    out
}

/// `matchPolicyPattern`. The error is picomatch's `SyntaxError` for a pattern over 64 KiB.
pub fn match_policy_pattern<S: AsRef<str>>(pattern: &str, candidates: &[S]) -> Result<bool> {
    let normalized = trim(pattern);
    if normalized.is_empty() {
        return Ok(false);
    }
    if candidates.iter().any(|c| c.as_ref() == normalized) {
        return Ok(true);
    }
    let matcher = picomatch_rs::Matcher::new(normalized).map_err(|e| PolicyError {
        name: match e {
            picomatch_rs::Error::EmptyPattern => "TypeError",
            picomatch_rs::Error::Syntax(_) => "SyntaxError",
        },
        message: match e {
            picomatch_rs::Error::EmptyPattern => "Expected pattern to be a non-empty string".into(),
            picomatch_rs::Error::Syntax(m) => m,
        },
    })?;
    if candidates.iter().any(|c| matcher.is_match(c.as_ref())) {
        return Ok(true);
    }
    if let Some(prefix) = normalized.strip_suffix("/*") {
        let with_slash = format!("{prefix}/");
        return Ok(candidates
            .iter()
            .any(|c| c.as_ref() == prefix || c.as_ref().starts_with(&with_slash)));
    }
    Ok(false)
}

/// `sourceCandidates`.
fn source_candidates(source: &PlanSource) -> Vec<String> {
    let identity = source.identity.clone();
    match source.kind {
        SourceKind::Git => {
            let mut ids = vec![identity.clone()];
            if let Some(host) = &source.host {
                if let Some(rest) = identity.strip_prefix(&format!("{host}/")) {
                    ids.push(rest.to_owned());
                }
                ids.push(host.clone());
            }
            ids.push("git".into());
            unique(ids)
        }
        SourceKind::Catalog => unique([identity, "catalog".into()]),
        SourceKind::Local => {
            let id = source.path.clone().unwrap_or(identity);
            // The original adds `id` again when it starts with ./ or ../: a no-op on a Set.
            unique([id, "local".into(), ".".into(), "./".into()])
        }
        SourceKind::Marketplace => unique([identity, "marketplace".into()]),
    }
}

fn first_match(patterns: &[String], candidates: &[String]) -> Result<Option<String>> {
    for p in patterns {
        if match_policy_pattern(p, candidates)? {
            return Ok(Some(p.clone()));
        }
    }
    Ok(None)
}

fn git_source(name: &str, identity: String, depth: f64) -> PlanSource {
    PlanSource {
        kind: SourceKind::Git,
        name: name.to_owned(),
        host: host_from_canonical_repo(&identity),
        identity,
        path: None,
        depth,
    }
}

fn plain_source(kind: SourceKind, name: &str, identity: &str, depth: f64) -> PlanSource {
    PlanSource {
        kind,
        name: name.to_owned(),
        identity: identity.to_owned(),
        host: None,
        path: (kind == SourceKind::Local).then(|| identity.to_owned()),
        depth,
    }
}

/// `sourceFromApmDependency`.
pub fn source_from_apm_dependency(dep: &ParsedApmDependency, depth: f64) -> PlanSource {
    match dep.source_kind {
        SourceKind::Git => git_source(&dep.name, canonical_apm_repo_url(&dep.origin_ref), depth),
        kind => plain_source(kind, &dep.name, &dep.origin_ref, depth),
    }
}

/// `sourceFromLockEntry`.
fn source_from_lock_entry(entry: &LockEntry) -> PlanSource {
    let repo = entry.repo_url.as_deref().filter(|r| !r.is_empty());
    if entry.source == LockSource::Git || repo.is_some() {
        let identity = match repo {
            Some(r) => canonical_apm_repo_url(r),
            None => entry.name.clone(),
        };
        return git_source(&entry.name, identity, entry.depth);
    }
    match entry.source {
        LockSource::Catalog => plain_source(
            SourceKind::Catalog,
            &entry.name,
            entry.repo_url.as_deref().unwrap_or(&entry.name),
            entry.depth,
        ),
        LockSource::Marketplace => plain_source(
            SourceKind::Marketplace,
            &entry.name,
            &entry.name,
            entry.depth,
        ),
        _ => plain_source(SourceKind::Local, &entry.name, &entry.name, entry.depth),
    }
}

/// What `recoverOriginLocator(getPluginById(id))` gives, for the kinds the policy reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PluginLocator {
    Git {
        url: String,
    },
    Catalog {
        org: String,
        catalog: String,
        slug: String,
    },
    Marketplace {
        reference: String,
    },
    /// No plugin with that id, no locator, or another kind.
    Other,
}

/// `sourceFromSelectedPlugin`.
fn source_from_selected_plugin(
    plugin: &SelectedPlugin,
    repo_url: Option<&str>,
    locate: &mut dyn FnMut(&str) -> PluginLocator,
) -> PlanSource {
    let (name, depth) = (plugin.name.as_str(), plugin.depth);
    if let Some(r) = repo_url.filter(|r| !r.is_empty()) {
        return git_source(name, canonical_apm_repo_url(r), depth);
    }
    if !plugin.plugin_id.is_empty() {
        match locate(&plugin.plugin_id) {
            PluginLocator::Git { url } => {
                return git_source(name, canonical_apm_repo_url(&url), depth);
            }
            PluginLocator::Catalog { org, catalog, slug } => {
                return plain_source(
                    SourceKind::Catalog,
                    name,
                    &format!("{org}/{catalog}/{slug}"),
                    depth,
                );
            }
            PluginLocator::Marketplace { reference } => {
                return plain_source(SourceKind::Marketplace, name, &reference, depth);
            }
            PluginLocator::Other => {}
        }
    }
    let kind = match plugin.source {
        DependencySourceKind::Catalog => SourceKind::Catalog,
        DependencySourceKind::Marketplace => SourceKind::Marketplace,
        DependencySourceKind::Git => SourceKind::Git,
        _ => SourceKind::Local,
    };
    plain_source(kind, name, name, depth)
}

fn kind_str(kind: SourceKind) -> &'static str {
    match kind {
        SourceKind::Git => "git",
        SourceKind::Catalog => "catalog",
        SourceKind::Marketplace => "marketplace",
        SourceKind::Local => "local",
    }
}

/// `mergeSources`: the shallowest source per `kind:identity`, at the position its key was
/// first seen (a `Map` keeps it), then a stable sort by `localeCompare` on the identity.
fn merge_sources(sources: Vec<PlanSource>) -> Vec<PlanSource> {
    let mut by_key: Vec<(String, PlanSource)> = Vec::new();
    for source in sources {
        let key = format!("{}:{}", kind_str(source.kind), source.identity);
        match by_key.iter_mut().find(|(k, _)| *k == key) {
            Some((_, existing)) => {
                if source.depth < existing.depth {
                    *existing = source;
                }
            }
            None => by_key.push((key, source)),
        }
    }
    let mut out: Vec<PlanSource> = by_key.into_iter().map(|(_, s)| s).collect();
    out.sort_by(|a, b| collate_rs::locale_compare(&a.identity, &b.identity));
    out
}

fn unique_primitives(values: impl IntoIterator<Item = Option<Primitive>>) -> Vec<Primitive> {
    let mut out: Vec<Primitive> = values.into_iter().flatten().collect();
    out.sort();
    out.dedup();
    out
}

fn mcp_from_manifest(deps: &[ParsedMcpDependency]) -> Vec<PlanMcp> {
    deps.iter()
        .map(|d| PlanMcp {
            name: d.name.clone(),
            identity: d.registry_id.clone().unwrap_or_else(|| d.name.clone()),
            depth: 0.0,
            declared_in_manifest: true,
        })
        .collect()
}

/// `buildAuditInstallPlan`'s options. `overlay_primitives` is what `overlayPrimitives` would
/// read from the project's `.apm` overlay.
#[derive(Clone, Copy, Debug, Default)]
pub struct AuditPlanInput<'a> {
    pub overlay_primitives: &'a [Primitive],
    pub apm_dependencies: &'a [ParsedApmDependency],
    pub mcp_dependencies: &'a [ParsedMcpDependency],
    /// `lock.plugins` and `lock.mcp_servers`, when there is a lock.
    pub lock_plugins: &'a [LockEntry],
    pub lock_mcp_servers: Option<&'a [LockMcpServer]>,
}

/// `buildAuditInstallPlan`.
pub fn build_audit_install_plan(input: AuditPlanInput<'_>) -> InstallPlan {
    let declared: Vec<&str> = input
        .mcp_dependencies
        .iter()
        .map(|d| d.name.as_str())
        .collect();
    let sources = merge_sources(
        input
            .apm_dependencies
            .iter()
            .map(|d| source_from_apm_dependency(d, 1.0))
            .chain(input.lock_plugins.iter().map(source_from_lock_entry))
            .collect(),
    );
    let lock_mcp = input.lock_mcp_servers.filter(|s| !s.is_empty());
    let primitives = unique_primitives(input.overlay_primitives.iter().copied().map(Some).chain([
        lock_mcp.map(|_| Primitive::Mcp),
        (!input.mcp_dependencies.is_empty()).then_some(Primitive::Mcp),
    ]));
    let mut mcp = mcp_from_manifest(input.mcp_dependencies);
    // mcpFromLock, then the filter that drops every declared name: what is left is depth 1.
    for server in input.lock_mcp_servers.unwrap_or(&[]) {
        if !declared.contains(&server.name.as_str()) {
            mcp.push(PlanMcp {
                name: server.name.clone(),
                identity: server.name.clone(),
                depth: 1.0,
                declared_in_manifest: false,
            });
        }
    }
    InstallPlan {
        sources,
        primitives,
        mcp,
    }
}

/// `buildApplyInstallPlan`'s options: `resolution.selected` and `resolution.decisions` stand for
/// the resolution, and `locate` for `recoverOriginLocator(getPluginById(id))`.
pub struct ApplyPlanInput<'a> {
    pub selected: &'a [SelectedPlugin],
    pub decisions: &'a [ResourceDecision],
    pub resources: &'a [Resource],
    pub apm_dependencies: &'a [ParsedApmDependency],
    pub mcp_dependencies: &'a [ParsedMcpDependency],
    /// `gitLocks`: `(name, repo_url)`.
    pub git_locks: &'a [(String, String)],
    pub locate: &'a mut dyn FnMut(&str) -> PluginLocator,
}

/// `buildApplyInstallPlan`.
pub fn build_apply_install_plan(input: ApplyPlanInput<'_>) -> InstallPlan {
    let declared: Vec<&str> = input
        .mcp_dependencies
        .iter()
        .map(|d| d.name.as_str())
        .collect();
    // `new Map(entries)`: the last entry for a name wins.
    let git_by_name = |name: &str| {
        input
            .git_locks
            .iter()
            .rev()
            .find(|(n, _)| n == name)
            .map(|(_, r)| r.as_str())
    };
    let mut sources: Vec<PlanSource> = input
        .apm_dependencies
        .iter()
        .map(|d| source_from_apm_dependency(d, 1.0))
        .collect();
    for plugin in input.selected.iter().filter(|p| p.depth > 0.0) {
        sources.push(source_from_selected_plugin(
            plugin,
            git_by_name(&plugin.name),
            input.locate,
        ));
    }
    let sources = merge_sources(sources);
    let primitives = unique_primitives(
        input
            .resources
            .iter()
            .map(|r| primitive_from_resource_type(&r.resource_type)),
    );
    let depth_of = |key: &str| {
        input
            .decisions
            .iter()
            .rev()
            .find(|d| d.key == key)
            .map(|d| d.winner.depth)
    };
    let mcp = input
        .resources
        .iter()
        .filter(|r| r.resource_type == "mcp_server")
        .map(|r| PlanMcp {
            name: r.name.clone(),
            identity: if r.origin_ref.is_empty() {
                r.name.clone()
            } else {
                r.origin_ref.clone()
            },
            // An mcp_server key never reads metadata, so resolutionKey cannot fail here.
            depth: resolve_rs::resource_resolution::resolution_key(r)
                .ok()
                .and_then(|k| depth_of(&k))
                .unwrap_or(0.0),
            declared_in_manifest: declared.contains(&r.name.as_str()),
        })
        .collect();
    InstallPlan {
        sources,
        primitives,
        mcp,
    }
}

/// `evaluatePolicy`.
pub fn evaluate_policy(policy: &PolicyDocument, plan: &InstallPlan) -> Result<Vec<Violation>> {
    let mut violations = Vec::new();
    let none: Vec<String> = Vec::new();

    for source in &plan.sources {
        let candidates = source_candidates(source);
        let deny = policy.dependencies_deny.as_ref().unwrap_or(&none);
        if let Some(denied) = first_match(deny, &candidates)? {
            violations.push(Violation {
                code: "source-denied".into(),
                subject: Some(source.identity.clone()),
                message: format!("Source {} matches deny pattern {denied}", source.identity),
            });
            continue;
        }
        if let Some(allow) = &policy.dependencies_allow
            && first_match(allow, &candidates)?.is_none()
        {
            violations.push(Violation {
                code: "source-not-allowed".into(),
                subject: Some(source.identity.clone()),
                message: format!(
                    "Source {} ({}) is not in dependencies.allow",
                    source.identity,
                    kind_str(source.kind)
                ),
            });
        }
    }

    if let Some(allow) = &policy.content_types_allow {
        let allowed: Vec<Primitive> = allow
            .iter()
            .filter_map(|a| normalize_content_type(a))
            .collect();
        for primitive in &plan.primitives {
            if !allowed.contains(primitive) {
                violations.push(Violation {
                    code: "primitive-not-allowed".into(),
                    subject: Some(primitive.as_str().into()),
                    message: format!(
                        "Primitive {} is not in manifest.content_types.allow",
                        primitive.as_str()
                    ),
                });
            }
        }
    }

    for entry in &plan.mcp {
        let candidates = unique([entry.identity.clone(), entry.name.clone()]);
        let deny = policy.mcp_deny.as_ref().unwrap_or(&none);
        if let Some(denied) = first_match(deny, &candidates)? {
            violations.push(Violation {
                code: "mcp-denied".into(),
                subject: Some(entry.name.clone()),
                message: format!("MCP server {} matches deny pattern {denied}", entry.name),
            });
            continue;
        }
        let allow_listed =
            first_match(policy.mcp_allow.as_ref().unwrap_or(&none), &candidates)?.is_some();
        let transitive = entry.depth > 0.0 && !entry.declared_in_manifest;
        if transitive && !policy.trust_transitive && !allow_listed {
            violations.push(Violation {
                code: "mcp-transitive".into(),
                subject: Some(entry.name.clone()),
                message: format!(
                    "Transitive MCP server {} is not declared in apm.yml dependencies.mcp or mcp.allow (mcp.trust_transitive is false)",
                    entry.name
                ),
            });
            continue;
        }
        if policy.mcp_allow.is_some() && !allow_listed && !entry.declared_in_manifest {
            violations.push(Violation {
                code: "mcp-not-allowed".into(),
                subject: Some(entry.name.clone()),
                message: format!("MCP server {} is not in mcp.allow", entry.name),
            });
        }
    }
    Ok(violations)
}

/// `evaluationFromLoad`.
pub fn evaluation_from_load(loaded: &LoadResult, plan: &InstallPlan) -> Result<Evaluation> {
    if loaded.status == LoadStatus::Skipped {
        return Ok(Evaluation {
            status: LoadStatus::Skipped,
            skipped_reason: Some("no-policy"),
            source: None,
            name: None,
            enforcement: Enforcement::Off,
            warnings: loaded.warnings.clone(),
            violations: Vec::new(),
            blocks: false,
        });
    }
    let policy = match (&loaded.status, &loaded.policy) {
        (LoadStatus::Failed, _) | (_, None) => {
            return Ok(Evaluation {
                status: LoadStatus::Failed,
                skipped_reason: None,
                source: loaded.source.clone(),
                name: None,
                enforcement: Enforcement::Block,
                warnings: loaded.warnings.clone(),
                violations: loaded.violations.clone(),
                blocks: true,
            });
        }
        (_, Some(p)) => p,
    };
    let violations = evaluate_policy(policy, plan)?;
    let blocks = policy.enforcement == Enforcement::Block && !violations.is_empty();
    Ok(Evaluation {
        status: LoadStatus::Evaluated,
        skipped_reason: None,
        source: loaded.source.clone(),
        name: (!policy.name.is_empty()).then(|| policy.name.clone()),
        enforcement: policy.enforcement,
        warnings: loaded.warnings.clone(),
        violations,
        blocks,
    })
}

/// `readManifestPolicyPin`.
pub fn read_manifest_policy_pin(project_root: &str) -> Result<Option<PolicyPin>> {
    let manifest_path = posix_normalize(&format!("{project_root}/{APM_MANIFEST_FILENAME}"));
    if !Path::new(&manifest_path).exists() {
        return Ok(None);
    }
    let raw = std::fs::read(&manifest_path).map_err(|e| PolicyError {
        name: "Error",
        message: e.to_string(),
    })?;
    let document = parse_yaml_mapping(&String::from_utf8_lossy(&raw), &manifest_path)?;
    parse_apm_policy_pin(document.get("policy"))
}

/// `formatPolicyViolations`.
pub fn format_policy_violations(violations: &[Violation]) -> String {
    if let [only] = violations {
        return only.message.clone();
    }
    let n = violations.len();
    let mut lines = vec![format!(
        "{n} {}",
        if n == 1 {
            "policy violation"
        } else {
            "policy violations"
        }
    )];
    lines.extend(violations.iter().map(|v| format!("- {}", v.message)));
    lines.join("\n")
}

/// `assertPolicyAllowsApply`: the `PolicyError` message when the evaluation blocks.
pub fn assert_policy_allows_apply(evaluation: &Evaluation) -> Result<()> {
    if !evaluation.blocks {
        return Ok(());
    }
    Err(PolicyError::new(format_policy_violations(
        &evaluation.violations,
    )))
}
