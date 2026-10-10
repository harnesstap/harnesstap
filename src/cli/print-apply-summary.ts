import {
  applyHeaderLine,
  applyWroteLine,
  CLI_COPY,
  dryRunSectionHeader,
  dryRunWouldLine,
  keptFilesHeader,
  keptReasonLabel,
  snapshotSavedUndoLine,
} from "../copy/cli.js";
import { ui } from "../ui/index.js";

export interface ApplyKeptFile {
  path: string;
  reason: "modified" | "unmanaged";
}

export function keptFromSkippedRemovals(
  skipped: readonly { path: string; reason: string }[] | undefined,
): ApplyKeptFile[] {
  return (skipped ?? []).flatMap((entry) => {
    const reason = removalSkipReason(entry.reason);
    return reason ? [{ path: entry.path, reason }] : [];
  });
}

export function printApplyPayload(payload: {
  profile_name: string;
  harnesses: readonly string[];
  files: readonly unknown[];
  written_files: readonly string[];
  removed_files?: readonly string[];
  skipped_removals?: readonly { path: string; reason: string; message?: string }[];
  snapshot_id?: string;
  dry_run?: boolean;
  removal_backup?: string;
}): void {
  const kept = keptFromSkippedRemovals(payload.skipped_removals);
  const unchanged = Math.max(0, payload.files.length - payload.written_files.length);
  if (payload.dry_run) {
    printApplyDryRun({
      wouldWrite: payload.written_files,
      wouldRemove: payload.removed_files ?? [],
      wouldKeep: kept,
      unchanged,
    });
  } else {
    printApplySuccess({
      name: payload.profile_name,
      harnessCount: payload.harnesses.length,
      wrote: payload.written_files.length,
      removed: payload.removed_files?.length ?? 0,
      kept,
      unchanged,
      snapshotId: payload.snapshot_id,
    });
  }
  for (const skipped of payload.skipped_removals ?? []) {
    if (skipped.reason === "missing") {
      continue;
    }
    if (skipped.message) {
      ui.warn(skipped.message);
    }
  }
  if (!payload.dry_run && payload.removal_backup && (payload.removed_files?.length ?? 0) > 0) {
    ui.info(`Backup: ${payload.removal_backup}`);
  }
}

export function printApplyDryRun(input: {
  wouldWrite: readonly string[];
  wouldRemove: readonly string[];
  wouldKeep: readonly ApplyKeptFile[];
  unchanged: number;
  header?: string | false;
}): void {
  if (input.header !== false) {
    console.log(input.header ?? CLI_COPY.dryRunNothingChanged);
    console.log("");
  }
  if (input.wouldWrite.length > 0) {
    console.log(dryRunSectionHeader("write", input.wouldWrite.length));
    for (const path of input.wouldWrite) {
      console.log(`  ${path}`);
    }
  }
  if (input.wouldRemove.length > 0) {
    console.log(dryRunSectionHeader("remove", input.wouldRemove.length));
    for (const path of input.wouldRemove) {
      console.log(`  ${path}`);
    }
  }
  if (input.wouldKeep.length > 0) {
    console.log(dryRunSectionHeader("keep", input.wouldKeep.length));
    for (const entry of input.wouldKeep) {
      console.log(`  ${entry.path}   ${keptReasonLabel(entry.reason)}`);
    }
  }
  console.log("");
  console.log(
    dryRunWouldLine({
      write: input.wouldWrite.length,
      remove: input.wouldRemove.length,
      keep: input.wouldKeep.length,
      unchanged: input.unchanged,
    }),
  );
}

export function printKeptFiles(kept: readonly ApplyKeptFile[]): void {
  if (kept.length === 0) {
    return;
  }
  console.log(keptFilesHeader(kept.length));
  for (const entry of kept) {
    console.log(`  ${entry.path}   ${keptReasonLabel(entry.reason)}`);
  }
  console.log(`${CLI_COPY.forceRemoveHint} ht apply --force-remove`);
}

export function printApplySuccess(input: {
  name: string;
  harnessCount: number;
  wrote: number;
  removed: number;
  kept: readonly ApplyKeptFile[];
  unchanged: number;
  snapshotId?: string;
}): void {
  console.log(applyHeaderLine(input.name, input.harnessCount));
  console.log(
    applyWroteLine({
      wrote: input.wrote,
      removed: input.removed,
      kept: input.kept.length,
      unchanged: input.unchanged,
    }),
  );
  printKeptFiles(input.kept);
  if (input.snapshotId) {
    console.log(snapshotSavedUndoLine(`ht revert ${input.snapshotId}`));
  }
}

export function removalSkipReason(
  reason: string,
): "modified" | "unmanaged" | undefined {
  if (reason === "modified") {
    return "modified";
  }
  if (reason === "unmanaged" || reason === "preexisting") {
    return "unmanaged";
  }
  return undefined;
}
