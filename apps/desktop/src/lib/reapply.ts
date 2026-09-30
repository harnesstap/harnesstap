import type { ProfileApplyPreview, ViewScope } from "./types";

/** Green hold on the apply strip before it collapses. */
export const APPLY_SUCCESS_HOLD_MS = 1500;

export function applyPreviewChangeCount(
  preview: ProfileApplyPreview | null | undefined,
): number {
  return preview?.files.changes.length ?? 0;
}

export type ProfileHeaderStatusKind =
  | "none"
  | "inactive"
  | "active_applied"
  | "active_not_fully_applied";

export const PROFILE_HEADER_STATUS_TOOLTIP = {
  inactive: "Inactive",
  active_applied: "Active and applied",
  active_not_fully_applied: "Active. Not fully applied.",
} as const;

export interface ProfileHeaderStatusState {
  kind: ProfileHeaderStatusKind;
  tooltip: string | null;
  active: boolean;
  warn: boolean;
}

/** Live-toolbar status disc: active, active-but-not-fully-applied, or inactive. */
export function profileHeaderStatus(input: {
  selectedProfile: string | null;
  activeProfile: string | null;
  applied: boolean;
  view: ViewScope;
  globalDriftStatus: "clean" | "drifted" | "pending";
  projectDriftStatus?: "na" | "clean" | "drifted";
}): ProfileHeaderStatusState {
  if (!input.selectedProfile) {
    return { kind: "none", tooltip: null, active: false, warn: false };
  }
  const isActive = input.selectedProfile === input.activeProfile;
  if (!isActive) {
    return {
      kind: "inactive",
      tooltip: PROFILE_HEADER_STATUS_TOOLTIP.inactive,
      active: false,
      warn: false,
    };
  }
  const pendingLive =
    input.view === "home" && input.globalDriftStatus === "pending";
  const notFullyApplied =
    !input.applied || scopeHasDrift(input) || pendingLive;
  if (notFullyApplied) {
    return {
      kind: "active_not_fully_applied",
      tooltip: PROFILE_HEADER_STATUS_TOOLTIP.active_not_fully_applied,
      active: true,
      warn: true,
    };
  }
  return {
    kind: "active_applied",
    tooltip: PROFILE_HEADER_STATUS_TOOLTIP.active_applied,
    active: true,
    warn: false,
  };
}

export type ApplyHelperKind =
  | "none"
  | "changes"
  | "up_to_date"
  | "nothing"
  | "reapply";

export interface ApplyCtaHelper {
  kind: ApplyHelperKind;
  label: string | null;
  changeCount: number;
}

/** Copy under the rail Apply button. */
export function applyCtaHelper(input: {
  selectedProfile: string | null;
  activeProfile: string | null;
  applied: boolean;
  showReapply: boolean;
  changeCount: number;
  switching: boolean;
}): ApplyCtaHelper {
  const changeCount = input.changeCount;
  if (input.switching) {
    return { kind: "none", label: null, changeCount };
  }
  if (!input.selectedProfile) {
    return { kind: "nothing", label: "Nothing to apply", changeCount };
  }
  if (input.showReapply) {
    return { kind: "reapply", label: "Re-apply to restore saved state", changeCount };
  }
  const isActive = input.selectedProfile === input.activeProfile;
  if (isActive && input.applied) {
    return { kind: "up_to_date", label: "Up to date", changeCount };
  }
  if (!isActive && changeCount > 0) {
    return {
      kind: "changes",
      label: `${changeCount} change${changeCount === 1 ? "" : "s"} · Preview`,
      changeCount,
    };
  }
  return { kind: "none", label: null, changeCount };
}

function scopeHasDrift(input: {
  view: ViewScope;
  globalDriftStatus: "clean" | "drifted" | "pending";
  projectDriftStatus?: "na" | "clean" | "drifted";
}): boolean {
  if (input.view === "home") {
    return input.globalDriftStatus === "drifted";
  }
  return input.projectDriftStatus === "drifted";
}

/** When Apply is disabled for an already-applied active profile, offer Re-apply if this view has drift. */
export function shouldShowReapply(input: {
  selectedProfile: string | null;
  activeProfile: string | null;
  applied: boolean;
  view: ViewScope;
  globalDriftStatus: "clean" | "drifted" | "pending";
  projectDriftStatus?: "na" | "clean" | "drifted";
}): boolean {
  if (!input.selectedProfile || input.selectedProfile !== input.activeProfile) {
    return false;
  }
  if (!input.applied) {
    return false;
  }
  return scopeHasDrift(input);
}

/**
 * After a library mutation on the active profile, auto-reapply only when the
 * current scope was clean beforehand (do not clobber preexisting drift).
 */
export function shouldAutoReapply(input: {
  mutatedProfile: string | null;
  activeProfile: string | null;
  applied: boolean;
  view: ViewScope;
  /** Drift snapshot taken before the mutation. */
  preexistingGlobalDriftStatus: "clean" | "drifted" | "pending";
  preexistingProjectDriftStatus?: "na" | "clean" | "drifted";
  /** false for description/tags-only; true for attach/detach/rename that affect apply. */
  affectsApply?: boolean;
}): boolean {
  if (input.affectsApply === false) {
    return false;
  }
  if (!input.mutatedProfile || input.mutatedProfile !== input.activeProfile) {
    return false;
  }
  if (!input.applied) {
    return false;
  }
  return !scopeHasDrift({
    view: input.view,
    globalDriftStatus: input.preexistingGlobalDriftStatus,
    projectDriftStatus: input.preexistingProjectDriftStatus,
  });
}
