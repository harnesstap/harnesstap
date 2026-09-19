import type { ProfileContentsResource } from "../../lib/types";
import type { ResourceDetailTarget } from "../ResourceDetailPane";

export const ICON_SIZE = 14;
export const APPLY_PROGRESS_LABEL = "Applying…";
export const APPLY_MATCH_PROFILE_LABEL = "Applying to match profile";

/** Mirrors `previewProjectApply` when project drift is `na`. */
export const PROJECT_NOT_TRACKED_WARNING =
  "Project is not tracked yet. Bootstrap or apply to create a snapshot.";

export function resourceDetailTarget(
  resource: Pick<ProfileContentsResource, "id" | "type" | "name" | "source">,
): ResourceDetailTarget {
  return {
    selector: resource.id ?? `${resource.type}:${resource.name}`,
    label: resource.name,
    pathHint: resource.source,
  };
}
