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
}

export interface LibraryLayer {
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
}

export interface ResourceTrackedDirectoryEntry {
  path: string;
  kind: "home_default" | "custom";
  label: string;
  platform_ids: string[];
  resource_count: number;
  removable: boolean;
}

export interface ResourceTrackedDirectoriesResult {
  directories: ResourceTrackedDirectoryEntry[];
}

export interface ResourceTrackedDirectoryAddResult {
  directory: ResourceTrackedDirectoryEntry;
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
  layerIds: string[];
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
  layer_id: string;
  tags: string[];
}

export interface ProfileRenameResult {
  old_name: string;
  name: string;
  layer_id: string;
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

export interface ProfileContentsLayer {
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
  layers: ProfileContentsLayer[];
  stack_resource_count: number;
  stack_summary: string | null;
  /** Counts by resource type, plus `layer` and `plugin_pin`. */
  type_counts: Record<string, number>;
  resources: ProfileContentsResource[];
  plugin_pins: ProfileContentsPin[];
  mcp_servers: string[];
}

export interface DriftFileChange {
  path: string;
  type: "added" | "modified" | "deleted";
  platform?: string;
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
  };
  relative_to_active: boolean;
  warning?: string;
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
  layerId?: string;
}

export interface ProfileRemoveResourceResult {
  resource: ProfileContentsResource;
}

export interface OpenPathRequest {
  selector?: string;
  path?: string;
  pathHint?: string | null;
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
