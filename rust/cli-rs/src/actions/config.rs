//! `config show`, `config validate` and `config init` (`src/cli/commands/config.ts`,
//! `services/config-command.ts`, `services/config-init.ts`, `project-config-write.ts`, and
//! the parts of `ensure-default-profile.ts`, `ensure-default-environment.ts`,
//! `active-profile.ts` and `environment-session.ts` that `config init` reaches).

use std::path::Path;

use apm_rs::project_config::{
    ProfileSource, ProjectConfig, ProjectProfileEntry, ResolvedProjectConfig, find_project_config,
    resolve_profile_environment, validate_project_config,
};
use serde_json::{Map, Value, json};

use super::{Ctx, Format, Printed, opt_str, output_format, print_json};
use crate::commander::ActionCall;

const MISSING_PROJECT_CONFIG_MESSAGE: &str =
    "No project config found. Run `ht config init` to create `apm.yml`.";
const PROJECT_CONFIG_EXISTS_MESSAGE: &str =
    "Project config already exists. Pass --force to overwrite, or edit `apm.yml` directly.";
const GLOBAL_DEFAULT_PROFILE_NAME: &str = "global default";
const LEGACY_DEFAULT_PROFILE_NAME: &str = "default";
const PROFILE_PLUGIN_TAG: &str = "profile";

enum Found {
    Config(Box<ResolvedProjectConfig>),
    Missing,
    Error(String),
}

/// `findProjectConfig(resolve(opts.project ?? process.cwd()))`; `None` when its error text is
/// one the port does not reproduce (YAML and TOML parser messages, file system errors).
fn find(call: &ActionCall, ctx: &Ctx<'_>) -> Option<Found> {
    let start = ctx.resolve(opt_str(call, "project").unwrap_or("."))?;
    match find_project_config(Path::new(&start)) {
        Ok(Some(config)) => Some(Found::Config(Box::new(config))),
        Ok(None) => Some(Found::Missing),
        Err(e) => {
            let faithful = matches!(
                e.name.as_str(),
                "Error" | "PolicyError" | "BundleSymlinkError"
            ) && !e.message.starts_with("Invalid YAML in ")
                && !e
                    .message
                    .starts_with("Invalid project local overrides TOML: ")
                && !e.message.contains("(os error ");
            faithful.then_some(Found::Error(e.message))
        }
    }
}

fn path_str(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn profile_json(entry: &ProjectProfileEntry) -> Value {
    let mut out = Map::new();
    out.insert("name".into(), json!(entry.name));
    out.insert("source".into(), json!(entry.source.as_str()));
    if let Some(s) = &entry.selector {
        out.insert("selector".into(), json!(s));
    }
    if let Some(p) = &entry.plugin {
        out.insert("plugin".into(), json!(p));
    }
    if let Some(e) = &entry.environment {
        out.insert("environment".into(), json!(e));
    }
    Value::Object(out)
}

/// `summarizeConfigForJson`.
fn summary_json(resolved: &ResolvedProjectConfig) -> Value {
    let config = &resolved.config;
    let mut out = Map::new();
    let mut put = |k: &str, v: Value| {
        out.insert(k.to_owned(), v);
    };
    put("root_path", json!(path_str(&resolved.root_path)));
    put("config_path", json!(path_str(&resolved.config_path)));
    put("name", json!(config.apm_name));
    put("version", json!(config.apm_version));
    if let Some(p) = &config.default_profile {
        put("default_profile", json!(p));
    }
    if let Some(e) = &config.default_environment {
        put("default_environment", json!(e));
    }
    put("targets", json!(resolved.harness_targets));
    put("skipped_targets", json!(resolved.skipped_targets));
    put(
        "profiles",
        Value::Array(config.profiles.iter().map(profile_json).collect()),
    );
    put(
        "environments",
        Value::Array(
            config
                .environments
                .iter()
                .map(|env| {
                    let mut e = Map::new();
                    e.insert("name".into(), json!(env.name));
                    e.insert(
                        "values".into(),
                        Value::Object(
                            env.values
                                .iter()
                                .map(|(k, v)| (k.clone(), json!(v)))
                                .collect(),
                        ),
                    );
                    if let Some(refs) = &env.secret_refs {
                        e.insert(
                            "secret_refs".into(),
                            Value::Object(
                                refs.iter()
                                    .map(|(k, r)| {
                                        (
                                            k.clone(),
                                            json!({ "provider": r.provider, "ref": r.reference }),
                                        )
                                    })
                                    .collect(),
                            ),
                        );
                    }
                    Value::Object(e)
                })
                .collect(),
        ),
    );
    put(
        "plugins",
        Value::Array(
            config
                .plugins
                .iter()
                .map(|p| json!({ "name": p.get("name") }))
                .collect(),
        ),
    );
    put("environment_count", json!(config.environments.len()));
    put("plugin_count", json!(config.plugins.len()));
    put(
        "apm_dependencies",
        Value::Array(
            resolved
                .apm_dependencies
                .iter()
                .map(|d| {
                    let mut o = Map::new();
                    o.insert("name".into(), json!(d.name));
                    o.insert("source".into(), json!(d.source_kind));
                    o.insert("selector".into(), json!(d.apply_selector));
                    if let Some(r) = d.git_ref.as_deref().filter(|r| !r.is_empty()) {
                        o.insert("ref".into(), json!(r));
                    }
                    if let Some(p) = d.path.as_deref().filter(|p| !p.is_empty()) {
                        o.insert("path".into(), json!(p));
                    }
                    Value::Object(o)
                })
                .collect(),
        ),
    );
    put(
        "mcp_dependencies",
        Value::Array(
            resolved
                .mcp_dependencies
                .iter()
                .map(|d| {
                    let mut o = Map::new();
                    o.insert("name".into(), json!(d.name));
                    if let Some(id) = d.registry_id.as_deref().filter(|id| !id.is_empty()) {
                        o.insert("registry_id".into(), json!(id));
                    }
                    Value::Object(o)
                })
                .collect(),
        ),
    );
    put("warnings", json!(resolved.warnings));
    Value::Object(out)
}

fn json_error(value: Value) -> Printed {
    let mut printed = print_json(&value);
    printed.code = 1;
    printed
}

fn danger(message: &str) -> Printed {
    let mut printed = Printed::ui();
    printed.danger(message);
    printed.code = 1;
    printed
}

/// `config show` (`handleConfigShowCommand`).
pub(super) fn show(call: &ActionCall, ctx: &Ctx<'_>) -> Option<Printed> {
    let format = match output_format(call) {
        Ok(f) => f,
        Err(printed) => return Some(printed),
    };
    let resolved = match (find(call, ctx)?, format) {
        (Found::Config(c), _) => c,
        (Found::Missing, Format::Json) => {
            return Some(json_error(
                json!({ "error": MISSING_PROJECT_CONFIG_MESSAGE }),
            ));
        }
        (Found::Error(m), Format::Json) => return Some(json_error(json!({ "error": m }))),
        (Found::Missing, Format::Human) => return Some(danger(MISSING_PROJECT_CONFIG_MESSAGE)),
        (Found::Error(m), Format::Human) => return Some(danger(&m)),
    };
    if let Format::Json = format {
        return Some(print_json(&summary_json(&resolved)));
    }

    let config = &resolved.config;
    let mut out = Printed::ui();
    for warning in &resolved.warnings {
        out.warn(warning);
    }
    out.kv("Config", &path_str(&resolved.config_path));
    out.kv("Root", &path_str(&resolved.root_path));
    for (key, value) in [
        ("Name", &config.apm_name),
        ("Version", &config.apm_version),
        ("Default profile", &config.default_profile),
        ("Default environment", &config.default_environment),
    ] {
        if let Some(v) = value.as_deref().filter(|v| !v.is_empty()) {
            out.kv(key, v);
        }
    }
    out.kv("Environments", &config.environments.len().to_string());
    out.kv("Inline plugins", &config.plugins.len().to_string());

    if config.profiles.is_empty() {
        out.log("No profiles configured.");
        return Some(out);
    }
    let rows: Vec<[String; 5]> = config
        .profiles
        .iter()
        .map(|entry| {
            let target = match entry.source {
                ProfileSource::Catalog | ProfileSource::Local => entry.selector.clone(),
                ProfileSource::Inline => entry.plugin.clone(),
            };
            let default = config.default_profile.as_deref() == Some(entry.name.as_str());
            [
                entry.name.clone(),
                entry.source.as_str().to_owned(),
                target.unwrap_or_default(),
                resolve_profile_environment(config, entry)
                    .unwrap_or("")
                    .to_owned(),
                if default { "*" } else { "" }.to_owned(),
            ]
        })
        .collect();
    // On a TTY the table takes the terminal's width and box characters.
    if ctx.host.stdout_is_tty() {
        return None;
    }
    out.log(&render_table(&rows)?);
    out.log("");
    let n = rows.len();
    out.log(&format!("{n} profile{}", if n == 1 { "" } else { "s" }));
    Some(out)
}

/// `renderTable` (`src/ui/table.ts`) and cli-table3 for the profile table off a TTY: ASCII
/// borders, 100 columns, no word wrap. `None` for text other than printable ASCII, whose
/// width cli-table3 measures its own way.
fn render_table(rows: &[[String; 5]]) -> Option<String> {
    const HEADERS: [&str; 5] = ["PROFILE", "SOURCE", "SELECTOR/PLUGIN", "ENVIRONMENT", ""];
    const WIDTHS: [usize; 5] = [16, 10, 24, 16, 2];
    const AVAILABLE: usize = 100 - 6;
    if rows
        .iter()
        .flatten()
        .any(|c| !c.bytes().all(|b| (0x20..0x7f).contains(&b)))
    {
        return None;
    }
    // computeColumnWidths: no column fits its content or has a share, so the flexible split.
    let content: Vec<usize> = (0..5)
        .map(|i| {
            rows.iter()
                .map(|r| r[i].len())
                .chain([WIDTHS[i], HEADERS[i].len()])
                .max()
                .unwrap_or(0)
                + 2
        })
        .collect();
    let mut widths = content.clone();
    if content.iter().sum::<usize>() > AVAILABLE {
        let min: Vec<usize> = (0..5).map(|i| (WIDTHS[i] + 2).min(content[i])).collect();
        let extra: Vec<usize> = (0..5).map(|i| content[i] - min[i]).collect();
        let extra_total: usize = extra.iter().sum();
        let budget = AVAILABLE - min.iter().sum::<usize>();
        for i in 0..5 {
            widths[i] = min[i] + budget * extra[i] / extra_total;
        }
        widths[0] += AVAILABLE - widths.iter().sum::<usize>();
    }
    let rule = format!(
        "+{}+",
        widths
            .iter()
            .map(|w| "-".repeat(*w))
            .collect::<Vec<_>>()
            .join("+")
    );
    let line = |cells: &[&str]| {
        let mut out = String::new();
        for (cell, w) in cells.iter().zip(&widths) {
            let inner = w - 2;
            // truncateTableCell, then cli-table3's own truncate and pad (a no-op after it).
            let clipped = if cell.len() <= inner {
                (*cell).to_owned()
            } else if inner <= 3 {
                cell[..inner].to_owned()
            } else {
                format!("{}...", &cell[..inner - 3])
            };
            out.push_str(&format!("| {clipped:<inner$} "));
        }
        out.push('|');
        out
    };
    let mut lines = vec![rule.clone(), line(&HEADERS), rule.clone()];
    for row in rows {
        let cells: Vec<&str> = row.iter().map(String::as_str).collect();
        lines.push(line(&cells));
        lines.push(rule.clone());
    }
    Some(lines.join("\n"))
}

/// `config validate` (`handleConfigValidateCommand`).
pub(super) fn validate(call: &ActionCall, ctx: &Ctx<'_>) -> Option<Printed> {
    let format = match output_format(call) {
        Ok(f) => f,
        Err(printed) => return Some(printed),
    };
    let error = |message: &str| match format {
        Format::Json => json_error(json!({ "valid": false, "errors": [message] })),
        Format::Human => danger(message),
    };
    let resolved = match find(call, ctx)? {
        Found::Config(c) => c,
        Found::Missing => return Some(error(MISSING_PROJECT_CONFIG_MESSAGE)),
        Found::Error(m) => return Some(error(&m)),
    };
    let result = validate_project_config(&resolved.config);
    let code = u8::from(!result.valid);
    if let Format::Json = format {
        let mut printed = print_json(&json!({ "valid": result.valid, "errors": result.errors }));
        printed.code = code;
        return Some(printed);
    }
    let path = path_str(&resolved.config_path);
    let mut out = Printed::ui();
    if result.valid {
        out.success(&format!("Project config is valid ({path})."));
        return Some(out);
    }
    out.code = 1;
    out.danger(&format!("Project config validation failed ({path}):"));
    for error in &result.errors {
        out.log(&format!("  - {error}"));
    }
    Some(out)
}

/// `JSON.parse(readFileSync(path)).name` when it is a non-empty string.
fn read_name_file(path: &str) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str::<Value>(&text).ok()?.get("name")? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// `JSON.stringify({ name }, null, 2)` and a newline, after `mkdirSync(dir, { recursive })`.
fn write_name_file(dir: &str, file: &str, name: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(
        db_rs::paths::posix_join(&[dir, file]),
        emit_rs::json::to_file_string(&json!({ "name": name })),
    )
}

/// What `writeFileSync(configPath)` throws, as Node words it; `None` when it should succeed,
/// `Some(None)` for an error the port does not word.
fn write_error(root: &str, config_path: &str) -> Option<Option<String>> {
    let node = |code: &str, text: &str| Some(Some(format!("{code}: {text}, open '{config_path}'")));
    match std::fs::metadata(root) {
        Ok(m) if m.is_dir() => {
            if std::fs::metadata(config_path).is_ok_and(|m| m.is_dir()) {
                return node("EISDIR", "illegal operation on a directory");
            }
            None
        }
        Ok(_) => node("ENOTDIR", "not a directory"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let mut dir = Path::new(root);
            while let Some(parent) = dir.parent() {
                dir = parent;
                if let Ok(m) = std::fs::metadata(dir) {
                    return if m.is_dir() {
                        node("ENOENT", "no such file or directory")
                    } else {
                        node("ENOTDIR", "not a directory")
                    };
                }
            }
            Some(None)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotADirectory => {
            node("ENOTDIR", "not a directory")
        }
        Err(_) => Some(None),
    }
}

/// `config init` (`handleConfigInitCommand` and `executeConfigInit`). The outcome is worked
/// out from what is on disk before anything is written; the writes then happen in the
/// original's order, and only when that outcome is printed here.
pub(super) fn init(call: &ActionCall, ctx: &Ctx<'_>) -> Option<Printed> {
    let format = match output_format(call) {
        Ok(f) => f,
        Err(printed) => return Some(printed),
    };
    let opts = call.opts();
    let force = opts.get("force").is_some_and(emit_rs::js::truthy);
    let overrides: Vec<String> = match opts.get("profile") {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect(),
        _ => Vec::new(),
    };
    let default_override = opt_str(call, "default").filter(|d| !d.is_empty());
    let host = ctx.host;

    // shouldUseWizard, with a TTY stdout standing in for stdin and stdout both being TTYs.
    let missing = overrides.is_empty() || default_override.is_none();
    let ci = host
        .var("CI")
        .map(|v| emit_rs::js::trim(&v).to_lowercase())
        .is_some_and(|v| !v.is_empty() && v != "0" && v != "false" && v != "no");
    let wizard = (host.var("HARNESSTAP_FORCE_WIZARD").as_deref() == Some("1")
        || host.stdout_is_tty())
        && !ci
        && host.var("HARNESSTAP_NO_INTERACTIVE").as_deref() != Some("1")
        && !ctx.args.iter().any(|a| a == "--no-interactive")
        && opt_str(call, "format") != Some("json")
        && (opts.get("interactive").is_some_and(emit_rs::js::truthy) || missing);
    if wizard && missing {
        return None;
    }

    let themed = matches!(format, Format::Human);
    let report = |result: Result<(String, String, Vec<String>), String>| match (result, &format) {
        (Ok((path, default, names)), Format::Json) => print_json(&json!({
            "config_path": path,
            "default_profile": default,
            "profiles": names,
        })),
        (Ok((path, default, names)), Format::Human) => {
            let mut out = Printed::ui();
            out.success(&format!("Created project config at {path}."));
            out.kv("Default profile", &default);
            out.kv("Profiles", &names.join(", "));
            out.hint("Run `ht config show` to inspect or `ht use` to switch profiles.");
            out
        }
        (Err(m), Format::Json) => json_error(json!({ "error": m })),
        (Err(m), Format::Human) if m == PROJECT_CONFIG_EXISTS_MESSAGE => {
            let mut out = Printed::ui();
            out.warn(&m);
            out.code = 1;
            out
        }
        (Err(m), Format::Human) => danger(&m),
    };

    // getDb on a missing database creates it, and the first query finds no table.
    let db_path = db_rs::paths::db_path(ctx);
    if !Path::new(&db_path).exists() {
        if !ctx.answers(1, themed) {
            return None;
        }
        let db = db_rs::connection::open(ctx).ok()?;
        let error = plugin_model_rs::list_plugins(&models_ctx(&db, ctx)).err()?;
        return Some(report(Err(error)));
    }
    let db = db_rs::connection::open(ctx).ok()?;
    let mctx = models_ctx(&db, ctx);
    let plugins = match plugin_model_rs::list_plugins(&mctx) {
        Ok(p) => p,
        Err(e) => return ctx.answers(1, themed).then(|| report(Err(e))),
    };
    let is_profile = |p: &plugin_model_rs::Plugin| p.tags.iter().any(|t| t == PROFILE_PLUGIN_TAG);
    let profile_named = |n: &str| plugins.iter().any(|p| p.name == n && is_profile(p));
    // migrateLegacyDefaultProfile renames `default`: not ported.
    if !profile_named(GLOBAL_DEFAULT_PROFILE_NAME) && profile_named(LEGACY_DEFAULT_PROFILE_NAME) {
        return None;
    }
    let mut available: Vec<String> = plugins
        .iter()
        .filter(|p| is_profile(p))
        .map(|p| p.name.clone())
        .collect();
    let create_profile = available.is_empty();
    if create_profile {
        // createProfileCommand would tag the existing plugin of that name: not ported.
        if plugins
            .iter()
            .any(|p| p.name == GLOBAL_DEFAULT_PROFILE_NAME)
        {
            return None;
        }
        available.push(GLOBAL_DEFAULT_PROFILE_NAME.to_owned());
    }
    let home = db_rs::paths::harnesstap_dir(ctx);
    let profile_file = db_rs::paths::posix_join(&[&home, "active-profile.json"]);
    // getActiveProfileName: `empty` is no profile.
    let active_before = read_name_file(&profile_file).filter(|n| emit_rs::js::trim(n) != "empty");
    let set_active = create_profile && active_before.is_none();
    let active = if set_active {
        Some(GLOBAL_DEFAULT_PROFILE_NAME.to_owned())
    } else {
        active_before
    };
    let environments = models_rs::environment::list_environments(&mctx).ok()?;
    let create_environment = environments.is_empty();
    let environment_file = db_rs::paths::posix_join(&[&home, "active-environment.json"]);
    let set_active_environment = create_environment && read_name_file(&environment_file).is_none();

    let project = opt_str(call, "project").unwrap_or(".");
    let root = ctx.resolve(project)?;
    let config_path = db_rs::paths::posix_join(&[&root, apm_rs::manifest::APM_MANIFEST_FILENAME]);
    let result = (|| {
        // resolveProfilePluginNames
        let names: Vec<String> = if overrides.is_empty() {
            available.clone()
        } else {
            let mut unique: Vec<String> = Vec::new();
            for name in &overrides {
                if !available.contains(name) {
                    return Ok(Err(format!(
                        "Unknown profile plugin: {name}. Create it with `ht profile create {name}` first."
                    )));
                }
                if !unique.contains(name) {
                    unique.push(name.clone());
                }
            }
            unique
        };
        if names.is_empty() {
            return Ok(Err(
                "Select at least one profile plugin for project config.".to_owned()
            ));
        }
        // resolveDefaultProfileName
        let default = match default_override {
            Some(d) if !names.iter().any(|n| n == d) => {
                return Ok(Err(format!(
                    "Default profile \"{d}\" must be one of: {}",
                    names.join(", ")
                )));
            }
            Some(d) => d.to_owned(),
            None => match active.as_ref().filter(|a| names.contains(a)) {
                Some(a) => a.clone(),
                None => names[0].clone(),
            },
        };
        // writeStarterProjectConfig
        if std::fs::metadata(&config_path).is_ok() && !force {
            return Ok(Err(PROJECT_CONFIG_EXISTS_MESSAGE.to_owned()));
        }
        match write_error(&root, &config_path) {
            Some(Some(message)) => Ok(Err(message)),
            Some(None) => Err(()),
            None => Ok(Ok((config_path.clone(), default, names))),
        }
    })()
    .ok()?;

    if !ctx.answers(u8::from(result.is_err()), themed) {
        return None;
    }
    // A write the checks above did not foresee fails: the original runs and meets it again.
    if create_profile {
        let input = plugin_model_rs::CreatePluginInput {
            name: GLOBAL_DEFAULT_PROFILE_NAME.to_owned(),
            description: Some("Global default profile".to_owned()),
            version: Some("1.0.0".to_owned()),
            tags: Some(vec![PROFILE_PLUGIN_TAG.to_owned()]),
            ..Default::default()
        };
        plugin_model_rs::create_plugin(&mctx, &input).ok()?;
        if set_active {
            write_name_file(&home, "active-profile.json", GLOBAL_DEFAULT_PROFILE_NAME).ok()?;
        }
    }
    if create_environment {
        models_rs::environment::create_environment(&mctx, "default", Some("Default environment"))
            .ok()?;
        if set_active_environment {
            write_name_file(&home, "active-environment.json", "default").ok()?;
        }
    }
    if let Ok((_, default, names)) = &result {
        let config = ProjectConfig {
            default_profile: Some(default.clone()),
            profiles: names
                .iter()
                .map(|name| ProjectProfileEntry {
                    name: name.clone(),
                    source: ProfileSource::Local,
                    selector: Some(name.clone()),
                    plugin: None,
                    environment: None,
                })
                .collect(),
            apm_version: Some("1.0.0".to_owned()),
            ..ProjectConfig::default()
        };
        let text = apm_rs::manifest::format_apm_manifest(&config, &root);
        std::fs::write(&config_path, text).ok()?;
    }
    Some(report(result))
}

fn models_ctx<'a>(db: &'a db_rs::connection::Db, ctx: &'a Ctx<'_>) -> models_rs::Ctx<'a> {
    models_rs::Ctx {
        db,
        env: ctx,
        clock: &models_rs::SystemClock,
        ids: &models_rs::UlidIds,
    }
}
