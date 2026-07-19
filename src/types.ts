// ── Resource types (superset of all platform features) ──────────────────

export const MATERIAL_RESOURCE_TYPES = [
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

export const COMPOSITION_RESOURCE_TYPES = ["plugin_pin", "layer"] as const;

export const RESOURCE_TYPES = [
  ...MATERIAL_RESOURCE_TYPES,
  ...COMPOSITION_RESOURCE_TYPES,
] as const;

/** Resource types shown in default `ht resource list` (excludes layer composition refs). */
export const LISTABLE_RESOURCE_TYPES = [
  ...MATERIAL_RESOURCE_TYPES,
  "plugin_pin",
] as const;

export type MaterialResourceType = (typeof MATERIAL_RESOURCE_TYPES)[number];
export type CompositionResourceType = (typeof COMPOSITION_RESOURCE_TYPES)[number];
export type ListableResourceType = (typeof LISTABLE_RESOURCE_TYPES)[number];
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const ORIGIN_KINDS = [
  "local_snapshot",
  "marketplace_link",
  "manual",
] as const;

export type OriginKind = (typeof ORIGIN_KINDS)[number];

// ── Type-specific metadata shapes ───────────────────────────────────────

export interface RuleMetadata {
  globs: string[];
  always_apply: boolean;
}

export interface SkillMetadata {
  scripts?: string[];
  references?: string[];
}

export interface McpOAuthAuthMetadata {
  CLIENT_ID?: string;
  CLIENT_SECRET?: string;
  scopes?: string[];
}

export interface McpServerMetadata {
  transport: "stdio" | "http";
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  connection_type?: string;
  env_file?: string;
  auth?: McpOAuthAuthMetadata;
}

export interface PermissionMetadata {
  action: "allow" | "deny" | "ask";
  pattern: string;
}

export interface HookMetadata {
  event: string;
  script: string;
  commandWindows?: string;
  timeout?: number;
  matcher?: string;
  hook_entry?: Record<string, unknown>;
}

export interface AgentMetadata {
  model?: string;
  reasoning_effort?: string;
  sandbox_mode?: string;
  readonly?: boolean;
  is_background?: boolean;
  extra?: Record<string, unknown>;
  wire_format?: "codex-toml" | "markdown-frontmatter" | "markdown-body";
}

export interface EnvVarMetadata {
  key: string;
  value: string;
}

export interface ModelConfigMetadata {
  model: string;
  provider?: string;
}

export interface PluginPinMetadata {
  source_kind?: "marketplace" | "local" | "git";
  marketplace_name?: string;
  version_constraint?: string;
  resolved_version?: string;
  sync_status?: "synced" | "stale" | "pinned" | "never_synced";
  portable?: "reference" | "embed";
  manifests?: {
    claude?: Record<string, unknown>;
    cursor?: Record<string, unknown>;
  };
}

export interface LayerResourceMetadata {
  version_constraint?: string;
  resolved_version?: string;
  resolved_layer_id?: string;
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
  | PluginPinMetadata
  | LayerResourceMetadata
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
  namespace: string;
  origin_kind: OriginKind;
  origin_ref: string;
  content_hash: string;
  content_blob_ref: string;
  created_at: string;
  updated_at: string;
}

export type ResourceCreateInput = Pick<
  Resource,
  "type" | "name" | "description" | "content" | "metadata" | "source"
> &
  Partial<
    Pick<
      Resource,
      "namespace" | "origin_kind" | "origin_ref" | "content_hash" | "content_blob_ref"
    >
  >;

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

/** Plugin reference in a layer (plugin-name@marketplace-name). */
export interface ClaudePluginEntry {
  id: string;
  enabled?: boolean;
  /** Optional version pin for documentation and future install automation. */
  version?: string;
}

/** Claude Code plugin marketplace configuration carried by a layer. */
export interface ClaudeLayerConfig {
  marketplaces?: Record<string, ClaudeMarketplaceEntry>;
  plugins?: ClaudePluginEntry[];
}

export interface Layer {
  id: string;
  name: string;
  version: string;
  org_slug: string;
  catalog_slug: string;
  description: string;
  tags: string[];
  claude?: ClaudeLayerConfig;
  /** Config contract keys this layer requires from an environment. */
  needs?: string[];
  default_environment_id?: string;
  created_at: string;
  updated_at: string;
}

export type EnvironmentSecretProvider = "keychain" | "env" | "file";

export interface Environment {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface EnvironmentResource {
  environment_id: string;
  resource_id: string;
  order: number;
}

export interface EnvironmentSecretRef {
  environment_id: string;
  key: string;
  provider: EnvironmentSecretProvider;
  ref: string;
}

export interface LayerResource {
  layer_id: string;
  resource_id: string;
  order: number;
}

export interface LayerDependency {
  layer_id: string;
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

export interface ProjectLayer {
  project_id: string;
  layer_id: string;
  platforms: string[];
  applied_at: string;
}

export const DECK_SCHEMA = "urn:harnesstap:deck:v1" as const;
export const DECK_JSON_VERSION = 1 as const;

export const PROJECT_SCHEMA = "urn:harnesstap:project:v1" as const;
export const PROJECT_SCHEMA_VERSION = 1 as const;

export const BUNDLE_SCHEMA = "urn:harnesstap:bundle:v1" as const;
export const BUNDLE_SCHEMA_VERSION = 1 as const;

export interface DeckJsonLayer {
  name: string;
  version: string;
  org?: string;
  catalog?: string;
  environment?: string;
}

export interface DeckJsonExportOptions {
  deckName?: string;
}

export type DeckJsonSecretProvider = "keychain" | "env" | "file";

export interface DeckJsonEnvironmentSecretRef {
  provider: DeckJsonSecretProvider;
  ref: string;
}

export interface DeckJsonEnvironment {
  name: string;
  values: Record<string, string>;
  secret_refs?: Record<string, DeckJsonEnvironmentSecretRef>;
}

export interface DeckJson {
  $schema: typeof DECK_SCHEMA;
  version: typeof DECK_JSON_VERSION;
  name: string;
  layers: DeckJsonLayer[];
  environments: DeckJsonEnvironment[];
  active_environment?: string;
}

export interface HarnessSelection {
  main_harness: string;
  alias_harnesses: string[];
}

export interface HarnessPreference extends HarnessSelection {
  updated_at: string;
}

export type CursorSkillMode = "agent-requested" | "always-on" | "agents-skills";

export interface ProjectHarnessConfig extends HarnessSelection {
  project_id: string;
  materialization_strategy: "symlink-preferred" | "copy";
  cursor_skill_mode?: CursorSkillMode;
  updated_at: string;
}

export interface SnapshotState {
  layers: Layer[];
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
  "codex-plugin",
  "copilot-plugin",
  "goose-plugin",
  "marketplace",
  "skill-package",
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

export interface GlobalApplySnapshot {
  id: string;
  profile_name: string;
  layer_ids: string[];
  created_at: string;
}

export interface GlobalApplySnapshotInstall {
  snapshot_id: string;
  platform_id: string;
  files: string[];
  installed_at: string;
}

export interface ImportedResourceProvenance {
  source_kind: ImportedSourceKind;
  source_label: string;
  plugin_name: string;
  plugin_version?: string;
  source_plugin_kind: Exclude<ImportedSourceKind, "marketplace">;
  relative_path: string;
  imported_at: string;
}

export interface PluginSourceScanResult {
  source_kind: ImportedSourceKind;
  source_label: string;
  plugin_name: string;
  plugin_version?: string;
  metadata: ImportedSnapshotMetadata;
  resources: ResourceCreateInput[];
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
  legacy_instructions?: string;
  skills?: string;
  rules?: string;
  /** Single-file rules path when the primary `rules` path is a directory. */
  legacy_rules?: string;
  mcp?: string;
  permissions?: string;
  hooks?: string;
  agents?: string;
  commands?: string;
  settings?: string;
  /** Alternate on-disk paths checked during platform detection. */
  pathAlternates?: Partial<{
    commands: string[];
    rules: string[];
    instructions: string[];
    skills: string[];
  }>;
}

export type SkillEmission = "native" | "instruction-only";

export interface PlatformDefinition {
  id: string;
  name: string;
  supports: Set<PlatformFeature>;
  projectPaths: PlatformPaths;
  globalPaths: PlatformPaths;
  /** When "instruction-only", skills are emitted as rules/instructions instead of native skill dirs. */
  skillEmission?: SkillEmission;
}

// ── Layer export format ─────────────────────────────────────────────────

export const LAYER_SCHEMA = "urn:harnesstap:layer:v1" as const;
export const LAYER_SCHEMA_VERSION = 1 as const;

export type LayerExportLayer = Omit<
  Layer,
  "id" | "created_at" | "updated_at" | "org_slug" | "catalog_slug" | "default_environment_id"
>;

export type LayerExportResource = Omit<
  Resource,
  "id" | "created_at" | "updated_at" | "source"
>;

export type LayerExportDependency = Omit<LayerDependency, "layer_id">;

export interface LayerExportEntry extends LayerExportLayer {
  name: string;
  version: string;
  description: string;
  tags: string[];
  resources: LayerExportResource[];
  /** Claude Code marketplace and plugin configuration for this layer. */
  claude?: ClaudeLayerConfig;
  /** Host plugin pins (marketplace refs, not inlined in the export file). */
  plugin_pins: LayerExportPluginPin[];
  /** Embedded plugin refs used by this layer; payload lives at export root. */
  embedded_plugin_refs?: string[];
  /** Layer composition dependencies (name + version constraint). */
  dependencies?: LayerExportDependency[];
}

export interface MultiLayerExport {
  $schema: typeof LAYER_SCHEMA;
  version: typeof LAYER_SCHEMA_VERSION;
  layers: LayerExportEntry[];
  /** Plugin trees inlined in the export file and shared by exported layers. */
  embedded_plugins: LayerExportEmbeddedPlugin[];
}

export type LayerExport = MultiLayerExport;

// ── Resource export format ──────────────────────────────────────────────

export const RESOURCE_SCHEMA = "urn:harnesstap:resource:v1" as const;
export const RESOURCE_SCHEMA_VERSION = 1 as const;

export type ResourceExportPayload = Omit<
  Resource,
  "id" | "created_at" | "updated_at" | "source"
>;

export interface ResourceExport extends ResourceExportPayload {
  $schema: typeof RESOURCE_SCHEMA;
  version: typeof RESOURCE_SCHEMA_VERSION;
}

/** Plugin pin carried in layer exports (non-embedded). */
export interface LayerExportPluginPin {
  ref: string;
  version_constraint: string;
}

/** Plugin tree inlined in layer exports. */
export interface LayerExportEmbeddedPlugin {
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

export type SerializerTarget = "project" | "global";

export interface SerializeOptions {
  target?: SerializerTarget;
  skillCursorMode?: CursorSkillMode;
  /** When set, skill auxiliary files are read from this tree (scan origin). */
  skillSourceRoot?: string;
}

export interface PlatformSerializer {
  readonly platformId: string;

  /** Scan a project directory and return discovered resources. */
  scan(projectRoot: string): Promise<ResourceCreateInput[]>;

  /** Scan platform defaults from the user home directory when supported. */
  scanGlobal?(homeRoot: string): Promise<ResourceCreateInput[]>;

  /** Serialize canonical resources into platform-specific files. */
  serialize(
    resources: Resource[],
    projectRoot: string,
    options?: SerializeOptions,
  ): Promise<SerializedFile[]>;
}
