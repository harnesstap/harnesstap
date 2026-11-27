//! Shared by the replay tests: the tagged value encoding the recorders use, and rebuilding
//! a recorded project tree on disk.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

use apm_rs::overlay::ApmOverlayInfo;
use apm_rs::skill_auxiliary::SkillMetadata;
use frontmatter_rs::JsValue;
use serde_json::{Value, json};

pub fn enc(v: &JsValue) -> Value {
    match v {
        JsValue::Undefined => json!({ "$undef": true }),
        JsValue::Null => Value::Null,
        JsValue::Bool(b) => Value::Bool(*b),
        JsValue::Number(n) if *n == 0.0 && n.is_sign_negative() => json!({ "$num": "-0" }),
        JsValue::Number(n) => json!({ "$num": node_semver_rs::js_number(*n) }),
        JsValue::String(s) => Value::String(s.clone()),
        JsValue::Array(items) => Value::Array(items.iter().map(enc).collect()),
        JsValue::Object(entries) => {
            json!({ "$obj": entries.iter().map(|(k, v)| json!([k, enc(v)])).collect::<Vec<_>>() })
        }
        JsValue::Date(ms) => json!({ "$date": node_semver_rs::js_number(*ms) }),
        JsValue::Buffer(bytes) => json!({ "$buf": bytes }),
    }
}

pub fn enc_skill_metadata(m: &SkillMetadata) -> Value {
    let mut entries = Vec::new();
    for (k, v) in [
        ("scripts", &m.scripts),
        ("references", &m.references),
        ("companions", &m.companions),
    ] {
        if let Some(list) = v {
            entries.push(json!([k, list]));
        }
    }
    json!({ "$obj": entries })
}

pub fn enc_overlay(o: &Option<ApmOverlayInfo>) -> Value {
    let Some(o) = o else { return Value::Null };
    json!({
        "present": o.present,
        "fromApm": o.from_apm,
        "skills": o.skills.iter().map(|s| json!({
            "name": s.name, "description": s.description, "content": s.content,
            "skillDirRelative": s.skill_dir_relative, "skillMdRelative": s.skill_md_relative,
            "metadata": enc_skill_metadata(&s.metadata),
        })).collect::<Vec<_>>(),
        "primitives": o.primitives.iter().map(|p| json!({
            "type": p.resource_type, "name": p.name, "description": p.description, "content": p.content,
            "metadata": enc(&p.metadata), "sourceRelative": p.source_relative,
        })).collect::<Vec<_>>(),
        "skippedKinds": o.skipped_kinds,
        "skippedRootDirs": o.skipped_root_dirs,
        "warnings": o.warnings,
    })
}

pub fn materialize(root: &Path, entries: &[Value]) {
    for e in entries {
        let p = root.join(e["path"].as_str().expect("path"));
        if let Some(parent) = p.parent() {
            let _ = fs::create_dir_all(parent);
        }
        match e["kind"].as_str().expect("kind") {
            "dir" => {
                let _ = fs::create_dir_all(&p);
            }
            "fifo" => {
                let status = std::process::Command::new("mkfifo")
                    .arg(&p)
                    .status()
                    .expect("mkfifo");
                assert!(status.success());
            }
            "symlink" => {
                #[cfg(unix)]
                let _ = std::os::unix::fs::symlink(e["target"].as_str().expect("target"), &p);
            }
            _ => {
                if fs::write(&p, e["content"].as_str().unwrap_or_default()).is_ok() {
                    #[cfg(unix)]
                    if let Some(mode) = e["mode"].as_u64() {
                        use std::os::unix::fs::PermissionsExt;
                        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(mode as u32));
                    }
                }
            }
        }
    }
}

pub fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("apm-{name}-replay-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch");
    dir
}
