//! The port of `src/services/plugin-origin.ts`: who may change a plugin.
//!
//! `PluginProvenanceError` is an `Err` with its message; its `hints` are
//! `provenance_hints`.

use crate::{err, get_plugin_by_id, text_at};
use models_rs::{Ctx, Result};
use rusqlite::{OptionalExtension, params};

/// `AuthoredCapability`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthoredCapability {
    Edit,
    Cut,
    Publish,
    Needs,
}

impl AuthoredCapability {
    /// `CAPABILITY_VERB`.
    fn verb(self) -> &'static str {
        match self {
            AuthoredCapability::Edit => "edited directly",
            AuthoredCapability::Cut => "cut",
            AuthoredCapability::Publish => "published directly",
            AuthoredCapability::Needs => "given needs",
        }
    }
}

/// `getPluginOrigin`.
pub fn get_plugin_origin(ctx: &Ctx, plugin_id: &str) -> Result<String> {
    let origin: Option<Option<String>> = ctx
        .db
        .conn
        .query_row(
            "SELECT origin FROM plugins WHERE id = ?",
            [plugin_id],
            |r| Ok(text_at(r, 0)),
        )
        .optional()
        .map_err(err)?;
    Ok(origin.flatten().unwrap_or_else(|| "authored".to_owned()))
}

/// `setPluginOrigin`.
pub fn set_plugin_origin(ctx: &Ctx, plugin_id: &str, origin: &str) -> Result<()> {
    ctx.db.run(
        "UPDATE plugins SET origin = ?, updated_at = ? WHERE id = ?",
        params![origin, ctx.clock.now_iso(), plugin_id],
    )?;
    Ok(())
}

fn name_of(ctx: &Ctx, plugin_id: &str) -> Result<String> {
    Ok(get_plugin_by_id(ctx, plugin_id)?.map_or_else(|| plugin_id.to_owned(), |p| p.name))
}

/// `assertAuthored`.
pub fn assert_authored(ctx: &Ctx, plugin_id: &str, capability: AuthoredCapability) -> Result<()> {
    let origin = get_plugin_origin(ctx, plugin_id)?;
    if origin == "authored" {
        return Ok(());
    }
    let name = name_of(ctx, plugin_id)?;
    let article = if origin == "upstream" {
        "an upstream"
    } else {
        "a catalog"
    };
    Err(format!(
        "{name} is {article} plugin and cannot be {}",
        capability.verb()
    ))
}

/// `assertSyncable`.
pub fn assert_syncable(ctx: &Ctx, plugin_id: &str) -> Result<()> {
    if get_plugin_origin(ctx, plugin_id)? != "authored" {
        return Ok(());
    }
    let name = name_of(ctx, plugin_id)?;
    Err(format!(
        "{name} is an authored plugin; there is no upstream to sync from"
    ))
}

/// The `hints` of the `PluginProvenanceError` the two asserts throw.
pub fn provenance_hints(name: &str, syncable: bool) -> Vec<String> {
    if syncable {
        vec![format!("ht plugin edit {name}")]
    } else {
        vec![format!("ht plugin fork {name}")]
    }
}
