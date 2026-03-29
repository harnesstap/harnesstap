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

export interface Preset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  is_template: boolean;
  created_at: string;
  updated_at: string;
}

export interface PresetResource {
  preset_id: string;
  resource_id: string;
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

export interface ExportBundle {
  $schema: string;
  version: number;
  preset: Omit<Preset, "id" | "created_at" | "updated_at">;
  resources: Omit<Resource, "id" | "created_at" | "updated_at" | "source">[];
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

  /** Serialize canonical resources into platform-specific files. */
  serialize(resources: Resource[], projectRoot: string): Promise<SerializedFile[]>;
}
