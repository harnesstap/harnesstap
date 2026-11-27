//! `lock export` (`handleLockExportCommand` in `src/cli/commands/lock.ts`), on
//! `lockfile_rs::export`.

use lockfile_rs::export::{
    TimestampError, export_sbom, parse_sbom_format, resolve_export_timestamp,
};
use lockfile_rs::{LockError, lockfile_path, read_lockfile};
use serde_json::Value;

use super::{Ctx, Printed, fail, opt_str};
use crate::commander::ActionCall;

const HINTS: [&str; 2] = ["ht apply", "ht install"];

/// `lock export`.
pub(super) fn export(call: &ActionCall, ctx: &Ctx<'_>) -> Option<Printed> {
    let format = match parse_sbom_format(opt_str(call, "format")) {
        Ok(f) => f,
        Err(m) => return Some(fail(&m, &[])),
    };
    // resolveLockRoot
    let project = opt_str(call, "project");
    let global = call.opts().get("global").is_some_and(emit_rs::js::truthy);
    if global && project.is_some_and(|p| p != ".") {
        return Some(fail("Pass only one of --global or --project.", &HINTS));
    }
    let root = if global {
        db_rs::paths::harnesstap_dir(ctx)
    } else {
        ctx.resolve(project.unwrap_or("."))?
    };
    let lock = match read_lockfile(&root) {
        Ok(Some(lock)) => lock,
        Ok(None) => {
            return Some(fail(
                &format!(
                    "No lockfile found at {}. Run ht apply or ht install to generate one first.",
                    lockfile_path(&root)
                ),
                &HINTS,
            ));
        }
        Err(LockError::Invalid(m)) => return Some(fail(&m, &[])),
        // YAML parser and file system messages are worded differently here.
        Err(_) => return None,
    };
    let timestamp = match resolve_export_timestamp(
        opt_str(call, "timestamp"),
        &lock.resolved_at,
        ctx.host.var("SOURCE_DATE_EPOCH").as_deref(),
    ) {
        Ok(ts) => ts,
        Err(TimestampError::Invalid(m)) => return Some(fail(&m, &HINTS)),
        Err(TimestampError::Range) => return Some(fail("Invalid time value", &[])),
        Err(TimestampError::Unsupported) => return None,
    };
    let document = export_sbom(&lock, format, &timestamp);

    let output = match call.opts().get("output") {
        Some(Value::String(o)) if !o.is_empty() => o,
        _ => {
            return Some(Printed {
                stdout: document,
                stderr: String::new(),
                code: 0,
                themed: false,
            });
        }
    };
    if !ctx.answers(0, false) {
        return None;
    }
    let path = ctx.resolve(output)?;
    // A failed write goes to the original, which makes the same folders and words the error.
    if let Some(dir) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(dir).ok()?;
    }
    std::fs::write(&path, document).ok()?;
    Some(Printed {
        stdout: String::new(),
        stderr: String::new(),
        code: 0,
        themed: false,
    })
}
