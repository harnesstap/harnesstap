export type PanelTrafficStatus = "green" | "yellow" | "red";
export type SwitchScope = "home" | "project" | "both";
export type GlobalProfileStatusDepth = "fast" | "full";

export interface PersonaSummary {
  name: string;
  version: string;
  tags: string[];
  description: string | null;
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
  depth: GlobalProfileStatusDepth;
  as_of: string;
  panel: GlobalProfilePanelStatus;
  harnesses: Record<string, HarnessLiveStatus>;
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
  apply_home: "Apply persona (home)",
  apply_project: "Apply persona (project)",
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
