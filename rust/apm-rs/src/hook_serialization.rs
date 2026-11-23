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
