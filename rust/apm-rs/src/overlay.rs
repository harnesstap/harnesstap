//! `apm-overlay.ts`: the primitives a project publishes from `.apm/` (or, without `.apm/`,
//! from root-level `agents/`, `skills/`, `commands/` and `hooks/`).

use std::fs;
use std::path::Path;

use emit_rs::js::trim;
use frontmatter_rs::{FrontmatterError, JsValue, parse_frontmatter};

use crate::hook_serialization::parse_hooks_json_content;
use crate::skill_auxiliary::{SkillMetadata, read_dir_sorted, skill_metadata_from_dir};

pub const APM_NATIVE_PRIMITIVE_DIRS: [&str; 4] = ["agents", "skills", "commands", "hooks"];
pub const APM_APPLY_PRIMITIVE_DIRS: [&str; 6] = [
    "agents",
    "skills",
    "commands",
    "hooks",
    "instructions",
    "prompts",
];
const APM_WARN_ONLY_DIRS: [&str; 2] = ["chatmodes", "mcp"];

/// `ApmOverlaySkill`.
#[derive(Clone, Debug, PartialEq)]
pub struct ApmOverlaySkill {
    pub name: String,
    pub description: String,
    pub content: String,
    pub skill_dir_relative: String,
    pub skill_md_relative: String,
    pub metadata: SkillMetadata,
}

/// `ApmOverlayPrimitive`. `metadata` is a plain object; for markdown primitives it is the
/// frontmatter, so it can hold dates and buffers as js-yaml builds them.
#[derive(Clone, Debug, PartialEq)]
pub struct ApmOverlayPrimitive {
    /// The `ResourceType`: `skill`, `agent`, `command`, `hook`, `instruction` or `rule`.
    pub resource_type: &'static str,
    pub name: String,
    pub description: String,
    pub content: String,
    pub metadata: JsValue,
    pub source_relative: String,
}

/// `ApmOverlayInfo`.
#[derive(Clone, Debug, PartialEq)]
pub struct ApmOverlayInfo {
    pub present: bool,
    pub from_apm: bool,
    pub skills: Vec<ApmOverlaySkill>,
    pub primitives: Vec<ApmOverlayPrimitive>,
    pub skipped_kinds: Vec<String>,
    pub skipped_root_dirs: Vec<String>,
    pub warnings: Vec<String>,
}

/// What `inspectApmOverlay` throws: `BundleSymlinkError`, a frontmatter error
/// (`YAMLException`, ...), or a file system error.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OverlayError {
    pub name: String,
    pub message: String,
}

impl OverlayError {
    fn symlink(entry: &str) -> Self {
        Self {
            name: "BundleSymlinkError".into(),
            message: format!("Symlinks are not allowed in a bundle: {entry}"),
        }
    }

    fn io(e: &std::io::Error) -> Self {
        Self {
            name: "Error".into(),
            message: e.to_string(),
        }
    }
}

impl From<FrontmatterError> for OverlayError {
    fn from(e: FrontmatterError) -> Self {
        Self {
            name: e.name().into(),
            message: e.message().into(),
        }
    }
}

type R<T> = Result<T, OverlayError>;

/// `existsSync`: follows symlinks, so a dangling one does not exist.
fn exists(path: &Path) -> bool {
    fs::metadata(path).is_ok()
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink())
}

fn is_directory(path: &Path) -> bool {
    exists(path) && fs::symlink_metadata(path).is_ok_and(|m| m.is_dir())
}

/// `skippedRootSourceWarning(dir)`.
pub fn skipped_root_source_warning(dir: &str) -> String {
    format!(
        "Skipping root-level {dir}/ because .apm/ is present. Move publishable files to .apm/{dir}/ or remove {dir}/ to silence this warning."
    )
}

fn matches_exclude(relative_path: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|pattern| {
        let normalized = pattern
            .strip_prefix("./")
            .unwrap_or(pattern)
            .replace('\\', "/");
        if let Some(prefix) = normalized.strip_suffix("/**") {
            return relative_path == prefix || relative_path.starts_with(&format!("{prefix}/"));
        }
        if let Some(prefix) = normalized.strip_suffix("/*") {
            return relative_path
                .strip_prefix(&format!("{prefix}/"))
                .is_some_and(|rest| !rest.contains('/'));
        }
        relative_path == normalized || relative_path.starts_with(&format!("{normalized}/"))
    })
}

/// `listContainedRegularFiles(root)` from `path-containment.ts`: every regular file as a POSIX
/// relative path, in `readdirSync` order; any symlink or special file throws.
pub fn list_contained_regular_files(root: &Path) -> R<Vec<String>> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) -> R<()> {
        for name in read_dir_sorted(dir).map_err(|e| OverlayError::io(&e))? {
            let absolute = dir.join(&name);
            let relative_path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let meta = fs::symlink_metadata(&absolute).map_err(|e| OverlayError::io(&e))?;
            if meta.file_type().is_symlink() {
                return Err(OverlayError::symlink(&relative_path));
            }
            if meta.is_dir() {
                walk(&absolute, &relative_path, out)?;
                continue;
            }
            if !meta.is_file() {
                return Err(OverlayError::symlink(&relative_path));
            }
            out.push(relative_path);
        }
        Ok(())
    }
    if is_symlink(root) {
        return Err(OverlayError::symlink("."));
    }
    let mut files = Vec::new();
    walk(root, "", &mut files)?;
    Ok(files)
}

fn list_source_files(
    project_root: &Path,
    source_relative: &str,
    exclude: &[String],
) -> R<Vec<String>> {
    let absolute = project_root.join(source_relative);
    if !exists(&absolute) {
        return Ok(Vec::new());
    }
    if is_symlink(&absolute) {
        return Err(OverlayError::symlink(source_relative));
    }
    if !fs::symlink_metadata(&absolute).is_ok_and(|m| m.is_dir()) {
        return Ok(Vec::new());
    }
    Ok(list_contained_regular_files(&absolute)?
        .into_iter()
        .filter(|child| !child.split('/').any(|s| s.starts_with('.')))
        .map(|child| format!("{source_relative}/{child}"))
        .filter(|p| !matches_exclude(p, exclude))
        .collect())
}

/// `str.replace(/\.<suffix>$/i, "")` for an ASCII suffix.
fn strip_suffix_ci<'a>(s: &'a str, suffix: &str) -> Option<&'a str> {
    let cut = s.len().checked_sub(suffix.len())?;
    (s.is_char_boundary(cut) && s[cut..].eq_ignore_ascii_case(suffix)).then(|| &s[..cut])
}

fn native_basename(relative_path: &str) -> String {
    let base = relative_path.rsplit('/').next().unwrap_or(relative_path);
    let base = [".agent.md", ".prompt.md", ".instructions.md"]
        .iter()
        .find_map(|suffix| strip_suffix_ci(base, suffix))
        .unwrap_or(base);
    strip_suffix_ci(base, ".md").unwrap_or(base).to_owned()
}

fn source_dir(prefix: &str, dir: &str) -> String {
    if prefix.is_empty() {
        dir.to_owned()
    } else {
        format!("{prefix}/{dir}")
    }
}

/// `{ ...value }` for what `isRecord` accepts (any object but an array); else `{}`.
fn record_entries(value: &JsValue) -> Vec<(String, JsValue)> {
    match value {
        JsValue::Object(entries) => entries.clone(),
        JsValue::Buffer(bytes) => bytes
            .iter()
            .enumerate()
            .map(|(i, b)| (i.to_string(), JsValue::Number(f64::from(*b))))
            .collect(),
        _ => Vec::new(),
    }
}

/// `fs.readFileSync(path, "utf-8")`: invalid UTF-8 becomes U+FFFD.
fn read_utf8(path: &Path) -> R<String> {
    let bytes = fs::read(path).map_err(|e| OverlayError::io(&e))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

struct Markdown {
    data: Vec<(String, JsValue)>,
    content: String,
}

impl Markdown {
    fn get(&self, key: &str) -> Option<&JsValue> {
        self.data.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    fn str(&self, key: &str) -> Option<&str> {
        match self.get(key) {
            Some(JsValue::String(s)) => Some(s),
            _ => None,
        }
    }

    /// `typeof data.name === "string" && data.name.trim() ? data.name.trim() : fallback`.
    fn name_or(&self, fallback: impl FnOnce() -> String) -> String {
        self.str("name")
            .map(trim)
            .filter(|s| !s.is_empty())
            .map_or_else(fallback, str::to_owned)
    }

    fn description(&self) -> String {
        self.str("description").unwrap_or_default().to_owned()
    }
}

fn parse_markdown(project_root: &Path, relative_path: &str) -> R<Markdown> {
    let raw = read_utf8(&project_root.join(relative_path))?;
    let parsed = parse_frontmatter(&raw)?;
    Ok(Markdown {
        data: record_entries(&parsed.data),
        content: parsed.content,
    })
}

fn apply_to_globs(md: &Markdown) -> Vec<String> {
    // `data.applyTo ?? data.apply_to`
    let raw = match md.get("applyTo") {
        None | Some(JsValue::Null | JsValue::Undefined) => md.get("apply_to"),
        some => some,
    };
    match raw {
        Some(JsValue::String(s)) if !trim(s).is_empty() => vec![trim(s).to_owned()],
        Some(JsValue::Array(items)) => items
            .iter()
            .filter_map(|e| match e {
                JsValue::String(s) if !trim(s).is_empty() => Some(trim(s).to_owned()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn skill_from_path(project_root: &Path, skill_md_relative: &str) -> R<ApmOverlaySkill> {
    let md = parse_markdown(project_root, skill_md_relative)?;
    let skill_dir_relative = strip_suffix_ci(skill_md_relative, "/SKILL.md")
        .unwrap_or(skill_md_relative)
        .to_owned();
    let dir_name = skill_dir_relative
        .rsplit('/')
        .next()
        .unwrap_or("skill")
        .to_owned();
    let metadata = skill_metadata_from_dir(&project_root.join(&skill_dir_relative));
    Ok(ApmOverlaySkill {
        name: md.name_or(|| dir_name),
        description: md.description(),
        content: trim(&md.content).to_owned(),
        skill_dir_relative,
        skill_md_relative: skill_md_relative.to_owned(),
        metadata,
    })
}

fn markdown_primitive(
    resource_type: &'static str,
    project_root: &Path,
    relative_path: &str,
) -> R<ApmOverlayPrimitive> {
    let md = parse_markdown(project_root, relative_path)?;
    let name = md.name_or(|| native_basename(relative_path));
    let description = md.description();
    let metadata = md
        .data
        .iter()
        .filter(|(k, _)| !matches!(k.as_str(), "name" | "description" | "applyTo" | "apply_to"))
        .cloned()
        .collect();
    Ok(ApmOverlayPrimitive {
        resource_type,
        name,
        description,
        content: trim(&md.content).to_owned(),
        metadata: JsValue::Object(metadata),
        source_relative: relative_path.to_owned(),
    })
}

fn collect_skills(
    project_root: &Path,
    skills_prefix: &str,
    exclude: &[String],
) -> R<Vec<ApmOverlaySkill>> {
    let mut skills: Vec<ApmOverlaySkill> = Vec::new();
    for relative_path in list_source_files(project_root, skills_prefix, exclude)? {
        if !relative_path.ends_with("/SKILL.md")
            && relative_path != format!("{skills_prefix}/SKILL.md")
        {
            continue;
        }
        let skill = skill_from_path(project_root, &relative_path)?;
        if skills.iter().any(|s| s.name == skill.name) {
            continue;
        }
        skills.push(skill);
    }
    Ok(skills)
}

fn push_unique(out: &mut Vec<ApmOverlayPrimitive>, primitive: ApmOverlayPrimitive) {
    if !out
        .iter()
        .any(|p| p.resource_type == primitive.resource_type && p.name == primitive.name)
    {
        out.push(primitive);
    }
}

fn collect_markdown_dir(
    resource_type: &'static str,
    project_root: &Path,
    dir_relative: &str,
    exclude: &[String],
) -> R<Vec<ApmOverlayPrimitive>> {
    let mut out = Vec::new();
    for relative_path in list_source_files(project_root, dir_relative, exclude)? {
        if !relative_path.ends_with(".md") {
            continue;
        }
        push_unique(
            &mut out,
            markdown_primitive(resource_type, project_root, &relative_path)?,
        );
    }
    Ok(out)
}

fn collect_instructions(
    project_root: &Path,
    dir_relative: &str,
    exclude: &[String],
) -> R<Vec<ApmOverlayPrimitive>> {
    let mut out: Vec<ApmOverlayPrimitive> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for relative_path in list_source_files(project_root, dir_relative, exclude)? {
        if !relative_path.ends_with(".md") {
            continue;
        }
        let md = parse_markdown(project_root, &relative_path)?;
        let name = md.name_or(|| native_basename(&relative_path));
        let description = md.description();
        let globs = apply_to_globs(&md);
        let key = if globs.is_empty() {
            format!("instruction:{name}")
        } else {
            format!("rule:{name}")
        };
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        let (resource_type, metadata) = if globs.is_empty() {
            ("instruction", JsValue::Object(Vec::new()))
        } else {
            (
                "rule",
                JsValue::Object(vec![
                    (
                        "globs".into(),
                        JsValue::Array(globs.into_iter().map(JsValue::String).collect()),
                    ),
                    ("always_apply".into(), JsValue::Bool(false)),
                ]),
            )
        };
        out.push(ApmOverlayPrimitive {
            resource_type,
            name,
            description,
            content: trim(&md.content).to_owned(),
            metadata,
            source_relative: relative_path,
        });
    }
    Ok(out)
}

fn collect_hooks(
    project_root: &Path,
    dir_relative: &str,
    exclude: &[String],
) -> R<Vec<ApmOverlayPrimitive>> {
    let mut out: Vec<ApmOverlayPrimitive> = Vec::new();
    for relative_path in list_source_files(project_root, dir_relative, exclude)? {
        if !relative_path.ends_with(".json") {
            continue;
        }
        let raw = read_utf8(&project_root.join(&relative_path))?;
        let parsed = parse_hooks_json_content(&raw, &relative_path);
        if !parsed.is_empty() {
            for resource in parsed {
                push_unique(
                    &mut out,
                    ApmOverlayPrimitive {
                        resource_type: "hook",
                        name: resource.name,
                        description: resource.description,
                        content: resource.content,
                        metadata: JsValue::Object(record_entries(&resource.metadata)),
                        source_relative: relative_path.clone(),
                    },
                );
            }
            continue;
        }
        // `relativePath.replace(/^.*\//, "").replace(/\.json$/i, "")`
        let base = relative_path.rsplit('/').next().unwrap_or(&relative_path);
        let mut name = strip_suffix_ci(base, ".json").unwrap_or(base).to_owned();
        if name.is_empty() {
            name = "hook".into();
        }
        push_unique(
            &mut out,
            ApmOverlayPrimitive {
                resource_type: "hook",
                name,
                description: String::new(),
                content: raw,
                metadata: JsValue::Object(Vec::new()),
                source_relative: relative_path,
            },
        );
    }
    Ok(out)
}

fn skill_metadata_value(m: &SkillMetadata) -> JsValue {
    let list = |v: &Vec<String>| JsValue::Array(v.iter().cloned().map(JsValue::String).collect());
    let mut entries = Vec::new();
    for (key, value) in [
        ("scripts", &m.scripts),
        ("references", &m.references),
        ("companions", &m.companions),
    ] {
        if let Some(v) = value {
            entries.push((key.to_owned(), list(v)));
        }
    }
    JsValue::Object(entries)
}

fn collect_from_prefix(
    project_root: &Path,
    prefix: &str,
    exclude: &[String],
    include_instructions_and_prompts: bool,
) -> R<(Vec<ApmOverlaySkill>, Vec<ApmOverlayPrimitive>)> {
    let skills = collect_skills(project_root, &source_dir(prefix, "skills"), exclude)?;
    let mut primitives: Vec<ApmOverlayPrimitive> = skills
        .iter()
        .map(|skill| ApmOverlayPrimitive {
            resource_type: "skill",
            name: skill.name.clone(),
            description: skill.description.clone(),
            content: skill.content.clone(),
            metadata: skill_metadata_value(&skill.metadata),
            source_relative: skill.skill_md_relative.clone(),
        })
        .collect();
    primitives.extend(collect_markdown_dir(
        "agent",
        project_root,
        &source_dir(prefix, "agents"),
        exclude,
    )?);
    primitives.extend(collect_markdown_dir(
        "command",
        project_root,
        &source_dir(prefix, "commands"),
        exclude,
    )?);
    primitives.extend(collect_hooks(
        project_root,
        &source_dir(prefix, "hooks"),
        exclude,
    )?);
    if include_instructions_and_prompts {
        primitives.extend(collect_instructions(
            project_root,
            &source_dir(prefix, "instructions"),
            exclude,
        )?);
        primitives.extend(collect_markdown_dir(
            "command",
            project_root,
            &source_dir(prefix, "prompts"),
            exclude,
        )?);
    }
    let mut unique = Vec::new();
    for primitive in primitives {
        push_unique(&mut unique, primitive);
    }
    Ok((skills, unique))
}

/// `collectSkillMdFiles(rootPath, skillsDirRelative)`.
pub fn collect_skill_md_files(
    root_path: &Path,
    skills_dir_relative: &str,
) -> R<Vec<ApmOverlaySkill>> {
    collect_skills(root_path, &skills_dir_relative.replace('\\', "/"), &[])
}

/// `inspectApmOverlay(rootPath, { exclude })`: `Ok(None)` is `undefined` (no `.apm/` and no
/// root-level primitive directory).
pub fn inspect_apm_overlay(root_path: &Path, exclude: &[String]) -> R<Option<ApmOverlayInfo>> {
    let apm_dir = root_path.join(".apm");
    let mut warnings = Vec::new();
    let mut skipped_kinds = Vec::new();
    let mut skipped_root_dirs = Vec::new();

    if exists(&apm_dir) {
        if is_symlink(&apm_dir) {
            return Err(OverlayError::symlink(".apm"));
        }
        let (skills, primitives) = collect_from_prefix(root_path, ".apm", exclude, true)?;
        for dir in APM_NATIVE_PRIMITIVE_DIRS {
            if exists(&root_path.join(dir)) {
                skipped_root_dirs.push(dir.to_owned());
                warnings.push(skipped_root_source_warning(dir));
            }
        }
        for dir in APM_WARN_ONLY_DIRS {
            if is_directory(&apm_dir.join(dir)) {
                skipped_kinds.push(format!(".apm/{dir}"));
                warnings.push(format!(
                    "Local .apm/{dir} primitives are present but not applied; MCP comes from apm.yml and chatmodes are not a HarnessTap resource type"
                ));
            }
        }
        if primitives.is_empty() && skipped_kinds.is_empty() {
            let has_apply_dir = APM_APPLY_PRIMITIVE_DIRS
                .iter()
                .any(|dir| is_directory(&apm_dir.join(dir)));
            let visible = read_dir_sorted(&apm_dir)
                .map_err(|e| OverlayError::io(&e))?
                .into_iter()
                .filter(|e| !e.starts_with('.'))
                .count();
            if !has_apply_dir && visible == 0 {
                warnings.push(
                    "Local .apm/ directory is present but contains no primitives to apply".into(),
                );
            } else {
                warnings.push(
                    "Local .apm/ directory is present but contains no applyable primitives".into(),
                );
            }
        }
        return Ok(Some(ApmOverlayInfo {
            present: true,
            from_apm: true,
            skills,
            primitives,
            skipped_kinds,
            skipped_root_dirs,
            warnings,
        }));
    }

    if !APM_NATIVE_PRIMITIVE_DIRS
        .iter()
        .any(|dir| exists(&root_path.join(dir)))
    {
        return Ok(None);
    }
    let (skills, primitives) = collect_from_prefix(root_path, "", exclude, false)?;
    Ok(Some(ApmOverlayInfo {
        present: false,
        from_apm: false,
        skills,
        primitives,
        skipped_kinds,
        skipped_root_dirs,
        warnings,
    }))
}
