import {
  applyResultToastTitle,
  APPLY_RESULT_COPY,
  emptyPlannedRemovals,
  type PlannedRemovals,
} from "./ui-copy";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseRemovals(value: unknown): PlannedRemovals {
  if (!isRecord(value)) {
    return emptyPlannedRemovals();
  }
  return {
    owned_unmodified: stringArray(value.owned_unmodified),
    owned_modified: stringArray(value.owned_modified),
    unmanaged: stringArray(value.unmanaged),
  };
}

function skippedKeptCount(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }
  return value.filter((entry) => {
    if (!isRecord(entry)) {
      return false;
    }
    return entry.reason !== "missing";
  }).length;
}

/** Home apply payload nested under switch `result.home.apply` or a direct apply body. */
export function applyOutcomeFromUnknown(result: unknown): {
  wrote: number;
  removed: number;
  kept: number;
  unchanged: number;
  snapshotId: string | null;
  removals: PlannedRemovals;
} {
  if (!isRecord(result)) {
    return {
      wrote: 0,
      removed: 0,
      kept: 0,
      unchanged: 0,
      snapshotId: null,
      removals: emptyPlannedRemovals(),
    };
  }
  const home = isRecord(result.home) ? result.home : null;
  const apply = isRecord(home?.apply)
    ? home.apply
    : isRecord(result.apply)
      ? result.apply
      : result;
  const wrote = stringArray(apply.written_files).length;
  const removed = stringArray(apply.removed_files).length;
  const files = stringArray(apply.files);
  const skipped = stringArray(apply.skipped_files);
  const unchanged = Math.max(
    0,
    files.length > 0 ? files.length - wrote : skipped.length,
  );
  const removals = parseRemovals(apply.removals);
  const kept =
    removals.owned_modified.length + removals.unmanaged.length
    || skippedKeptCount(apply.skipped_removals);
  const snapshotId =
    typeof apply.snapshot_id === "string"
      ? apply.snapshot_id
      : typeof result.snapshot_id === "string"
        ? result.snapshot_id
        : null;
  return { wrote, removed, kept, unchanged, snapshotId, removals };
}

export function applySuccessToast(result: unknown): {
  title: string;
  snapshotId: string | null;
  viewSnapshotLabel: string;
} {
  const outcome = applyOutcomeFromUnknown(result);
  return {
    title: applyResultToastTitle(outcome),
    snapshotId: outcome.snapshotId,
    viewSnapshotLabel: APPLY_RESULT_COPY.viewSnapshot,
  };
}
