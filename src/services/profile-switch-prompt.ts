import {
  discardConfirm,
  discardedChangesLine,
  SWITCH_CHANGES_VALUES,
  type SwitchChangesValue,
  savedChangesLine,
  stashedChangesLine,
  unsavedChangesFlagHint,
  unsavedChangesLine,
} from "../copy/cli.js";
import { ui } from "../ui/index.js";
import {
  detectGlobalProfileStatus,
  type GlobalProfileStatus,
} from "./global-profile-drift.js";
import { commitManagedPathFromLive } from "./profile-commit-resource.js";
import { stashProfileCommand } from "./profile-stash.js";
import {
  promptForChoice,
  promptForConfirmation,
  shouldUseBrowsePicker,
} from "./wizards/shared.js";

export type SwitchChangesDecision = "continue" | "abort";

export function parseSwitchChanges(
  raw: string | undefined,
): SwitchChangesValue | "invalid" | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  if ((SWITCH_CHANGES_VALUES as readonly string[]).includes(raw)) {
    return raw as SwitchChangesValue;
  }
  return "invalid";
}

export async function maybeSyncActiveProfileBeforeSwitch(input: {
  targetProfileName: string;
  harness?: string;
  yes?: boolean;
  format?: string;
  changes?: string;
  noInteractive?: boolean;
}): Promise<SwitchChangesDecision> {
  const format = input.format ?? "human";

  let status: GlobalProfileStatus;
  try {
    status = await detectGlobalProfileStatus({
      harness: input.harness,
      depth: "full",
    });
  } catch (error) {
    ui.warn(error instanceof Error ? error.message : String(error));
    return "continue";
  }

  if (!status.active_profile || status.active_profile === input.targetProfileName) {
    return "continue";
  }
  if (status.changes.length === 0) {
    return "continue";
  }

  const count = status.changes.length;
  const parsedChanges = parseSwitchChanges(input.changes);
  if (parsedChanges === "invalid") {
    ui.danger('Error: Invalid --changes. Use save, stash or discard.');
    return "abort";
  }

  const interactive =
    !input.yes
    && shouldUseBrowsePicker({
      noInteractive: input.noInteractive,
      format,
    });

  let action: SwitchChangesValue | "cancel";
  if (parsedChanges) {
    action = parsedChanges;
  } else if (!interactive) {
    ui.danger(`Error: ${unsavedChangesLine(status.active_profile, count)}`);
    ui.hint(unsavedChangesFlagHint());
    return "abort";
  } else {
    ui.warn(unsavedChangesLine(status.active_profile, count));
    action = await promptForChoice({
      message: "What should HarnessTap do with them?",
      choices: [
        { name: `Save them to "${status.active_profile}"`, value: "save" as const },
        { name: "Stash them", value: "stash" as const },
        { name: "Discard them", value: "discard" as const },
        { name: "Cancel", value: "cancel" as const },
      ],
    });
  }

  switch (action) {
    case "cancel":
      return "abort";
    case "save": {
      for (const change of status.changes) {
        try {
          await commitManagedPathFromLive({
            profileSelector: status.active_profile,
            path: change.path,
            scope: "home",
            ...(input.harness ? { harness: input.harness } : {}),
          });
        } catch {
          // Aggregate paths or unmapped files stay on disk; switch still proceeds.
        }
      }
      ui.success(savedChangesLine(status.active_profile, count));
      return "continue";
    }
    case "stash": {
      await stashProfileCommand({
        harness: input.harness,
        conflictPolicy: "replace",
        pull: false,
      });
      ui.success(stashedChangesLine(count, "ht profile stash pop"));
      return "continue";
    }
    case "discard": {
      if (interactive && parsedChanges !== "discard") {
        const confirmed = await promptForConfirmation({
          message: discardConfirm(count),
          default: false,
        });
        if (!confirmed) {
          return "abort";
        }
      }
      ui.success(discardedChangesLine(count));
      return "continue";
    }
    default: {
      const unhandled: never = action;
      throw new Error(`Unhandled switch changes action: ${String(unhandled)}`);
    }
  }
}
