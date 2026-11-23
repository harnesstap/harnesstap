//! `project-config.ts`: the project's `apm.yml` read as a HarnessTap project config (profiles,
//! environments, inline plugins), the walk up to find it, and `.harnesstap/local.toml`
//! overrides.

use std::fs;
use std::path::{Path, PathBuf};

use emit_rs::js::{ordered_entries, to_string};
use serde_json::{Map, Value};

use crate::dependencies::{ParsedApmDependency, ParsedMcpDependency};
use crate::manifest::{
    APM_MANIFEST_FILENAME, ApmCompilationConfig, ManifestError, parse_apm_manifest_contents,
};
use crate::overlay::ApmOverlayInfo;
use crate::policy::PolicyPin;

type R<T> = Result<T, ManifestError>;

fn error(message: impl Into<String>) -> ManifestError {
    ManifestError {
        name: "Error".into(),
        message: message.into(),
    }
}

/// `ProjectProfileSource`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProfileSource {
    Catalog,
    Local,
    Inline,
}

impl ProfileSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Catalog => "catalog",
            Self::Local => "local",
            Self::Inline => "inline",
        }
    }
}

/// `ProjectProfileEntry`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectProfileEntry {
    pub name: String,
    pub source: ProfileSource,
    pub selector: Option<String>,
    pub plugin: Option<String>,
    pub environment: Option<String>,
}

/// `DeckJsonEnvironmentSecretRef`. `provider` is `keychain`, `env` or `file`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnvironmentSecretRef {
    pub provider: String,
    pub reference: String,
}

/// `DeckJsonEnvironment`. `values` and `secret_refs` are in `Object.keys` order; `secret_refs`
/// is `None` when the original leaves the key out.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DeckJsonEnvironment {
    pub name: String,
    pub values: Vec<(String, String)>,
    pub secret_refs: Option<Vec<(String, EnvironmentSecretRef)>>,
}

/// `ProjectConfig`. Each plugin table is in `Object.keys` order and has a string `name`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProjectConfig {
    pub default_profile: Option<String>,
    pub default_environment: Option<String>,
    pub profiles: Vec<ProjectProfileEntry>,
    pub environments: Vec<DeckJsonEnvironment>,
    pub plugins: Vec<Map<String, Value>>,
    pub apm_name: Option<String>,
    pub apm_version: Option<String>,
    pub apm_description: Option<String>,
    pub apm_document: Option<Map<String, Value>>,
}

/// `ResolvedProjectConfig`.
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedProjectConfig {
    pub config: ProjectConfig,
    pub root_path: PathBuf,
    pub config_path: PathBuf,
    pub harness_targets: Vec<String>,
    pub skipped_targets: Vec<String>,
    pub apm_dependencies: Vec<ParsedApmDependency>,
    pub mcp_dependencies: Vec<ParsedMcpDependency>,
    pub policy_pin: Option<PolicyPin>,
    pub overlay: Option<ApmOverlayInfo>,
    pub compilation: Option<ApmCompilationConfig>,
    pub warnings: Vec<String>,
}

/// `ProjectConfigValidationResult`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectConfigValidation {
    pub valid: bool,
    pub errors: Vec<String>,
}

fn non_empty_str(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// `resolve(startPath)` against the current directory, then its directory when it is a file.
fn resolve_walk_root(start_path: &Path) -> PathBuf {
    let absolute = absolute(start_path);
    if fs::metadata(&absolute).is_ok_and(|m| m.is_file())
        && let Some(parent) = absolute.parent()
    {
        return parent.to_path_buf();
    }
    absolute
}

/// Node's `path.resolve(p)` on POSIX: absolute against the current directory, normalized,
/// without a trailing slash.
fn absolute(path: &Path) -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let joined = cwd.join(path);
    let mut out = PathBuf::from("/");
    for part in joined.components() {
        match part {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::Normal(p) => out.push(p),
            _ => {}
        }
    }
    out
}

/// `projectManifestPath(rootPath)`.
pub fn project_manifest_path(root_path: &Path) -> PathBuf {
    root_path.join(APM_MANIFEST_FILENAME)
}

struct Located {
    root_path: PathBuf,
    config_path: PathBuf,
    config_dir: PathBuf,
}

fn locate_project_config_file(start_path: &Path) -> Option<Located> {
    let mut current = resolve_walk_root(start_path);
    loop {
        let config_path = project_manifest_path(&current);
        if fs::metadata(&config_path).is_ok() {
            let config_dir = current.join(".harnesstap");
            return Some(Located {
                root_path: current,
                config_path,
                config_dir,
            });
        }
        if !current.pop() {
            return None;
        }
    }
}

fn parse_profile_source(value: Option<&Value>, name: &str) -> R<ProfileSource> {
    let Some(Value::String(value)) = value else {
        return Err(error(format!(
            "Profile {name} must include a source string"
        )));
    };
    match value.as_str() {
        "catalog" => Ok(ProfileSource::Catalog),
        "local" => Ok(ProfileSource::Local),
        "inline" => Ok(ProfileSource::Inline),
        other => Err(error(format!("Unknown profile source for {name}: {other}"))),
    }
}

fn parse_profile_entry(value: &Value, index: usize) -> R<ProjectProfileEntry> {
    let Value::Object(value) = value else {
        return Err(error(format!("Profile at index {index} must be a table")));
    };
    let Some(name) = non_empty_str(value.get("name")) else {
        return Err(error(format!(
            "Profile at index {index} must include a non-empty name"
        )));
    };
    let source = parse_profile_source(value.get("source"), name)?;
    let environment = non_empty_str(value.get("environment")).map(str::to_owned);
    let mut entry = ProjectProfileEntry {
        name: name.to_owned(),
        source,
        selector: None,
        plugin: None,
        environment,
    };
    match source {
        ProfileSource::Catalog => {
            let Some(selector) = non_empty_str(value.get("selector")) else {
                return Err(error(format!(
                    "Profile {name} with catalog source must include a selector"
                )));
            };
            entry.selector = Some(selector.to_owned());
        }
        ProfileSource::Local => {
            entry.selector = Some(
                non_empty_str(value.get("selector"))
                    .unwrap_or(name)
                    .to_owned(),
            );
        }
        ProfileSource::Inline => {
            let Some(plugin) = non_empty_str(value.get("plugin")) else {
                return Err(error(format!(
                    "Profile {name} with inline source must include a plugin key"
                )));
            };
            entry.plugin = Some(plugin.to_owned());
        }
    }
    Ok(entry)
}

/// `String(value ?? fallback)`.
fn string_or(value: Option<&Value>, fallback: &str) -> String {
    match value {
        None | Some(Value::Null) => fallback.to_owned(),
        Some(v) => to_string(v),
    }
}

fn parse_named_environment(name: &str, value: &Value) -> R<DeckJsonEnvironment> {
    let Value::Object(value) = value else {
        return Err(error(format!("Environment {name} must be a mapping")));
    };
    let mut values = Vec::new();
    match value.get("values") {
        None => {}
        Some(Value::Object(raw)) => {
            // `values[key] = ...` with `__proto__` sets the prototype instead of a key.
            for (key, entry) in ordered_entries(raw) {
                if key == "__proto__" {
                    continue;
                }
                values.push((key.clone(), to_string(entry)));
            }
        }
        Some(_) => {
            return Err(error(format!(
                "Environment {name} field values must be a mapping"
            )));
        }
    }
    let mut secret_refs = Vec::new();
    match value.get("secret_refs") {
        None => {}
        Some(Value::Object(raw)) => {
            for (key, entry) in ordered_entries(raw) {
                let Value::Object(entry) = entry else {
                    return Err(error(format!(
                        "Environment {name} secret_refs.{key} must be a mapping"
                    )));
                };
                let provider = string_or(entry.get("provider"), "env");
                if !matches!(provider.as_str(), "keychain" | "env" | "file") {
                    return Err(error(format!(
                        "Environment {name} secret_refs.{key} has unknown provider: {provider}"
                    )));
                }
                let reference = string_or(entry.get("ref"), "");
                if key == "__proto__" {
                    // Assigned as the prototype, so not a key of `secret_refs`.
                    continue;
                }
                secret_refs.push((
                    key.clone(),
                    EnvironmentSecretRef {
                        provider,
                        reference,
                    },
                ));
            }
        }
        Some(_) => {
            return Err(error(format!(
                "Environment {name} field secret_refs must be a mapping"
            )));
        }
    }
    Ok(DeckJsonEnvironment {
        name: name.to_owned(),
        values,
        secret_refs: (!secret_refs.is_empty()).then_some(secret_refs),
    })
}

fn parse_plugin_table(value: &Value, index: usize) -> R<Map<String, Value>> {
    let Value::Object(value) = value else {
        return Err(error(format!("Plugin at index {index} must be a table")));
    };
    if non_empty_str(value.get("name")).is_none() {
        return Err(error(format!(
            "Plugin at index {index} must include a non-empty name"
        )));
    }
    Ok(ordered_entries(value)
        .into_iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect())
}

/// What `parseOptionalStringField` reads: a YAML value, or a TOML one from `local.toml`.
enum Field<'a> {
    Absent,
    Str(&'a str),
    Other,
}

fn optional_string_field(value: Field<'_>, field: &str) -> R<Option<String>> {
    match value {
        Field::Absent => Ok(None),
        Field::Str(s) if !s.is_empty() => Ok(Some(s.to_owned())),
        _ => Err(error(format!(
            "Project config field {field} must be a non-empty string when set"
        ))),
    }
}

fn json_field<'a>(document: &'a Map<String, Value>, key: &str) -> Field<'a> {
    match document.get(key) {
        None => Field::Absent,
        Some(Value::String(s)) => Field::Str(s),
        Some(_) => Field::Other,
    }
}

fn parse_profiles(document: &Map<String, Value>) -> R<Vec<ProjectProfileEntry>> {
    let raw = match document.get("profiles") {
        None => return Ok(Vec::new()),
        Some(Value::Array(raw)) => raw,
        Some(_) => return Err(error("Project config profiles must be an array of tables")),
    };
    let profiles = raw
        .iter()
        .enumerate()
        .map(|(i, v)| parse_profile_entry(v, i))
        .collect::<R<Vec<_>>>()?;
    let mut seen = std::collections::HashSet::new();
    for profile in &profiles {
        if !seen.insert(profile.name.as_str()) {
            return Err(error(format!("Duplicate profile name: {}", profile.name)));
        }
    }
    Ok(profiles)
}

fn parse_environment_block(
    document: &Map<String, Value>,
) -> R<(Option<String>, Vec<DeckJsonEnvironment>)> {
    let raw = match document.get("environments") {
        None => return Ok((None, Vec::new())),
        Some(Value::Object(raw)) => raw,
        Some(_) => {
            return Err(error("Project config field environments must be a mapping"));
        }
    };
    let mut default_environment = None;
    let mut environments = Vec::new();
    // `Object.entries` keys are unique, so the original's duplicate check never fires.
    for (key, value) in ordered_entries(raw) {
        if key == "default" {
            match value {
                Value::String(s) if !s.is_empty() => default_environment = Some(s.clone()),
                _ => {
                    return Err(error(
                        "Project config field environments.default must be a non-empty string when set",
                    ));
                }
            }
            continue;
        }
        environments.push(parse_named_environment(key, value)?);
    }
    Ok((default_environment, environments))
}

fn parse_plugins(document: &Map<String, Value>) -> R<Vec<Map<String, Value>>> {
    match document.get("plugins") {
        None => Ok(Vec::new()),
        Some(Value::Array(raw)) => raw
            .iter()
            .enumerate()
            .map(|(i, v)| parse_plugin_table(v, i))
            .collect(),
        Some(_) => Err(error("Project config plugins must be an array of tables")),
    }
}

/// `projectConfigFromTomlDocument(document)`.
pub fn project_config_from_document(document: &Map<String, Value>) -> R<ProjectConfig> {
    let default_profile =
        optional_string_field(json_field(document, "default_profile"), "default_profile")?;
    let (default_environment, environments) = parse_environment_block(document)?;
    Ok(ProjectConfig {
        default_profile,
        default_environment,
        environments,
        profiles: parse_profiles(document)?,
        plugins: parse_plugins(document)?,
        ..ProjectConfig::default()
    })
}

fn with_manifest_identity(
    mut config: ProjectConfig,
    name: &str,
    version: &str,
    description: Option<&String>,
    rest: &Map<String, Value>,
) -> ProjectConfig {
    config.apm_name = Some(name.to_owned());
    config.apm_version = Some(version.to_owned());
    config.apm_description = description.cloned();
    config.apm_document = (!rest.is_empty()).then(|| rest.clone());
    config
}

/// `parseProjectConfigContents(raw, filePath, rootPath)`.
pub fn parse_project_config_contents(
    raw: &str,
    file_path: &str,
    root_path: Option<&Path>,
) -> R<ProjectConfig> {
    let fields = parse_apm_manifest_contents(raw, file_path, root_path)?;
    let config = project_config_from_document(&fields.vendor)?;
    Ok(with_manifest_identity(
        config,
        &fields.name,
        &fields.version,
        fields.description.as_ref(),
        &fields.rest,
    ))
}

fn read_utf8(path: &Path) -> R<String> {
    fs::read(path)
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .map_err(|e| {
            error(if e.kind() == std::io::ErrorKind::IsADirectory {
                "EISDIR: illegal operation on a directory, read".to_owned()
            } else {
                e.to_string()
            })
        })
}

/// `parseProjectConfigFile(filePath, rootPath)`.
pub fn parse_project_config_file(file_path: &Path, root_path: Option<&Path>) -> R<ProjectConfig> {
    parse_project_config_contents(
        &read_utf8(file_path)?,
        &file_path.to_string_lossy(),
        root_path,
    )
}

/// `locateProjectManifest(startPath)`: `(rootPath, configPath)`.
pub fn locate_project_manifest(start_path: &Path) -> Option<(PathBuf, PathBuf)> {
    locate_project_config_file(start_path).map(|l| (l.root_path, l.config_path))
}

/// `parseTransportToml(raw, label)` for `local.toml`. Parsed with the `toml` crate; the text
/// after `Invalid <label> TOML: ` is its own, not smol-toml's.
fn parse_transport_toml(raw: &str, label: &str) -> R<toml::Table> {
    if raw.starts_with('\u{feff}') {
        // smol-toml reads a byte order mark as part of the first key, and rejects it.
        return Err(error(format!(
            "Invalid {label} TOML: Invalid TOML document: only letter, numbers, dashes and underscores are allowed in keys"
        )));
    }
    raw.parse::<toml::Table>()
        .map_err(|e| error(format!("Invalid {label} TOML: {}", e.message())))
}

fn toml_field<'a>(document: &'a toml::Table, key: &str) -> Field<'a> {
    match document.get(key) {
        None => Field::Absent,
        Some(toml::Value::String(s)) => Field::Str(s),
        Some(_) => Field::Other,
    }
}

/// `mergeProjectConfigLocalOverrides(config, configDir)`.
pub fn merge_project_config_local_overrides(
    mut config: ProjectConfig,
    config_dir: &Path,
) -> R<ProjectConfig> {
    let local_path = config_dir.join("local.toml");
    if fs::metadata(&local_path).is_err() {
        return Ok(config);
    }
    let raw = read_utf8(&local_path)?;
    let document = parse_transport_toml(&raw, "project local overrides")?;
    let default_profile =
        optional_string_field(toml_field(&document, "default_profile"), "default_profile")?;
    let default_environment = optional_string_field(
        toml_field(&document, "default_environment"),
        "default_environment",
    )?;
    if default_profile.is_some() {
        config.default_profile = default_profile;
    }
    if default_environment.is_some() {
        config.default_environment = default_environment;
    }
    Ok(config)
}

/// `findProjectConfig(startPath)`.
pub fn find_project_config(start_path: &Path) -> R<Option<ResolvedProjectConfig>> {
    let Some(located) = locate_project_config_file(start_path) else {
        return Ok(None);
    };
    let raw = read_utf8(&located.config_path)?;
    let fields = parse_apm_manifest_contents(
        &raw,
        &located.config_path.to_string_lossy(),
        Some(&located.root_path),
    )?;
    let config = project_config_from_document(&fields.vendor)?;
    let config = with_manifest_identity(
        config,
        &fields.name,
        &fields.version,
        fields.description.as_ref(),
        &fields.rest,
    );
    let config = merge_project_config_local_overrides(config, &located.config_dir)?;
    Ok(Some(ResolvedProjectConfig {
        config,
        root_path: located.root_path,
        config_path: located.config_path,
        harness_targets: fields.harness_targets,
        skipped_targets: fields.skipped_targets,
        apm_dependencies: fields.apm_dependencies,
        mcp_dependencies: fields.mcp_dependencies,
        policy_pin: fields.policy_pin,
        overlay: fields.overlay,
        compilation: fields.compilation,
        warnings: fields.warnings,
    }))
}

/// `getProfileEntry(config, profileKey)`.
pub fn get_profile_entry<'a>(
    config: &'a ProjectConfig,
    profile_key: &str,
) -> R<&'a ProjectProfileEntry> {
    config
        .profiles
        .iter()
        .find(|p| p.name == profile_key)
        .ok_or_else(|| error(format!("Unknown profile: {profile_key}")))
}

/// `resolveProfileEnvironment(config, entry)`.
pub fn resolve_profile_environment<'a>(
    config: &'a ProjectConfig,
    entry: &'a ProjectProfileEntry,
) -> Option<&'a str> {
    entry
        .environment
        .as_deref()
        .or(config.default_environment.as_deref())
}

/// `validateProjectConfig(config)`.
pub fn validate_project_config(config: &ProjectConfig) -> ProjectConfigValidation {
    let has_profile = |n: &str| config.profiles.iter().any(|p| p.name == n);
    let has_environment = |n: &str| config.environments.iter().any(|e| e.name == n);
    let has_plugin = |n: &str| {
        config
            .plugins
            .iter()
            .any(|p| p.get("name").and_then(Value::as_str) == Some(n))
    };
    let mut errors = Vec::new();
    if let Some(p) = config.default_profile.as_deref().filter(|p| !p.is_empty())
        && !has_profile(p)
    {
        errors.push(format!("default_profile references unknown profile: {p}"));
    }
    if let Some(e) = config
        .default_environment
        .as_deref()
        .filter(|e| !e.is_empty())
        && !has_environment(e)
    {
        errors.push(format!(
            "environments.default references unknown environment: {e}"
        ));
    }
    for profile in &config.profiles {
        if let Some(e) = profile.environment.as_deref().filter(|e| !e.is_empty())
            && !has_environment(e)
        {
            errors.push(format!(
                "Profile {} references unknown environment: {e}",
                profile.name
            ));
        }
        if profile.source == ProfileSource::Inline {
            let key = profile.plugin.as_deref();
            if !key.is_some_and(|k| !k.is_empty() && has_plugin(k)) {
                errors.push(format!(
                    "Profile {} with inline source references unknown plugin: {}",
                    profile.name,
                    key.unwrap_or("(missing)")
                ));
            }
        }
    }
    ProjectConfigValidation {
        valid: errors.is_empty(),
        errors,
    }
}

/// `evaluateProjectConfigContents(raw, filePath, rootPath)`: the config, or the error texts.
pub fn evaluate_project_config_contents(
    raw: &str,
    file_path: &str,
    root_path: &Path,
) -> Result<(ProjectConfig, ProjectConfigValidation), Vec<String>> {
    let config = parse_project_config_contents(raw, file_path, Some(root_path))
        .map_err(|e| vec![e.message])?;
    let validation = validate_project_config(&config);
    if !validation.valid {
        return Err(validation.errors);
    }
    Ok((config, validation))
}
