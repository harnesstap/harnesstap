import type {
  ConflictPolicy,
  ConflictResolution,
  MaterializationConflict,
} from "./applier.js";
import { ui } from "../ui/index.js";
import { promptForChoice } from "./wizards/shared.js";

export function resolveApplyConflictPolicy(opts: {
  onConflict?: string;
  noInteractive?: boolean;
}): ConflictPolicy {
  const raw = opts.onConflict;
  const mapped =
    raw === "overwrite" || raw === "replace"
      ? "replace"
      : raw === "ignore" || raw === "skip"
        ? "skip"
        : raw === "prompt"
          ? "prompt"
          : raw === "fail" || raw === "cancel"
            ? "cancel"
            : undefined;
  if (mapped === "replace" || mapped === "skip" || mapped === "prompt" || mapped === "cancel") {
    return mapped;
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
      { name: "Replace existing file", value: "replace" as const },
      { name: "Keep existing file", value: "skip" as const },
      { name: "Cancel apply", value: "cancel" as const },
    ],
  });
}
