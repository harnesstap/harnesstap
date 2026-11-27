//! `services/plugin-composition.ts`, plus `findMarketplacePluginNameCollision`
//! split out of `upstream-plugin.ts` (database only; the rest of that file
//! materializes installs and is not needed yet).
//!
//! What reaches past the database goes through [`CompositionHost`]: the
//! marketplace catalog on disk, the marketplace pin cache (git over the
//! network) and resource sync (the scanner).

use models_rs::Ctx;
use models_rs::resource::{
    LISTABLE_RESOURCE_TYPES as RESOURCE_TYPES, ResolveMode, Resource, ResourceLookup,
    find_resource_by_key, resolve_resource,
};
use models_rs::services::resource_selector::parse_resource_selector;
use serde::Serialize;
use serde_json::Value;

use crate::claude_pins::{self, resolve_home_root};
use crate::dependency::{
    AddDependencyOptions, add_dependency, ensure_dependency_resource, list_dependencies,
    parse_dependency_ref, remove_dependency,
};
use crate::git_constraint::parse_git_dependency_constraint;
use crate::origin::get_plugin_origin;
use crate::versioning::mark_plugin_dirty;
use crate::{
    AttachedResource, Plugin, PluginRefView, Result, add_resource_to_plugin, get_plugin_by_name,
    list_plugin_versions, remove_resource_from_plugin, sync_claude_marketplace_plugins_after_add,
    sync_claude_marketplace_plugins_after_remove,
};

/// `MATERIAL_RESOURCE_TYPES`: every resource type but `plugin`.
const MATERIAL_RESOURCE_TYPES: &[&str] = RESOURCE_TYPES.split_at(RESOURCE_TYPES.len() - 1).0;

/// The work composition hands to code that is not ported yet.
pub trait CompositionHost {
    /// `marketplaceCatalogWarnings(harnesstapDir, marketplace)`.
    fn marketplace_catalog_warnings(
        &self,
        harnesstap_dir: &str,
        marketplace: &str,
    ) -> Result<Vec<String>>;
    /// The names of `listCatalogPlugins(harnesstapDir, { name: marketplace })`.
    fn catalog_plugin_names(&self, harnesstap_dir: &str, marketplace: &str) -> Result<Vec<String>>;
    /// `installMarketplacePinIntoCache` (git over the network).
    fn install_marketplace_pin_into_cache(
        &self,
        origin_ref: &str,
        version_constraint: &str,
        home_root: &str,
    ) -> Result<()>;
    /// `syncPluginResource(resource, { policy: "overwrite" })` (the scanner).
    fn sync_plugin_resource(&self, ctx: &Ctx, resource: &Resource) -> Result<()>;
}

/// `PluginPinView`. `version_constraint` keeps the metadata JSON value.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PluginPinView {
    #[serde(rename = "ref")]
    pub reference: String,
    pub version_constraint: Value,
    pub embed_on_export: bool,
    pub resource: AttachedResource,
}

/// The composition view of `parseDependencyRef`: `(name, namespace, origin_ref)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PluginRefIdentity {
    pub name: String,
    pub namespace: String,
    pub origin_ref: String,
}

/// `isCompositionResourceType`.
pub fn is_composition_resource_type(resource_type: &str) -> bool {
    resource_type == "plugin"
}

/// `parsePluginRef` (deprecated alias of `parseDependencyRef`).
pub fn parse_plugin_ref(reference: &str) -> PluginRefIdentity {
    let parsed = parse_dependency_ref(reference);
    PluginRefIdentity {
        name: parsed.name,
        namespace: parsed.namespace,
        origin_ref: parsed.origin_ref,
    }
}

/// `pluginResourceNamespace`.
pub fn plugin_resource_namespace(
    identity: &PluginRefIdentity,
    version_constraint: Option<&str>,
) -> String {
    match version_constraint.filter(|c| !c.is_empty()) {
        None => identity.namespace.clone(),
        Some(c) if identity.namespace.is_empty() => c.to_owned(),
        Some(c) => format!("{}#{c}", identity.namespace),
    }
}

/// `formatPluginRef`.
pub fn format_plugin_ref(resource: &Resource) -> String {
    if !resource.origin_ref.is_empty() {
        return resource.origin_ref.clone();
    }
    if resource.namespace.is_empty() {
        resource.name.clone()
    } else {
        format!("{}@{}", resource.name, resource.namespace)
    }
}

/// `findPluginResourceByPin`.
pub fn find_plugin_resource_by_pin(
    ctx: &Ctx,
    reference: &str,
    version_constraint: Option<&str>,
) -> Result<Option<Resource>> {
    let identity = parse_plugin_ref(reference);
    let namespace = plugin_resource_namespace(&identity, version_constraint);
    if let Some(found) = find_resource_by_key(ctx, "plugin", &identity.name, &namespace)? {
        return Ok(Some(found));
    }
    if version_constraint.is_none_or(str::is_empty) {
        return find_resource_by_key(ctx, "plugin", &identity.name, &identity.namespace);
    }
    Ok(None)
}

fn strip_type_prefix(selector: &str) -> &str {
    match selector.split_once(':') {
        Some((t, rest)) if t == "plugin" || t == "plugin_pin" || RESOURCE_TYPES.contains(&t) => {
            rest
        }
        _ => selector,
    }
}

/// `ensurePluginResource` (deprecated alias of `ensureDependencyResource`).
pub fn ensure_plugin_resource(
    ctx: &Ctx,
    selector: &str,
    version_constraint: Option<&str>,
    portable: Option<&str>,
) -> Result<Resource> {
    ensure_dependency_resource(
        ctx,
        strip_type_prefix(selector),
        version_constraint,
        portable,
    )
}

/// `listAttachedPluginPins`.
pub fn list_attached_plugin_pins(ctx: &Ctx, plugin_id: &str) -> Result<Vec<PluginPinView>> {
    Ok(list_dependencies(ctx, plugin_id)?
        .into_iter()
        .map(|d| PluginPinView {
            reference: d.reference,
            version_constraint: d.version_constraint,
            embed_on_export: d.embed_on_export,
            resource: d.resource,
        })
        .collect())
}

/// `attachPluginPinToPlugin`: `latest` and `*` attach without a constraint.
pub fn attach_plugin_pin_to_plugin(
    ctx: &Ctx,
    plugin_id: &str,
    reference: &str,
    version_constraint: &str,
    embed_on_export: bool,
    mark_dirty: Option<bool>,
) -> Result<()> {
    let constraint = (version_constraint != "latest" && version_constraint != "*")
        .then_some(version_constraint)
        .filter(|c| !c.is_empty());
    add_dependency(
        ctx,
        plugin_id,
        reference,
        &AddDependencyOptions {
            version_constraint: constraint,
            embed_on_export,
            mark_dirty: (mark_dirty == Some(false)).then_some(false),
        },
    )?;
    Ok(())
}

/// `detachPluginPinFromPlugin`.
pub fn detach_plugin_pin_from_plugin(ctx: &Ctx, plugin_id: &str, reference: &str) -> Result<()> {
    remove_dependency(ctx, plugin_id, reference)?;
    Ok(())
}

/// `listAttachedPluginRefs`. A non-string `version_constraint` becomes its JSON text.
pub fn list_attached_plugin_refs(ctx: &Ctx, plugin_id: &str) -> Result<Vec<PluginRefView>> {
    Ok(list_dependencies(ctx, plugin_id)?
        .into_iter()
        .map(|d| PluginRefView {
            dependency_name: d.reference,
            version_constraint: match d.version_constraint {
                Value::String(s) => s,
                other => other.to_string(),
            },
            resource: d.resource,
        })
        .collect())
}

/// `attachCompositionResource`.
pub fn attach_composition_resource(ctx: &Ctx, plugin_id: &str, resource: &Resource) -> Result<()> {
    mark_plugin_dirty(ctx, plugin_id)?;
    add_resource_to_plugin(ctx, plugin_id, &resource.id, None)
}

fn normalize_composition_type(resource_type: &str) -> Option<String> {
    if resource_type == "plugin" || resource_type == "plugin_pin" {
        return Some("plugin".into());
    }
    RESOURCE_TYPES
        .contains(&resource_type)
        .then(|| resource_type.to_owned())
}

/// `PLUGIN_ATTACHMENT_TYPES`.
pub fn plugin_attachment_types() -> Vec<&'static str> {
    MATERIAL_RESOURCE_TYPES
        .iter()
        .copied()
        .chain(["plugin"])
        .collect()
}

/// `attachmentTypeRequiredHints`.
pub fn attachment_type_required_hints(selector: &str, plugin_name: Option<&str>) -> Vec<String> {
    let example = plugin_name.unwrap_or("<plugin>");
    vec![
        format!("ht plugin edit {example} --add {selector} --type skill"),
        format!("Valid types: {}", plugin_attachment_types().join(", ")),
        "Or use a typed selector: skill:name, plugin:ref@marketplace".to_owned(),
    ]
}

/// `resolveAttachmentType`. Without a type, the `Err` is the
/// `PluginAttachmentHintError` message; its hints are
/// [`attachment_type_required_hints`].
pub fn resolve_attachment_type(selector: &str, explicit_type: Option<&str>) -> Result<String> {
    let parsed = parse_resource_selector(selector);
    if let Some(t) = parsed.resource_type.as_deref() {
        return normalize_composition_type(t).ok_or_else(|| format!("Invalid --type: {t}"));
    }
    if let Some(t) = explicit_type.filter(|t| !t.is_empty()) {
        return normalize_composition_type(t).ok_or_else(|| format!("Invalid --type: {t}"));
    }
    Err(format!(
        "Attachment type required for selector \"{selector}\""
    ))
}

/// `validatePluginAttachmentType`.
pub fn validate_plugin_attachment_type(resource_type: Option<&str>) -> Result<Option<String>> {
    let Some(t) = resource_type.filter(|t| !t.is_empty()) else {
        return Ok(None);
    };
    if t == "plugin" || t == "plugin_pin" {
        return Ok(Some("plugin".into()));
    }
    if !plugin_attachment_types().contains(&t) {
        return Err(format!(
            "Invalid --type. Valid: {}",
            plugin_attachment_types().join(", ")
        ));
    }
    Ok(Some(t.to_owned()))
}

fn format_ambiguous_resource_message(selector: &str, matches: &[Resource]) -> String {
    let mut lines = vec![format!("Ambiguous resource name: {selector}")];
    for m in matches {
        let pad = 14usize.saturating_sub(emit_rs::js::utf16_len(&m.resource_type));
        lines.push(format!(
            "  {} {}{} {}",
            m.id,
            m.resource_type,
            " ".repeat(pad),
            m.name
        ));
    }
    lines.join("\n")
}

fn resolve_typed_resource(ctx: &Ctx, selector: &str, resource_type: &str) -> Result<Resource> {
    match resolve_resource(ctx, selector, ResolveMode::Compose)? {
        ResourceLookup::NotFound => Err(format!("Resource not found: {selector}")),
        ResourceLookup::Ambiguous { matches } => {
            Err(format_ambiguous_resource_message(selector, &matches))
        }
        ResourceLookup::Found { resource } if resource.resource_type != resource_type => {
            Err(format!(
                "Type mismatch: selector \"{selector}\" resolved to {}, expected {resource_type}",
                resource.resource_type
            ))
        }
        ResourceLookup::Found { resource } => Ok(*resource),
    }
}

fn normalize_attachment_selector(selector: &str, explicit_type: Option<&str>) -> String {
    if selector.contains(':') {
        return selector.to_owned();
    }
    match explicit_type.filter(|t| !t.is_empty()) {
        Some("plugin" | "plugin_pin") => format!("plugin:{selector}"),
        Some(t) if MATERIAL_RESOURCE_TYPES.contains(&t) => selector.to_owned(),
        Some(t) => format!("{t}:{selector}"),
        None => selector.to_owned(),
    }
}

/// `escapingMarketplaceSourceWarning` (`marketplace-catalog-parse.ts`).
pub fn escaping_marketplace_source_warning(plugin_name: &str) -> String {
    format!("Skipped {plugin_name}: source path leaves the marketplace repository.")
}

/// A skipped `../` marketplace entry must not become a pin.
fn assert_marketplace_source_stays_in_repo(
    ctx: &Ctx,
    host: &dyn CompositionHost,
    reference: &str,
) -> Result<()> {
    let parsed = parse_dependency_ref(reference);
    if parsed.source_kind != "marketplace" {
        return Ok(());
    }
    let dir = db_rs::paths::harnesstap_dir(ctx.env);
    let warning = escaping_marketplace_source_warning(&parsed.name);
    if !host
        .marketplace_catalog_warnings(&dir, &parsed.namespace)?
        .contains(&warning)
    {
        return Ok(());
    }
    if host
        .catalog_plugin_names(&dir, &parsed.namespace)?
        .contains(&parsed.name)
    {
        return Ok(());
    }
    Err(format!(
        "Cannot attach {}: source path leaves the marketplace repository.",
        parsed.origin_ref
    ))
}

/// `findMarketplacePluginNameCollision` (`upstream-plugin.ts`): the ref
/// already holding the name when `reference` comes from another marketplace
/// and that pin still exists.
pub fn find_marketplace_plugin_name_collision(
    ctx: &Ctx,
    reference: &str,
) -> Result<Option<String>> {
    let (name, marketplace) = claude_pins::parse_plugin_ref(reference);
    if marketplace.is_empty() {
        return Ok(None);
    }
    for version in list_plugin_versions(ctx, name)? {
        let Some(plugin) = get_plugin_by_name(ctx, name, Some(&version))? else {
            continue;
        };
        let Some(locator) = plugin.origin_locator.as_deref().filter(|l| !l.is_empty()) else {
            continue;
        };
        if get_plugin_origin(ctx, &plugin.id)? != "upstream" {
            continue;
        }
        let (held_name, held_marketplace) = claude_pins::parse_plugin_ref(locator);
        if held_name == name && held_marketplace == marketplace {
            continue;
        }
        let exists = ctx
            .db
            .conn
            .query_row(
                "SELECT 1 AS found FROM resources WHERE type = 'plugin' AND origin_ref = ? LIMIT 1",
                [locator],
                |_| Ok(()),
            )
            .map(|()| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                e => Err(e.to_string()),
            })?;
        if exists {
            return Ok(Some(locator.to_owned()));
        }
    }
    Ok(None)
}

/// `assertNoMarketplacePluginNameCollision`.
pub fn assert_no_marketplace_plugin_name_collision(ctx: &Ctx, reference: &str) -> Result<()> {
    let Some(held_by) = find_marketplace_plugin_name_collision(ctx, reference)? else {
        return Ok(());
    };
    let (name, _) = claude_pins::parse_plugin_ref(reference);
    Err(format!(
        "{reference} and {held_by} are both named \"{name}\". HarnessTap keeps one plugin per name, so {reference} was not added and {held_by} is unchanged. Delete {held_by} from the library first to use {reference}."
    ))
}

/// `AddPluginAttachmentInput`.
#[derive(Debug, Clone, Default)]
pub struct AddAttachment<'a> {
    pub selector: &'a str,
    pub resource_type: Option<&'a str>,
    pub version: Option<&'a str>,
    pub embed: bool,
    pub sync: bool,
}

/// `addPluginAttachment`: the message it prints.
pub fn add_plugin_attachment(
    ctx: &Ctx,
    host: &dyn CompositionHost,
    plugin: &Plugin,
    input: &AddAttachment,
) -> Result<String> {
    let selector = normalize_attachment_selector(input.selector, input.resource_type);
    let attachment_type = resolve_attachment_type(&selector, input.resource_type)?;
    let version = input.version.filter(|v| !v.is_empty());

    if attachment_type == "plugin" {
        let reference = strip_type_prefix(&selector);
        assert_marketplace_source_stays_in_repo(ctx, host, reference)?;
        if parse_dependency_ref(reference).source_kind == "marketplace" {
            assert_no_marketplace_plugin_name_collision(
                ctx,
                &parse_dependency_ref(reference).origin_ref,
            )?;
        }
    }

    mark_plugin_dirty(ctx, &plugin.id)?;

    if attachment_type == "plugin" {
        let reference = strip_type_prefix(&selector);
        if let Some(v) = version {
            if parse_dependency_ref(reference).source_kind == "git" {
                parse_git_dependency_constraint(Some(v))?;
            } else {
                resolve_rs::plugin_constraints::parse_version_constraint(v)?;
            }
        }
        let resource = add_dependency(
            ctx,
            &plugin.id,
            reference,
            &AddDependencyOptions {
                version_constraint: version,
                embed_on_export: input.embed,
                mark_dirty: None,
            },
        )?;
        let display_ref = format_plugin_ref(&resource);
        if let Some(v) = version {
            sync_claude_marketplace_plugins_after_add(ctx, plugin, &display_ref, v)?;
        }
        if input.sync {
            if parse_dependency_ref(&display_ref).source_kind == "marketplace" {
                // Sync still runs when the install fails; missing trees stay stale.
                let _ = host.install_marketplace_pin_into_cache(
                    &display_ref,
                    version.unwrap_or("latest"),
                    &resolve_home_root(ctx.env),
                );
            }
            host.sync_plugin_resource(ctx, &resource)?;
        }
        let label = version.map_or_else(String::new, |v| format!(" ({v})"));
        return Ok(format!(
            "Attached plugin {display_ref}{label} to plugin {}",
            plugin.name
        ));
    }

    if version.is_some() {
        return Err("--version is only supported for plugin attachments".into());
    }
    if input.embed {
        return Err("--embed is only supported for plugin attachments".into());
    }
    if input.sync {
        return Err("--sync is only supported for plugin attachments".into());
    }
    let resource = resolve_typed_resource(ctx, &selector, &attachment_type)?;
    add_resource_to_plugin(ctx, &plugin.id, &resource.id, None)?;
    Ok(format!(
        "Added {} \"{}\" to plugin {}",
        resource.resource_type, resource.name, plugin.name
    ))
}

/// `removePluginAttachment`: `(message, removed)`.
pub fn remove_plugin_attachment(
    ctx: &Ctx,
    plugin: &Plugin,
    selector: &str,
    resource_type: Option<&str>,
) -> Result<(String, bool)> {
    let selector = normalize_attachment_selector(selector, resource_type);
    let attachment_type = resolve_attachment_type(&selector, resource_type)?;

    if attachment_type == "plugin" {
        let reference = strip_type_prefix(&selector);
        let name = parse_dependency_ref(reference).name;
        let pin = list_attached_plugin_pins(ctx, &plugin.id)?
            .into_iter()
            .find(|p| p.reference == reference || p.resource.resource.name == name);
        let Some(pin) = pin else {
            return Ok((
                format!(
                    "Plugin dependency \"{reference}\" not found on plugin {}",
                    plugin.name
                ),
                false,
            ));
        };
        remove_dependency(ctx, &plugin.id, &pin.reference)?;
        sync_claude_marketplace_plugins_after_remove(ctx, plugin, &pin.reference)?;
        return Ok((
            format!(
                "Removed plugin {} from plugin {}",
                pin.reference, plugin.name
            ),
            true,
        ));
    }

    let resource = resolve_typed_resource(ctx, &selector, &attachment_type)?;
    mark_plugin_dirty(ctx, &plugin.id)?;
    remove_resource_from_plugin(ctx, &plugin.id, &resource.id)?;
    Ok((
        format!(
            "Removed {} \"{}\" from plugin {}",
            resource.resource_type, resource.name, plugin.name
        ),
        true,
    ))
}
