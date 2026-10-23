import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  asRestoreFile,
  flattenLiveRestoreFiles,
  snapshotAbsentPaths,
  snapshotLinks,
  type RestoreFile,
} from "./snapshot-capture.js";
import {
  backupAndRewriteFile,
  executeSafeFileRemovals,
  classifyManagedPathOwnership,
  hashFileOrLink,
  hashOnDiskFile,
  isSharedMergedConfigPath,
  restoreSafeRemovalBackup,
  type SafeRemovalSkip,
} from "./safe-file-removal.js";
import { restoreForgottenSettingsMarketplaces } from "./claude-settings-marketplaces.js";
import { isClaudeSettingsPath, restoreForgottenEnabledKeys } from "./claude-enabled-plugin-keys.js";
import { restoreRemovedHostPluginViews, restoreRemovedOwnership } from "./removed-ownership.js";
import {
  heldBackByRegistry,
  registersNoPlugin,
  withSnapshotSettingsKeys,
  withoutEnabledKeys,
  withoutInstalledRecords,
} from "./revert-plugin-registry.js";
import { restoreBlockedGroupMessage, restoreBlockedMessage, restoreBlocker } from "./restore-blocker.js";

export type RevertKind = "project" | "global";

export interface RevertPlan {
  kind: RevertKind;
  id: string;
  rootPath: string;
  label: string;
  createdAt: string;
  restoreFiles: Array<SerializedFile | RestoreFile>;
  /** Links to put back as links. */
  restoreLinks?: Array<{ path: string; target: string }>;
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

type RestoreDecision = "write" | "skip-unmanaged" | "skip-modified" | "skip-blocked" | "unchanged";

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
    || Object.keys(state.disk_files_base64 ?? {}).length > 0
    || (state.absent_paths?.length ?? 0) > 0
    || Object.keys(state.harness_files ?? {}).length > 0
    || Object.keys(state.disk_links ?? {}).length > 0
    || (state.trashed_files?.length ?? 0) > 0
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
      restoreLinks: snapshotLinks(projectSnap.state),
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
    restoreFiles: state ? flattenLiveRestoreFiles(state, globalSnap.id) : [],
    restoreLinks: state ? snapshotLinks(state) : [],
    absentPaths: state ? snapshotAbsentPaths(state) : [],
    hasCapturedState: capturedStateUseful(state),
  };
}

function readLive(rootPath: string, path: string): string | undefined {
  try {
    return readFileSync(resolve(rootPath, path), "utf-8");
  } catch {
    return undefined;
  }
}

function shouldRestorePath(rootPath: string, file: RestoreFile): RestoreDecision {
  const fullPath = resolve(rootPath, file.path);
  if (restoreBlocker(rootPath, file.path) !== undefined) {
    return "skip-blocked";
  }
  if (!existsSync(fullPath)) {
    return "write";
  }
  const wanted = file.bytes;
  if (readFileSync(fullPath).equals(wanted)) {
    return "unchanged";
  }
  const ownership = classifyManagedPathOwnership(rootPath, file.path);
  if (ownership === "unowned") {
    return "skip-unmanaged";
  }
  if (ownership === "owned") {
    return "write";
  }
  if (hashOnDiskFile(fullPath) === hashGeneratedContent(wanted.toString("utf-8"))) {
    return "unchanged";
  }
  return "skip-modified";
}

type LinkOutcome =
  | { kind: "skip"; link: { path: string; target: string }; skip: SafeRemovalSkip }
  | { kind: "present" | "make"; link: { path: string; target: string } };

function textRestoreFile(path: string, text: string): RestoreFile {
  return { path, content: text, bytes: Buffer.from(text, "utf-8") };
}

/** One warning per skip, except that the paths held up by the same file or folder share one. */
function skippedWarnings(skipped: readonly SafeRemovalSkip[]): string[] {
  const byBlocker = new Map<string, SafeRemovalSkip[]>();
  const warnings: string[] = [];
  for (const entry of skipped) {
    if (entry.reason === "missing") continue;
    if (entry.blockedBy === undefined) {
      warnings.push(entry.message);
      continue;
    }
    byBlocker.set(entry.blockedBy, [...(byBlocker.get(entry.blockedBy) ?? []), entry]);
  }
  for (const [blocker, entries] of byBlocker) {
    const [first] = entries;
    if (entries.length === 1 && first) {
      warnings.push(first.message);
      continue;
    }
    warnings.push(restoreBlockedGroupMessage(blocker, entries.map((entry) => entry.path)));
  }
  return warnings;
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
        onSkip: (skip) => skipped.push(skip),
      }),
    );
  }

  const planFiles = plan.restoreFiles.map(asRestoreFile);
  const decisions = planFiles.map((file) => ({
    file,
    decision: shouldRestorePath(plan.rootPath, file),
  }));
  const kept = new Set(
    decisions.filter((entry) => entry.decision.startsWith("skip")).map((entry) => entry.file.path),
  );
  const linkOutcomes = (plan.restoreLinks ?? []).map((link): LinkOutcome => {
    const fullPath = resolve(plan.rootPath, link.path);
    const blocker = restoreBlocker(plan.rootPath, link.path);
    if (blocker !== undefined) {
      return {
        kind: "skip",
        link,
        skip: {
          path: link.path,
          reason: "unmanaged",
          blockedBy: blocker,
          message: restoreBlockedMessage(link.path, blocker, "link"),
        },
      };
    }
    let current: string | null | undefined;
    try {
      current = lstatSync(fullPath).isSymbolicLink() ? readlinkSync(fullPath) : null;
    } catch {
      current = undefined;
    }
    if (current === link.target) return { kind: "present", link };
    if (current === undefined) return { kind: "make", link };
    // Something else is there now: it is never removed to put the link back.
    return {
      kind: "skip",
      link,
      skip: {
        path: link.path,
        reason: "modified",
        message: `Skipped restoring the link ${link.path} (something else is at that path now).`,
      },
    };
  });
  for (const entry of linkOutcomes) if (entry.kind === "skip") kept.add(entry.link.path);
  const heldBack = heldBackByRegistry(planFiles, kept);
  if (heldBack) skipped.push(...heldBack.skips);
  const isHeldBack = (path: string): boolean =>
    heldBack?.prefixes.some((prefix) => path.startsWith(prefix)) === true;

  const toWrite: RestoreFile[] = [];
  for (const { file: planned, decision } of decisions) {
    // A file that cannot be put back says why; the others of a held back plugin say nothing.
    if (isHeldBack(planned.path) && !(heldBack?.recordKeys.length && decision.startsWith("skip"))) continue;
    let file: RestoreFile = planned;
    if (heldBack && heldBack.enabledKeys.length > 0 && planned.path.endsWith("/settings.json")) {
      file = textRestoreFile(
        planned.path,
        withoutEnabledKeys(planned.content, heldBack.enabledKeys, readLive(plan.rootPath, planned.path)),
      );
    } else if (heldBack && heldBack.recordKeys.length > 0 && planned.path.endsWith("/plugins/installed_plugins.json")) {
      const live = readLive(plan.rootPath, planned.path);
      const text = withoutInstalledRecords(planned.content, heldBack.recordKeys, live);
      // Nothing left to register and no registry there: do not create an empty one.
      if (live === undefined && registersNoPlugin(text)) continue;
      file = textRestoreFile(planned.path, text);
    }
    switch (decision) {
      case "write":
        toWrite.push(file);
        restored.push(file.path);
        break;
      case "unchanged":
        restored.push(file.path);
        break;
      case "skip-modified": {
        // settings.json changed since HarnessTap wrote it (Claude Code rewrites
        // it too): add the plugin and marketplace keys the switch removed,
        // key by key, and leave the rest of the file as it is.
        const live = isClaudeSettingsPath(file.path) ? readLive(plan.rootPath, file.path) : undefined;
        const merged = live === undefined ? undefined : withSnapshotSettingsKeys(file.content, live);
        if (merged !== undefined) {
          if (merged !== live) toWrite.push(textRestoreFile(file.path, merged));
          restored.push(file.path);
          break;
        }
        skipped.push({
          path: file.path,
          reason: "modified",
          message: `Skipped restoring ${file.path} (modified since HarnessTap wrote it).`,
        });
        break;
      }
      case "skip-blocked": {
        const blocker = restoreBlocker(plan.rootPath, file.path) ?? file.path;
        skipped.push({
          path: file.path,
          reason: "unmanaged",
          blockedBy: blocker,
          message: restoreBlockedMessage(file.path, blocker),
        });
        break;
      }
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

  const linksToMake: Array<{ path: string; target: string }> = [];
  for (const entry of linkOutcomes) {
    if (isHeldBack(entry.link.path) && entry.kind !== "skip") continue;
    if (entry.kind === "skip") {
      skipped.push(entry.skip);
      continue;
    }
    if (entry.kind === "make") linksToMake.push(entry.link);
    restored.push(entry.link.path);
  }

  if (!options.dryRun) {
    for (const link of linksToMake) {
      const fullPath = resolve(plan.rootPath, link.path);
      mkdirSync(dirname(fullPath), { recursive: true });
      symlinkSync(link.target, fullPath);
    }
    for (const file of toWrite) {
      backupAndRewriteFile({
        rootPath: plan.rootPath,
        relativePath: file.path,
        nextContent: file.bytes,
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

  if (!options.dryRun) {
    restoreRemovedOwnership({
      snapshotId: plan.id,
      rootPath: plan.rootPath,
      restoredPaths: restored,
      hashOf: hashFileOrLink,
      isMergedConfig: isSharedMergedConfigPath,
    });
    restoreRemovedHostPluginViews({
      snapshotId: plan.id,
      rootPath: plan.rootPath,
      restoredPaths: restored,
      hashOf: hashFileOrLink,
    });
    for (const path of new Set(restored)) {
      if (!isClaudeSettingsPath(path)) continue;
      restoreForgottenEnabledKeys(resolve(plan.rootPath, path), plan.id);
      restoreForgottenSettingsMarketplaces(resolve(plan.rootPath, path), plan.id);
    }
  }

  const warnings = [
    ...skippedWarnings(skipped),
    ...removal.warnings,
  ];

  return {
    restored: [...new Set(restored)],
    removed: removal.removed,
    skipped: [...skipped, ...removal.skipped],
    warnings,
  };
}
