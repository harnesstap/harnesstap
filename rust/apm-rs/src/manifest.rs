//! `apm-manifest.ts`: `apm.yml` parsing and field extraction, and writing a `ProjectConfig`
//! back as an `apm.yml` document.

use std::fs;
use std::path::Path;

use emit_rs::js::{number_to_string, ordered_entries, trim};
use serde_json::{Map, Value};

use crate::dependencies::{
    ParsedApmDependency, ParsedMcpDependency, collect_apm_and_dev_dependencies,
    collect_runtime_apm_dependencies,
};
use crate::overlay::{ApmOverlayInfo, inspect_apm_overlay};
use crate::policy::{PolicyPin, parse_apm_policy_pin};
use crate::project_config::ProjectConfig;
use crate::targets::{collect_apm_target_tokens, map_apm_targets};

pub const APM_MANIFEST_FILENAME: &str = "apm.yml";

const HT_TOP_LEVEL_KEYS: [&str; 4] = ["default_profile", "environments", "profiles", "plugins"];
const STRIP_TOP_LEVEL_KEYS: [&str; 3] = ["x-harnesstap", "default_environment", "environment"];
const RESERVED_TOP_LEVEL: [&str; 10] = [
    "name",
    "version",
    "description",
    "default_profile",
    "environments",
    "profiles",
    "plugins",
    "x-harnesstap",
    "default_environment",
    "environment",
];

/// What the manifest readers throw: `name` is the JavaScript error's (`Error`, `PolicyError`,
/// `BundleSymlinkError`, `YAMLException` from overlay frontmatter, ...).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManifestError {
    pub name: String,
    pub message: String,
}

impl ManifestError {
    fn error(message: impl Into<String>) -> Self {
        Self {
            name: "Error".into(),
            message: message.into(),
        }
    }
}

type R<T> = Result<T, ManifestError>;

/// `ApmCompilationConfig`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ApmCompilationConfig {
    pub target_tokens: Vec<String>,
    pub strategy: Option<String>,
    pub source_attribution: Option<bool>,
    pub exclude: Vec<String>,
    pub chatmode: Option<String>,
    /// Only ever `Some(true)`.
    pub single_file: Option<bool>,
}

/// `ApmManifestFields`. `vendor` and `rest` are in `Object.keys` order.
#[derive(Clone, Debug, PartialEq)]
pub struct ApmManifestFields {
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub vendor: Map<String, Value>,
    pub harness_targets: Vec<String>,
    pub skipped_targets: Vec<String>,
    pub apm_dependencies: Vec<ParsedApmDependency>,
    pub mcp_dependencies: Vec<ParsedMcpDependency>,
    pub policy_pin: Option<PolicyPin>,
    pub overlay: Option<ApmOverlayInfo>,
    pub compilation: Option<ApmCompilationConfig>,
    pub warnings: Vec<String>,
    pub rest: Map<String, Value>,
}

/// `parseApmCompilation(value)`.
pub fn parse_apm_compilation(value: Option<&Value>) -> Option<ApmCompilationConfig> {
    let Some(Value::Object(value)) = value else {
        return None;
    };
    let mut tokens_doc = Map::new();
    for key in ["target", "targets"] {
        if let Some(v) = value.get(key) {
            tokens_doc.insert(key.into(), v.clone());
        }
    }
    let exclude = match value.get("exclude") {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|e| e.as_str().map(str::to_owned))
            .collect(),
        Some(Value::String(s)) => vec![s.clone()],
        _ => Vec::new(),
    };
    let string = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_owned);
    Some(ApmCompilationConfig {
        target_tokens: collect_apm_target_tokens(&tokens_doc),
        strategy: string("strategy"),
        source_attribution: value.get("source_attribution").and_then(Value::as_bool),
        exclude,
        chatmode: string("chatmode"),
        single_file: (value.get("single_file") == Some(&Value::Bool(true))).then_some(true),
    })
}

/// `coerceString(value)`.
fn coerce_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => number_to_string(n),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

/// `parseApmYamlDocument(raw, filePath)`. The text after `Invalid YAML in <path>: ` is
/// `yaml-rs`'s, not the `yaml` package's.
pub fn parse_apm_yaml_document(raw: &str, file_path: &str) -> R<Map<String, Value>> {
    match yaml_rs::parse(raw) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err(ManifestError::error(format!(
            "{file_path} must be a YAML mapping"
        ))),
        Err(e) => Err(ManifestError::error(format!(
            "Invalid YAML in {file_path}: {e}"
        ))),
    }
}

/// `extractApmManifestFields(document, filePath, rootPath)`.
pub fn extract_apm_manifest_fields(
    document: &Map<String, Value>,
    file_path: &str,
    root_path: Option<&Path>,
) -> R<ApmManifestFields> {
    let name = trim(&coerce_string(document.get("name"))).to_owned();
    if name.is_empty() {
        return Err(ManifestError::error(format!(
            "{file_path} is missing required field name"
        )));
    }
    let version = trim(&coerce_string(document.get("version"))).to_owned();
    if version.is_empty() {
        return Err(ManifestError::error(format!(
            "{file_path} is missing required field version"
        )));
    }
    let mut warnings = Vec::new();
    if document.contains_key("workspaces") {
        warnings.push(
            "apm.yml field workspaces is reserved for OpenAPM v0.2 and is ignored".to_owned(),
        );
    }
    let description = document
        .get("description")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);

    let compilation = parse_apm_compilation(document.get("compilation"));
    let top_level_targets = collect_apm_target_tokens(document);
    let target_tokens = if top_level_targets.is_empty() {
        compilation
            .as_ref()
            .map(|c| c.target_tokens.clone())
            .unwrap_or_default()
    } else {
        top_level_targets
    };
    let mapping = map_apm_targets(&target_tokens);
    warnings.extend(mapping.warnings.iter().cloned());
    if compilation.as_ref().and_then(|c| c.strategy.as_deref()) == Some("distributed") {
        warnings.push(
            "apm.yml compilation.strategy is distributed; ht compile / ht apply write existing harness files (single-file root context) rather than per-directory AGENTS.md"
                .to_owned(),
        );
    }

    let (apm, mcp) = collect_apm_and_dev_dependencies(document).map_err(ManifestError::error)?;
    let policy_pin = parse_apm_policy_pin(document.get("policy")).map_err(|e| ManifestError {
        name: e.name.into(),
        message: e.message,
    })?;
    let mut vendor = Map::new();
    for key in HT_TOP_LEVEL_KEYS {
        if let Some(v) = document.get(key) {
            vendor.insert(key.into(), v.clone());
        }
    }
    // `rest[key] = value` with `__proto__` sets the prototype instead of a key.
    let mut rest = Map::new();
    for (key, value) in ordered_entries(document) {
        if !RESERVED_TOP_LEVEL.contains(&key.as_str()) && key != "__proto__" {
            rest.insert(key.clone(), value.clone());
        }
    }

    let mut overlay = None;
    if let Some(root) = root_path.filter(|r| !r.as_os_str().is_empty()) {
        let exclude = compilation
            .as_ref()
            .map(|c| c.exclude.clone())
            .unwrap_or_default();
        overlay = inspect_apm_overlay(root, &exclude).map_err(|e| ManifestError {
            name: e.name,
            message: e.message,
        })?;
        if let Some(o) = &overlay {
            warnings.extend(o.warnings.iter().cloned());
        }
    }

    Ok(ApmManifestFields {
        name,
        version,
        description,
        vendor,
        harness_targets: mapping.harness_targets,
        skipped_targets: mapping.skipped_targets,
        apm_dependencies: apm,
        mcp_dependencies: mcp,
        policy_pin,
        overlay,
        compilation,
        warnings,
        rest,
    })
}

/// `basename(projectPath).trim()`, or `project` when that is empty.
fn sanitize_package_name(project_path: &str) -> String {
    let trimmed_end = project_path.trim_end_matches('/');
    let base = trimmed_end.rsplit('/').next().unwrap_or("");
    let base = trim(base);
    if base.is_empty() {
        "project".to_owned()
    } else {
        base.to_owned()
    }
}

/// `serializeEnvironmentBlock(config)`.
pub fn serialize_environment_block(config: &ProjectConfig) -> Option<Map<String, Value>> {
    let default_environment = config
        .default_environment
        .as_deref()
        .filter(|e| !e.is_empty());
    if default_environment.is_none() && config.environments.is_empty() {
        return None;
    }
    let mut block = Map::new();
    if let Some(default) = default_environment {
        block.insert("default".into(), Value::String(default.to_owned()));
    }
    for environment in &config.environments {
        let mut entry = Map::new();
        if !environment.values.is_empty() {
            let values: Map<String, Value> = environment
                .values
                .iter()
                .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                .collect();
            entry.insert("values".into(), Value::Object(values));
        }
        if let Some(refs) = environment.secret_refs.as_ref().filter(|r| !r.is_empty()) {
            let refs: Map<String, Value> = refs
                .iter()
                .map(|(k, r)| {
                    let mut o = Map::new();
                    o.insert("provider".into(), Value::String(r.provider.clone()));
                    o.insert("ref".into(), Value::String(r.reference.clone()));
                    (k.clone(), Value::Object(o))
                })
                .collect();
            entry.insert("secret_refs".into(), Value::Object(refs));
        }
        block.insert(environment.name.clone(), Value::Object(entry));
    }
    Some(block)
}

/// `apmDocumentFromProjectConfig(config, projectPath)`.
pub fn apm_document_from_project_config(
    config: &ProjectConfig,
    project_path: &str,
) -> Map<String, Value> {
    let name = config
        .apm_name
        .clone()
        .unwrap_or_else(|| sanitize_package_name(project_path));
    let version = config
        .apm_version
        .clone()
        .unwrap_or_else(|| "1.0.0".to_owned());
    let mut document = config.apm_document.clone().unwrap_or_default();
    for key in STRIP_TOP_LEVEL_KEYS.iter().chain(HT_TOP_LEVEL_KEYS.iter()) {
        document.shift_remove(*key);
    }
    let mut set = |key: &str, value: Value| {
        document.insert(key.to_owned(), value);
    };
    set("name", Value::String(name));
    set("version", Value::String(version));
    let truthy = |v: &Option<String>| v.as_deref().filter(|s| !s.is_empty()).map(str::to_owned);
    if let Some(description) = truthy(&config.apm_description) {
        set("description", Value::String(description));
    }
    if let Some(profile) = truthy(&config.default_profile) {
        set("default_profile", Value::String(profile));
    }
    if let Some(environments) = serialize_environment_block(config) {
        set("environments", Value::Object(environments));
    }
    if !config.profiles.is_empty() {
        let profiles = config
            .profiles
            .iter()
            .map(|p| {
                let mut o = Map::new();
                o.insert("name".into(), Value::String(p.name.clone()));
                o.insert("source".into(), Value::String(p.source.as_str().to_owned()));
                for (k, v) in [
                    ("selector", &p.selector),
                    ("plugin", &p.plugin),
                    ("environment", &p.environment),
                ] {
                    if let Some(v) = truthy(v) {
                        o.insert(k.into(), Value::String(v));
                    }
                }
                Value::Object(o)
            })
            .collect();
        set("profiles", Value::Array(profiles));
    }
    if !config.plugins.is_empty() {
        let plugins = config.plugins.iter().cloned().map(Value::Object).collect();
        set("plugins", Value::Array(plugins));
    }
    document
}

/// `formatApmManifest(config, projectPath)`.
pub fn format_apm_manifest(config: &ProjectConfig, project_path: &str) -> String {
    yaml_rs::stringify(&Value::Object(apm_document_from_project_config(
        config,
        project_path,
    )))
}

/// `parseApmManifestContents(raw, filePath, rootPath)`.
pub fn parse_apm_manifest_contents(
    raw: &str,
    file_path: &str,
    root_path: Option<&Path>,
) -> R<ApmManifestFields> {
    let document = parse_apm_yaml_document(raw, file_path)?;
    extract_apm_manifest_fields(&document, file_path, root_path)
}

/// `readPackageRuntimeApmDependencies(packageRoot)`: `dependencies.apm` only.
pub fn read_package_runtime_apm_dependencies(package_root: &Path) -> R<Vec<ParsedApmDependency>> {
    let file_path = package_root.join(APM_MANIFEST_FILENAME);
    if fs::metadata(&file_path).is_err() {
        return Ok(Vec::new());
    }
    if fs::symlink_metadata(&file_path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(ManifestError::error(format!(
            "Symlinks are not allowed in a bundle: {APM_MANIFEST_FILENAME}"
        )));
    }
    let raw = fs::read(&file_path).map_err(|e| {
        ManifestError::error(if e.kind() == std::io::ErrorKind::IsADirectory {
            "EISDIR: illegal operation on a directory, read".to_owned()
        } else {
            e.to_string()
        })
    })?;
    let display = file_path.to_string_lossy();
    let document = parse_apm_yaml_document(&String::from_utf8_lossy(&raw), &display)?;
    collect_runtime_apm_dependencies(&document).map_err(ManifestError::error)
}
