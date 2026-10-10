import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getGlobalApplySnapshot,
  listGlobalApplySnapshots,
} from "../models/global-apply-snapshot.js";
import { getProject } from "../models/project.js";
import { findSnapshotById } from "../models/snapshot.js";
import type { SerializedFile, SnapshotState } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { hashGeneratedContent } from "./materialization-ownership.js";
import {
  flattenLiveRestoreFiles,
  snapshotAbsentPaths,
} from "./snapshot-capture.js";
import {
  backupAndRewriteFile,
  executeSafeFileRemovals,
  classifyManagedPathOwnership,
  hashOnDiskFile,
  restoreSafeRemovalBackup,
  type SafeRemovalSkip,
} from "./safe-file-removal.js";

export type RevertKind = "project" | "global";

export interface RevertPlan {
  kind: RevertKind;
  id: string;
  rootPath: string;
  label: string;
  createdAt: string;
  restoreFiles: SerializedFile[];
  absentPaths: string[];
  hasCapturedState: boolean;
}

export interface RevertResult {
  restored: string[];
  removed: string[];
  skipped: SafeRemovalSkip[];
  warnings: string[];
}

const PREFIX_MIN = 8;

type RestoreDecision = "write" | "skip-unmanaged" | "skip-modified" | "unchanged";

function parseStoredState(raw: unknown): SnapshotState | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Partial<SnapshotState>;
  if (!record.platform_files || typeof record.platform_files !== "object") {
    return undefined;
  }
  return record as SnapshotState;
}

function capturedStateUseful(state: SnapshotState | undefined): boolean {
  if (!state) {
    return false;
  }
  return (
    Object.keys(state.platform_files).length > 0
    || Object.keys(state.disk_files ?? {}).length > 0
    || (state.absent_paths?.length ?? 0) > 0
    || Object.keys(state.harness_files ?? {}).length > 0
  );
}

function findGlobalByPrefix(prefix: string): ReturnType<typeof getGlobalApplySnapshot> {
  const matches = listGlobalApplySnapshots().filter((row) => row.id.startsWith(prefix));
  return matches.length === 1 ? matches[0] : undefined;
}

export function resolveRevertPlan(snapshotId: string): RevertPlan | { error: string } {
  const trimmed = snapshotId.trim();
  if (!trimmed) {
    return { error: "Error: Pass a snapshot id." };
  }

  const projectSnap = findSnapshotById(trimmed, PREFIX_MIN);
  if (projectSnap) {
    const project = getProject(projectSnap.project_id);
    if (!project) {
      return { error: "Error: Snapshot project not found." };
    }
    return {
      kind: "project",
      id: projectSnap.id,
      rootPath: project.local_path,
      label: projectSnap.label,
      createdAt: projectSnap.created_at,
      restoreFiles: flattenLiveRestoreFiles(projectSnap.state),
      absentPaths: snapshotAbsentPaths(projectSnap.state),
      hasCapturedState: capturedStateUseful(projectSnap.state),
    };
  }

  const globalSnap =
    getGlobalApplySnapshot(trimmed)
    ?? (trimmed.length >= PREFIX_MIN ? findGlobalByPrefix(trimmed) : undefined);
  if (!globalSnap) {
    return { error: `Error: No snapshot named "${trimmed}".` };
  }
  const state = parseStoredState(globalSnap.state);
  return {
    kind: "global",
    id: globalSnap.id,
    rootPath: resolveHomeRoot(),
    label: globalSnap.profile_name,
    createdAt: globalSnap.created_at,
    restoreFiles: state ? flattenLiveRestoreFiles(state) : [],
    absentPaths: state ? snapshotAbsentPaths(state) : [],
    hasCapturedState: capturedStateUseful(state),
  };
}

function shouldRestorePath(rootPath: string, file: SerializedFile): RestoreDecision {
  const fullPath = resolve(rootPath, file.path);
  if (!existsSync(fullPath)) {
    return "write";
  }
  const onDisk = readFileSync(fullPath, "utf-8");
  if (onDisk === file.content) {
    return "unchanged";
  }
  const ownership = classifyManagedPathOwnership(rootPath, file.path);
  if (ownership === "unowned") {
    return "skip-unmanaged";
  }
  if (ownership === "owned") {
    return "write";
  }
  if (hashOnDiskFile(fullPath) === hashGeneratedContent(file.content)) {
    return "unchanged";
  }
  return "skip-modified";
}

export function executeRevert(
  plan: RevertPlan,
  options: { dryRun?: boolean; forceRemove?: boolean; applyId?: string } = {},
): RevertResult {
  const restored: string[] = [];
  const skipped: SafeRemovalSkip[] = [];

  if (!plan.hasCapturedState && plan.kind === "global" && !options.dryRun) {
    restored.push(
      ...restoreSafeRemovalBackup({
        snapshotId: plan.id,
        rootPath: plan.rootPath,
      }),
    );
  }

  const toWrite: SerializedFile[] = [];
  for (const file of plan.restoreFiles) {
    const decision = shouldRestorePath(plan.rootPath, file);
    switch (decision) {
      case "write":
        toWrite.push(file);
        restored.push(file.path);
        break;
      case "unchanged":
        restored.push(file.path);
        break;
      case "skip-modified":
        skipped.push({
          path: file.path,
          reason: "modified",
          message: `Skipped restoring ${file.path} (modified since HarnessTap wrote it).`,
        });
        break;
      case "skip-unmanaged":
        skipped.push({
          path: file.path,
          reason: "unmanaged",
          message: `Skipped restoring ${file.path} (not managed by HarnessTap).`,
        });
        break;
      default: {
        const _exhaustive: never = decision;
        throw new Error(`Unhandled restore decision: ${_exhaustive}`);
      }
    }
  }

  if (!options.dryRun) {
    for (const file of toWrite) {
      backupAndRewriteFile({
        rootPath: plan.rootPath,
        relativePath: file.path,
        nextContent: file.content,
        applyId: options.applyId ?? plan.id,
        snapshotId: plan.id,
      });
    }
  }

  const removal = executeSafeFileRemovals(plan.rootPath, plan.absentPaths, {
    dryRun: options.dryRun,
    forceRemove: options.forceRemove,
    applyId: options.applyId ?? plan.id,
    snapshotId: plan.id,
  });

  const warnings = [
    ...skipped.filter((entry) => entry.reason !== "missing").map((entry) => entry.message),
    ...removal.warnings,
  ];

  return {
    restored: [...new Set(restored)],
    removed: removal.removed,
    skipped: [...skipped, ...removal.skipped],
    warnings,
  };
}
