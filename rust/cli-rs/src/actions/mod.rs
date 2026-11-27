//! Actions answered without the original, one module per command group. Each builds its
//! whole output in memory; `lib.rs` prints it only when the original would print nothing
//! after it (a failure, or a success with the update check skipped).

use serde_json::Value;

use crate::commander::ActionCall;

mod help;

/// What an action printed and its exit code.
pub struct Printed {
    pub stdout: String,
    pub stderr: String,
    pub code: u8,
    /// The output goes through `ui.theme` (colored when chalk has colors).
    pub themed: bool,
}

/// Runs the action at `call.path`, or `None` when it is not ported.
pub fn run(call: &ActionCall) -> Option<Printed> {
    let path: Vec<&str> = call.path.iter().map(String::as_str).collect();
    match path.as_slice() {
        ["help"] => Some(help::help(call)),
        ["help", "scenario"] => Some(help::scenario(call)),
        _ => None,
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
