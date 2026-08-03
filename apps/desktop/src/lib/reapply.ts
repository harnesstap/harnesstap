import type { ViewScope } from "./types";

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
