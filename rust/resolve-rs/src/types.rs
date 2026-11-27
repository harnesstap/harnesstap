//! The constraint records, `UnsatisfiableConstraintError` and resolution result types from
//! `src/services/resolve/types.ts`.

use serde::{Deserialize, Serialize};

/// `DependencySourceKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DependencySourceKind {
    Local,
    Marketplace,
    Git,
    Catalog,
}

/// `ConstraintRecord`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConstraintRecord {
    pub constraint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declared: Option<String>,
    pub path: Vec<String>,
    pub requirer: String,
}

/// `SelectionReason`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SelectionReason {
    Root,
    RootOverride,
    RootConstraint,
    Mediation,
    Locked,
}

/// `UnsatisfiableReason`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnsatisfiableReason {
    MissingInventory,
    ConstraintConflict,
    OverrideMissing,
}

/// `RecoveryAction`, the variants unsatisfiable constraints and singleton conflicts produce.
/// (`tag-as-profile` belongs to profiles, not ported yet.)
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "id", rename_all = "kebab-case")]
pub enum RecoveryAction {
    #[serde(rename_all = "camelCase")]
    SyncInstall {
        label: String,
        plugin_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source_kind: Option<DependencySourceKind>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        root_name: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    CreatePlugin { label: String, plugin_name: String },
    #[serde(rename_all = "camelCase")]
    OverrideVersion {
        label: String,
        plugin_name: String,
        versions: Vec<String>,
        root_name: String,
    },
    #[serde(rename_all = "camelCase")]
    OverrideResource {
        label: String,
        root_name: String,
        key: String,
        winner_plugin_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        winner_resource_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        namespace: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fingerprint: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        preview: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    DetachDependency {
        label: String,
        root_name: String,
        plugin_name: String,
    },
    #[serde(rename_all = "camelCase")]
    ClearOverride {
        label: String,
        root_name: String,
        plugin_name: String,
    },
}

impl RecoveryAction {
    pub fn label(&self) -> &str {
        match self {
            RecoveryAction::SyncInstall { label, .. }
            | RecoveryAction::CreatePlugin { label, .. }
            | RecoveryAction::OverrideVersion { label, .. }
            | RecoveryAction::OverrideResource { label, .. }
            | RecoveryAction::DetachDependency { label, .. }
            | RecoveryAction::ClearOverride { label, .. } => label,
        }
    }
}

/// `displayConstraint`: the declared git ref, else the range.
pub fn display_constraint(constraint: &str, declared: Option<&str>) -> String {
    match declared {
        Some(d) if !d.is_empty() => d.to_owned(),
        _ if constraint.is_empty() => "*".to_owned(),
        _ => constraint.to_owned(),
    }
}

fn display(record: &ConstraintRecord) -> String {
    display_constraint(&record.constraint, record.declared.as_deref())
}

/// The constructor input of `UnsatisfiableConstraintError`. `None` and `Some("")` differ only
/// where the TypeScript tests presence, which it never does for these strings.
#[derive(Clone, Debug, Default)]
pub struct UnsatisfiableInput {
    pub plugin_name: String,
    pub requirers: Vec<ConstraintRecord>,
    pub available: Vec<String>,
    pub root_name: String,
    pub source_kind: Option<DependencySourceKind>,
    pub plugin_ref: Option<String>,
    pub root_override: Option<String>,
}

/// `UnsatisfiableConstraintError`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsatisfiableConstraintError {
    pub name: &'static str,
    pub message: String,
    pub plugin_name: String,
    pub requirers: Vec<ConstraintRecord>,
    pub available: Vec<String>,
    pub reason: UnsatisfiableReason,
    pub actions: Vec<RecoveryAction>,
    pub hints: Vec<String>,
}

impl std::fmt::Display for UnsatisfiableConstraintError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for UnsatisfiableConstraintError {}

impl UnsatisfiableConstraintError {
    pub fn new(input: UnsatisfiableInput) -> Self {
        let (reason, message, actions) = build_unsatisfiable(&input);
        let hints = actions.iter().map(hint_for_action).collect();
        UnsatisfiableConstraintError {
            name: "UnsatisfiableConstraintError",
            message,
            plugin_name: input.plugin_name,
            requirers: input.requirers,
            available: input.available,
            reason,
            actions,
            hints,
        }
    }
}

/// `pluginRef?.trim()`, when not empty.
fn trimmed_ref(plugin_ref: Option<&str>) -> Option<&str> {
    plugin_ref.map(crate::js_trim).filter(|r| !r.is_empty())
}

fn marketplace_sync_command(plugin_name: &str, plugin_ref: Option<&str>) -> String {
    let selector = trimmed_ref(plugin_ref).unwrap_or(plugin_name);
    if selector.starts_with("plugin:") {
        format!("ht resource sync {selector}")
    } else {
        format!("ht resource sync plugin:{selector}")
    }
}

fn git_fetch_action(
    plugin_name: &str,
    root_name: &str,
    plugin_ref: Option<&str>,
) -> RecoveryAction {
    let source = match trimmed_ref(plugin_ref) {
        Some(r) => format!(" from {r}"),
        None => " from git".to_owned(),
    };
    RecoveryAction::SyncInstall {
        label: format!("Apply {root_name} without --dry-run to fetch {plugin_name}{source}"),
        plugin_name: plugin_name.to_owned(),
        source_kind: Some(DependencySourceKind::Git),
        root_name: Some(root_name.to_owned()),
    }
}

fn build_unsatisfiable(
    input: &UnsatisfiableInput,
) -> (UnsatisfiableReason, String, Vec<RecoveryAction>) {
    let plugin_name = input.plugin_name.as_str();
    let root_name = input.root_name.as_str();
    let available = &input.available;
    let source_kind = input.source_kind;
    let plugin_ref = input.plugin_ref.as_deref();

    if let Some(root_override) = input.root_override.as_deref().filter(|o| !o.is_empty())
        && !available.iter().any(|v| v == root_override)
    {
        let mut actions = Vec::new();
        if !available.is_empty() {
            actions.push(RecoveryAction::OverrideVersion {
                label: format!("Pick an installed version of {plugin_name}"),
                plugin_name: plugin_name.to_owned(),
                versions: available.clone(),
                root_name: root_name.to_owned(),
            });
        } else if source_kind == Some(DependencySourceKind::Git) {
            actions.push(git_fetch_action(plugin_name, root_name, plugin_ref));
        } else if let Some(
            kind @ (DependencySourceKind::Marketplace | DependencySourceKind::Catalog),
        ) = source_kind
        {
            actions.push(RecoveryAction::SyncInstall {
                label: if kind == DependencySourceKind::Marketplace {
                    marketplace_sync_command(plugin_name, plugin_ref)
                } else {
                    format!("Pull {plugin_name} from catalog")
                },
                plugin_name: plugin_name.to_owned(),
                source_kind: Some(kind),
                root_name: None,
            });
        }
        actions.push(RecoveryAction::ClearOverride {
            label: format!("Clear override for {plugin_name}"),
            root_name: root_name.to_owned(),
            plugin_name: plugin_name.to_owned(),
        });
        let message = [
            format!(
                "Override requests {plugin_name}@{root_override}, but that version is not installed."
            ),
            if available.is_empty() {
                "  available: (none)".to_owned()
            } else {
                format!("  available: {}", available.join(", "))
            },
            format!("  fix: {}", actions[0].label()),
        ]
        .join("\n");
        return (UnsatisfiableReason::OverrideMissing, message, actions);
    }

    if available.is_empty() {
        let install = match source_kind {
            Some(DependencySourceKind::Git) => git_fetch_action(plugin_name, root_name, plugin_ref),
            Some(kind @ (DependencySourceKind::Catalog | DependencySourceKind::Marketplace)) => {
                RecoveryAction::SyncInstall {
                    label: if kind == DependencySourceKind::Catalog {
                        format!("Pull {plugin_name} from catalog")
                    } else {
                        marketplace_sync_command(plugin_name, plugin_ref)
                    },
                    plugin_name: plugin_name.to_owned(),
                    source_kind: Some(kind),
                    root_name: None,
                }
            }
            _ => RecoveryAction::CreatePlugin {
                label: format!("Create {plugin_name}"),
                plugin_name: plugin_name.to_owned(),
            },
        };
        let mut lines = vec![format!("No local version of {plugin_name} is installed.")];
        for record in &input.requirers {
            lines.push(format!(
                "  required by: {} \u{2192} {plugin_name} {}",
                record.requirer,
                display(record)
            ));
        }
        lines.push(if source_kind == Some(DependencySourceKind::Git) {
            format!("  fix: {}", install.label())
        } else {
            format!("  fix: {}, then re-apply", install.label())
        });
        let actions = vec![
            install,
            RecoveryAction::DetachDependency {
                label: format!("Detach {plugin_name} from {root_name}"),
                root_name: root_name.to_owned(),
                plugin_name: plugin_name.to_owned(),
            },
        ];
        return (
            UnsatisfiableReason::MissingInventory,
            lines.join("\n"),
            actions,
        );
    }

    let actions = vec![
        RecoveryAction::OverrideVersion {
            label: format!("Override {plugin_name} to an available version"),
            plugin_name: plugin_name.to_owned(),
            versions: available.clone(),
            root_name: root_name.to_owned(),
        },
        RecoveryAction::DetachDependency {
            label: format!("Detach {plugin_name} from {root_name}"),
            root_name: root_name.to_owned(),
            plugin_name: plugin_name.to_owned(),
        },
    ];
    let mut lines = vec![format!(
        "No installed version of {plugin_name} satisfies the required constraints."
    )];
    for record in &input.requirers {
        lines.push(format!(
            "  {} \u{2192} {plugin_name} {}",
            record.requirer,
            display(record)
        ));
    }
    lines.push(format!("  available: {}", available.join(", ")));
    lines.push(format!(
        "  fix: override {plugin_name} to an available version, or detach a conflicting dependency"
    ));
    (
        UnsatisfiableReason::ConstraintConflict,
        lines.join("\n"),
        actions,
    )
}

/// `hintForAction`.
pub fn hint_for_action(action: &RecoveryAction) -> String {
    match action {
        RecoveryAction::SyncInstall {
            label,
            plugin_name,
            source_kind,
            root_name,
        } => match source_kind {
            Some(DependencySourceKind::Catalog) => format!("ht plugin pull {plugin_name}"),
            Some(DependencySourceKind::Git) => {
                format!("ht apply {}", root_name.as_deref().unwrap_or("<plugin>"))
            }
            Some(DependencySourceKind::Marketplace) => {
                if label.starts_with("ht resource sync ") {
                    label.clone()
                } else {
                    format!("ht resource sync plugin:{plugin_name}")
                }
            }
            _ => format!("ht plugin create {plugin_name}"),
        },
        RecoveryAction::CreatePlugin { plugin_name, .. } => {
            format!("ht plugin create {plugin_name}")
        }
        RecoveryAction::OverrideVersion {
            plugin_name,
            root_name,
            ..
        } => format!("ht plugin edit {root_name} --override plugin:{plugin_name}@<version>"),
        RecoveryAction::OverrideResource {
            root_name,
            key,
            winner_plugin_name,
            winner_resource_id,
            ..
        } => format!(
            "ht plugin edit {root_name} --override {key}={}",
            winner_resource_id.as_deref().unwrap_or(winner_plugin_name)
        ),
        RecoveryAction::DetachDependency {
            plugin_name,
            root_name,
            ..
        } => format!("ht plugin edit {root_name} --remove plugin:{plugin_name}"),
        RecoveryAction::ClearOverride {
            plugin_name,
            root_name,
            ..
        } => format!("ht plugin edit {root_name} --clear-override plugin:{plugin_name}"),
    }
}

/// `SelectedPlugin`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedPlugin {
    pub name: String,
    pub version: String,
    pub plugin_id: String,
    /// Root is 0; a direct dependency of the root is 1.
    pub depth: f64,
    pub declaration_index: f64,
    pub constraints: Vec<ConstraintRecord>,
    pub reason: SelectionReason,
    pub path: Vec<String>,
    pub source: DependencySourceKind,
}

/// `ResourceDecisionReason`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceDecisionReason {
    OnlyCandidate,
    NearestToRoot,
    IdenticalContent,
    DeclarationOrder,
    RootOverride,
}

/// `ResourceSide`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSide {
    pub plugin_name: String,
    pub plugin_version: String,
    pub depth: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

/// `ResourceDecision`: one `type:name` outcome.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResourceDecision {
    pub key: String,
    pub winner: ResourceSide,
    pub losers: Vec<ResourceSide>,
    pub reason: ResourceDecisionReason,
}

/// `ResolutionRoot`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionRoot {
    pub name: String,
    pub version: String,
    pub plugin_id: String,
    pub ephemeral: bool,
}

/// `ResolutionResult`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResolutionResult {
    pub root: ResolutionRoot,
    /// Root first (depth 0), then dependencies by depth, then declaration.
    pub selected: Vec<SelectedPlugin>,
    /// Winning material resources, one per resolution key, with their attachment's `order` and
    /// effective `harness_scope`.
    pub resources: Vec<models_rs::resource::AttachedResource>,
    pub decisions: Vec<ResourceDecision>,
    pub warnings: Vec<String>,
}

/// `CONFLICT_PREVIEW_LINES`.
pub const CONFLICT_PREVIEW_LINES: usize = 12;

/// `previewConflictContent`: the first lines of a conflicting copy.
pub fn preview_conflict_content(content: &str) -> String {
    let lines: Vec<&str> = content.split('\n').collect();
    if lines.len() <= CONFLICT_PREVIEW_LINES {
        return content.to_owned();
    }
    let mut kept = lines[..CONFLICT_PREVIEW_LINES].join("\n");
    kept.push_str(&format!("\n... ({} lines in content)", lines.len()));
    kept
}

/// The first `n` UTF-16 units, as `String.prototype.slice(0, n)`.
fn js_prefix(s: &str, n: usize) -> String {
    String::from_utf16_lossy(&s.encode_utf16().take(n).collect::<Vec<u16>>())
}

/// `new Set(values).size > 1`.
fn differ<'a>(mut values: impl Iterator<Item = &'a str>) -> bool {
    let first = values.next();
    values.any(|v| Some(v) != first)
}

fn conflict_side_parts(side: &ResourceSide, sides: &[ResourceSide]) -> Vec<String> {
    let plugin = format!("{}@{}", side.plugin_name, side.plugin_version);
    let same_plugin = !sides.is_empty()
        && sides
            .iter()
            .all(|o| o.plugin_name == side.plugin_name && o.plugin_version == side.plugin_version);
    let sources_differ = differ(sides.iter().map(|e| e.source.as_deref().unwrap_or("")));
    let namespaces_differ = differ(sides.iter().map(|e| e.namespace.as_deref().unwrap_or("")));
    let mut parts = Vec::new();
    if !same_plugin {
        parts.push(plugin.clone());
    }
    if let Some(source) = side.source.as_deref().map(crate::js_trim)
        && !source.is_empty()
        && (same_plugin || sources_differ)
    {
        parts.push(source.to_owned());
    }
    if let Some(namespace) = side.namespace.as_deref()
        && namespaces_differ
        && !crate::js_trim(namespace).is_empty()
    {
        parts.push(format!("@{namespace}"));
    }
    if let Some(fingerprint) = side.fingerprint.as_deref().filter(|f| !f.is_empty()) {
        parts.push(js_prefix(fingerprint, 7));
    }
    if parts.is_empty() {
        parts.push(plugin);
    }
    parts
}

/// `describeConflictSide`: a unique label for one singleton-conflict copy.
pub fn describe_conflict_side(side: &ResourceSide, sides: &[ResourceSide]) -> String {
    let base = conflict_side_parts(side, sides).join(" \u{b7} ");
    let collisions = sides
        .iter()
        .filter(|o| conflict_side_parts(o, sides).join(" \u{b7} ") == base)
        .count();
    match side.resource_id.as_deref().filter(|id| !id.is_empty()) {
        Some(id) if collisions > 1 => format!("{base} \u{b7} {}", js_prefix(id, 8)),
        _ => base,
    }
}

/// `overrideWinnerValue`: the plugin name, or the resource id when one plugin owns several copies.
pub fn override_winner_value(side: &ResourceSide, sides: &[ResourceSide]) -> String {
    let same_name = sides
        .iter()
        .filter(|o| o.plugin_name == side.plugin_name)
        .count()
        > 1;
    match side.resource_id.as_deref().filter(|id| !id.is_empty()) {
        Some(id) if same_name => id.to_owned(),
        _ => side.plugin_name.clone(),
    }
}

/// `SingletonConflictError`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SingletonConflictError {
    pub name: &'static str,
    pub message: String,
    pub key: String,
    pub sides: Vec<ResourceSide>,
    pub hints: Vec<String>,
    pub actions: Vec<RecoveryAction>,
}

impl std::fmt::Display for SingletonConflictError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SingletonConflictError {}

impl SingletonConflictError {
    pub fn new(key: &str, sides: Vec<ResourceSide>, root_name: &str) -> Self {
        let non_empty = |v: &Option<String>| v.clone().filter(|s| !s.is_empty());
        let actions: Vec<RecoveryAction> = sides
            .iter()
            .map(|side| {
                let value = override_winner_value(side, &sides);
                let winner_resource_id = if value != side.plugin_name {
                    Some(value)
                } else {
                    non_empty(&side.resource_id)
                };
                RecoveryAction::OverrideResource {
                    label: format!("Use {} for {key}", describe_conflict_side(side, &sides)),
                    root_name: root_name.to_owned(),
                    key: key.to_owned(),
                    winner_plugin_name: side.plugin_name.clone(),
                    winner_resource_id: winner_resource_id.filter(|s| !s.is_empty()),
                    source: non_empty(&side.source),
                    namespace: non_empty(&side.namespace),
                    fingerprint: non_empty(&side.fingerprint),
                    preview: non_empty(&side.preview),
                }
            })
            .collect();
        let mut lines = vec![format!("conflicting {key} at the same depth")];
        for side in &sides {
            let detail = describe_conflict_side(side, &sides);
            let plugin = format!("{}@{}", side.plugin_name, side.plugin_version);
            let suffix = if detail == plugin {
                String::new()
            } else {
                format!(" \u{b7} {detail}")
            };
            lines.push(format!("  {plugin} (depth {}){suffix}", side.depth));
        }
        lines.push(format!(
            "  fix: {}",
            actions
                .first()
                .map_or_else(|| format!("override {key}"), |a| a.label().to_owned())
        ));
        let hints = actions.iter().map(hint_for_action).collect();
        SingletonConflictError {
            name: "SingletonConflictError",
            message: lines.join("\n"),
            key: key.to_owned(),
            sides,
            hints,
            actions,
        }
    }
}

/// What `resolveComposition` and `walkDependencyGraph` throw.
#[derive(Clone, Debug, PartialEq)]
pub enum ResolveError {
    /// A plain `Error`, by its message.
    Message(String),
    Unsatisfiable(Box<UnsatisfiableConstraintError>),
    SingletonConflict(Box<SingletonConflictError>),
}

impl std::fmt::Display for ResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResolveError::Message(m) => f.write_str(m),
            ResolveError::Unsatisfiable(e) => f.write_str(&e.message),
            ResolveError::SingletonConflict(e) => f.write_str(&e.message),
        }
    }
}

impl std::error::Error for ResolveError {}

impl From<String> for ResolveError {
    fn from(message: String) -> Self {
        ResolveError::Message(message)
    }
}

impl From<UnsatisfiableConstraintError> for ResolveError {
    fn from(e: UnsatisfiableConstraintError) -> Self {
        ResolveError::Unsatisfiable(Box::new(e))
    }
}

impl From<crate::version_mediation::MediationError> for ResolveError {
    fn from(e: crate::version_mediation::MediationError) -> Self {
        match e {
            crate::version_mediation::MediationError::Constraint(m) => ResolveError::Message(m),
            crate::version_mediation::MediationError::Unsatisfiable(u) => {
                ResolveError::Unsatisfiable(u)
            }
        }
    }
}
