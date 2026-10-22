import {
  applyHeaderLine,
  applyWroteLine,
  CLI_COPY,
  CLI_HINTS,
  dryRunSectionHeader,
  dryRunWouldLine,
  forceRemoveHintLine,
  keptFilesHeader,
  keptReportedBeforeLine,
  keptReasonLabel,
  snapshotSavedUndoLine,
} from "../copy/cli.js";
import {
  allKeptHostPluginViewPaths,
  hostPluginViewChangeCounts,
  hostPluginViewForceReplace,
  pendingKeptHostPluginViewPaths,
} from "../services/package-cache/host-plugin-view-policy.js";
import { isClaudePluginRegistryPath } from "../services/claude-plugin-registration-prune.js";
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
  const listedKept = kept.length > 0;
  for (const skipped of payload.skipped_removals ?? []) {
    if (skipped.reason === "missing") {
      continue;
    }
    if (listedKept && removalSkipReason(skipped.reason)) {
      continue;
    }
    if (skipped.message) {
      ui.warn(skipped.message);
    }
  }
  // The removal itself already printed "Removed N files. Backup: <dir>"
  // (profile-apply warnSkippedRemovals), so the backup folder is not repeated.
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
      console.log(`  ${entry.path}   ${keptReasonLabel(entry.reason, entry.path)}`);
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
    console.log(`  ${entry.path}   ${keptReasonLabel(entry.reason, entry.path)}`);
  }
  // HarnessTap keeps the entries Claude Code changed in its plugin registries
  // even with --force-remove, so suggesting it for those alone is wrong.
  if (kept.every((entry) => isClaudePluginRegistryPath(entry.path))) {
    return;
  }
  // With --force-remove already in effect, suggesting it again is wrong.
  console.log(
    hostPluginViewForceReplace()
      ? CLI_HINTS.forceRemoveAlreadyUsed
      : forceRemoveHintLine(kept.length),
  );
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
  // Files a plugin cache folder refresh added, replaced or removed count too, so the
  // line never says nothing changed next to "Backed up and replaced ...".
  const pluginFolder = hostPluginViewChangeCounts();
  // Kept files in a plugin cache folder get their own, more detailed notice.
  // List each kept file once, and count both.
  const folderKept = new Set(pendingKeptHostPluginViewPaths());
  const kept = input.kept.filter((entry) => !folderKept.has(entry.path));
  // Kept files in a plugin cache folder that an earlier apply already reported get no
  // notice again, but they are still kept, so the count and a pointer include them.
  const listedPaths = new Set([...folderKept, ...kept.map((entry) => entry.path)]);
  const reportedBefore = allKeptHostPluginViewPaths().filter((path) => !listedPaths.has(path));
  const keptTotal = listedPaths.size + new Set(reportedBefore).size;
  console.log(
    applyWroteLine({
      wrote: input.wrote + pluginFolder.replaced + pluginFolder.added,
      removed: input.removed + pluginFolder.removed,
      kept: keptTotal,
      unchanged: input.unchanged,
    }),
  );
  if (kept.length > 0) {
    printKeptFiles(kept);
  }
  if (reportedBefore.length > 0) {
    console.log(keptReportedBeforeLine(new Set(reportedBefore).size));
  }
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
