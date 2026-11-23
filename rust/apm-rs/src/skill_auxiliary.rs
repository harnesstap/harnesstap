//! `skill-auxiliary.ts`, the listing half: the companion files beside a `SKILL.md` and the
//! `scripts` / `references` metadata built from them.

use std::fs;
use std::path::Path;

/// `SkillCompanionEntry`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillCompanionEntry {
    pub relative_path: String,
    pub mode: u32,
}

/// `SkillMetadata`: each list is left out when empty.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SkillMetadata {
    pub scripts: Option<Vec<String>>,
    pub references: Option<Vec<String>>,
    pub companions: Option<Vec<String>>,
}

const SKILL_ENTRY_FILE: &str = "SKILL.md";

fn is_ignored_dir_name(name: &str) -> bool {
    name.starts_with('.') || name == ".git" || name == "node_modules"
}

/// `readdirSync(dir)`: names in byte order (libuv sorts with `strcmp`).
pub(crate) fn read_dir_sorted(dir: &Path) -> std::io::Result<Vec<String>> {
    let mut names: Vec<String> = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
    Ok(names)
}

#[cfg(unix)]
fn file_mode(meta: &fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o777
}

#[cfg(not(unix))]
fn file_mode(meta: &fs::Metadata) -> u32 {
    if meta.permissions().readonly() {
        0o444
    } else {
        0o666
    }
}

fn walk(prefix: &str, current: &Path, out: &mut Vec<SkillCompanionEntry>) {
    let Ok(names) = read_dir_sorted(current) else {
        return;
    };
    for name in names {
        if name.starts_with('.') {
            continue;
        }
        let full = current.join(&name);
        let Ok(meta) = fs::metadata(&full) else {
            continue;
        };
        let relative_path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if meta.is_dir() {
            if is_ignored_dir_name(&name) {
                continue;
            }
            walk(&relative_path, &full, out);
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        if relative_path.is_empty() || relative_path == SKILL_ENTRY_FILE {
            continue;
        }
        if relative_path.split('/').any(|s| s.starts_with('.')) {
            continue;
        }
        out.push(SkillCompanionEntry {
            relative_path,
            mode: file_mode(&meta),
        });
    }
}

/// `listSkillCompanionTree(skillDir)`.
pub fn list_skill_companion_tree(skill_dir: &Path) -> Vec<SkillCompanionEntry> {
    if !fs::metadata(skill_dir).is_ok_and(|m| m.is_dir()) {
        return Vec::new();
    }
    let mut entries = Vec::new();
    walk("", skill_dir, &mut entries);
    entries.sort_by(|a, b| collate_rs::locale_compare(&a.relative_path, &b.relative_path));
    entries
}

/// `Array.prototype.sort()` with no comparator: UTF-16 code unit order.
fn js_default_sort(names: &mut [String]) {
    names.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
}

fn top_level_names_under(companions: &[SkillCompanionEntry], dir_name: &str) -> Vec<String> {
    let prefix = format!("{dir_name}/");
    let mut names: Vec<String> = companions
        .iter()
        .filter_map(|e| e.relative_path.strip_prefix(&prefix))
        .filter(|rest| !rest.is_empty() && !rest.contains('/'))
        .map(str::to_owned)
        .collect();
    js_default_sort(&mut names);
    names
}

/// `listSkillAuxiliaryFiles(skillDir)`: `(scripts, references, companions)`.
pub fn list_skill_auxiliary_files(skill_dir: &Path) -> (Vec<String>, Vec<String>, Vec<String>) {
    let companions = list_skill_companion_tree(skill_dir);
    let scripts = top_level_names_under(&companions, "scripts");
    let mut references: Vec<String> = Vec::new();
    for name in top_level_names_under(&companions, "reference")
        .into_iter()
        .chain(top_level_names_under(&companions, "references"))
    {
        if !references.contains(&name) {
            references.push(name);
        }
    }
    js_default_sort(&mut references);
    let companions = companions.into_iter().map(|e| e.relative_path).collect();
    (scripts, references, companions)
}

/// `skillMetadataFromDir(skillDir)`.
pub fn skill_metadata_from_dir(skill_dir: &Path) -> SkillMetadata {
    let (scripts, references, companions) = list_skill_auxiliary_files(skill_dir);
    let some = |v: Vec<String>| (!v.is_empty()).then_some(v);
    SkillMetadata {
        scripts: some(scripts),
        references: some(references),
        companions: some(companions),
    }
}
