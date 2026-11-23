//! The constraint records and `UnsatisfiableConstraintError` from `src/services/resolve/types.ts`.

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

/// `RecoveryAction`, the variants an unsatisfiable constraint produces. (`override-resource` and
/// `tag-as-profile` belong to singleton conflicts and profiles, not ported yet.)
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

/// `hintForAction` for the variants above.
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
