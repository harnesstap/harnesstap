//! `apm-mcp-manifest.ts`: adding an MCP registry id to `dependencies.mcp` in `apm.yml`.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::dependencies::collect_apm_and_dev_dependencies;
use crate::manifest::{APM_MANIFEST_FILENAME, ManifestError, parse_apm_yaml_document};

/// `splitMcpRegistryIdentity(raw)` from `mcp-registry.ts`: `(name, version)`.
pub fn split_mcp_registry_identity(raw: &str) -> (String, String) {
    let trimmed = emit_rs::js::trim(raw);
    let slash = trimmed.rfind('/');
    if let Some(at) = trimmed
        .rfind('@')
        .filter(|&at| at > 0 && slash.is_none_or(|s| at > s))
    {
        let (name, version) = (&trimmed[..at], &trimmed[at + 1..]);
        if !name.is_empty() && !version.is_empty() {
            return (name.to_owned(), version.to_owned());
        }
    }
    (trimmed.to_owned(), "latest".to_owned())
}

/// `apmManifestPath(projectRoot)`.
pub fn apm_manifest_path(project_root: &Path) -> PathBuf {
    project_root.join(APM_MANIFEST_FILENAME)
}

/// `manifestHasMcpRegistryId(raw, registryId)`.
pub fn manifest_has_mcp_registry_id(raw: &str, registry_id: &str) -> Result<bool, ManifestError> {
    let document = parse_apm_yaml_document(raw, APM_MANIFEST_FILENAME)?;
    let (name, _) = split_mcp_registry_identity(registry_id);
    let (_, mcp) =
        collect_apm_and_dev_dependencies(&document).map_err(|message| ManifestError {
            name: "Error".into(),
            message,
        })?;
    Ok(mcp.iter().any(|entry| {
        let id = entry.registry_id.as_deref();
        id == Some(registry_id)
            || id == Some(name.as_str())
            || entry.raw == registry_id
            || entry.raw == name
    }))
}

/// `appendMcpRegistryIdToManifest(raw, registryId)`: `(next, added)`.
pub fn append_mcp_registry_id_to_manifest(
    raw: &str,
    registry_id: &str,
) -> Result<(String, bool), ManifestError> {
    if manifest_has_mcp_registry_id(raw, registry_id)? {
        return Ok((raw.to_owned(), false));
    }
    let mut document = parse_apm_yaml_document(raw, APM_MANIFEST_FILENAME)?;
    let mut dependencies: Map<String, Value> = match document.get("dependencies") {
        Some(Value::Object(d)) => d.clone(),
        _ => Map::new(),
    };
    let mut mcp = match dependencies.get("mcp") {
        Some(Value::Array(existing)) => existing.clone(),
        _ => Vec::new(),
    };
    mcp.push(Value::String(registry_id.to_owned()));
    dependencies.insert("mcp".into(), Value::Array(mcp));
    document.insert("dependencies".into(), Value::Object(dependencies));
    Ok((yaml_rs::stringify(&Value::Object(document)), true))
}

/// `withMcpManifestAppend`: add the id to the project's `apm.yml`, run `run`, and put the
/// file back when `run` fails, leaves a non-zero exit code (`run` returns it, standing in for
/// `process.exitCode`), or `dry_run` is set.
pub fn with_mcp_manifest_append<E: From<ManifestError>>(
    project_root: &Path,
    registry_id: &str,
    dry_run: bool,
    run: impl FnOnce() -> Result<i32, E>,
) -> Result<bool, E> {
    let path = apm_manifest_path(project_root);
    if fs::metadata(&path).is_err() {
        return Err(ManifestError {
            name: "Error".into(),
            message: format!(
                "No {APM_MANIFEST_FILENAME} found under {}. Run ht config init first.",
                project_root.display()
            ),
        }
        .into());
    }
    let io = |e: std::io::Error| ManifestError {
        name: "Error".into(),
        message: e.to_string(),
    };
    let previous = String::from_utf8_lossy(&fs::read(&path).map_err(io)?).into_owned();
    let (next, added) = append_mcp_registry_id_to_manifest(&previous, registry_id)?;
    if added {
        fs::write(&path, next).map_err(io)?;
    }
    let restore = || -> Result<(), ManifestError> {
        if added {
            fs::write(&path, &previous).map_err(io)?;
        }
        Ok(())
    };
    match run() {
        Ok(exit_code) => {
            if exit_code != 0 || dry_run {
                restore()?;
            }
            Ok(added)
        }
        Err(e) => {
            restore()?;
            Err(e)
        }
    }
}
