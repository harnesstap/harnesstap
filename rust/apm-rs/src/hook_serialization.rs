//! `hook-serialization.ts`, the reading half: `parseHooksJsonContent` and what it needs.

use frontmatter_rs::JsValue;
use serde_json::Value;

/// `ResourceCreateInput` for a hook read from a hooks JSON file.
#[derive(Clone, Debug, PartialEq)]
pub struct HookResource {
    pub name: String,
    pub description: String,
    pub content: String,
    pub source: String,
    /// `HookMetadata`: `event`, `script`, `hook_entry`, then `commandWindows`, `timeout` and
    /// `matcher` when set.
    pub metadata: JsValue,
}

/// A value from `JSON.parse`: objects in `Object.keys` order, numbers as doubles.
pub fn js_value_from_json(value: &Value) -> JsValue {
    match value {
        Value::Null => JsValue::Null,
        Value::Bool(b) => JsValue::Bool(*b),
        Value::Number(n) => JsValue::Number(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => JsValue::String(s.clone()),
        Value::Array(items) => JsValue::Array(items.iter().map(js_value_from_json).collect()),
        Value::Object(map) => JsValue::Object(
            emit_rs::js::ordered_entries(map)
                .into_iter()
                .map(|(k, v)| (k.clone(), js_value_from_json(v)))
                .collect(),
        ),
    }
}

/// `commandReferencesPluginRoot(command)`.
pub fn command_references_plugin_root(command: Option<&str>) -> bool {
    let Some(command) = command.filter(|c| !c.is_empty()) else {
        return false;
    };
    if command.contains("CLAUDE_PLUGIN_ROOT") {
        return true;
    }
    // `/(?:^|[\s"'`=(])(?:\.\/)?hooks\//`
    let starts = |rest: &str| rest.starts_with("hooks/") || rest.starts_with("./hooks/");
    if starts(command) {
        return true;
    }
    command.char_indices().any(|(i, c)| {
        (emit_rs::js::is_space(c) || "\"'`=(".contains(c)) && starts(&command[i + c.len_utf8()..])
    })
}

fn is_object(v: &Value) -> bool {
    // `!item || typeof item !== "object"`: arrays count as objects here.
    matches!(v, Value::Object(_) | Value::Array(_))
}

fn str_prop<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.as_object()?.get(key)?.as_str()
}

/// `collectHookEntries`: `(entry, matcher)` pairs in reading order.
pub fn collect_hook_entries<'a>(
    entries: &'a [Value],
    matcher: Option<&'a str>,
    collected: &mut Vec<(&'a Value, Option<&'a str>)>,
) {
    for item in entries {
        if !is_object(item) {
            continue;
        }
        let item_matcher = str_prop(item, "matcher").or(matcher);
        if let Some(Value::Array(hooks)) = item.as_object().and_then(|o| o.get("hooks")) {
            collect_hook_entries(hooks, item_matcher, collected);
            continue;
        }
        if str_prop(item, "command").is_none() {
            continue;
        }
        collected.push((item, item_matcher));
    }
}

fn hook_resource_name(event: &str, matcher: Option<&str>, index: usize) -> String {
    match matcher.filter(|m| !m.is_empty()) {
        Some(m) => {
            let mut out = String::new();
            let mut in_run = false;
            for c in m.chars() {
                if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                    out.push(c);
                    in_run = false;
                } else if !in_run {
                    out.push('-');
                    in_run = true;
                }
            }
            format!("{event}-{out}")
        }
        None => format!("{event}-{}", index + 1),
    }
}

/// `parseHooksJsonContent(content, displayPath)`.
///
/// One known difference: `JSON.parse` accepts a lone surrogate escape and numbers outside the
/// double range (as `Infinity`), which serde_json rejects; such a file reads as no hooks here.
pub fn parse_hooks_json_content(content: &str, display_path: &str) -> Vec<HookResource> {
    let Ok(parsed) = serde_json::from_str::<Value>(content) else {
        return Vec::new();
    };
    let Some(Value::Object(hooks)) = parsed.as_object().and_then(|o| o.get("hooks")) else {
        return Vec::new();
    };
    let mut resources = Vec::new();
    for (event, entries) in emit_rs::js::ordered_entries(hooks) {
        let Value::Array(entries) = entries else {
            continue;
        };
        let mut collected = Vec::new();
        collect_hook_entries(entries, None, &mut collected);
        for (index, (entry, matcher)) in collected.into_iter().enumerate() {
            let command = str_prop(entry, "command").unwrap_or_default().to_owned();
            let mut metadata = vec![
                ("event".to_owned(), JsValue::String(event.clone())),
                ("script".to_owned(), JsValue::String(command.clone())),
                ("hook_entry".to_owned(), js_value_from_json(entry)),
            ];
            if let Some(w) = str_prop(entry, "commandWindows") {
                metadata.push(("commandWindows".into(), JsValue::String(w.to_owned())));
            }
            if let Some(Value::Number(t)) = entry.as_object().and_then(|o| o.get("timeout")) {
                metadata.push((
                    "timeout".into(),
                    JsValue::Number(t.as_f64().unwrap_or(f64::NAN)),
                ));
            }
            if let Some(m) = matcher.filter(|m| !m.is_empty()) {
                metadata.push(("matcher".into(), JsValue::String(m.to_owned())));
            }
            resources.push(HookResource {
                name: hook_resource_name(event, matcher, index),
                description: str_prop(entry, "statusMessage")
                    .unwrap_or_default()
                    .to_owned(),
                content: command,
                source: display_path.to_owned(),
                metadata: JsValue::Object(metadata),
            });
        }
    }
    resources
}

// ---- Writing half: buildHooksJson and the plugin-root filters ----

use serde_json::Map;

fn command_of(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str)
}

/// `hookRequiresPluginRoot(hook)` for a `HookMetadata` object.
pub fn hook_requires_plugin_root(hook: &Value) -> bool {
    hook.get("requires_plugin_root") == Some(&Value::Bool(true))
        || command_references_plugin_root(command_of(hook.get("script")))
        || command_references_plugin_root(command_of(
            hook.get("hook_entry").and_then(|e| e.get("command")),
        ))
}

/// `userHooksForHostConfig(hooks)`: `(hooks, skipped)`, the second holding those that need a
/// plugin root.
pub fn user_hooks_for_host_config(hooks: &[Value]) -> (Vec<&Value>, Vec<&Value>) {
    hooks.iter().partition(|h| !hook_requires_plugin_root(h))
}

/// `scanHooksFile(filePath, displayPath)`.
pub fn scan_hooks_file(file_path: &std::path::Path, display_path: &str) -> Vec<HookResource> {
    match std::fs::read(file_path) {
        Ok(bytes) => parse_hooks_json_content(&String::from_utf8_lossy(&bytes), display_path),
        Err(_) => Vec::new(),
    }
}

/// `{ ...value }`: own keys of an object, indexes of an array or string, nothing for the rest.
fn spread(value: &Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => emit_rs::js::ordered_entries(map)
            .into_iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .map(|(i, v)| (i.to_string(), v.clone()))
            .collect(),
        Value::String(s) => s
            .chars()
            .enumerate()
            .map(|(i, c)| (i.to_string(), Value::String(c.to_string())))
            .collect(),
        _ => Map::new(),
    }
}

/// `obj[key] = value` on a plain object: `__proto__` sets the prototype, not an own key.
fn assign(map: &mut Map<String, Value>, key: String, value: Value) {
    if key != "__proto__" {
        map.insert(key, value);
    }
}

fn truthy(value: Option<&Value>) -> bool {
    value.is_some_and(emit_rs::js::truthy)
}

fn is_hook_wrapper(entry: &Value) -> bool {
    matches!(entry.get("hooks"), Some(Value::Array(_)))
        || str_prop(entry, "matcher").is_some_and(|m| !m.is_empty())
}

fn wrapped_hooks(hook: &Value) -> Option<&Value> {
    let entry = hook.get("hook_entry").filter(|e| truthy(Some(e)))?;
    entry.get("hooks").filter(|h| h.is_array()).map(|_| entry)
}

fn build_flat_hook_entry(hook: &Value) -> Map<String, Value> {
    let script = hook.get("script");
    let mut entry = match hook.get("hook_entry") {
        Some(e) if truthy(Some(e)) && !is_hook_wrapper(e) => spread(e),
        _ => {
            let mut m = Map::new();
            if let Some(s) = script {
                m.insert("command".into(), s.clone());
            }
            m
        }
    };
    if !truthy(entry.get("command")) {
        match script {
            Some(s) => {
                entry.insert("command".into(), s.clone());
            }
            // `entry.command = undefined`: JSON drops the key.
            None => {
                entry.shift_remove("command");
            }
        }
    }
    if let Some(w) = hook.get("commandWindows").filter(|w| w.is_string()) {
        entry.insert("commandWindows".into(), w.clone());
    }
    if let Some(t) = hook.get("timeout").filter(|t| t.is_number()) {
        entry.insert("timeout".into(), t.clone());
    }
    entry
}

fn flatten_hook_commands(hook: &Value) -> Vec<Value> {
    match wrapped_hooks(hook)
        .and_then(|e| e.get("hooks"))
        .and_then(Value::as_array)
    {
        Some(items) => items.iter().filter(|i| i.is_object()).cloned().collect(),
        None => vec![Value::Object(build_flat_hook_entry(hook))],
    }
}

fn wrap_event_entries(hooks: &[&Value]) -> Vec<Value> {
    let mut result = Vec::new();
    let mut groups: Vec<(String, Vec<Value>)> = Vec::new();
    for hook in hooks {
        if let Some(entry) = wrapped_hooks(hook) {
            result.push(Value::Object(spread(entry)));
            continue;
        }
        let entry = Value::Object(build_flat_hook_entry(hook));
        match str_prop(hook, "matcher").filter(|m| !m.is_empty()) {
            Some(matcher) => match groups.iter_mut().find(|(m, _)| m == matcher) {
                Some((_, group)) => group.push(entry),
                None => groups.push((matcher.to_owned(), vec![entry])),
            },
            None => result.push(serde_json::json!({ "hooks": [entry] })),
        }
    }
    for (matcher, entries) in groups {
        result.push(serde_json::json!({ "matcher": matcher, "hooks": entries }));
    }
    result
}

/// `HooksJsonShape`: Claude-style events wrap each entry in `{ hooks: [...] }`; Cursor's
/// `hooks.json` is flat.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum HooksJsonShape {
    #[default]
    Wrapped,
    Flat,
}

/// `BuildHooksJsonOptions`.
#[derive(Clone, Debug, Default)]
pub struct BuildHooksJsonOptions {
    pub version: Option<Value>,
    pub shape: HooksJsonShape,
    /// Keep hooks whose commands reference a plugin root (a plugin package keeps them).
    pub include_plugin_root: bool,
}

/// `buildHooksJson(hookResources, options)`: `{ hooks, version? }` from `HookMetadata` objects.
pub fn build_hooks_json(hook_resources: &[Value], options: &BuildHooksJsonOptions) -> Value {
    let usable: Vec<&Value> = if options.include_plugin_root {
        hook_resources.iter().collect()
    } else {
        user_hooks_for_host_config(hook_resources).0
    };
    // A `Map` keyed by `hook.event`; the object key is its `String()`.
    let mut by_event: Vec<(String, Vec<&Value>)> = Vec::new();
    for hook in usable {
        let event = hook
            .get("event")
            .map_or_else(|| "undefined".to_owned(), emit_rs::js::to_string);
        match by_event.iter_mut().find(|(e, _)| *e == event) {
            Some((_, hooks)) => hooks.push(hook),
            None => by_event.push((event, vec![hook])),
        }
    }
    let mut serialized = Map::new();
    for (event, hooks) in by_event {
        let entries = match options.shape {
            HooksJsonShape::Flat => hooks
                .iter()
                .flat_map(|h| flatten_hook_commands(h))
                .collect(),
            HooksJsonShape::Wrapped => wrap_event_entries(&hooks),
        };
        assign(&mut serialized, event, Value::Array(entries));
    }
    let mut document = Map::new();
    document.insert("hooks".into(), Value::Object(serialized));
    if let Some(version) = &options.version {
        document.insert("version".into(), version.clone());
    }
    Value::Object(document)
}

fn command_from_unknown_entry(entry: &Value) -> Option<&str> {
    let Value::Object(record) = entry else {
        return None;
    };
    if let Some(Value::String(command)) = record.get("command") {
        return Some(command);
    }
    let Some(Value::Array(inner)) = record.get("hooks") else {
        return None;
    };
    inner
        .iter()
        .filter_map(command_from_unknown_entry)
        .find(|c| !c.is_empty())
}

/// `stripPluginRootCommandsFromHooksObject(hooks)`: drop user-config hook entries that only work
/// with `CLAUDE_PLUGIN_ROOT`.
pub fn strip_plugin_root_commands_from_hooks_object(
    hooks: &Map<String, Value>,
) -> Map<String, Value> {
    let mut next = Map::new();
    for (event, entries) in emit_rs::js::ordered_entries(hooks) {
        let Value::Array(entries) = entries else {
            assign(&mut next, event.clone(), entries.clone());
            continue;
        };
        let kept: Vec<Value> = entries
            .iter()
            .filter(|e| !command_references_plugin_root(command_from_unknown_entry(e)))
            .cloned()
            .collect();
        if !kept.is_empty() {
            assign(&mut next, event.clone(), Value::Array(kept));
        }
    }
    next
}
