import type { ViewScope } from "./types";

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
  if (input.view === "home") {
    return input.globalDriftStatus === "drifted";
  }
  return input.projectDriftStatus === "drifted";
}
