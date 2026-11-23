//! The Rust port of `src/services/harness-scope.ts`.
//!
//! Scopes arrive as JSON values, so the port keeps the original's behavior on
//! malformed ones too: the same `TypeError`s, in the same order, and the same
//! pass-through of whatever `intersectHarnessScopes` or `resourceHarnessScope`
//! return unchanged. Sorting is `localeCompare` (`collate-rs`).

#![forbid(unsafe_code)]

use platforms_rs::{PlatformDefinition, PlatformPaths, get_all_platforms, get_platform};
use regex::Regex;
use serde_json::{Map, Value, json};
use std::sync::OnceLock;

type R<T> = Result<T, String>;

fn all_scope() -> Value {
    json!({ "kind": "all" })
}

fn subset(harnesses: Vec<Value>) -> Value {
    json!({ "kind": "subset", "harnesses": harnesses })
}

fn strings(ids: Vec<String>) -> Vec<Value> {
    ids.into_iter().map(Value::String).collect()
}

fn type_error(msg: impl std::fmt::Display) -> String {
    format!("TypeError: {msg}")
}

/// `obj.key` where `obj` may be `null` or `undefined` (`None`). Returns
/// `None` for an undefined property.
fn prop<'a>(obj: Option<&'a Value>, key: &str) -> R<Option<&'a Value>> {
    match obj {
        None => Err(type_error(format!(
            "Cannot read properties of undefined (reading '{key}')"
        ))),
        Some(Value::Null) => Err(type_error(format!(
            "Cannot read properties of null (reading '{key}')"
        ))),
        Some(Value::Object(o)) => Ok(o.get(key)),
        Some(_) => Ok(None),
    }
}

fn is_all(scope: Option<&Value>) -> R<bool> {
    Ok(prop(scope, "kind")?.and_then(Value::as_str) == Some("all"))
}

/// The code points of a string, as the spread operator and `new Set` see them.
fn code_points(s: &str) -> Vec<Value> {
    s.chars().map(|c| Value::String(c.to_string())).collect()
}

/// `[...value]` (spread): arrays and strings; anything else is not iterable.
fn spread(value: Option<&Value>, expr: &str) -> R<Vec<Value>> {
    match value {
        Some(Value::Array(items)) => Ok(items.clone()),
        Some(Value::String(s)) => Ok(code_points(s)),
        _ => Err(type_error(format!("{expr} is not iterable"))),
    }
}

/// `new Set(value)`: `null` and `undefined` give an empty set.
fn set_items(value: Option<&Value>) -> R<Vec<Value>> {
    match value {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => Ok(dedupe(items.clone())),
        Some(Value::String(s)) => Ok(dedupe(code_points(s))),
        Some(Value::Object(_)) => Err(type_error(
            "object is not iterable (cannot read property Symbol(Symbol.iterator))",
        )),
        Some(v) => Err(type_error(format!(
            "{} {v} is not iterable (cannot read property Symbol(Symbol.iterator))",
            if v.is_number() { "number" } else { "boolean" }
        ))),
    }
}

/// `SameValueZero` membership for JSON values (objects by identity: never equal).
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Object(_), _) | (Value::Array(_), _) => false,
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        _ => a == b,
    }
}

fn dedupe(items: Vec<Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::with_capacity(items.len());
    for item in items {
        if !out.iter().any(|x| same(x, &item)) {
            out.push(item);
        }
    }
    out
}

/// `String(value)` for the right-hand side of `localeCompare`.
fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => emit_rs::js::number_to_string(n),
        Value::Array(items) => items
            .iter()
            .map(|x| {
                if x.is_null() {
                    String::new()
                } else {
                    js_string(x)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// `.sort((a, b) => a.localeCompare(b))` over already unique values. V8 never
/// passes the first element as `a` below 64 items, so only a later non-string
/// throws.
fn sort_values(mut items: Vec<Value>) -> R<Vec<Value>> {
    if items.len() > 1 && items.iter().skip(1).any(|v| !v.is_string()) {
        return Err(type_error("a.localeCompare is not a function"));
    }
    items.sort_by(|a, b| collate_rs::locale_compare(&js_string(a), &js_string(b)));
    Ok(items)
}

fn unique_sorted_values(value: Option<&Value>) -> R<Vec<Value>> {
    sort_values(set_items(value)?)
}

fn unique_sorted_strings<S: AsRef<str>>(ids: &[S]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(ids.len());
    for id in ids {
        if !out.iter().any(|x| x == id.as_ref()) {
            out.push(id.as_ref().to_owned());
        }
    }
    collate_rs::sort_locale(&mut out);
    out
}

/// `xs.method(...)` on a value that must be an array.
fn array_for<'a>(value: Option<&'a Value>, expr: &str, method: &str) -> R<&'a [Value]> {
    match value {
        Some(Value::Array(items)) => Ok(items),
        None => Err(type_error(format!(
            "Cannot read properties of undefined (reading '{method}')"
        ))),
        Some(Value::Null) => Err(type_error(format!(
            "Cannot read properties of null (reading '{method}')"
        ))),
        Some(_) => Err(type_error(format!("{expr}.{method} is not a function"))),
    }
}

/// Port of `parseHarnessScope` (`src/services/harness-scope.ts:15`).
pub fn parse_harness_scope(raw: serde_json::Value) -> Result<serde_json::Value, String> {
    Ok(parse_scope(&raw))
}

fn parse_scope(raw: &Value) -> Value {
    match raw {
        Value::Array(items) => {
            let ids: Vec<String> = items
                .iter()
                .filter_map(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect();
            let harnesses = unique_sorted_strings(&ids);
            if harnesses.is_empty() {
                all_scope()
            } else {
                subset(strings(harnesses))
            }
        }
        Value::String(s) if !s.is_empty() && s != "all" && s != "[]" => {
            match serde_json::from_str::<Value>(s) {
                Ok(parsed) => parse_scope(&parsed),
                Err(_) => all_scope(),
            }
        }
        _ => all_scope(),
    }
}

/// Port of `serializeHarnessScope` (`src/services/harness-scope.ts:40`).
pub fn serialize_harness_scope(scope: serde_json::Value) -> Result<String, String> {
    if is_all(Some(&scope))? {
        return Ok("all".into());
    }
    let ids = unique_sorted_values(scope.get("harnesses"))?;
    Ok(emit_rs::json::stringify(&Value::Array(ids), ""))
}

/// Port of `harnessScopeWire` (`src/services/harness-scope.ts:47`).
pub fn harness_scope_wire(scope: serde_json::Value) -> Result<serde_json::Value, String> {
    if is_all(Some(&scope))? {
        return Ok(json!("all"));
    }
    Ok(Value::Array(spread(
        scope.get("harnesses"),
        "scope.harnesses",
    )?))
}

/// `resource.harness_scope ?? HARNESS_SCOPE_ALL`.
fn scope_of(resource: &Value) -> R<Value> {
    Ok(match prop(Some(resource), "harness_scope")? {
        None | Some(Value::Null) => all_scope(),
        Some(v) => v.clone(),
    })
}

/// Port of `resourceHarnessScope` (`src/services/harness-scope.ts:51`).
pub fn resource_harness_scope(resource: serde_json::Value) -> Result<serde_json::Value, String> {
    scope_of(&resource)
}

/// Port of `uniqueSorted` (`src/services/harness-scope.ts:55`).
pub fn unique_sorted(ids: Vec<String>) -> Result<Vec<String>, String> {
    Ok(unique_sorted_strings(&ids))
}

/// Port of `intersectHarnessScopes` (`src/services/harness-scope.ts:59`).
pub fn intersect_harness_scopes(
    left: serde_json::Value,
    right: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if is_all(Some(&left))? {
        return Ok(right);
    }
    if is_all(Some(&right))? {
        return Ok(left);
    }
    let right_set = set_items(right.get("harnesses"))?;
    let kept: Vec<Value> = array_for(left.get("harnesses"), "left.harnesses", "filter")?
        .iter()
        .filter(|id| right_set.iter().any(|r| same(r, id)))
        .cloned()
        .collect();
    if kept.is_empty() {
        return Ok(subset(Vec::new()));
    }
    Ok(subset(sort_values(dedupe(kept))?))
}

/// Port of `unionHarnessScopes` (`src/services/harness-scope.ts:72`).
pub fn union_harness_scopes(
    left: serde_json::Value,
    right: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if is_all(Some(&left))? || is_all(Some(&right))? {
        return Ok(all_scope());
    }
    let mut ids = spread(left.get("harnesses"), "left.harnesses")?;
    ids.extend(spread(right.get("harnesses"), "right.harnesses")?);
    Ok(subset(sort_values(dedupe(ids))?))
}

/// Port of `resourceAppliesToHarness` (`src/services/harness-scope.ts:85`).
pub fn resource_applies_to_harness(
    resource: serde_json::Value,
    harness_id: String,
) -> Result<bool, String> {
    let scope = scope_of(&resource)?;
    if is_all(Some(&scope))? {
        return Ok(true);
    }
    match scope.get("harnesses") {
        Some(Value::Array(items)) => Ok(items
            .iter()
            .any(|v| v.as_str() == Some(harness_id.as_str()))),
        Some(Value::String(s)) => Ok(s.contains(harness_id.as_str())),
        None => Err(type_error(
            "Cannot read properties of undefined (reading 'includes')",
        )),
        Some(Value::Null) => Err(type_error(
            "Cannot read properties of null (reading 'includes')",
        )),
        Some(_) => Err(type_error("scope.harnesses.includes is not a function")),
    }
}

/// Port of `normalizeScopeToRegistered` (`src/services/harness-scope.ts:93`).
pub fn normalize_scope_to_registered(
    scope: serde_json::Value,
    registered: Vec<String>,
) -> Result<serde_json::Value, String> {
    if is_all(Some(&scope))? {
        return Ok(all_scope());
    }
    let original = array_for(scope.get("harnesses"), "scope.harnesses", "filter")?;
    let allowed: Vec<&str> = original
        .iter()
        .filter_map(Value::as_str)
        .filter(|id| registered.iter().any(|r| r == id))
        .collect();
    let harnesses = unique_sorted_strings(&allowed);
    if harnesses.is_empty() {
        return Ok(subset(original.to_vec()));
    }
    if covers(&harnesses, &registered) {
        return Ok(all_scope());
    }
    Ok(subset(strings(harnesses)))
}

fn covers(selected: &[String], registered: &[String]) -> bool {
    !registered.is_empty() && registered.iter().all(|id| selected.contains(id))
}

/// Port of `coversRegistered` (`src/services/harness-scope.ts:111`).
pub fn covers_registered(selected: Vec<String>, registered: Vec<String>) -> Result<bool, String> {
    Ok(covers(&selected, &registered))
}

/// Port of `isOrphanedHarnessScope` (`src/services/harness-scope.ts:122`).
pub fn is_orphaned_harness_scope(
    scope: serde_json::Value,
    registered: Vec<String>,
) -> Result<bool, String> {
    if is_all(Some(&scope))? {
        return Ok(false);
    }
    let harnesses = scope.get("harnesses");
    if registered.is_empty() {
        return match harnesses {
            Some(Value::Array(items)) => Ok(!items.is_empty()),
            Some(Value::String(s)) => Ok(!s.is_empty()),
            None => Err(type_error(
                "Cannot read properties of undefined (reading 'length')",
            )),
            Some(Value::Null) => Err(type_error(
                "Cannot read properties of null (reading 'length')",
            )),
            Some(_) => Ok(false),
        };
    }
    Ok(array_for(harnesses, "scope.harnesses", "every")?
        .iter()
        .all(|id| {
            !id.as_str()
                .is_some_and(|id| registered.iter().any(|r| r == id))
        }))
}

/// Inherited `Object.prototype` members, which a plain-object lookup finds.
fn prototype_member(key: &str) -> Option<Value> {
    match key {
        "__proto__" => Some(json!({})),
        "constructor" => Some(json!({ "$function": "Object" })),
        "toString"
        | "toLocaleString"
        | "valueOf"
        | "hasOwnProperty"
        | "isPrototypeOf"
        | "propertyIsEnumerable"
        | "__defineGetter__"
        | "__defineSetter__"
        | "__lookupGetter__"
        | "__lookupSetter__" => Some(json!({ "$function": key })),
        _ => None,
    }
}

fn surface_for(resource_type: &str) -> Option<&'static str> {
    Some(match resource_type {
        "instruction" => "instructions",
        "skill" => "skills",
        "rule" => "rules",
        "mcp_server" => "mcp",
        "permission" => "permissions",
        "hook" => "hooks",
        "agent" => "agents",
        "command" => "commands",
        "env_var" | "model_config" => "settings",
        "plugin" | "plugin_pin" => "plugins",
        _ => return None,
    })
}

/// Port of `pathSurfaceForResourceType` (`src/services/harness-scope.ts:153`).
pub fn path_surface_for_resource_type(r#type: String) -> Result<Option<serde_json::Value>, String> {
    Ok(Some(
        surface_for(&r#type)
            .map(|s| json!(s))
            .or_else(|| prototype_member(&r#type))
            .unwrap_or_else(crate::js::undefined),
    ))
}

fn normalize_emit(raw: Option<&str>) -> Option<String> {
    let raw = raw.filter(|r| !r.is_empty())?;
    let normalized = raw.replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    (!normalized.is_empty()).then(|| normalized.to_owned())
}

/// Port of `normalizeEmitPath` (`src/services/harness-scope.ts:157`).
pub fn normalize_emit_path(raw: Option<String>) -> Result<Option<String>, String> {
    Ok(normalize_emit(raw.as_deref()))
}

fn home_marker() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // INFALLIBLE: a fixed pattern.
        #[expect(clippy::unwrap_used, reason = "fixed pattern")]
        Regex::new(r"(?:^|/)(\.(?:claude|cursor|codex|agents|gemini|config|copilot|cline|minimax|kiro|windsurf|goose|amazonq)(?:/.*)?)$").unwrap()
    })
}

fn source_path_candidates(source: &str) -> Vec<String> {
    let normalized = source.replace('\\', "/");
    let mut out = vec![normalized.clone()];
    let mut add = |c: String| {
        if !out.contains(&c) {
            out.push(c);
        }
    };
    if let Some(rest) = normalized.strip_prefix("~/") {
        add(rest.to_owned());
    }
    if let Some(m) = home_marker().captures(&normalized).and_then(|c| c.get(1)) {
        let marker = m.as_str();
        if !marker.is_empty() {
            add(marker.to_owned());
            add(format!("~/{marker}"));
        }
    }
    out
}

fn path_values(p: &PlatformPaths) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = [
        p.instructions,
        p.legacy_instructions,
        p.skills,
        p.rules,
        p.legacy_rules,
        p.mcp,
        p.permissions,
        p.hooks,
        p.agents,
        p.commands,
        p.settings,
        p.plugins,
    ]
    .into_iter()
    .flatten()
    .collect();
    if let Some(a) = &p.path_alternates {
        for list in [
            a.commands,
            a.agents,
            a.rules,
            a.instructions,
            a.skills,
            a.settings,
        ]
        .into_iter()
        .flatten()
        {
            out.extend(list.iter().copied());
        }
    }
    out
}

fn platform_prefixes(platform: &PlatformDefinition) -> Vec<String> {
    let mut out = Vec::new();
    for group in [&platform.global_paths, &platform.project_paths] {
        out.extend(
            path_values(group)
                .into_iter()
                .filter_map(|v| normalize_emit(Some(v))),
        );
    }
    out
}

fn origin_harnesses(source: &str) -> Vec<String> {
    if source.is_empty() {
        return Vec::new();
    }
    let candidates = source_path_candidates(source);
    let mut best: Option<usize> = None;
    let mut ids: Vec<String> = Vec::new();
    for platform in get_all_platforms() {
        for prefix in platform_prefixes(platform) {
            let bare = prefix.strip_prefix("~/").unwrap_or(&prefix);
            for candidate in &candidates {
                let haystack = candidate.strip_prefix("~/").unwrap_or(candidate);
                let hit = haystack == bare
                    || haystack.starts_with(&format!("{bare}/"))
                    || *candidate == prefix
                    || candidate.starts_with(&format!("{prefix}/"));
                if !hit {
                    continue;
                }
                let score = emit_rs::js::utf16_len(bare);
                if best.is_none_or(|b| score > b) {
                    best = Some(score);
                    ids.clear();
                    ids.push(platform.id.to_owned());
                } else if best == Some(score) && !ids.iter().any(|i| i == platform.id) {
                    ids.push(platform.id.to_owned());
                }
            }
        }
    }
    unique_sorted_strings(&ids)
}

/// Port of `originHarnessesFromSourcePath` (`src/services/harness-scope.ts:210`).
pub fn origin_harnesses_from_source_path(source: Option<String>) -> Result<Vec<String>, String> {
    Ok(origin_harnesses(source.as_deref().unwrap_or("")))
}

/// Port of `originHarnessFromSourcePath` (`src/services/harness-scope.ts:243`).
pub fn origin_harness_from_source_path(source: Option<String>) -> Result<Option<String>, String> {
    Ok(origin_harnesses(source.as_deref().unwrap_or(""))
        .into_iter()
        .next())
}

/// `originHarnessesFromSourcePath` on any value: falsy gives nothing, other
/// non-strings throw at `source.replace`.
fn origin_harnesses_of(value: Option<&Value>) -> R<Vec<String>> {
    match value {
        Some(Value::String(s)) => Ok(origin_harnesses(s)),
        None | Some(Value::Null) | Some(Value::Bool(false)) => Ok(Vec::new()),
        Some(Value::Number(n)) if n.as_f64() == Some(0.0) => Ok(Vec::new()),
        Some(_) => Err(type_error("source.replace is not a function")),
    }
}

/// Port of `diskCaptureHarnessScope` (`src/services/harness-scope.ts:247`).
pub fn disk_capture_harness_scope(
    resource: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut origins = origin_harnesses_of(prop(Some(&resource), "source")?)?;
    origins.extend(origin_harnesses_of(prop(Some(&resource), "origin_ref")?)?);
    let origins = unique_sorted_strings(&origins);
    if origins.is_empty() {
        return Ok(all_scope());
    }
    Ok(subset(strings(origins)))
}

fn surface_path(paths: &PlatformPaths, surface: &str) -> Option<&'static str> {
    match surface {
        "instructions" => paths.instructions,
        "skills" => paths.skills,
        "rules" => paths.rules,
        "mcp" => paths.mcp,
        "permissions" => paths.permissions,
        "hooks" => paths.hooks,
        "agents" => paths.agents,
        "commands" => paths.commands,
        "settings" => paths.settings,
        "plugins" => paths.plugins,
        _ => None,
    }
}

fn emit_path(platform_id: &str, resource_type: &str, target: &str) -> Option<String> {
    let platform = get_platform(platform_id)?;
    let surface = surface_for(resource_type)?;
    let paths = if target == "global" {
        &platform.global_paths
    } else {
        &platform.project_paths
    };
    if let Some(primary) = normalize_emit(surface_path(paths, surface)) {
        return Some(primary);
    }
    match surface {
        "permissions" | "hooks" | "mcp" => normalize_emit(paths.settings),
        "settings" => normalize_emit(paths.settings.or(paths.permissions)),
        _ => None,
    }
}

/// Port of `emitPathForResourceType` (`src/services/harness-scope.ts:260`).
pub fn emit_path_for_resource_type(
    platform_id: String,
    r#type: String,
    target: String,
) -> Result<Option<String>, String> {
    Ok(emit_path(&platform_id, &r#type, &target))
}

/// Port of `linkedHarnessGroups` (`src/services/harness-scope.ts:292`).
pub fn linked_harness_groups(
    registered: Vec<String>,
    r#type: String,
    target: String,
) -> Result<Vec<serde_json::Value>, String> {
    let mut buckets: Vec<(String, Vec<String>)> = Vec::new();
    let mut unpathed: Vec<String> = Vec::new();
    for id in registered {
        let Some(path) = emit_path(&id, &r#type, &target) else {
            unpathed.push(id);
            continue;
        };
        match buckets.iter_mut().find(|(p, _)| *p == path) {
            Some((_, ids)) => ids.push(id),
            None => buckets.push((path, vec![id])),
        }
    }
    buckets.sort_by(|(a, _), (b, _)| collate_rs::locale_compare(a, b));
    let mut groups: Vec<Value> = buckets
        .into_iter()
        .map(|(path, ids)| {
            let linked = ids.len() > 1;
            json!({ "key": path, "harnessIds": ids, "linked": linked, "emitPath": path })
        })
        .collect();
    groups.extend(
        unpathed
            .into_iter()
            .map(|id| json!({ "key": id, "harnessIds": [id], "linked": false })),
    );
    Ok(groups)
}

/// Port of `expandLinkedSelection` (`src/services/harness-scope.ts:327`).
pub fn expand_linked_selection(
    selected: Vec<String>,
    toggle_ids: Vec<String>,
    next_checked: bool,
) -> Result<Vec<String>, String> {
    let mut set: Vec<String> = Vec::new();
    for id in selected {
        if !set.contains(&id) {
            set.push(id);
        }
    }
    for id in toggle_ids {
        if next_checked {
            if !set.contains(&id) {
                set.push(id);
            }
        } else {
            set.retain(|x| *x != id);
        }
    }
    collate_rs::sort_locale(&mut set);
    Ok(set)
}

/// Port of `selectionFromGroups` (`src/services/harness-scope.ts:343`).
///
/// `selected` is a `Set` in the original, which JSON cannot carry: any
/// non-empty group then fails at `selected.has`, as it does in the original.
pub fn selection_from_groups(
    selected: serde_json::Value,
    group: serde_json::Value,
) -> Result<bool, String> {
    let ids = array_for(
        prop(Some(&group), "harnessIds")?,
        "group.harnessIds",
        "every",
    )?;
    if ids.is_empty() {
        return Ok(true);
    }
    prop(Some(&selected), "has")?;
    Err(type_error("selected.has is not a function"))
}

/// Port of `withHarnessScope` (`src/services/harness-scope.ts:350`).
pub fn with_harness_scope(
    resource: serde_json::Value,
    scope: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut out = Map::new();
    match resource {
        Value::Object(o) => out.extend(o),
        Value::Array(items) => {
            out.extend(
                items
                    .into_iter()
                    .enumerate()
                    .map(|(i, v)| (i.to_string(), v)),
            );
        }
        Value::String(s) => {
            let units: Vec<u16> = s.encode_utf16().collect();
            out.extend(units.iter().enumerate().map(|(i, u)| {
                (
                    i.to_string(),
                    Value::String(String::from_utf16_lossy(&[*u])),
                )
            }));
        }
        _ => {}
    }
    out.insert("harness_scope".into(), scope);
    Ok(Value::Object(out))
}
