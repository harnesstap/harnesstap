//! The port of `src/platforms/registry.ts`.
//!
//! The platform table itself is `data.rs`, written by `gen-data.py` from the
//! original's `getAllPlatforms()` (recorded by `tests/make-fixtures.ts`), so it
//! cannot drift from `registry.ts` without the fixture test failing.

mod data;

use serde::Serialize;

/// `PlatformPaths["pathAlternates"]`: other on-disk paths checked during
/// detection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct PathAlternates {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commands: Option<&'static [&'static str]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agents: Option<&'static [&'static str]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules: Option<&'static [&'static str]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<&'static [&'static str]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<&'static [&'static str]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<&'static [&'static str]>,
}

/// `PlatformPaths`: project paths are relative to the project root, global
/// paths start with `~/`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct PlatformPaths {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_instructions: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_rules: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hooks: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agents: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commands: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugins: Option<&'static str>,
    #[serde(rename = "pathAlternates", skip_serializing_if = "Option::is_none")]
    pub path_alternates: Option<PathAlternates>,
}

/// `HostManagedPaths`: app-owned paths, for inventory only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct HostManagedPaths {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<&'static str>,
}

/// `RelatedPlatformLocation`: another tree this harness reads, for inventory only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct RelatedLocation {
    pub path: &'static str,
    pub surfaces: &'static [&'static str],
}

/// `detectionPaths`: distinctive paths used only for detection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct DetectionPaths {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<&'static [&'static str]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub global: Option<&'static [&'static str]>,
}

/// `PlatformDefinition`. `supports` keeps the original `Set`'s insertion order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PlatformDefinition {
    pub id: &'static str,
    pub name: &'static str,
    pub supports: &'static [&'static str],
    #[serde(rename = "projectPaths")]
    pub project_paths: PlatformPaths,
    #[serde(rename = "globalPaths")]
    pub global_paths: PlatformPaths,
    /// `instruction-only` when skills are emitted as rules or instructions.
    #[serde(rename = "skillEmission", skip_serializing_if = "Option::is_none")]
    pub skill_emission: Option<&'static str>,
    #[serde(rename = "hostManagedPaths", skip_serializing_if = "Option::is_none")]
    pub host_managed_paths: Option<HostManagedPaths>,
    #[serde(rename = "relatedLocations", skip_serializing_if = "Option::is_none")]
    pub related_locations: Option<&'static [RelatedLocation]>,
    #[serde(rename = "hostPluginRuntimeModules", skip_serializing_if = "is_false")]
    pub host_plugin_runtime_modules: bool,
    #[serde(rename = "detectionPaths", skip_serializing_if = "Option::is_none")]
    pub detection_paths: Option<DetectionPaths>,
}

fn is_false(b: &bool) -> bool {
    !b
}

impl PlatformDefinition {
    /// `supports.has(feature)`.
    pub fn supports(&self, feature: &str) -> bool {
        self.supports.contains(&feature)
    }
}

/// `getPlatform`.
pub fn get_platform(id: &str) -> Option<&'static PlatformDefinition> {
    data::PLATFORMS.iter().find(|p| p.id == id)
}

/// `getAllPlatforms`, in registry order.
pub fn get_all_platforms() -> &'static [PlatformDefinition] {
    data::PLATFORMS
}

/// `getPlatformIds`, in registry order.
pub fn get_platform_ids() -> Vec<&'static str> {
    data::PLATFORMS.iter().map(|p| p.id).collect()
}

/// `detectPlatforms`: a stub in the original too (the scanner detects).
pub fn detect_platforms(_project_root: &str) -> Vec<&'static str> {
    Vec::new()
}

/// `ResourceClass`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceClass {
    /// Keyed by distinct names: an equal-depth collision warns.
    Set,
    /// One per scope: an equal-depth collision is an error.
    Singleton,
}

/// `RESOURCE_CLASSES`, in the original's key order.
pub const RESOURCE_CLASSES: [(&str, ResourceClass); 10] = [
    ("skill", ResourceClass::Set),
    ("rule", ResourceClass::Set),
    ("agent", ResourceClass::Set),
    ("command", ResourceClass::Set),
    ("hook", ResourceClass::Set),
    ("mcp_server", ResourceClass::Set),
    ("instruction", ResourceClass::Singleton),
    ("model_config", ResourceClass::Singleton),
    ("permission", ResourceClass::Singleton),
    ("env_var", ResourceClass::Singleton),
];

/// `resourceClass` for a material resource type.
pub fn resource_class(resource_type: &str) -> Option<ResourceClass> {
    RESOURCE_CLASSES
        .iter()
        .find(|(t, _)| *t == resource_type)
        .map(|(_, c)| *c)
}
