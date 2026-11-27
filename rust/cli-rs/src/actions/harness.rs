//! `harness list`, `set`, `status`, `project set` and `project status`
//! (`src/cli/commands/harness.ts`). `harness sync` stays in the original. Prompts, a
//! TTY table and git-origin projects hand back to the original too.

use db_rs::connection::Db;
use db_rs::paths::{harnesstap_dir, posix_resolve};
use harness_rs::project_identity::{
    Identity, ensure_project_for_root, find_project_for_root, resolve_project_identity,
};
use harness_rs::{SelectionInput, parse_harness_list, resolve_harness_selection};
use models_rs::harness::{
    ProjectHarnessInput, get_harness_preference, get_project_harness_config,
    set_harness_preference, set_project_harness_config,
};
use models_rs::{Ctx, SystemClock, UlidIds};
use serde_json::{Map, Value, json};

use super::{Format, Printed, Shown, output_format, print_json, thrown};
use crate::Host;
use crate::commander::ActionCall;

/// `DEDICATED_SERIALIZER_PLATFORM_IDS` (`src/services/platform-serializers.ts`).
const NATIVE_HARNESS_IDS: [&str; 12] = [
    "claude-code",
    "cursor",
    "codex",
    "goose",
    "opencode",
    "github-copilot",
    "copilot-cli",
    "gemini-cli",
    "grok-build",
    "deepseek-harness",
    "muse-code",
    "minimax-code",
];

fn themed(stdout: String) -> Printed {
    Printed {
        stdout,
        stderr: String::new(),
        code: 0,
        themed: true,
    }
}

/// `ui.success`.
fn success(message: &str) -> Printed {
    themed(format!("✓ {message}\n"))
}

/// `ui.panel` with `renderKv` rows (key padded to 20).
fn panel(title: &str, rows: &[(&str, &str)]) -> Printed {
    let mut out = format!("{title}\n");
    for (key, value) in rows {
        out.push_str(&format!("  {key:<20}  {value}\n"));
    }
    themed(out)
}

fn opt<'a>(opts: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    opts.get(key).and_then(Value::as_str)
}

/// `getDb` + `initializeSchema`. `None` when either fails: the original's message is
/// the driver's own.
fn open(host: &dyn Host) -> Option<Db> {
    let env = |name: &str| host.var(name);
    let db = db_rs::connection::open(&env).ok()?;
    db_rs::schema::initialize_schema(&db.conn, Default::default()).ok()?;
    Some(db)
}

fn ctx<'a>(db: &'a Db, env: &'a dyn db_rs::paths::Env) -> Ctx<'a> {
    Ctx {
        db,
        env,
        clock: &SystemClock,
        ids: &UlidIds,
    }
}

/// `harness list`. A human table on a TTY is sized to the terminal: the original prints it.
pub(super) fn list(call: &ActionCall, host: &dyn Host) -> Option<Printed> {
    let format = match output_format(call) {
        Ok(format) => format,
        Err(printed) => return Some(printed),
    };
    let supported = call
        .opts()
        .get("supported")
        .is_some_and(|v| v == &json!(true));
    let platforms: Vec<_> = platforms_rs::get_all_platforms()
        .iter()
        .filter(|p| !supported || NATIVE_HARNESS_IDS.contains(&p.id))
        .collect();
    if let Format::Json = format {
        let items: Vec<Value> = platforms
            .iter()
            .map(|p| {
                let mut supports = p.supports.to_vec();
                supports.sort_unstable();
                json!({ "id": p.id, "name": p.name, "supports": supports })
            })
            .collect();
        return Some(print_json(&Value::Array(items)));
    }
    if host.stdout_is_tty() {
        return None;
    }
    let rows: Vec<[String; 3]> = platforms
        .iter()
        .map(|p| [p.id.to_owned(), p.name.to_owned(), p.supports.join(", ")])
        .collect();
    Some(themed(render_table(
        [("ID", 20), ("NAME", 20), ("SUPPORTS", 40)],
        &rows,
        &format!("{} harnesses", platforms.len()),
        "No harnesses found.",
    )))
}

/// `renderTable` off a TTY (100 columns, ASCII borders, no wrap) for plain columns, then
/// `console.log`. ponytail: widths count chars, which is JS `length` only for BMP text;
/// the registry is ASCII. Port cli-table3 whole when a caller passes other text or options.
fn render_table(
    columns: [(&str, usize); 3],
    rows: &[[String; 3]],
    summary: &str,
    empty: &str,
) -> String {
    if rows.is_empty() {
        return format!("{empty}\n");
    }
    let len = |s: &str| s.chars().count();
    let content: Vec<usize> = columns
        .iter()
        .enumerate()
        .map(|(i, (header, width))| {
            rows.iter()
                .map(|r| len(&r[i]))
                .fold((*width).max(len(header)), usize::max)
                + 2
        })
        .collect();
    let n = columns.len();
    let available = n.max(100 - (n + 1));
    // allocateFlexibleColumnWidths without widthShare, then shrinkToAvailable.
    let mut widths = if content.iter().sum::<usize>() <= available {
        content.clone()
    } else {
        let mins: Vec<usize> = columns
            .iter()
            .zip(&content)
            .map(|((_, w), c)| (w + 2).min(*c))
            .collect();
        let min_total: usize = mins.iter().sum();
        if min_total >= available {
            let mut remaining = available;
            let last = mins.len() - 1;
            mins.iter()
                .enumerate()
                .map(|(i, w)| {
                    let take = if i == last {
                        remaining
                    } else {
                        (*w).min(remaining)
                    };
                    remaining -= take;
                    take
                })
                .collect()
        } else {
            let extra: Vec<usize> = content.iter().zip(&mins).map(|(c, m)| c - m).collect();
            let extra_total: usize = extra.iter().sum();
            let budget = available - min_total;
            let mut w: Vec<usize> = mins
                .iter()
                .zip(&extra)
                .map(|(m, e)| m + (budget * e).checked_div(extra_total).unwrap_or(0))
                .collect();
            w[0] += available - w.iter().sum::<usize>();
            w
        }
    };
    let mut overflow = widths.iter().sum::<usize>().saturating_sub(available);
    for w in widths.iter_mut().rev() {
        let take = w.saturating_sub(1).min(overflow);
        *w -= take;
        overflow -= take;
    }
    let border = || {
        let parts: Vec<String> = widths.iter().map(|w| "-".repeat(*w)).collect();
        format!("+{}+\n", parts.join("+"))
    };
    let line = |cells: Vec<String>| {
        let parts: Vec<String> = cells
            .iter()
            .zip(&widths)
            .map(|(c, w)| format!(" {c:<inner$} ", inner = w.saturating_sub(2)))
            .collect();
        format!("|{}|\n", parts.join("|"))
    };
    let mut out = border();
    out.push_str(&line(
        columns.iter().map(|(h, _)| (*h).to_owned()).collect(),
    ));
    for row in rows {
        out.push_str(&border());
        let cells = row
            .iter()
            .zip(&widths)
            .map(|(c, w)| truncate_cell(c, w.saturating_sub(2)))
            .collect();
        out.push_str(&line(cells));
    }
    out.push_str(&border());
    format!("{out}\n{summary}\n")
}

/// `truncateTableCell` for text without ANSI codes.
fn truncate_cell(value: &str, width: usize) -> String {
    if value.chars().count() <= width {
        return value.to_owned();
    }
    if width <= 3 {
        return value.chars().take(width).collect();
    }
    format!("{}...", value.chars().take(width - 3).collect::<String>())
}

/// `harness set`. Hands back when stdin is a TTY (the wizard may prompt) or when its
/// success would not be printed.
pub(super) fn set(call: &ActionCall, host: &dyn Host, shown: Shown) -> Option<Printed> {
    if host.stdin_is_tty() || !shown(0, true) {
        return None;
    }
    let db = open(host)?;
    let env = |name: &str| host.var(name);
    let ctx = ctx(&db, &env);
    let opts = call.opts();
    let harnesses = parse_harness_list(opt(opts, "harnesses"));
    let aliases = parse_harness_list(opt(opts, "aliases"));
    let current = get_harness_preference(&ctx).ok()?;
    let selection = resolve_harness_selection(&SelectionInput {
        harnesses: harnesses.as_deref(),
        main: opt(opts, "main"),
        aliases: aliases.as_deref(),
        current: current.as_ref().map(|c| c.registered_harnesses.as_slice()),
        detected: &[],
    });
    let registered = match selection {
        Ok(registered) => registered,
        Err(message) => return Some(thrown(&message)),
    };
    let saved = set_harness_preference(&ctx, &registered).ok()?;
    Some(success(&format!(
        "Set harness preference → {}",
        saved.registered_harnesses.join(", ")
    )))
}

/// The format, or the error to print once the database is open (the original opens it
/// first). `None` when a success would not be printed.
fn checked_format(call: &ActionCall, shown: Shown) -> Option<Result<Format, Printed>> {
    let format = output_format(call);
    match &format {
        Ok(f) if !shown(0, matches!(f, Format::Human)) => None,
        _ => Some(format),
    }
}

/// `harness status`.
pub(super) fn status(call: &ActionCall, host: &dyn Host, shown: Shown) -> Option<Printed> {
    let format = checked_format(call, shown)?;
    let db = open(host)?;
    let format = match format {
        Ok(format) => format,
        Err(printed) => return Some(printed),
    };
    let env = |name: &str| host.var(name);
    let preference = get_harness_preference(&ctx(&db, &env)).ok()?;
    if let Format::Json = format {
        let value = match &preference {
            Some(p) => serde_json::to_value(p).ok()?,
            None => json!({ "registered_harnesses": [] }),
        };
        return Some(print_json(&value));
    }
    let Some(preference) = preference else {
        return Some(themed("No harness preference configured.\n".into()));
    };
    let registered = preference.registered_harnesses.join(", ");
    let resources = settings_rs::load_settings(&harnesstap_dir(&env)).plugin_resources;
    Some(panel(
        "HARNESS",
        &[
            ("Registered", or_none(&registered)),
            ("Plugin resources", &resources),
        ],
    ))
}

fn or_none(value: &str) -> &str {
    if value.is_empty() { "(none)" } else { value }
}

/// `resolve(opts.project)` and its identity; `None` for a git-origin project.
fn project_identity(call: &ActionCall, host: &dyn Host) -> Option<(String, Identity)> {
    let cwd = host.cwd()?;
    let root = posix_resolve(&cwd, opt(call.opts(), "project").unwrap_or("."));
    match resolve_project_identity(&cwd, &root) {
        Identity::Origin => None,
        identity => Some((root, identity)),
    }
}

/// `harness project set`.
pub(super) fn project_set(call: &ActionCall, host: &dyn Host, shown: Shown) -> Option<Printed> {
    if host.stdin_is_tty() || !shown(0, true) {
        return None;
    }
    let (root, identity) = project_identity(call, host)?;
    let db = open(host)?;
    let env = |name: &str| host.var(name);
    let ctx = ctx(&db, &env);
    let project = ensure_project_for_root(&ctx, &identity)?.ok()?;
    let opts = call.opts();
    let harnesses = parse_harness_list(opt(opts, "harnesses"));
    let aliases = parse_harness_list(opt(opts, "aliases"));
    let current = get_project_harness_config(&ctx, &project.id).ok()?;
    let detected: Vec<String> = harness_rs::scanner::detect_platforms(&root)
        .into_iter()
        .map(str::to_owned)
        .collect();
    let selection = resolve_harness_selection(&SelectionInput {
        harnesses: harnesses.as_deref(),
        main: opt(opts, "main"),
        aliases: aliases.as_deref(),
        current: current.as_ref().map(|c| c.registered_harnesses.as_slice()),
        detected: &detected,
    });
    let registered = match selection {
        Ok(registered) => registered,
        Err(message) => return Some(thrown(&message)),
    };
    let strategy = opt(opts, "materializationStrategy")
        .filter(|s| !s.is_empty())
        .map(|s| {
            if s == "copy" {
                "copy"
            } else {
                "symlink-preferred"
            }
        });
    let saved = set_project_harness_config(
        &ctx,
        &ProjectHarnessInput {
            project_id: &project.id,
            registered_harnesses: &registered,
            materialization_strategy: strategy,
            cursor_skill_mode: None,
        },
    )
    .ok()?;
    Some(success(&format!(
        "Set project harness preference → {}",
        saved.registered_harnesses.join(", ")
    )))
}

/// `harness project status`.
pub(super) fn project_status(call: &ActionCall, host: &dyn Host, shown: Shown) -> Option<Printed> {
    let format = checked_format(call, shown)?;
    let format = match format {
        Ok(format) => format,
        Err(printed) => {
            open(host)?;
            return Some(printed);
        }
    };
    let (_, identity) = project_identity(call, host)?;
    let db = open(host)?;
    let env = |name: &str| host.var(name);
    let ctx = ctx(&db, &env);
    let project = find_project_for_root(&ctx, &identity)?.ok()?;
    let config = match project {
        Some(p) => get_project_harness_config(&ctx, &p.id).ok()?,
        None => None,
    };
    if let Format::Json = format {
        let value = match &config {
            Some(c) => serde_json::to_value(c).ok()?,
            None => {
                json!({ "registered_harnesses": [], "materialization_strategy": "symlink-preferred" })
            }
        };
        return Some(print_json(&value));
    }
    let Some(config) = config else {
        return Some(themed("No project harness preference configured.\n".into()));
    };
    let registered = config.registered_harnesses.join(", ");
    Some(panel(
        "HARNESS  project",
        &[
            ("Registered", or_none(&registered)),
            ("Materialization", &config.materialization_strategy),
        ],
    ))
}
