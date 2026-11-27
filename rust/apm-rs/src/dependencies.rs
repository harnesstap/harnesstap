//! `apm-dependencies.ts`: the `dependencies.apm` and `dependencies.mcp` entries of an
//! `apm.yml`, parsed into what to install.

use emit_rs::js::{ordered_entries, to_string, trim, truthy};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// `ApmDependencySourceKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Git,
    Catalog,
    Marketplace,
    Local,
}

/// `ParsedApmDependency`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedApmDependency {
    pub raw: String,
    pub source_kind: SourceKind,
    pub name: String,
    pub origin_ref: String,
    pub apply_selector: String,
    #[serde(rename = "ref", skip_serializing_if = "Option::is_none")]
    pub git_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_constraint: Option<String>,
    /// Virtual package subpath inside the git repo (object-form `path:`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// `ParsedMcpDependency["transport"]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpTransport {
    Stdio,
    Http,
}

/// `ParsedMcpDependency`. `env` and `headers` keep the key order of the JavaScript object.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMcpDependency {
    pub raw: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<McpTransport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "pairs")]
    pub env: Option<Vec<(String, String)>>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "pairs")]
    pub headers: Option<Vec<(String, String)>>,
    pub self_defined: bool,
}

fn pairs<S: serde::Serializer>(
    value: &Option<Vec<(String, String)>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let map: Map<String, Value> = value
        .iter()
        .flatten()
        .map(|(k, v)| (k.clone(), Value::String(v.clone())))
        .collect();
    map.serialize(serializer)
}

/// `splitHashRef`: `(body, ref)`.
fn split_hash_ref(value: &str) -> (&str, Option<&str>) {
    match value.rfind('#') {
        Some(hash) if hash > 0 => {
            let (body, git_ref) = (&value[..hash], &value[hash + 1..]);
            if body.is_empty() || git_ref.is_empty() {
                (value, None)
            } else {
                (body, Some(git_ref))
            }
        }
        _ => (value, None),
    }
}

/// `repoNameFromGitRef`.
fn repo_name_from_git_ref(value: &str) -> String {
    let without_git = value.strip_suffix(".git").unwrap_or(value);
    let tail = without_git
        .split('/')
        .rfind(|s| !s.is_empty())
        .unwrap_or(without_git);
    tail.rsplit(':').next().unwrap_or(tail).to_owned()
}

/// `looksLikeHost`.
fn looks_like_host(segment: &str) -> bool {
    segment.contains('.') || segment == "localhost"
}

/// `cloneUrlFromOrigin`: strip a `git+` transport prefix.
pub fn clone_url_from_origin(origin_ref: &str) -> String {
    origin_ref
        .strip_prefix("git+")
        .unwrap_or(origin_ref)
        .to_owned()
}

fn with_ref(git_ref: Option<&str>) -> (Option<String>, Option<String>) {
    let r = git_ref.map(str::to_owned);
    (r.clone(), r)
}

/// `parseGitShorthand`.
fn parse_git_shorthand(body: &str, raw: &str, git_ref: Option<&str>) -> ParsedApmDependency {
    let name = repo_name_from_git_ref(body);
    let first = body.split('/').next().unwrap_or("");
    let origin_ref = if looks_like_host(first) {
        body.to_owned()
    } else {
        format!(
            "https://github.com/{}.git",
            body.strip_suffix(".git").unwrap_or(body)
        )
    };
    let (git_ref, version_constraint) = with_ref(git_ref);
    ParsedApmDependency {
        raw: raw.to_owned(),
        source_kind: SourceKind::Git,
        apply_selector: name.clone(),
        name,
        origin_ref,
        git_ref,
        version_constraint,
        path: None,
    }
}

const LOCAL_PREFIXES: [&str; 7] = ["./", "../", "~/", "/", ".\\", "..\\", "~\\"];

/// `parseApmDependencyString`.
pub fn parse_apm_dependency_string(entry: &str) -> ParsedApmDependency {
    let trimmed = trim(entry);
    let (body, git_ref) = split_hash_ref(trimmed);
    let plain = |kind, name: String, origin: &str, selector: &str, git_ref: Option<&str>| {
        let (git_ref, version_constraint) = with_ref(git_ref);
        ParsedApmDependency {
            raw: trimmed.to_owned(),
            source_kind: kind,
            name,
            origin_ref: origin.to_owned(),
            apply_selector: selector.to_owned(),
            git_ref,
            version_constraint,
            path: None,
        }
    };

    if LOCAL_PREFIXES.iter().any(|p| body.starts_with(p)) {
        let name = body
            .split(['/', '\\'])
            .rfind(|s| !s.is_empty())
            .unwrap_or(body)
            .to_owned();
        let selector = name.clone();
        return plain(SourceKind::Local, name, body, &selector, None);
    }

    let git_prefixes = [
        "https://",
        "http://",
        "file://",
        "git://",
        "git@",
        "ssh://git@",
        "git+",
    ];
    if git_prefixes.iter().any(|p| body.starts_with(p)) {
        let name = repo_name_from_git_ref(body);
        let selector = name.clone();
        return plain(
            SourceKind::Git,
            name,
            &clone_url_from_origin(body),
            &selector,
            git_ref,
        );
    }

    let slash_parts: Vec<&str> = body.split('/').filter(|s| !s.is_empty()).collect();
    let at = body.rfind('@');

    if slash_parts.len() == 3 {
        let name_part = slash_parts[2];
        let name = name_part.split('@').next().unwrap_or(name_part).to_owned();
        return plain(SourceKind::Catalog, name, body, body, git_ref);
    }

    if let Some(at) = at.filter(|&a| a > 0 && !body[..a].contains('/')) {
        return plain(
            SourceKind::Marketplace,
            body[..at].to_owned(),
            body,
            body,
            None,
        );
    }

    if slash_parts.len() == 2 || (slash_parts.len() > 2 && looks_like_host(slash_parts[0])) {
        return parse_git_shorthand(body, trimmed, git_ref);
    }

    plain(SourceKind::Local, body.to_owned(), body, body, git_ref)
}

fn str_field<'a>(entry: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    entry.get(key).and_then(Value::as_str)
}

/// `parseApmDependencyEntry`.
pub fn parse_apm_dependency_entry(entry: &Value) -> Result<ParsedApmDependency, String> {
    if let Value::String(s) = entry {
        return Ok(parse_apm_dependency_string(s));
    }
    let Value::Object(map) = entry else {
        return Err("dependencies.apm entries must be strings or mappings".into());
    };
    let raw = emit_rs::json::stringify(entry, "");
    let (git, id) = (str_field(map, "git"), str_field(map, "id"));
    if git.is_some() && id.is_some() {
        return Err("dependencies.apm object cannot set both git and id".into());
    }
    let version = str_field(map, "version").filter(|v| !v.is_empty());

    if let (Some(marketplace), Some(name)) = (str_field(map, "marketplace"), str_field(map, "name"))
    {
        let origin_ref = format!("{name}@{marketplace}");
        return Ok(ParsedApmDependency {
            raw,
            source_kind: SourceKind::Marketplace,
            name: name.to_owned(),
            apply_selector: origin_ref.clone(),
            origin_ref,
            git_ref: None,
            version_constraint: version.map(str::to_owned),
            path: None,
        });
    }

    if let Some(id) = id {
        let parsed = parse_apm_dependency_string(id);
        let catalog = parsed.source_kind == SourceKind::Catalog;
        let selector = match version {
            Some(v) if catalog => format!("{id}@{v}"),
            _ => parsed.apply_selector.clone(),
        };
        let origin_ref = if catalog {
            selector.clone()
        } else {
            parsed.origin_ref.clone()
        };
        let (git_ref, version_constraint) = match version {
            Some(v) => (
                Some(parsed.git_ref.clone().unwrap_or_else(|| v.to_owned())),
                Some(v.to_owned()),
            ),
            None => (parsed.git_ref.clone(), parsed.version_constraint.clone()),
        };
        return Ok(ParsedApmDependency {
            raw,
            apply_selector: selector,
            origin_ref,
            git_ref,
            version_constraint,
            ..parsed
        });
    }

    if let Some(git) = git {
        let git_ref = str_field(map, "ref").filter(|r| !r.is_empty());
        let source = match git_ref {
            Some(r) => format!("{git}#{r}"),
            None => git.to_owned(),
        };
        let parsed = parse_apm_dependency_string(&source);
        let path = str_field(map, "path").filter(|p| !p.is_empty());
        let (r, v) = match git_ref {
            Some(r) => (Some(r.to_owned()), Some(r.to_owned())),
            None => (parsed.git_ref.clone(), parsed.version_constraint.clone()),
        };
        return Ok(ParsedApmDependency {
            raw,
            origin_ref: clone_url_from_origin(&parsed.origin_ref),
            git_ref: r,
            version_constraint: v,
            path: path.map(str::to_owned).or(parsed.path.clone()),
            ..parsed
        });
    }

    if let Some(path) = str_field(map, "path") {
        return Ok(parse_apm_dependency_string(path));
    }

    Err("dependencies.apm object must include git, id, path, or marketplace".into())
}

/// `parseApmDependencyList`; `None` is `undefined`.
pub fn parse_apm_dependency_list(
    value: Option<&Value>,
) -> Result<Vec<ParsedApmDependency>, String> {
    match value {
        None => Ok(Vec::new()),
        Some(Value::Array(items)) => items.iter().map(parse_apm_dependency_entry).collect(),
        Some(_) => Err("dependencies.apm must be a list".into()),
    }
}

/// `mcpTransport`.
fn mcp_transport(value: Option<&Value>) -> Option<McpTransport> {
    match value.and_then(Value::as_str) {
        Some("stdio") => Some(McpTransport::Stdio),
        Some("http" | "sse" | "streamable-http") => Some(McpTransport::Http),
        _ => None,
    }
}

/// `stringMap`.
fn string_map(value: Option<&Value>) -> Option<Vec<(String, String)>> {
    let Some(Value::Object(map)) = value else {
        return None;
    };
    Some(
        ordered_entries(map)
            .into_iter()
            .map(|(k, v)| (k.clone(), to_string(v)))
            .collect(),
    )
}

/// `parseMcpDependencyEntry`.
pub fn parse_mcp_dependency_entry(entry: &Value) -> Result<ParsedMcpDependency, String> {
    if let Value::String(s) = entry {
        let trimmed = trim(s);
        let name = trimmed
            .split('/')
            .rfind(|p| !p.is_empty())
            .unwrap_or(trimmed);
        return Ok(ParsedMcpDependency {
            raw: trimmed.to_owned(),
            name: name.to_owned(),
            registry_id: Some(trimmed.to_owned()),
            transport: None,
            command: None,
            args: None,
            url: None,
            env: None,
            headers: None,
            self_defined: false,
        });
    }
    let Value::Object(map) = entry else {
        return Err("dependencies.mcp entries must be strings or mappings".into());
    };
    let Some(name) = str_field(map, "name").filter(|n| !n.is_empty()) else {
        return Err("dependencies.mcp object must include a name".into());
    };
    let registry = map.get("registry");
    let self_defined = registry == Some(&Value::Bool(false));
    let mut registry_id = registry.and_then(Value::as_str).map(str::to_owned);
    if !self_defined && !registry.is_some_and(truthy) {
        registry_id = Some(name.to_owned());
    }
    let args = match map.get("args") {
        Some(Value::Array(items)) => Some(items.iter().map(to_string).collect()),
        _ => None,
    };
    Ok(ParsedMcpDependency {
        raw: emit_rs::json::stringify(entry, ""),
        name: name.to_owned(),
        registry_id,
        transport: mcp_transport(map.get("transport")),
        command: str_field(map, "command").map(str::to_owned),
        args,
        url: str_field(map, "url").map(str::to_owned),
        env: string_map(map.get("env")),
        headers: string_map(map.get("headers")),
        self_defined,
    })
}

/// `parseMcpDependencyList`.
pub fn parse_mcp_dependency_list(
    value: Option<&Value>,
) -> Result<Vec<ParsedMcpDependency>, String> {
    match value {
        None => Ok(Vec::new()),
        Some(Value::Array(items)) => items.iter().map(parse_mcp_dependency_entry).collect(),
        Some(_) => Err("dependencies.mcp must be a list".into()),
    }
}

fn field<'a>(m: Option<&'a Map<String, Value>>, k: &str) -> Option<&'a Value> {
    m.and_then(|m| m.get(k))
}

fn section<'a>(document: &'a Map<String, Value>, key: &str) -> Option<&'a Map<String, Value>> {
    document.get(key).and_then(Value::as_object)
}

/// `collectRuntimeApmDependencies`.
pub fn collect_runtime_apm_dependencies(
    document: &Map<String, Value>,
) -> Result<Vec<ParsedApmDependency>, String> {
    parse_apm_dependency_list(section(document, "dependencies").and_then(|d| d.get("apm")))
}

/// `collectApmAndDevDependencies`: `(apm, mcp)`.
pub fn collect_apm_and_dev_dependencies(
    document: &Map<String, Value>,
) -> Result<(Vec<ParsedApmDependency>, Vec<ParsedMcpDependency>), String> {
    let deps = section(document, "dependencies");
    let dev = section(document, "devDependencies");
    let mut apm = parse_apm_dependency_list(field(deps, "apm"))?;
    apm.extend(parse_apm_dependency_list(field(dev, "apm"))?);
    let mut mcp = parse_mcp_dependency_list(field(deps, "mcp"))?;
    mcp.extend(parse_mcp_dependency_list(field(dev, "mcp"))?);
    Ok((apm, mcp))
}

/// `isFilesystemApmDependency`.
pub fn is_filesystem_apm_dependency(dependency: &ParsedApmDependency) -> bool {
    dependency.source_kind == SourceKind::Local
        && LOCAL_PREFIXES
            .iter()
            .any(|p| dependency.origin_ref.starts_with(p))
}
