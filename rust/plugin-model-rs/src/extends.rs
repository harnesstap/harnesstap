//! `services/plugin-extends.ts`: a profile that extends a parent
//! (`upstream.kind = "extends"`) shows the parent's items live, minus the
//! entries it hides, plus its own. Also `catalogUpstreamBase`, split out of
//! `plugin-fork.ts` (the rest of that file is not needed here yet).
//!
//! `ExtendsError` and `UpstreamUnpublishedError` are `Err` messages. Runs
//! outside a status computation, so `computationSlot` is a plain call.

use std::collections::HashSet;

use models_rs::Ctx;
use models_rs::resource::{LISTABLE_RESOURCE_TYPES as RESOURCE_TYPES, Resource};
use node_semver_rs::{self as semver, Options};
use rusqlite::params;
use serde::Serialize;

use crate::cloud_error::{
    CloudFailure, cloud_error_detail, parse_cloud_error_text, request_id_suffix,
};
use crate::dependency::{DependencyView, dependencies_from_resources, is_host_plugin_pin_resource};
use crate::upstream::{
    PluginUpstream, exportable_upstream, is_catalog_upstream_ref, upstream_ref_base,
};
use crate::versioning::mark_plugin_dirty;
use crate::{
    AttachedResource, Plugin, Result, get_plugin_by_id, get_plugin_resources, resolve_ap_name,
    transaction,
};

/// `MAX_EXCLUDE_ENTRIES`: Cloud accepts at most this many per package.
pub const MAX_EXCLUDE_ENTRIES: usize = 200;

/// `ComposedItem`. `source` is `parent` or `own`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ComposedItem {
    pub resource: AttachedResource,
    pub source: &'static str,
}

/// `InheritedItem`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InheritedItem {
    pub id: String,
    #[serde(rename = "type")]
    pub resource_type: String,
    pub name: String,
    pub source: &'static str,
    pub hidden: bool,
}

/// An exclude entry, `{ type, name }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExcludeEntry {
    #[serde(rename = "type")]
    pub resource_type: String,
    pub name: String,
}

struct CandidateRow {
    id: String,
    name: String,
    version: String,
    frozen: bool,
}

/// `parseExcludeEntry`: validates one exclude string and returns it normalized.
pub fn parse_exclude_entry(entry: &str) -> Result<ExcludeEntry> {
    let trimmed = emit_rs::js::trim(entry);
    let (resource_type, name) = match trimmed.find(':') {
        Some(colon) if colon > 0 => (&trimmed[..colon], emit_rs::js::trim(&trimmed[colon + 1..])),
        _ => ("", ""),
    };
    if resource_type.is_empty() || name.is_empty() || !RESOURCE_TYPES.contains(&resource_type) {
        return Err(format!(
            "Invalid hidden item \"{entry}\". Use <type>:<name>, where type is one of {}.",
            RESOURCE_TYPES.join(", ")
        ));
    }
    if name.contains(['*', '?', '[', ']']) {
        return Err(format!(
            "Invalid hidden item \"{entry}\". Name one item exactly; patterns such as * are not supported."
        ));
    }
    Ok(ExcludeEntry {
        resource_type: resource_type.to_owned(),
        name: name.to_owned(),
    })
}

/// `[...new Set(keys)].sort()`.
fn unique_sorted(keys: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut unique: Vec<String> = keys
        .into_iter()
        .filter(|k| seen.insert(k.clone()))
        .collect();
    unique.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    unique
}

/// `normalizeExcludeEntries`.
pub fn normalize_exclude_entries<S: AsRef<str>>(entries: &[S]) -> Result<Vec<String>> {
    let mut keys = Vec::new();
    for entry in entries {
        let e = parse_exclude_entry(entry.as_ref())?;
        keys.push(format!("{}:{}", e.resource_type, e.name));
    }
    let unique = unique_sorted(keys);
    if unique.len() > MAX_EXCLUDE_ENTRIES {
        return Err(format!(
            "A profile can hide at most {MAX_EXCLUDE_ENTRIES} items; this one would hide {}.",
            unique.len()
        ));
    }
    Ok(unique)
}

/// `excludeKeyOf`.
pub fn exclude_key_of(resource: &Resource) -> String {
    format!("{}:{}", resource.resource_type, resource.name)
}

/// `listPluginExcludes`.
pub fn list_plugin_excludes(ctx: &Ctx, plugin_id: &str) -> Result<Vec<String>> {
    let mut stmt = ctx
        .db
        .conn
        .prepare("SELECT entry FROM plugin_excludes WHERE plugin_id = ? ORDER BY entry")
        .map_err(|e| e.to_string())?;
    stmt.query_map([plugin_id], |r| r.get::<_, String>(0))
        .and_then(|rows| rows.collect())
        .map_err(|e| e.to_string())
}

/// `writePluginExcludes`: replaces the hidden list. Callers mark the plugin dirty first.
pub fn write_plugin_excludes<S: AsRef<str>>(
    ctx: &Ctx,
    plugin_id: &str,
    entries: &[S],
) -> Result<Vec<String>> {
    let normalized = normalize_exclude_entries(entries)?;
    let now = ctx.clock.now_iso();
    transaction(ctx, || {
        ctx.db.run(
            "DELETE FROM plugin_excludes WHERE plugin_id = ?",
            [plugin_id],
        )?;
        for entry in &normalized {
            ctx.db.run(
                "INSERT INTO plugin_excludes (plugin_id, entry, created_at) VALUES (?, ?, ?)",
                params![plugin_id, entry, now],
            )?;
        }
        Ok(())
    })?;
    Ok(normalized)
}

/// `setPluginExcludes`: only an extends link can hide anything.
pub fn set_plugin_excludes<S: AsRef<str>>(
    ctx: &Ctx,
    plugin_id: &str,
    entries: &[S],
) -> Result<Vec<String>> {
    let Some(plugin) = get_plugin_by_id(ctx, plugin_id)? else {
        return Err(format!("Plugin not found: {plugin_id}"));
    };
    if plugin.upstream.as_ref().map(|u| u.kind.as_str()) != Some("extends") {
        return Err(format!(
            "{} does not keep in sync with a parent, so it has nothing to hide.",
            plugin.name
        ));
    }
    let normalized = normalize_exclude_entries(entries)?;
    let current = list_plugin_excludes(ctx, plugin_id)?;
    if current.join("\n") == normalized.join("\n") {
        return Ok(current);
    }
    mark_plugin_dirty(ctx, plugin_id)?;
    write_plugin_excludes(ctx, plugin_id, &normalized)
}

fn upstream_kind_of(ctx: &Ctx, plugin_id: &str) -> Result<String> {
    let kind: Option<Option<String>> = ctx
        .db
        .conn
        .query_row(
            "SELECT upstream_kind FROM plugins WHERE id = ?",
            [plugin_id],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            e => Err(e.to_string()),
        })?;
    Ok(kind.flatten().unwrap_or_default())
}

/// The range part of an upstream ref, `*` when missing or not a valid range.
fn upstream_range(reference: &str) -> String {
    let range = match reference.rfind('@') {
        Some(at) if at > 0 => &reference[at + 1..],
        _ => "*",
    };
    if semver::valid_range(range, Options::default()).is_some() {
        range.to_owned()
    } else {
        "*".to_owned()
    }
}

fn candidate_query(ctx: &Ctx, sql: &str, args: &[&str]) -> Result<Vec<CandidateRow>> {
    let mut stmt = ctx.db.conn.prepare(sql).map_err(|e| e.to_string())?;
    stmt.query_map(rusqlite::params_from_iter(args), |r| {
        Ok(CandidateRow {
            id: r.get(0)?,
            name: r.get(1)?,
            version: r.get(2)?,
            frozen: r.get::<_, Option<String>>(3)?.is_some(),
        })
    })
    .and_then(|rows| rows.collect())
    .map_err(|e| e.to_string())
}

fn candidate_rows(
    ctx: &Ctx,
    upstream: &PluginUpstream,
    linked_id: Option<&str>,
) -> Result<Vec<CandidateRow>> {
    let base = upstream_ref_base(&upstream.reference);
    let mut rows = if is_catalog_upstream_ref(&upstream.reference) {
        let parts: Vec<&str> = base.split('/').collect();
        let (org, catalog, slug) = (parts[0], parts[1], parts[2]);
        let like = format!("{base}@%");
        candidate_query(
            ctx,
            "SELECT id, name, version, frozen_at FROM plugins\n           WHERE org_slug = ? AND catalog_slug = ?\n             AND (ap_name = ? OR name = ? OR origin_locator = ? OR origin_locator LIKE ?)",
            &[org, catalog, slug, slug, base, &like],
        )?
    } else {
        candidate_query(
            ctx,
            "SELECT id, name, version, frozen_at FROM plugins WHERE name = ?",
            &[base],
        )?
    };
    if let Some(linked_id) = linked_id.filter(|s| !s.is_empty())
        && let Some(linked) = get_plugin_by_id(ctx, linked_id)?
    {
        rows.extend(candidate_query(
            ctx,
            "SELECT id, name, version, frozen_at FROM plugins\n             WHERE name = ? AND org_slug = ? AND catalog_slug = ?",
            &[&linked.name, &linked.org_slug, &linked.catalog_slug],
        )?);
    }
    // `new Map(rows.map((row) => [row.id, row]))`: first position, last value.
    let mut unique: Vec<CandidateRow> = Vec::new();
    for row in rows {
        match unique.iter_mut().find(|u| u.id == row.id) {
            Some(slot) => *slot = row,
            None => unique.push(row),
        }
    }
    Ok(unique)
}

/// `resolveUpstreamParent`: the newest installed parent version in the
/// child's upstream range, a working head before a frozen one.
pub fn resolve_upstream_parent(
    ctx: &Ctx,
    plugin: &Plugin,
    include_self: bool,
) -> Result<Option<Plugin>> {
    let Some(upstream) = &plugin.upstream else {
        return Ok(None);
    };
    let range = upstream_range(&upstream.reference);
    let mut matches: Vec<CandidateRow> =
        candidate_rows(ctx, upstream, plugin.upstream_plugin_id.as_deref())?
            .into_iter()
            .filter(|r| include_self || (r.id != plugin.id && r.name != plugin.name))
            .filter(|r| {
                semver::valid(r.version.as_str(), Options::default()).is_some()
                    && semver::satisfies(r.version.as_str(), &range, Options::default())
            })
            .collect();
    matches.sort_by(|a, b| {
        let by_version =
            semver::rcompare(a.version.as_str(), b.version.as_str(), Options::default())
                .unwrap_or(0);
        by_version.cmp(&0).then_with(|| a.frozen.cmp(&b.frozen))
    });
    match matches.first() {
        Some(best) => get_plugin_by_id(ctx, &best.id),
        None => Ok(None),
    }
}

/// `parentMissingError`'s message. The plugin has an upstream.
pub fn parent_missing_error(plugin: &Plugin) -> String {
    let Some(upstream) = &plugin.upstream else {
        return format!("Parent undefined of {} is not installed.", plugin.name);
    };
    let base = upstream_ref_base(&upstream.reference);
    let hint = is_catalog_upstream_ref(&upstream.reference).then(|| {
        let version = if upstream.version_at_link.is_empty() {
            "latest"
        } else {
            &upstream.version_at_link
        };
        format!("ht profile pull {base}@{version}")
    });
    let suffix = hint.map_or_else(String::new, |h| format!(" Run `{h}` first."));
    format!(
        "Parent {} of {} is not installed.{suffix}",
        upstream.reference, plugin.name
    )
}

fn is_own_host_pin(plugin: &Plugin, resource: &Resource) -> bool {
    resource.name == plugin.name && is_host_plugin_pin_resource(resource)
}

fn own_items(own: Vec<AttachedResource>) -> Vec<ComposedItem> {
    own.into_iter()
        .map(|resource| ComposedItem {
            resource,
            source: "own",
        })
        .collect()
}

fn compose_items(ctx: &Ctx, plugin_id: &str, chain: &[String]) -> Result<Vec<ComposedItem>> {
    let own = get_plugin_resources(ctx, plugin_id)?;
    if upstream_kind_of(ctx, plugin_id)? != "extends" {
        return Ok(own_items(own));
    }
    let plugin = match get_plugin_by_id(ctx, plugin_id)? {
        Some(p) if p.upstream.is_some() => p,
        _ => return Ok(own_items(own)),
    };
    let Some(parent) = resolve_upstream_parent(ctx, &plugin, false)? else {
        return Err(parent_missing_error(&plugin));
    };
    if chain.contains(&parent.name) {
        let mut cycle = chain.to_vec();
        cycle.push(parent.name.clone());
        return Err(format!(
            "{} cannot extend {}: {} is a cycle.",
            plugin.name,
            parent.name,
            cycle.join(" > ")
        ));
    }
    let hidden: HashSet<String> = list_plugin_excludes(ctx, &plugin.id)?.into_iter().collect();
    let own_keys: HashSet<String> = own.iter().map(|r| exclude_key_of(&r.resource)).collect();
    let mut next_chain = chain.to_vec();
    next_chain.push(parent.name.clone());
    let mut items: Vec<ComposedItem> = compose_items(ctx, &parent.id, &next_chain)?
        .into_iter()
        .map(|item| item.resource)
        .filter(|r| !is_own_host_pin(&parent, &r.resource))
        .filter(|r| {
            let key = exclude_key_of(&r.resource);
            !hidden.contains(&key) && !own_keys.contains(&key)
        })
        .map(|resource| ComposedItem {
            resource,
            source: "parent",
        })
        .collect();
    items.extend(own_items(own));
    Ok(items)
}

/// `listInheritedItems`: the parent's items as the child sees them, hidden
/// ones flagged; items the child also has itself are left out.
pub fn list_inherited_items(ctx: &Ctx, plugin_id: &str) -> Result<Vec<InheritedItem>> {
    let plugin = match get_plugin_by_id(ctx, plugin_id)? {
        Some(p) if p.upstream.as_ref().is_some_and(|u| u.kind == "extends") => p,
        _ => return Ok(Vec::new()),
    };
    let Some(parent) = resolve_upstream_parent(ctx, &plugin, false)? else {
        return Err(parent_missing_error(&plugin));
    };
    let hidden: HashSet<String> = list_plugin_excludes(ctx, &plugin.id)?.into_iter().collect();
    let own_keys: HashSet<String> = get_plugin_resources(ctx, &plugin.id)?
        .iter()
        .map(|r| exclude_key_of(&r.resource))
        .collect();
    let chain = [plugin.name.clone(), parent.name.clone()];
    Ok(compose_items(ctx, &parent.id, &chain)?
        .into_iter()
        .map(|item| item.resource.resource)
        .filter(|r| !is_own_host_pin(&parent, r) && !own_keys.contains(&exclude_key_of(r)))
        .map(|r| InheritedItem {
            hidden: hidden.contains(&exclude_key_of(&r)),
            id: r.id,
            resource_type: r.resource_type,
            name: r.name,
            source: "parent",
        })
        .collect())
}

/// `listComposedItems`: own and inherited items, tagged with their source.
pub fn list_composed_items(ctx: &Ctx, plugin_id: &str) -> Result<Vec<ComposedItem>> {
    let chain: Vec<String> = get_plugin_by_id(ctx, plugin_id)?
        .map(|p| p.name)
        .into_iter()
        .collect();
    compose_items(ctx, plugin_id, &chain)
}

/// `getComposedPluginResources`: exactly `getPluginResources` for a plugin
/// that does not extend anything.
pub fn get_composed_plugin_resources(ctx: &Ctx, plugin_id: &str) -> Result<Vec<AttachedResource>> {
    if upstream_kind_of(ctx, plugin_id)? != "extends" {
        return get_plugin_resources(ctx, plugin_id);
    }
    Ok(list_composed_items(ctx, plugin_id)?
        .into_iter()
        .map(|item| item.resource)
        .collect())
}

/// `listComposedDependencies`: `listDependencies` over the composed set.
pub fn list_composed_dependencies(ctx: &Ctx, plugin_id: &str) -> Result<Vec<DependencyView>> {
    let plugin = get_plugin_by_id(ctx, plugin_id)?;
    let resources = get_composed_plugin_resources(ctx, plugin_id)?;
    Ok(dependencies_from_resources(&resources)
        .into_iter()
        .filter(|d| match &plugin {
            Some(p) => !(d.name == p.name && is_host_plugin_pin_resource(&d.resource.resource)),
            None => true,
        })
        .collect())
}

/// `catalogUpstreamBase` (`plugin-fork.ts`): `org/catalog/slug` for a plugin
/// that lives in a catalog.
pub fn catalog_upstream_base(source: &Plugin) -> Option<String> {
    if source.org_slug.is_empty() || source.catalog_slug.is_empty() {
        return None;
    }
    let prefix = format!("{}/{}/", source.org_slug, source.catalog_slug);
    if let Some(locator) = source.origin_locator.as_deref()
        && locator.starts_with(&prefix)
    {
        return Some(match locator[prefix.len()..].find('@') {
            Some(i) => locator[..prefix.len() + i].to_owned(),
            None => locator.to_owned(),
        });
    }
    Some(format!(
        "{}/{}/{}",
        source.org_slug,
        source.catalog_slug,
        resolve_ap_name(&source.name, source.ap_name.as_deref())
    ))
}

/// `portableUpstream`: the upstream link a package may carry.
pub fn portable_upstream(ctx: &Ctx, plugin: &Plugin) -> Result<Option<PluginUpstream>> {
    let Some(upstream) = &plugin.upstream else {
        return Ok(None);
    };
    let direct = exportable_upstream(Some(upstream));
    if direct.is_some() || upstream.kind != "extends" {
        return Ok(direct);
    }
    let Some(parent) = resolve_upstream_parent(ctx, plugin, false)? else {
        return Ok(None);
    };
    let Some(base) = catalog_upstream_base(&parent) else {
        return Ok(None);
    };
    let version_at_link =
        if semver::valid(upstream.version_at_link.as_str(), Options::default()).is_some() {
            upstream.version_at_link.clone()
        } else {
            parent.version.clone()
        };
    Ok(exportable_upstream(Some(&PluginUpstream {
        kind: "extends".into(),
        reference: format!("{base}@{}", upstream_range(&upstream.reference)),
        version_at_link,
    })))
}

/// `parseExcludeList`: valid exclude strings from a package; anything else is dropped.
pub fn parse_exclude_list(raw: &serde_json::Value) -> Vec<String> {
    let Some(entries) = raw.as_array() else {
        return Vec::new();
    };
    let valid = entries
        .iter()
        .filter_map(serde_json::Value::as_str)
        .filter_map(|e| parse_exclude_entry(e).ok())
        .map(|e| format!("{}:{}", e.resource_type, e.name))
        .collect();
    unique_sorted(valid)
}

/// `assertNoExtendsCycle`: refuses a link that makes a plugin extend itself,
/// directly or through its parents.
pub fn assert_no_extends_cycle(
    ctx: &Ctx,
    plugin: &Plugin,
    upstream: &PluginUpstream,
    upstream_plugin_id: Option<&str>,
) -> Result<()> {
    if upstream.kind != "extends" {
        return Ok(());
    }
    let mut seen = vec![plugin.name.clone()];
    let mut linked = plugin.clone();
    linked.upstream = Some(upstream.clone());
    if let Some(id) = upstream_plugin_id.filter(|s| !s.is_empty()) {
        linked.upstream_plugin_id = Some(id.to_owned());
    }
    let mut current = resolve_upstream_parent(ctx, &linked, true)?;
    let points_at_plugin = |reference: &str| {
        let base = upstream_ref_base(reference);
        let slug = base.rsplit('/').next().unwrap_or(base);
        base == plugin.name
            || slug == plugin.name
            || plugin
                .ap_name
                .as_deref()
                .is_some_and(|a| !a.is_empty() && slug == a)
    };
    if points_at_plugin(&upstream.reference) {
        return Err(format!(
            "{} cannot extend itself ({}).",
            plugin.name, upstream.reference
        ));
    }
    while let Some(cur) = current {
        if let Some(up) = cur.upstream.as_ref().filter(|u| u.kind == "extends")
            && points_at_plugin(&up.reference)
        {
            return Err(format!(
                "{} cannot extend {}: {} > {} > {} is a cycle.",
                plugin.name,
                upstream.reference,
                seen.join(" > "),
                cur.name,
                plugin.name
            ));
        }
        if seen.contains(&cur.name) {
            return Err(format!(
                "{} cannot extend {}: {} > {} is a cycle.",
                plugin.name,
                upstream.reference,
                seen.join(" > "),
                cur.name
            ));
        }
        seen.push(cur.name.clone());
        if cur.upstream.as_ref().map(|u| u.kind.as_str()) != Some("extends") {
            return Ok(());
        }
        current = resolve_upstream_parent(ctx, &cur, false)?;
    }
    Ok(())
}

/// `UpstreamUnpublishedError`'s message.
pub fn upstream_unpublished_message(plugin_name: &str, reference: &str) -> String {
    format!(
        "{plugin_name} keeps in sync with {reference}, which is not published. Publish the parent first, or detach this profile to publish it as a separate copy."
    )
}

/// `assertParentPublished`: a keep-in-sync child needs a published parent.
pub fn assert_parent_published(ctx: &Ctx, plugin: &Plugin) -> Result<()> {
    let Some(upstream) = plugin.upstream.as_ref().filter(|u| u.kind == "extends") else {
        return Ok(());
    };
    if portable_upstream(ctx, plugin)?.is_none() {
        return Err(upstream_unpublished_message(
            &plugin.name,
            &upstream.reference,
        ));
    }
    Ok(())
}

fn upstream_ref_or_parent(plugin: &Plugin) -> &str {
    plugin
        .upstream
        .as_ref()
        .map_or("its parent", |u| u.reference.as_str())
}

/// `cloudPublishErrorMessage`: a Cloud 400 on publish as a message naming what to fix.
pub fn cloud_publish_error_message(plugin: &Plugin, error: &CloudFailure) -> Option<String> {
    let raw = error.message();
    let detail = cloud_error_detail(error);
    let code = detail.code.clone().or_else(|| {
        raw.contains("upstream_unpublished")
            .then(|| "upstream_unpublished".to_owned())
    });
    match code.as_deref() {
        Some("upstream_unpublished") => {
            let reference = detail
                .reference
                .as_deref()
                .unwrap_or_else(|| upstream_ref_or_parent(plugin));
            Some(
                upstream_unpublished_message(&plugin.name, reference) + &request_id_suffix(&detail),
            )
        }
        Some("invalid_exclude") => {
            let entry = detail.entry.as_deref().unwrap_or("an entry");
            let why = detail.message.as_deref().map_or_else(String::new, |m| {
                format!(" ({})", m.strip_suffix('.').unwrap_or(m))
            });
            let fix = detail.entry.as_deref().map_or_else(String::new, |e| {
                format!(
                    " Run `ht plugin edit {} --unhide {e}` and publish again.",
                    plugin.name
                )
            });
            Some(format!(
                "Cloud rejected the hidden item \"{entry}\" of {}{why}. Each hidden item is <type>:<name>, where type is one of {}.{fix}{}",
                plugin.name,
                RESOURCE_TYPES.join(", "),
                request_id_suffix(&detail)
            ))
        }
        _ => None,
    }
}

/// `upstreamUnpublishedFromCloud`: for callers holding only the error text.
pub fn upstream_unpublished_from_cloud(plugin: &Plugin, message: &str) -> Option<String> {
    let detail = parse_cloud_error_text(message);
    let code = detail.code.clone().or_else(|| {
        message
            .contains("upstream_unpublished")
            .then(|| "upstream_unpublished".to_owned())
    });
    if code.as_deref() != Some("upstream_unpublished") {
        return None;
    }
    let reference = detail
        .reference
        .as_deref()
        .unwrap_or_else(|| upstream_ref_or_parent(plugin));
    Some(upstream_unpublished_message(&plugin.name, reference))
}
