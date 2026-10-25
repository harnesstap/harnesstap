import type { ProfileApplyPreview } from "./types";

/**
 * Apply has nowhere to write: no harness is registered. The agent flags the
 * preview (`not_set_up`) and every resource row (`apply_not_set_up`).
 */
export function isHarnessNotSetUp(
  preview: Pick<ProfileApplyPreview, "not_set_up" | "contents"> | null | undefined,
): boolean {
  if (!preview) {
    return false;
  }
  if (preview.not_set_up) {
    return true;
  }
  return (preview.contents?.resources ?? []).some(
    (resource) => resource.apply_not_set_up === true,
  );
}
