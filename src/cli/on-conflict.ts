/** Shared --on-conflict vocabulary (DS-6). Old values stay as aliases for one release. */

export const ON_CONFLICT_VALUES = ["replace", "skip", "prompt", "cancel"] as const;
export type OnConflictValue = (typeof ON_CONFLICT_VALUES)[number];

export const ON_CONFLICT_HELP =
  "What to do when it already exists: replace, skip, prompt or cancel";

export const ON_CONFLICT_PLUGIN_IMPORT_HELP =
  "What to do when it already exists: replace, skip, prompt, cancel or merge";

export const ON_CONFLICT_APPLY_HELP =
  "What to do when it already exists: replace, skip, prompt or cancel (default: prompt when interactive, cancel when not)";

function mapAlias(value: string): string {
  switch (value) {
    case "overwrite":
      return "replace";
    case "ignore":
      return "skip";
    case "fail":
    case "abort":
      return "cancel";
    default:
      return value;
  }
}

export function parseOnConflict(
  value: string | undefined,
  opts?: { allowMerge?: boolean },
): OnConflictValue | "merge" | undefined {
  if (!value) {
    return undefined;
  }
  const mapped = mapAlias(value);
  switch (mapped) {
    case "replace":
    case "skip":
    case "prompt":
    case "cancel":
      return mapped;
    case "merge":
      if (opts?.allowMerge) {
        return "merge";
      }
      throw new Error(`Invalid --on-conflict value: ${value}. Use replace, skip, prompt or cancel.`);
    default:
      throw new Error(
        opts?.allowMerge
          ? `Invalid --on-conflict value: ${value}. Use replace, skip, prompt, cancel or merge.`
          : `Invalid --on-conflict value: ${value}. Use replace, skip, prompt or cancel.`,
      );
  }
}

export function toResourceSyncOnConflict(
  value: OnConflictValue | "merge" | undefined,
): "overwrite" | "ignore" | "fail" | undefined {
  if (!value || value === "merge" || value === "prompt") {
    return undefined;
  }
  switch (value) {
    case "replace":
      return "overwrite";
    case "skip":
      return "ignore";
    case "cancel":
      return "fail";
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}

export function toPluginImportOnConflict(
  value: OnConflictValue | "merge" | undefined,
): "overwrite" | "cancel" | "merge" | undefined {
  if (!value) {
    return undefined;
  }
  switch (value) {
    case "replace":
      return "overwrite";
    case "cancel":
    case "skip":
      return "cancel";
    case "merge":
      return "merge";
    case "prompt":
      return "cancel";
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}
