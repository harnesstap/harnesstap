export type PanelTrafficStatus = "green" | "yellow" | "red";
export type ViewScope = "home" | "project";
/** Agent switch still accepts "both"; the UI only offers Home|Project views. */
export type SwitchScope = ViewScope | "both";
export type GlobalProfileStatusDepth = "fast" | "full";

export interface ProfileSummary {
  name: string;
  version: string;
  tags: string[];
  description: string | null;
  /** Where this profile is enabled; appears in each matching Home/Project view. */
  scopes: ViewScope[];
  /** Unpublished edits on the working head (shown as version*). */
  dirty?: boolean;
}

export interface LibraryPlugin {
  id: string;
  name: string;
  version: string;
  tags: string[];
  description: string | null;
}

export interface LibraryResource {
  id: string;
  name: string;
  type: string;
  namespace: string | null;
  description: string | null;
  /** On-disk path or import origin label. */
  source?: string | null;
  updated_at?: string | null;
  origin_kind?: string | null;
}

export interface ResourceTrackedFolderEntry {
  path: string;
  label: string;
  platform_ids: string[];
}

export interface ResourceTrackedDirectoryEntry {
  path: string;
  kind: "home_default" | "custom";
  label: string;
  platform_ids: string[];
  resource_count: number;
  removable: boolean;
  folders: ResourceTrackedFolderEntry[];
}

export interface ResourceTrackedDirectoriesResult {
  directories: ResourceTrackedDirectoryEntry[];
}

export interface ResourceTrackedDirectoryAddResult {
  directory: ResourceTrackedDirectoryEntry;
  imported_count: number;
}

export interface ResourceTrackedDirectoryRescanEntry {
  path: string;
  kind: "home_default" | "custom";
  imported_count: number;
  skipped: boolean;
  error?: string;
}

export interface ResourceTrackedDirectoriesRescanResult {
  directories: ResourceTrackedDirectoryEntry[];
  rescanned: ResourceTrackedDirectoryRescanEntry[];
  imported_count: number;
}

export interface LibraryResourceDetail {
  id: string;
  type: string;
  name: string;
  namespace: string | null;
  description: string | null;
  source: string;
  origin_kind: string;
  origin_ref: string | null;
  updated_at: string;
  content: string;
  content_truncated: boolean;
}

export type ProfileCreateSource = "compose" | "home" | "project";
export type ProfileConflictPolicy = "skip" | "overwrite";

interface ProfileCreateCommon {
  name: string;
  description?: string;
  use?: boolean;
}

export interface ProfileCreateComposeRequest extends ProfileCreateCommon {
  source: "compose";
  pluginIds: string[];
  resourceIds: string[];
}

export interface ProfileCreateHomeRequest extends ProfileCreateCommon {
  source: "home";
  conflictPolicy: ProfileConflictPolicy;
}

export interface ProfileCreateProjectRequest extends ProfileCreateCommon {
  source: "project";
  projectPath: string;
  conflictPolicy: ProfileConflictPolicy;
}

export type ProfileCreateRequest =
  | ProfileCreateComposeRequest
  | ProfileCreateHomeRequest
  | ProfileCreateProjectRequest;

export interface ProfileCreatePreview {
  source: ProfileCreateSource;
  name: string;
  totalImports: number;
  conflicts: unknown[];
  warnings: string[];
}

export interface ProfileCreateResult {
  profile: {
    name: string;
    id: string;
    version: string;
  };
  imported_count: number;
  used: boolean;
}

export interface CloudProfile {
  selector: string;
  name: string;
  orgSlug: string;
  catalogSlug: string;
  version: string;
  tags: string[];
  description: string | null;
}

export interface CloudProfilePullRequest {
  selector: string;
  as?: string;
  use?: boolean;
}

export interface CloudProfilePullResult {
  profile: {
    name: string;
    id: string;
  };
  tagged: boolean;
  warning?: string;
}

export interface CloudPendingLogin {
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_at: number;
}

export interface CloudAuthStatus {
  authenticated: boolean;
  accountName?: string;
  email?: string;
  name?: string;
  orgSlug?: string;
  cloudBaseUrl?: string;
  pendingLogin?: CloudPendingLogin;
}

export interface CloudAuthLoginPollResult {
  status: "pending" | "complete" | "error";
  intervalMs?: number;
  message?: string;
  auth?: CloudAuthStatus;
}

export interface ProfileTagResult {
  plugin_id: string;
  tags: string[];
}

export interface ProfileRenameResult {
  old_name: string;
  name: string;
  plugin_id: string;
  was_active: boolean;
}

export interface HarnessPluginStatusRow {
  id: string;
  state: "installed" | "missing" | "extra";
}

export interface HarnessMcpStatusRow {
  name: string;
  state: "present" | "missing" | "extra";
}

export interface HarnessLiveStatus {
  plugins: HarnessPluginStatusRow[];
  mcp: HarnessMcpStatusRow[];
}

export interface ProfileContentsPlugin {
  id: string;
  name: string;
  version: string;
  resources: ProfileContentsResource[];
}

export interface ProfileContentsPin {
  ref: string;
  version_constraint: string;
}

export interface ProfileContentsResource {
  type: string;
  name: string;
  id?: string;
  /** On-disk path or import origin label (hover target). */
  source?: string;
}

export interface ProfileContents {
  plugins: ProfileContentsPlugin[];
  stack_resource_count: number;
  stack_summary: string | null;
  /** Counts by resource type, plus `plugin` and `plugin_pin`. */
  type_counts: Record<string, number>;
  resources: ProfileContentsResource[];
  plugin_pins: ProfileContentsPin[];
  mcp_servers: string[];
}

export interface DriftFileChange {
  path: string;
  type: "added" | "modified" | "deleted";
  platform?: string;
  resource?: { type: string; name: string; origin_kind?: string | null };
}

export interface GlobalProfilePanelStatus {
  status: PanelTrafficStatus;
  reasons: string[];
}

export interface GlobalProfileStatus {
  active_profile: string | null;
  profile_exists: boolean;
  applied: boolean;
  snapshot_id: string | null;
  snapshot_at: string | null;
  stack_in_sync: boolean;
  has_drift: boolean;
  changes?: DriftFileChange[];
  depth: GlobalProfileStatusDepth;
  as_of: string;
  panel: GlobalProfilePanelStatus;
  harnesses: Record<string, HarnessLiveStatus>;
  contents?: ProfileContents | null;
  drift_summary: {
    global: {
      status: "clean" | "drifted" | "pending";
      owned_changes: number;
      non_owned_changes: number;
    };
    project?: {
      status: "na" | "clean" | "drifted";
      report: unknown | null;
    };
  };
  switching?: boolean;
  warning?: string;
  untracked_resource_count?: number;
}

export interface ProfileApplyPreviewRequest {
  profile: string;
  scope: ViewScope;
  projectPath?: string;
}

export type RecoveryAction =
  | { id: "sync-install"; label: string; pluginName: string; sourceKind?: string }
  | { id: "create-plugin"; label: string; pluginName: string }
  | {
      id: "override-version";
      label: string;
      pluginName: string;
      versions: string[];
      rootName: string;
    }
  | {
      id: "override-resource";
      label: string;
      rootName: string;
      key: string;
      winnerPluginName: string;
    }
  | { id: "detach-dependency"; label: string; rootName: string; pluginName: string }
  | { id: "clear-override"; label: string; rootName: string; pluginName: string }
  | { id: "tag-as-profile"; label: string; pluginName: string };

export interface ProfileApplyPreview {
  profile: string;
  scope: ViewScope;
  contents: ProfileContents | null;
  harnesses?: Record<string, HarnessLiveStatus>;
  /** Material resources on disk that are not in the profile stack. */
  untracked_resources: ProfileContentsResource[];
  /** Preferred alias for untracked_resources (not staged / working tree). */
  not_staged?: ProfileContentsResource[];
  files: {
    expected_count: number;
    changes: DriftFileChange[];
    root_path: string;
  };
  relative_to_active: boolean;
  warning?: string;
  recovery_actions?: RecoveryAction[];
}

export interface ProfileAddResourceRequest {
  resourceType?: string;
  resourceName?: string;
  scope: ViewScope;
  projectPath?: string;
  path?: string;
}

export interface ProfileAddResourceResult {
  resource: ProfileContentsResource;
}

export interface ProfileAddAllResourcesRequest {
  scope: ViewScope;
  projectPath?: string;
}

export interface ProfileAddAllResourcesResult {
  resources: ProfileContentsResource[];
  added_count: number;
}

export interface ProfileRemoveResourceRequest {
  resourceType: string;
  resourceName: string;
  pluginId?: string;
}

export interface ProfileRemoveResourceResult {
  resource: ProfileContentsResource;
}

export interface ProfileRestoreFileRequest {
  scope: ViewScope;
  projectPath?: string;
  harness?: string;
  path: string;
}

export interface ProfileRestoreFileResult {
  path: string;
  absolute_path: string;
}

export interface ProfileFileDiffRequest {
  scope: ViewScope;
  projectPath?: string;
  harness?: string;
  path: string;
}

export interface ProfileFileDiffResult {
  path: string;
  absolute_path: string;
  /** Expected content from the profile snapshot. */
  expected: string;
  /** Current on-disk content, or null if missing. */
  current: string | null;
}

export interface OpenPathRequest {
  selector?: string;
  path?: string;
  pathHint?: string | null;
  profile?: string;
  scope?: ViewScope;
  projectPath?: string;
}

export interface OpenPathResult {
  path: string;
}

export interface ProfileStashEntry {
  id: string;
  profile_name: string;
  created_at: string;
  contents: ProfileContents;
  file_changes: DriftFileChange[];
}

export interface ProfileStashListResult {
  entries: ProfileStashEntry[];
}

export interface ProfileStashPushResult {
  entry: ProfileStashEntry;
  cleared: {
    profile_name: string;
    removed_files?: string[];
    dry_run: boolean;
  };
}

export interface ProfileStashPopResult {
  entry: ProfileStashEntry;
  restored: {
    profile_name: string;
    dry_run: boolean;
    cancelled: boolean;
  };
  removed: boolean;
}

export type ProfileSwitchStep =
  | "validate_baseline"
  | "apply_home"
  | "apply_project"
  | "restore_previous"
  | "complete";

export type ProfileSwitchStepStatus =
  | "started"
  | "completed"
  | "failed"
  | "cancelled";

export interface ProfileSwitchStepEvent {
  step: ProfileSwitchStep;
  status: ProfileSwitchStepStatus;
  profile_name?: string;
  error?: string;
}

export interface AgentSwitchFinalEvent {
  type: "result";
  ok: boolean;
  cancelled?: boolean;
  result?: unknown;
  error?: string;
}

export type AgentSwitchStreamEvent = ProfileSwitchStepEvent | AgentSwitchFinalEvent;

export interface AgentHealth {
  status: string;
  version: string;
  port: number;
}

export type MaterializationStrategy = "symlink-preferred" | "copy";

export interface HarnessCatalogEntry {
  id: string;
  name: string;
  supported: boolean;
  supports: string[];
}

export interface HarnessSettingsGlobal {
  main_harness: string | null;
  alias_harnesses: string[];
}

export interface HarnessSettingsProject {
  available: boolean;
  override: boolean;
  main_harness?: string | null;
  alias_harnesses?: string[];
  materialization_strategy?: MaterializationStrategy;
  reason?: string;
}

export interface HarnessSettingsPayload {
  global: HarnessSettingsGlobal;
  project?: HarnessSettingsProject;
  harnesses: HarnessCatalogEntry[];
}

export interface PutHarnessSettingsInput {
  global: { main_harness: string; alias_harnesses: string[] };
  project?: {
    path: string;
    override: boolean;
    main_harness?: string;
    alias_harnesses?: string[];
    materialization_strategy?: MaterializationStrategy;
  };
}

export interface PutHarnessSettingsMirrorSummary {
  main_harness: string;
  alias_harnesses: string[];
  platforms_synced: string[];
  files_written: number;
  surface_warnings: Array<{
    harness: string;
    path: string;
    category: string;
    message: string;
    alias_harnesses: string[];
  }>;
}

export interface PutHarnessSettingsResult {
  global: HarnessSettingsGlobal;
  project?: HarnessSettingsProject;
  mirror?: PutHarnessSettingsMirrorSummary;
  mirror_error?: string;
}

export interface ProfileDetailResource {
  id: string;
  type: string;
  name: string;
  source: string;
}

export interface ProfileDetailDependency {
  dependency_name: string;
  version_constraint: string;
  order: number;
  resource_id: string | null;
}

export interface ProfileDetail {
  profile: {
    id: string;
    name: string;
    version: string;
    description: string;
    tags: string[];
    dirty?: boolean;
  };
  active: boolean;
  dependencies: ProfileDetailDependency[];
  resources: ProfileDetailResource[];
}

export type PluginMarketplacePlatform = "claude-code" | "cursor" | "goose";

export interface PluginMarketplaceEntry {
  name: string;
  url: string;
  platforms: PluginMarketplacePlatform[];
}

export interface MarketplaceListResult {
  marketplaces: PluginMarketplaceEntry[];
}

export interface MarketplaceAddRequest {
  url: string;
  name: string;
  platforms?: PluginMarketplacePlatform[];
}

export interface MarketplaceAddResult {
  status: "added" | "already_configured";
  entry: PluginMarketplaceEntry;
  refresh: { ok: boolean; message: string };
}

export interface CatalogPlugin {
  name: string;
  version?: string;
  ref: string;
  description?: string;
}

export interface MarketplacePluginsResult {
  marketplace: string;
  plugins: CatalogPlugin[];
}

export interface ProfilePluginAddRequest {
  ref: string;
  projectPath?: string;
  versionConstraint?: string;
}

export interface ProfilePluginAddResult {
  status: "attached" | "already_attached";
  ref: string;
  pluginName: string;
  marketplaceCopied: boolean;
}

export type MigrateScope = "workspace" | "plugin" | "resource";

export interface LibraryEnvironment {
  id: string;
  name: string;
  description: string | null;
}

export interface EnvironmentsListResult {
  environments: LibraryEnvironment[];
}

export interface MigrateDetectImportScopeResult {
  scope: MigrateScope;
}

export interface MigrateExportInput {
  scope: MigrateScope;
  path: string;
  plugin?: string;
  resource?: string;
  include_plugins?: boolean;
  /** Write a single-file `.ap.json` envelope instead of a package directory. */
  single_file?: boolean;
}

/** Workspace export matches CLI JSON: flattened manifest fields + output + scope. */
export type MigrateExportResult =
  | {
      scope: "workspace";
      output: string;
      version: number;
      exported_at: string;
      plugin_count: number;
      environment_count?: number;
      include_plugins: boolean;
      includes_active_profile: boolean;
    }
  | { scope: "plugin"; output: string; plugins: string[]; files?: string[] }
  | { scope: "resource"; output: string; resource: string; files?: string[] };

export interface MigrateImportInput {
  path: string;
  scope?: MigrateScope | null;
}

export type MigrateImportResult =
  | {
      scope: "workspace";
      manifest: Record<string, unknown>;
      plugins_imported: number;
      environments_imported: number;
    }
  | {
      scope: "plugin";
      plugin: string;
      plugins: string[];
      resources_imported: number;
    }
  | {
      scope: "resource";
      resource: string;
      action: "created" | "updated" | "unchanged";
    };

export const SWITCH_STEP_LABELS: Record<ProfileSwitchStep, string> = {
  validate_baseline: "Validate baseline",
  apply_home: "Apply profile (global)",
  apply_project: "Apply profile (project)",
  restore_previous: "Restore previous",
  complete: "Verify live state",
};

export function orderedSwitchSteps(scope: SwitchScope): ProfileSwitchStep[] {
  switch (scope) {
    case "home":
      return ["validate_baseline", "apply_home", "complete"];
    case "project":
      return ["apply_project", "complete"];
    case "both":
      return ["validate_baseline", "apply_home", "apply_project", "complete"];
    default: {
      const neverScope: never = scope;
      return neverScope;
    }
  }
}
