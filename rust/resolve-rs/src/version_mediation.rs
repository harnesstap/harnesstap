//! Port of `src/services/resolve/version-mediation.ts`.

use crate::js_trim;
use crate::plugin_constraints::{VersionConstraint, parse_version_constraint};
use crate::types::{
    ConstraintRecord, DependencySourceKind, SelectionReason, UnsatisfiableConstraintError,
    UnsatisfiableInput,
};
use node_semver_rs::{self as semver, Options};

const ANY: &str = "*";

/// What `selectVersion` throws: `parseVersionConstraint`'s `Error`, or the unsatisfiable error.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MediationError {
    Constraint(String),
    Unsatisfiable(Box<UnsatisfiableConstraintError>),
}

impl std::fmt::Display for MediationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MediationError::Constraint(m) => f.write_str(m),
            MediationError::Unsatisfiable(e) => f.write_str(&e.message),
        }
    }
}

impl std::error::Error for MediationError {}

impl From<UnsatisfiableConstraintError> for MediationError {
    fn from(e: UnsatisfiableConstraintError) -> Self {
        MediationError::Unsatisfiable(Box::new(e))
    }
}

/// `normalizeConstraint`.
pub fn normalize_constraint(raw: &str) -> Result<String, String> {
    let trimmed = js_trim(raw);
    if trimmed.is_empty() || trimmed == ANY || trimmed == "latest" {
        return Ok(ANY.to_owned());
    }
    Ok(match parse_version_constraint(trimmed)? {
        VersionConstraint::Exact { version } => format!("={version}"),
        VersionConstraint::Range { range } => range,
    })
}

/// `intersectConstraints`.
pub fn intersect_constraints<S: AsRef<str>>(constraints: &[S]) -> Result<String, String> {
    let mut meaningful = Vec::new();
    for c in constraints {
        let n = normalize_constraint(c.as_ref())?;
        if n != ANY {
            meaningful.push(n);
        }
    }
    Ok(if meaningful.is_empty() {
        ANY.to_owned()
    } else {
        meaningful.join(" ")
    })
}

/// The argument of `selectVersion`.
#[derive(Clone, Debug, Default)]
pub struct SelectInput {
    pub name: String,
    pub available: Vec<String>,
    pub constraints: Vec<ConstraintRecord>,
    pub root_override: Option<String>,
    pub root_name: String,
    pub source_kind: Option<DependencySourceKind>,
    pub plugin_ref: Option<String>,
}

/// `selectVersion`: the version and why it won.
pub fn select_version(input: &SelectInput) -> Result<(String, SelectionReason), MediationError> {
    let mut sorted: Vec<String> = input
        .available
        .iter()
        .filter(|v| semver::valid(v.as_str(), Options::STRICT).is_some())
        .cloned()
        .collect();
    semver::sort_rcompare(&mut sorted).map_err(MediationError::Constraint)?;
    let non_semver: Vec<String> = input
        .available
        .iter()
        .filter(|v| semver::valid(v.as_str(), Options::STRICT).is_none() && *v != "unknown")
        .cloned()
        .collect();
    let available_for_errors = if sorted.is_empty() {
        non_semver.clone()
    } else {
        sorted.clone()
    };
    // `...(input.sourceKind ? ...)` and `...(input.pluginRef ? ...)`.
    let plugin_ref = input.plugin_ref.clone().filter(|r| !r.is_empty());

    if let Some(root_override) = input.root_override.as_deref().filter(|o| !o.is_empty()) {
        if !input.available.iter().any(|v| v == root_override) {
            return Err(UnsatisfiableConstraintError::new(UnsatisfiableInput {
                plugin_name: input.name.clone(),
                requirers: vec![ConstraintRecord {
                    constraint: format!("={root_override}"),
                    declared: None,
                    path: vec![input.root_name.clone()],
                    requirer: format!("{} (override)", input.root_name),
                }],
                available: available_for_errors,
                root_name: input.root_name.clone(),
                source_kind: input.source_kind,
                plugin_ref,
                root_override: Some(root_override.to_owned()),
            })
            .into());
        }
        return Ok((root_override.to_owned(), SelectionReason::RootOverride));
    }

    let mut root_declared = Vec::new();
    for record in &input.constraints {
        if record.path.len() == 1
            && normalize_constraint(&record.constraint).map_err(MediationError::Constraint)? != ANY
        {
            root_declared.push(record);
        }
    }
    let effective: Vec<&ConstraintRecord> = if root_declared.is_empty() {
        input.constraints.iter().collect()
    } else {
        root_declared.clone()
    };
    let range = intersect_constraints(
        &effective
            .iter()
            .map(|r| r.constraint.as_str())
            .collect::<Vec<_>>(),
    )
    .map_err(MediationError::Constraint)?;
    let reason = if root_declared.is_empty() {
        SelectionReason::Mediation
    } else {
        SelectionReason::RootConstraint
    };

    let winner = sorted
        .iter()
        .find(|v| semver::satisfies(v.as_str(), &range, Options::INCLUDE_PRERELEASE));
    let Some(winner) = winner else {
        // `(range === ANY ? nonSemver[0] : undefined) ?? (marketplace ? (sorted[0] ?? nonSemver[0]) : undefined)`
        let fallback = (if range == ANY {
            non_semver.first()
        } else {
            None
        })
        .or_else(|| {
            if input.source_kind == Some(DependencySourceKind::Marketplace) {
                sorted.first().or_else(|| non_semver.first())
            } else {
                None
            }
        });
        if let Some(fallback) = fallback.filter(|f| !f.is_empty()) {
            return Ok((fallback.clone(), reason));
        }
        return Err(UnsatisfiableConstraintError::new(UnsatisfiableInput {
            plugin_name: input.name.clone(),
            requirers: input.constraints.clone(),
            available: available_for_errors,
            root_name: input.root_name.clone(),
            source_kind: input.source_kind,
            plugin_ref,
            root_override: None,
        })
        .into());
    };
    Ok((winner.clone(), reason))
}
