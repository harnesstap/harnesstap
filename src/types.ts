// ── Resource types (superset of all platform features) ──────────────────

export const RESOURCE_TYPES = [
  "instruction",
  "skill",
  "rule",
  "mcp_server",
  "permission",
  "hook",
  "agent",
  "command",
  "env_var",
  "model_config",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

// ── Type-specific metadata shapes ───────────────────────────────────────

export interface RuleMetadata {
  globs: string[];
  always_apply: boolean;
}

export interface SkillMetadata {
  scripts?: string[];
  references?: string[];
}

export interface McpServerMetadata {
  transport: "stdio" | "http";
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface PermissionMetadata {
  action: "allow" | "deny" | "ask";
  pattern: string;
}

export interface HookMetadata {
  event: string;
  script: string;
}

export interface AgentMetadata {
  model?: string;
  reasoning_effort?: string;
  sandbox_mode?: string;
}

export interface EnvVarMetadata {
  key: string;
  value: string;
}

export interface ModelConfigMetadata {
  model: string;
  provider?: string;
}

export type ResourceMetadata =
  | RuleMetadata
  | SkillMetadata
  | McpServerMetadata
  | PermissionMetadata
  | HookMetadata
  | AgentMetadata
  | EnvVarMetadata
  | ModelConfigMetadata
  | Record<string, unknown>;

// ── Core entities ───────────────────────────────────────────────────────

export interface Resource {
  id: string;
  type: ResourceType;
  name: string;
  description: string;
  content: string;
  metadata: ResourceMetadata;
  source: string;
  created_at: string;
  updated_at: string;
}

/** Claude Code marketplace source (extraKnownMarketplaces entry). */
export interface ClaudeMarketplaceSource {
  source: string;
  repo?: string;
  url?: string;
  [key: string]: unknown;
}

export interface ClaudeMarketplaceEntry {
  source: ClaudeMarketplaceSource;
  autoUpdate?: boolean;
}

/** Plugin reference in a preset (plugin-name@marketplace-name). */
export interface ClaudePluginEntry {
  id: string;
  enabled?: boolean;
  /** Optional version pin for documentation and future install automation. */
  version?: string;
}

/** Claude Code plugin marketplace configuration carried by a preset. */
export interface ClaudePresetConfig {
  marketplaces?: Record<string, ClaudeMarketplaceEntry>;
  plugins?: ClaudePluginEntry[];
}

export interface Preset {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  claude?: ClaudePresetConfig;

  created_at: string;
  updated_at: string;
}

export interface PresetResource {
  preset_id: string;
  resource_id: string;
  order: number;
}

export interface PresetDependency {
  preset_id: string;
  dependency_name: string;
  version_constraint: string;
  order: number;
}

export interface Project {
  id: string;
  git_origin: string;
  name: string;
  local_path: string;
  created_at: string;
}

export interface ProjectPreset {
  project_id: string;
  preset_id: string;
  platforms: string[];
  applied_at: string;
}

export interface HarnessSelection {
  main_harness: string;
  alias_harnesses: string[];
}

export interface HarnessPreference extends HarnessSelection {
  updated_at: string;
}

export interface ProjectHarnessConfig extends HarnessSelection {
  project_id: string;
  materialization_strategy: "symlink-preferred" | "copy";
  updated_at: string;
}

export interface SnapshotState {
  presets: Preset[];
  resources: Resource[];
  platform_files: Record<string, Record<string, string>>;
}

export interface Snapshot {
  id: string;
  project_id: string;
  label: string;
  state: SnapshotState;
  created_at: string;
}

export const IMPORTED_SOURCE_KINDS = [
  "cursor-plugin",
  "claude-plugin",
  "marketplace",
] as const;

export type ImportedSourceKind = (typeof IMPORTED_SOURCE_KINDS)[number];

export type ImportedSnapshotMetadata = Record<string, unknown>;

export interface ImportedSnapshot {
  id: string;
  source_kind: ImportedSourceKind;
  source_label: string;
  plugin_name: string;
  plugin_version?: string;
  resource_ids: string[];
  metadata: ImportedSnapshotMetadata;
  created_at: string;
}

export interface ImportedSnapshotInstall {
  snapshot_id: string;
  platform_id: string;
  files: string[];
  installed_at: string;
}

// ── Platform definitions ────────────────────────────────────────────────

export const PLATFORM_FEATURES = [
  "instructions",
  "skills",
  "rules",
  "mcp",
  "permissions",
  "hooks",
  "agents",
  "commands",
  "env_vars",
  "model_config",
] as const;

export type PlatformFeature = (typeof PLATFORM_FEATURES)[number];

export interface PlatformPaths {
  instructions?: string;
  skills?: string;
  rules?: string;
  mcp?: string;
  permissions?: string;
  hooks?: string;
  agents?: string;
  commands?: string;
  settings?: string;
}

export interface PlatformDefinition {
  id: string;
  name: string;
  supports: Set<PlatformFeature>;
  projectPaths: PlatformPaths;
  globalPaths: PlatformPaths;
}

// ── Export/import bundle ────────────────────────────────────────────────

export const BUNDLE_SCHEMA = "urn:harnessdeck:bundle:v1" as const;
export const BUNDLE_VERSION = 1 as const;

export type ExportBundlePreset = Omit<Preset, "id" | "created_at" | "updated_at">;

export type ExportBundleResource = Omit<
  Resource,
  "id" | "created_at" | "updated_at" | "source"
>;

export type ExportBundleDependency = Omit<PresetDependency, "preset_id">;

export interface ExportBundlePresetEntry extends ExportBundlePreset {
  name: string;
  version: string;
  description: string;
  tags: string[];
  resources: ExportBundleResource[];
  /** Claude Code marketplace and plugin configuration for this preset. */
  claude?: ClaudePresetConfig;
  /** Preset plugin pins (marketplace refs, not inlined in the bundle file). */
  plugins: ExportBundlePresetPluginPin[];
  /** Embedded plugin refs used by this preset; payload lives at bundle root. */
  embedded_plugin_refs?: string[];
  /** Preset composition dependencies (name + version constraint). */
  dependencies?: ExportBundleDependency[];
}

export interface LegacyExportBundle {
  $schema: typeof BUNDLE_SCHEMA;
  version: typeof BUNDLE_VERSION;
  preset: ExportBundlePreset;
  resources: ExportBundleResource[];
  /** Claude Code marketplace and plugin configuration for this preset. */
  claude?: ClaudePresetConfig;
  /** Preset plugin pins (marketplace refs, not inlined in the bundle file). */
  plugins: ExportBundlePresetPluginPin[];
  /** Preset composition dependencies (name + version constraint). */
  dependencies?: ExportBundleDependency[];
  /** Plugin trees inlined in the bundle file. */
  embedded_plugins: ExportBundleEmbeddedPlugin[];
}

export interface MultiPresetExportBundle {
  $schema: typeof BUNDLE_SCHEMA;
  version: typeof BUNDLE_VERSION;
  presets: ExportBundlePresetEntry[];
  /** Plugin trees inlined in the bundle file and shared by bundle presets. */
  embedded_plugins: ExportBundleEmbeddedPlugin[];
}

export type ExportBundle = LegacyExportBundle | MultiPresetExportBundle;

/** Plugin pin carried in bundles (non-embedded). */
export interface ExportBundlePresetPluginPin {
  ref: string;
  version_constraint: string;
}

/** Plugin tree inlined in bundles. */
export interface ExportBundleEmbeddedPlugin {
  ref: string;
  version_constraint: string;
  /** Logical directory key for imports that are not `./...` project-relative refs. */
  root: string;
  /** Paths relative to the plugin root, POSIX-style separators. */
  files: Record<string, string>;
}

// ── Serializer interface ────────────────────────────────────────────────

export interface SerializedFile {
  path: string;
  content: string;
}

export interface PlatformSerializer {
  readonly platformId: string;

  /** Scan a project directory and return discovered resources. */
  scan(projectRoot: string): Promise<Resource[]>;

  /** Scan platform defaults from the user home directory when supported. */
  scanGlobal?(homeRoot: string): Promise<Resource[]>;

  /** Serialize canonical resources into platform-specific files. */
  serialize(
    resources: Resource[],
    projectRoot: string,
  ): Promise<SerializedFile[]>;
}
