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
  if (opts.onConflict === "replace") return "replace";
  if (opts.onConflict === "skip") return "skip";
  if (opts.onConflict === "prompt") return "prompt";
  if (
    opts.noInteractive ||
    process.env.CI === "true" ||
    process.env.HARNESSTAP_NO_INTERACTIVE === "1" ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  ) {
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
