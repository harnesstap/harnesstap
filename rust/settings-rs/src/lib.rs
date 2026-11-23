//! The port of `src/config/settings.ts` (the toolkit's `config.jsonc`) and
//! `src/services/plugin-resource-mode.ts`.
//!
//! `JSON.parse` is `serde_json`, which differs on a few inputs the app does
//! not write: lone surrogate escapes and numbers past `f64` are errors here
//! (so the defaults apply), where JS reads them.

use emit_rs::js::number_value;
use serde_json::{Map, Value, json};
use std::path::Path;

// ---------------------------------------------------------------------------
// plugin-resource-mode.ts

/// `PLUGIN_RESOURCE_MODES`.
pub const PLUGIN_RESOURCE_MODES: [&str; 3] = ["symlink", "copy", "clone"];

/// `DEFAULT_PLUGIN_RESOURCE_MODE`.
pub const DEFAULT_PLUGIN_RESOURCE_MODE: &str = "symlink";

/// `isPluginResourceMode`.
pub fn is_plugin_resource_mode(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|v| PLUGIN_RESOURCE_MODES.contains(&v))
}

/// `parsePluginResourceMode`. `None` is `undefined`.
pub fn parse_plugin_resource_mode(value: Option<&str>) -> Result<String, String> {
    match value {
        Some(v) if PLUGIN_RESOURCE_MODES.contains(&v) => Ok(v.to_owned()),
        _ => Err(format!(
            "Invalid plugin resource mode: {}. Use symlink, copy, or clone.",
            value.unwrap_or("undefined")
        )),
    }
}

// ---------------------------------------------------------------------------
// settings.ts

/// `UPDATE_MODES`.
pub const UPDATE_MODES: [&str; 3] = ["off", "notify", "install"];
/// `UPDATE_FREQUENCIES`.
pub const UPDATE_FREQUENCIES: [&str; 3] = ["hourly", "daily", "weekly"];

/// `UPDATE_FREQUENCY_MS`.
pub fn update_frequency_ms(frequency: &str) -> Option<f64> {
    match frequency {
        "hourly" => Some(3_600_000.0),
        "daily" => Some(86_400_000.0),
        "weekly" => Some(604_800_000.0),
        _ => None,
    }
}

/// `UpdateSettings`.
#[derive(Debug, Clone, PartialEq)]
pub struct UpdateSettings {
    pub mode: String,
    pub frequency: String,
    pub prompted: bool,
}

impl Default for UpdateSettings {
    /// `DEFAULT_UPDATE_SETTINGS`.
    fn default() -> Self {
        UpdateSettings {
            mode: "notify".into(),
            frequency: "daily".into(),
            prompted: false,
        }
    }
}

impl UpdateSettings {
    pub fn to_value(&self) -> Value {
        json!({ "mode": self.mode, "frequency": self.frequency, "prompted": self.prompted })
    }
}

/// `PluginMarketplaceEntry`.
#[derive(Debug, Clone, PartialEq)]
pub struct PluginMarketplaceEntry {
    pub name: String,
    pub url: String,
    pub platforms: Vec<String>,
    pub tracked_branches: Option<Vec<String>>,
}

impl PluginMarketplaceEntry {
    pub fn to_value(&self) -> Value {
        let mut m = Map::new();
        m.insert("name".into(), json!(self.name));
        m.insert("url".into(), json!(self.url));
        m.insert("platforms".into(), json!(self.platforms));
        if let Some(b) = &self.tracked_branches {
            m.insert("trackedBranches".into(), json!(b));
        }
        Value::Object(m)
    }
}

/// `HarnesstapSettings`.
#[derive(Debug, Clone, PartialEq)]
pub struct HarnesstapSettings {
    pub refresh_max_age_hours: f64,
    pub marketplace_refresh_max_age_minutes: f64,
    pub marketplaces: Vec<PluginMarketplaceEntry>,
    pub plugin_version_history_limit: f64,
    pub plugin_resources: String,
    pub native_agent_plugins: bool,
    pub updates: UpdateSettings,
}

/// `DEFAULT_MARKETPLACE_REFRESH_MAX_AGE_MINUTES`.
pub const DEFAULT_MARKETPLACE_REFRESH_MAX_AGE_MINUTES: f64 = 60.0;

impl Default for HarnesstapSettings {
    /// `DEFAULTS`.
    fn default() -> Self {
        HarnesstapSettings {
            refresh_max_age_hours: 24.0,
            marketplace_refresh_max_age_minutes: DEFAULT_MARKETPLACE_REFRESH_MAX_AGE_MINUTES,
            marketplaces: Vec::new(),
            plugin_version_history_limit: 10.0,
            plugin_resources: DEFAULT_PLUGIN_RESOURCE_MODE.into(),
            native_agent_plugins: false,
            updates: UpdateSettings::default(),
        }
    }
}

impl HarnesstapSettings {
    fn plugins_value(&self) -> Value {
        json!({
            "refreshMaxAgeHours": number_value(self.refresh_max_age_hours),
            "marketplaceRefreshMaxAgeMinutes": number_value(self.marketplace_refresh_max_age_minutes),
            "marketplaces": self.marketplaces.iter().map(PluginMarketplaceEntry::to_value).collect::<Vec<_>>(),
        })
    }
    fn harness_sync_value(&self) -> Value {
        json!({ "pluginResources": self.plugin_resources, "nativeAgentPlugins": self.native_agent_plugins })
    }
    /// The settings as the original's object, in its key order.
    pub fn to_value(&self) -> Value {
        json!({
            "plugins": self.plugins_value(),
            "pluginVersionHistoryLimit": number_value(self.plugin_version_history_limit),
            "harnessSync": self.harness_sync_value(),
            "updates": self.updates.to_value(),
        })
    }
}

/// `marketplaceRefreshMaxAgeMs`.
pub fn marketplace_refresh_max_age_ms(minutes: f64) -> f64 {
    minutes * 60.0 * 1000.0
}

/// `isUpdateMode`.
pub fn is_update_mode(value: &Value) -> bool {
    value.as_str().is_some_and(|v| UPDATE_MODES.contains(&v))
}

/// `isUpdateFrequency`.
pub fn is_update_frequency(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|v| UPDATE_FREQUENCIES.contains(&v))
}

/// `parseUpdateSettings`.
pub fn parse_update_settings(value: Option<&Value>) -> UpdateSettings {
    let empty = Map::new();
    let raw = match value {
        Some(Value::Object(o)) => o,
        _ => &empty,
    };
    let defaults = UpdateSettings::default();
    UpdateSettings {
        mode: raw
            .get("mode")
            .filter(|v| is_update_mode(v))
            .and_then(Value::as_str)
            .map_or(defaults.mode, str::to_owned),
        frequency: raw
            .get("frequency")
            .filter(|v| is_update_frequency(v))
            .and_then(Value::as_str)
            .map_or(defaults.frequency, str::to_owned),
        prompted: raw.get("prompted") == Some(&Value::Bool(true)),
    }
}

/// `parseTrackedBranches`.
pub fn parse_tracked_branches(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    let mut branches: Vec<String> = Vec::new();
    for item in items {
        let Some(s) = item.as_str() else { continue };
        let trimmed = emit_rs::js::trim(s);
        if trimmed.is_empty() || branches.iter().any(|b| b == trimmed) {
            continue;
        }
        branches.push(trimmed.to_owned());
    }
    branches
}

const VALID_PLATFORMS: [&str; 4] = ["claude-code", "cursor", "goose", "copilot-cli"];

/// `parseMarketplaces`.
pub fn parse_marketplaces(value: Option<&Value>) -> Vec<PluginMarketplaceEntry> {
    let Some(Value::Array(rows)) = value else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for row in rows {
        // `typeof row === "object"` lets arrays through; they have no fields.
        let record = match row {
            Value::Object(o) => o.clone(),
            Value::Array(_) => Map::new(),
            _ => continue,
        };
        let Some(name) = record.get("name").and_then(Value::as_str) else {
            continue;
        };
        let name = emit_rs::js::trim(name);
        if name.is_empty() {
            continue;
        }
        let Some(url) = record.get("url").and_then(Value::as_str) else {
            continue;
        };
        let url = emit_rs::js::trim(url);
        if url.is_empty() {
            continue;
        }
        let Some(Value::Array(platforms)) = record.get("platforms") else {
            continue;
        };
        let platforms: Vec<String> = platforms
            .iter()
            .filter_map(Value::as_str)
            .filter(|p| VALID_PLATFORMS.contains(p))
            .map(str::to_owned)
            .collect();
        if platforms.is_empty() {
            continue;
        }
        let tracked = parse_tracked_branches(record.get("trackedBranches"));
        out.push(PluginMarketplaceEntry {
            name: name.to_owned(),
            url: url.to_owned(),
            platforms,
            tracked_branches: (!tracked.is_empty()).then_some(tracked),
        });
    }
    out
}

/// `settingsPath`.
pub fn settings_path(harnesstap_dir: &str) -> String {
    let jsonc = Path::new(harnesstap_dir).join("config.jsonc");
    if jsonc.exists() {
        jsonc.to_string_lossy().into_owned()
    } else {
        Path::new(harnesstap_dir)
            .join("config.json")
            .to_string_lossy()
            .into_owned()
    }
}

/// JS `/\s/` on one character.
fn is_js_space(c: char) -> bool {
    emit_rs::js::is_space(c)
}

/// `parseJsonc`: drops comments and trailing commas, then `JSON.parse`.
pub fn parse_jsonc(content: &str) -> Result<Value, String> {
    let chars: Vec<char> = content.chars().collect();
    let at = |i: usize| chars.get(i).copied();
    let mut normalized = String::with_capacity(content.len());
    let (mut in_string, mut quote, mut escaping) = (false, '"', false);
    let (mut in_line, mut in_block) = (false, false);
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        let next = at(index + 1);
        if in_line {
            if c == '\n' {
                in_line = false;
                normalized.push(c);
            }
        } else if in_block {
            if c == '*' && next == Some('/') {
                in_block = false;
                index += 1;
            }
        } else if in_string {
            normalized.push(c);
            if escaping {
                escaping = false;
            } else if c == '\\' {
                escaping = true;
            } else if c == quote {
                in_string = false;
            }
        } else if c == '"' || c == '\'' {
            in_string = true;
            quote = c;
            normalized.push(c);
        } else if c == '/' && next == Some('/') {
            in_line = true;
            index += 1;
        } else if c == '/' && next == Some('*') {
            in_block = true;
            index += 1;
        } else if c == ',' {
            let mut look = index + 1;
            while look < chars.len() {
                let lc = chars[look];
                let ln = at(look + 1);
                if is_js_space(lc) {
                    look += 1;
                    continue;
                }
                if lc == '/' && ln == Some('/') {
                    look += 2;
                    while look < chars.len() && chars[look] != '\n' {
                        look += 1;
                    }
                    continue;
                }
                if lc == '/' && ln == Some('*') {
                    look += 2;
                    while look < chars.len() && !(chars[look] == '*' && at(look + 1) == Some('/')) {
                        look += 1;
                    }
                    look += 2;
                    continue;
                }
                if lc == '}' || lc == ']' {
                    break;
                }
                normalized.push(c);
                break;
            }
            if look >= chars.len() {
                normalized.push(c);
            }
        } else {
            normalized.push(c);
        }
        index += 1;
    }
    serde_json::from_str(&normalized).map_err(|e| e.to_string())
}

fn read_text(path: &str) -> Option<String> {
    std::fs::read(path)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).into_owned())
}

fn positive(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|n| *n > 0.0)
}

/// `loadSettings`.
pub fn load_settings(harnesstap_dir: &str) -> HarnesstapSettings {
    let path = settings_path(harnesstap_dir);
    if !Path::new(&path).exists() {
        return HarnesstapSettings::default();
    }
    let Some(raw) = read_text(&path).and_then(|t| parse_jsonc(&t).ok()) else {
        return HarnesstapSettings::default();
    };
    // `raw.plugins` on null throws, and the catch returns the defaults.
    if raw.is_null() {
        return HarnesstapSettings::default();
    }
    let defaults = HarnesstapSettings::default();
    let plugins = raw.get("plugins");
    // `raw.plugins?.x` and `raw.harnessSync?.x` read null as undefined.
    let field = |key: &str| plugins.and_then(|p| p.get(key));
    let harness_sync = raw.get("harnessSync");
    let limit = raw
        .get("pluginVersionHistoryLimit")
        .and_then(Value::as_f64)
        .filter(|n| n.fract() == 0.0 && *n >= 1.0);
    let plugin_resources = harness_sync.and_then(|h| h.get("pluginResources"));
    HarnesstapSettings {
        refresh_max_age_hours: positive(field("refreshMaxAgeHours"))
            .unwrap_or(defaults.refresh_max_age_hours),
        marketplace_refresh_max_age_minutes: positive(field("marketplaceRefreshMaxAgeMinutes"))
            .unwrap_or(defaults.marketplace_refresh_max_age_minutes),
        marketplaces: parse_marketplaces(field("marketplaces")),
        plugin_version_history_limit: limit.unwrap_or(defaults.plugin_version_history_limit),
        plugin_resources: plugin_resources
            .filter(|v| is_plugin_resource_mode(v))
            .and_then(Value::as_str)
            .map_or(defaults.plugin_resources, str::to_owned),
        native_agent_plugins: harness_sync.and_then(|h| h.get("nativeAgentPlugins"))
            == Some(&Value::Bool(true)),
        updates: parse_update_settings(raw.get("updates")),
    }
}

/// `readToolkitConfigRecord`; `path` defaults to [`settings_path`].
pub fn read_toolkit_config_record(harnesstap_dir: &str, path: Option<&str>) -> Map<String, Value> {
    let path = path.map_or_else(|| settings_path(harnesstap_dir), str::to_owned);
    match read_text(&path).map(|t| parse_jsonc(&t)) {
        Some(Ok(Value::Object(o))) => o,
        _ => Map::new(),
    }
}

/// `writeToolkitConfigRecord`.
pub fn write_toolkit_config_record(
    harnesstap_dir: &str,
    record: &Map<String, Value>,
    path: Option<&str>,
) -> Result<(), String> {
    let path = path.map_or_else(|| settings_path(harnesstap_dir), str::to_owned);
    std::fs::create_dir_all(harnesstap_dir).map_err(|e| e.to_string())?;
    let text = emit_rs::json::stringify(&Value::Object(record.clone()), "  ");
    std::fs::write(&path, format!("{text}\n")).map_err(|e| e.to_string())
}

/// `saveSettings`.
pub fn save_settings(harnesstap_dir: &str, settings: &HarnesstapSettings) -> Result<(), String> {
    let path = settings_path(harnesstap_dir);
    let mut record = read_toolkit_config_record(harnesstap_dir, Some(&path));
    record.insert("plugins".into(), settings.plugins_value());
    record.insert(
        "pluginVersionHistoryLimit".into(),
        number_value(settings.plugin_version_history_limit),
    );
    record.insert("harnessSync".into(), settings.harness_sync_value());
    record.insert("updates".into(), settings.updates.to_value());
    write_toolkit_config_record(harnesstap_dir, &record, Some(&path))
}

/// `loadUpdateSettings`.
pub fn load_update_settings(harnesstap_dir: &str) -> UpdateSettings {
    load_settings(harnesstap_dir).updates
}

/// `saveUpdateSettings`: only the `updates` keys change. `patch` holds the
/// keys of `Partial<UpdateSettings>` that are set.
pub fn save_update_settings(
    harnesstap_dir: &str,
    patch: &Map<String, Value>,
) -> Result<UpdateSettings, String> {
    let path = settings_path(harnesstap_dir);
    let mut record = read_toolkit_config_record(harnesstap_dir, Some(&path));
    let Value::Object(mut merged) = parse_update_settings(record.get("updates")).to_value() else {
        unreachable!("to_value builds an object")
    };
    for (k, v) in patch {
        merged.insert(k.clone(), v.clone());
    }
    let next = parse_update_settings(Some(&Value::Object(merged)));
    record.insert("updates".into(), next.to_value());
    write_toolkit_config_record(harnesstap_dir, &record, Some(&path))?;
    Ok(next)
}
