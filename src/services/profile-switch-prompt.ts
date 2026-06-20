import { ui } from "../ui/index.js";
import { formatCount } from "../ui/format.js";
import {
  detectActiveProfileHarnessSyncBeforeSwitch,
  updateProfileFromMainHarness,
} from "./profile-harness-sync.js";
import { shouldPromptProfileEnable } from "./profile-enable-prompt.js";
import { promptForConfirmation } from "./wizards/shared.js";

export async function maybeSyncActiveProfileBeforeSwitch(input: {
  targetProfileName: string;
  harness?: string;
  yes?: boolean;
  format?: string;
}): Promise<boolean> {
  const format = input.format ?? "human";
  if (format !== "human") {
    return false;
  }

  let status;
  try {
    status = await detectActiveProfileHarnessSyncBeforeSwitch({
      targetProfileName: input.targetProfileName,
      harness: input.harness,
    });
  } catch (error) {
    ui.warn(error instanceof Error ? error.message : String(error));
    return false;
  }

  if (!status || status.in_sync) {
    return false;
  }

  if (!shouldPromptProfileEnable({ yes: input.yes, format })) {
    ui.hint(
      `Profile ${ui.theme.accent(status.active_profile)} differs from your main harness (${status.main_harness}). Update it before switching to avoid losing on-disk changes.`,
    );
    return false;
  }

  const added = status.changes.filter((change) => change.change === "added").length;
  const modified = status.changes.filter((change) => change.change === "modified").length;
  const removed = status.changes.filter((change) => change.change === "removed").length;
  const summaryParts = [
    added > 0 ? formatCount(added, "new resource") : "",
    modified > 0 ? formatCount(modified, "modified resource") : "",
    removed > 0 ? formatCount(removed, "removed resource") : "",
  ].filter(Boolean);

  ui.warn(
    `Profile ${ui.theme.accent(status.active_profile)} is out of sync with your main harness (${status.main_harness}).`,
  );
  if (summaryParts.length > 0) {
    ui.dim(summaryParts.join(", "));
  }

  const confirmed = await promptForConfirmation({
    message: `Update profile ${status.active_profile} from the main harness before switching to ${input.targetProfileName}?`,
    default: true,
  });

  if (!confirmed) {
    return false;
  }

  const updated = await updateProfileFromMainHarness({
    profileSelector: status.active_profile,
    harness: status.main_harness,
  });

  ui.success(
    `Updated profile ${ui.theme.accent(updated.profile_name)} from ${updated.main_harness}`,
  );
  if (updated.attached_resources > 0 || updated.removed_resources > 0) {
    ui.dim(
      [
        updated.attached_resources > 0
          ? formatCount(updated.attached_resources, "resource attached")
          : "",
        updated.removed_resources > 0
          ? formatCount(updated.removed_resources, "resource removed")
          : "",
      ]
        .filter(Boolean)
        .join(", "),
    );
  }

  return true;
}
