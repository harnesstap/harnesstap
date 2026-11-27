//! `src/services/skill-command-metadata.ts`: command resources from a skill's
//! `scripts/command-metadata.json`, with their text from `reference/<key>.md`.

use std::path::Path;

use emit_rs::js::{ordered_entries, trim};
use frontmatter_rs::parse_frontmatter;
use serde_json::{Map, Value, json};

/// Node's `path.join` on POSIX (the same as `db-rs`'s `posix_join`).
fn join(parts: &[&str]) -> String {
    let joined = parts
        .iter()
        .filter(|p| !p.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("/");
    if joined.is_empty() {
        return ".".to_owned();
    }
    let absolute = joined.starts_with('/');
    let trailing = joined.ends_with('/');
    let mut segments: Vec<&str> = Vec::new();
    for segment in joined.split('/') {
        match segment {
            "" | "." => {}
            ".." if segments.last().is_some_and(|s| *s != "..") => {
                segments.pop();
            }
            ".." if absolute => {}
            s => segments.push(s),
        }
    }
    let mut out = segments.join("/");
    if out.is_empty() && !absolute {
        out.push('.');
    }
    if !out.is_empty() && trailing {
        out.push('/');
    }
    if absolute { format!("/{out}") } else { out }
}

/// `readFileSync(path, "utf-8")`, or `None` when it fails.
fn read_text(path: &str) -> Option<String> {
    std::fs::read(path)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).into_owned())
}

fn read_reference_content(skill_dir: &str, command_key: &str) -> Result<Option<String>, String> {
    for reference_dir in ["reference", "references"] {
        let reference_path = join(&[skill_dir, reference_dir, &format!("{command_key}.md")]);
        let Some(raw) = read_text(&reference_path).filter(|r| !r.is_empty()) else {
            continue;
        };
        if raw.starts_with("---") {
            return match parse_frontmatter(&raw) {
                Ok(parsed) if parsed.content != raw => Ok(Some(trim(&parsed.content).to_owned())),
                _ => Err(format!(
                    "Error: Malformed reference frontmatter: {reference_path}"
                )),
            };
        }
        return Ok(Some(trim(&raw).to_owned()));
    }
    Ok(None)
}

fn trimmed_str(entry: &Value, key: &str) -> String {
    entry
        .get(key)
        .and_then(Value::as_str)
        .map(|s| trim(s).to_owned())
        .unwrap_or_default()
}

/// What `scanSkillCommandMetadataResources` takes.
pub struct ScanSkillCommandMetadataInput<'a> {
    pub skill_dir: &'a str,
    pub skill_name: &'a str,
    pub root_path: &'a str,
    pub relative_path: &'a dyn Fn(&str, &str) -> String,
    /// `ImportedResourceProvenance`, kept as the original's object.
    pub imported_from: Option<&'a Value>,
}

/// `scanSkillCommandMetadataResources(input)`: `ResourceCreateInput` objects (`type`, `name`,
/// `description`, `content`, `source`, `metadata`), sorted by name with `localeCompare`.
/// Errors are the original's `Error` messages, prefixed `Error: `.
pub fn scan_skill_command_metadata_resources(
    input: &ScanSkillCommandMetadataInput,
) -> Result<Vec<Value>, String> {
    let metadata_path = join(&[input.skill_dir, "scripts/command-metadata.json"]);
    if !Path::new(&metadata_path).exists() {
        return Ok(Vec::new());
    }
    let Some(raw) = read_text(&metadata_path).filter(|r| !r.is_empty()) else {
        return Ok(Vec::new());
    };
    // `JSON.parse` takes a lone surrogate escape and out-of-range numbers, which serde_json
    // refuses; such a file is reported malformed here.
    let Ok(Value::Object(metadata_file)) = serde_json::from_str::<Value>(&raw) else {
        return Err(format!(
            "Error: Malformed skill command metadata: {metadata_path}"
        ));
    };
    let mut resources = Vec::new();
    for (command_key, entry) in ordered_entries(&metadata_file) {
        if !matches!(entry, Value::Object(_) | Value::Array(_)) {
            continue;
        }
        let reference_content = read_reference_content(input.skill_dir, command_key)?;
        let description = trimmed_str(entry, "description");
        let argument_hint = trimmed_str(entry, "argumentHint");
        let name = format!("{}:{command_key}", input.skill_name);
        let command_name = trim(&name);
        if command_name.is_empty() || command_name.contains('/') || command_name.contains('\\') {
            return Err(format!(
                "Error: Invalid command name in {metadata_path}: {name}"
            ));
        }
        let source = match input.imported_from {
            Some(imported) => imported.get("relative_path").cloned(),
            None => Some(Value::String((input.relative_path)(
                input.root_path,
                &metadata_path,
            ))),
        };
        let mut metadata = Map::new();
        metadata.insert("skill_command".into(), Value::Bool(true));
        metadata.insert(
            "skill_name".into(),
            Value::String(input.skill_name.to_owned()),
        );
        metadata.insert("command_key".into(), Value::String(command_key.clone()));
        if !argument_hint.is_empty() {
            metadata.insert("argument_hint".into(), Value::String(argument_hint));
        }
        if let Some(imported) = input.imported_from {
            metadata.insert("imported_from".into(), imported.clone());
        }
        let content = reference_content.unwrap_or_else(|| {
            let mut lines = vec![
                format!("# {} {command_key}", input.skill_name),
                String::new(),
            ];
            if !description.is_empty() {
                lines.extend([description.clone(), String::new()]);
            }
            lines.push(format!(
                "Use the {} skill. Read reference/{command_key}.md for the full command flow.",
                input.skill_name
            ));
            lines.join("\n")
        });
        let mut resource = json!({
            "type": "command",
            "name": command_name,
            "description": description,
            "content": content,
        });
        if let (Value::Object(r), Some(source)) = (&mut resource, source) {
            r.insert("source".into(), source);
        }
        resource["metadata"] = Value::Object(metadata);
        resources.push(resource);
    }
    resources.sort_by(|a, b| {
        collate_rs::locale_compare(
            a["name"].as_str().unwrap_or(""),
            b["name"].as_str().unwrap_or(""),
        )
    });
    Ok(resources)
}

#[cfg(test)]
mod tests {
    use super::join;

    #[test]
    fn join_normalizes_like_node() {
        assert_eq!(join(&["/a/./b/", "reference", "../x.md"]), "/a/b/x.md");
        assert_eq!(join(&["a", "..", "..", "b"]), "../b");
        assert_eq!(join(&["", ""]), ".");
    }
}
