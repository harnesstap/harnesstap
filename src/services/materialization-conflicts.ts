import { ON_CONFLICT_VALUE_HELP, parseOnConflict } from "../cli/on-conflict.js";
import { ui } from "../ui/index.js";
import type {
  ConflictPolicy,
  ConflictResolution,
  MaterializationConflict,
} from "./applier.js";
import { promptForChoice } from "./wizards/shared.js";

export function resolveApplyConflictPolicy(opts: {
  onConflict?: string;
  noInteractive?: boolean;
}): ConflictPolicy {
  const parsed = opts.onConflict ? parseOnConflict(opts.onConflict) : undefined;
  if (
    parsed === "replace" ||
    parsed === "skip" ||
    parsed === "prompt" ||
    parsed === "cancel"
  ) {
    return parsed;
  }
  if (
    opts.noInteractive ||
    process.env.CI === "true" ||
    process.env.HARNESSTAP_NO_INTERACTIVE === "1" ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  ) {
    // W2-12 will switch this fallback to cancel. Today apply still replaces.
    return "replace";
  }
  return "prompt";
}

export async function promptMaterializationConflict(
  conflict: MaterializationConflict,
): Promise<ConflictResolution> {
  const ownerSummary =
    conflict.owners.length > 0
      ? conflict.owners
          .map((owner) => `${owner.plugin_name}@${owner.plugin_version ?? "?"}`)
          .join(", ")
      : "another plugin or manual edit";

  ui.warn(`File already exists: ${conflict.path}`);
  ui.dim(`  Previously written by: ${ownerSummary}`);

  return promptForChoice({
    message: `How should HarnessTap handle ${conflict.path}?`,
    choices: [
      { name: ON_CONFLICT_VALUE_HELP.replace, value: "replace" as const },
      { name: ON_CONFLICT_VALUE_HELP.skip, value: "skip" as const },
      { name: ON_CONFLICT_VALUE_HELP.cancel, value: "cancel" as const },
    ],
  });
}
