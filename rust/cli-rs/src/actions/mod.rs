//! Actions answered without the original, one module per command group. Each builds its
//! whole output in memory; `lib.rs` prints it unless it is themed and colors are on. An
//! action that writes files or the database decides its outcome first and writes only when
//! [`Ctx::answers`] says that outcome is printed, so the original never runs after a partial
//! write.

use serde_json::Value;

use crate::Host;
use crate::commander::ActionCall;

mod config;
mod help;
mod lock;

/// What an action knows about the run besides its own options.
pub struct Ctx<'a> {
    pub host: &'a dyn Host,
    /// argv without the program (`process.argv.slice(2)`).
    pub args: &'a [String],
    /// Themed output would be plain text.
    pub plain: bool,
}

impl Ctx<'_> {
    /// Whether `lib.rs` prints an outcome, so its side effects may happen.
    pub fn answers(&self, themed: bool) -> bool {
        !themed || self.plain
    }

    /// `path.resolve(p)` against `process.cwd()`.
    pub fn resolve(&self, path: &str) -> Option<String> {
        Some(db_rs::paths::posix_resolve(&self.host.cwd()?, path))
    }
}

impl db_rs::paths::Env for Ctx<'_> {
    fn var(&self, name: &str) -> Option<String> {
        self.host.var(name)
    }
}

/// What an action printed and its exit code.
pub struct Printed {
    pub stdout: String,
    pub stderr: String,
    pub code: u8,
    /// The output goes through `ui.theme` (colored when chalk has colors).
    pub themed: bool,
}

/// Runs the action at `call.path`, or `None` when it is not ported or this run is left to
/// the original.
pub fn run(call: &ActionCall, ctx: &Ctx<'_>) -> Option<Printed> {
    let path: Vec<&str> = call.path.iter().map(String::as_str).collect();
    match path.as_slice() {
        ["help"] => Some(help::help(call)),
        ["help", "scenario"] => Some(help::scenario(call)),
        ["config", "show"] => config::show(call, ctx),
        ["config", "validate"] => config::validate(call, ctx),
        ["config", "init"] => config::init(call, ctx),
        ["lock", "export"] => lock::export(call, ctx),
        _ => None,
    }
}

/// A string option value (`opts.<key>`).
pub(crate) fn opt_str<'a>(call: &'a ActionCall, key: &str) -> Option<&'a str> {
    call.opts().get(key).and_then(Value::as_str)
}

/// Lines printed through `ui` (`src/ui/status.ts`, `kv.ts`): themed.
impl Printed {
    fn ui() -> Self {
        Printed {
            stdout: String::new(),
            stderr: String::new(),
            code: 0,
            themed: true,
        }
    }

    /// `console.log(line)`.
    fn log(&mut self, line: &str) {
        self.stdout.push_str(line);
        self.stdout.push('\n');
    }

    /// `ui.success`.
    fn success(&mut self, message: &str) {
        self.log(&format!("✓ {message}"));
    }

    /// `ui.warn`.
    fn warn(&mut self, message: &str) {
        self.log(&format!("⚠ {message}"));
    }

    /// `ui.danger` (stderr).
    fn danger(&mut self, message: &str) {
        self.stderr.push_str(&format!("✗ {message}\n"));
    }

    /// `ui.hint`.
    fn hint(&mut self, message: &str) {
        self.log(&format!("  → {message}"));
    }

    /// `ui.kvBlock` rows with the default key width and indent.
    fn kv(&mut self, key: &str, value: &str) {
        let pad = 20usize.saturating_sub(emit_rs::js::utf16_len(key));
        self.log(&format!("  {key}{}  {value}", " ".repeat(pad)));
    }
}

/// `fail(message, { hints })` (`src/cli/shared.ts`), exit code 1.
pub(crate) fn fail(message: &str, hints: &[&str]) -> Printed {
    let error = crate::ensure_error_prefix(message);
    let mut stderr = format!("{error}\n");
    let mut printed = vec![error];
    for hint in hints {
        if emit_rs::js::trim(hint).is_empty() {
            continue;
        }
        let key = crate::ensure_error_prefix(hint);
        if printed.contains(&key) {
            continue;
        }
        printed.push(key);
        stderr.push_str(hint);
        stderr.push('\n');
    }
    Printed {
        stdout: String::new(),
        stderr,
        code: 1,
        themed: false,
    }
}

/// `failCaught` of a plain `Error` thrown by an action (no hint).
pub(crate) fn thrown(message: &str) -> Printed {
    Printed {
        stdout: String::new(),
        stderr: format!("{}\n", crate::ensure_error_prefix(message)),
        code: 1,
        themed: false,
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Format {
    Human,
    Json,
}

/// `parseOutputFormat` (`src/utils/output-format.ts`).
pub(crate) fn output_format(call: &ActionCall) -> Result<Format, Printed> {
    match call.opts().get("format") {
        None | Some(Value::Null) => Ok(Format::Human),
        Some(Value::String(s)) if s.is_empty() || s == "human" => Ok(Format::Human),
        Some(Value::String(s)) if s == "json" => Ok(Format::Json),
        Some(other) => {
            let shown = other
                .as_str()
                .map_or_else(|| emit_rs::js::to_string(other), str::to_string);
            Err(thrown(&format!(
                "Invalid --format value: {shown}. Use human or json."
            )))
        }
    }
}

/// `printJson`: `JSON.stringify(value, jsonReplacer, 2)` and a newline.
pub(crate) fn print_json(value: &Value) -> Printed {
    Printed {
        stdout: format!("{}\n", emit_rs::json::stringify(value, "  ")),
        stderr: String::new(),
        code: 0,
        themed: false,
    }
}
