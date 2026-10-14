import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isEmptyBuiltinProfile, isProfilePlugin } from "../constants/profile.js";
import { getLatestGlobalApplySnapshotForProfile } from "../models/global-apply-snapshot.js";
import { resolvePluginSelector } from "../models/plugin-model.js";
import { listMaterializationsForRootPath } from "../models/resource-materialization.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { getActiveProfileName } from "./active-profile.js";
import {
  isTransparentCrossHarnessGap,
  resourceScopesForPlugins,
} from "./cross-harness-gap.js";
import {
  buildHostManagedStatus,
  type HostManagedStatus,
  profileSkillNameMap,
} from "./cursor-host-managed-skills.js";
import { fileContentsEquivalentForDrift } from "./file-contents-drift.js";
import { isNativeAgentPluginCachePath } from "./native-agent-plugins.js";
import {
  buildHarnessLiveStatusMap,
  classifyGlobalDriftChanges,
  collectOwnedGlobalProfileFiles,
  computeGlobalProfilePanelStatus,
  countMissingHarnessRows,
  declaredMcpFromExpectedFiles,
  type GlobalProfileDriftSummary,
  type GlobalProfilePanelStatus,
  type GlobalProfileStatusDepth,
  type HarnessLiveStatus,
  resolveProjectDriftSummary,
} from "./global-profile-status-panel.js";
import type { HarnessScope } from "./harness-scope.js";
import { mergePluginsForApply } from "./plugin-apply-merge.js";
import {
  type ApplyProfilePluginResult,
  applyProfilePlugin,
  clearGlobalProfileApply,
  collectProfilePluginIds,
} from "./profile-apply.js";
import { resourceKeyFromManagedPath } from "./profile-commit-resource.js";
import {
  buildProfileContents,
  type ProfileContents,
} from "./profile-contents.js";
import { detectNotStagedProfileResources } from "./profile-untracked-resources.js";
import { type DriftFileChange, driftChangeIsKept } from "./project-drift.js";
import { hashOnDiskFile } from "./safe-file-removal.js";
import { withAffectedResources } from "./scoped-file-content-delta.js";
import { runInStatusComputation } from "./status-computation.js";
import { withStatusReadCache } from "./status-read-cache.js";

type StatusFieldInput = Parameters<typeof buildBaseStatusFields>[0];

interface DriftCore {
  fields: Omit<StatusFieldInput, "depth">;
  harness?: string;
  watchedPaths: string[];
}

let driftCoreComputes = 0;

/** How many times the dry-run core has actually run. Tests use this. */
export function readDriftCoreComputeCount(): number {
  return driftCoreComputes;
}

function driftCore(
  fields: Omit<StatusFieldInput, "depth">,
  harness: string | undefined,
  homeRoot: string,
): DriftCore {
  const watchedPaths = (fields.expectedApply?.expected_files ?? []).map((file) =>
    join(homeRoot, file.path),
  );
  return { fields, harness, watchedPaths };
}

export interface GlobalProfileStatus {
  active_profile: string | null;
  profile_exists: boolean;
  applied: boolean;
  snapshot_id: string | null;
  snapshot_at: string | null;
  stack_in_sync: boolean;
  has_drift: boolean;
  changes: DriftFileChange[];
  warning?: string;
  depth: GlobalProfileStatusDepth;
  as_of: string;
  panel: GlobalProfilePanelStatus;
  harnesses: Record<string, HarnessLiveStatus>;
  drift_summary: GlobalProfileDriftSummary;
  contents?: ProfileContents | null;
  untracked_resource_count?: number;
  /** Alias for untracked_resource_count (not-staged working-tree resources). */
  not_staged_count?: number;
  /** App-managed inventory (full depth only); never applied or persisted. */
  host_managed?: HostManagedStatus;
  /**
   * True when this payload is the previous result and a fresh read is running.
   * Absent or false after apply, switch, and install, which wait for a new read.
   */
  refreshing?: boolean;
}

function keptContentDiff(
  path: string,
  keptModified: ReadonlySet<string>,
  keptUnmanaged: ReadonlySet<string>,
): DriftFileChange {
  if (keptModified.has(path)) {
    return { path, type: "modified", removal_group: "owned_modified" };
  }
  if (keptUnmanaged.has(path)) {
    return { path, type: "modified", removal_group: "unmanaged" };
  }
  return { path, type: "modified" };
}

function isMissingExpectedFileTransparent(
  homeRoot: string,
  path: string,
  expectedPathsByResource: ReadonlyMap<string, readonly string[]>,
  scopeByResource: ReadonlyMap<string, HarnessScope>,
): boolean {
  const mapped = resourceKeyFromManagedPath(path);
  if (!mapped) {
    return true;
  }
  const key = `${mapped.type}:${mapped.name}`;
  const siblings = expectedPathsByResource.get(key) ?? [];
  const onDiskSiblingPaths = siblings.filter(
    (sibling) => sibling !== path && readGlobalFile(homeRoot, sibling) !== null,
  );
  return isTransparentCrossHarnessGap({
    path,
    onDiskSiblingPaths,
    scope: scopeByResource.get(key),
  });
}

function readGlobalFile(homeRoot: string, relativePath: string): string | null {
  const fullPath = join(homeRoot, relativePath);
  if (!existsSync(fullPath)) {
    return null;
  }
  try {
    return readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

function pluginIdsMatch(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((pluginId, index) => pluginId === right[index]);
}

function declaredMcpFromExpectedApply(expectedApply: ApplyProfilePluginResult) {
  return declaredMcpFromExpectedFiles(
    expectedApply.harnesses,
    expectedApply.expected_files ?? [],
  );
}

function declaredMcpNamesFromMergedPlugins(pluginIds: string[]): Record<string, string[]> {
  const merged = mergePluginsForApply(pluginIds);
  const names = merged.resources
    .filter((resource) => resource.type === "mcp_server")
    .map((resource) => resource.name);
  return {
    "claude-code": names,
    cursor: names,
  };
}

function buildBaseStatusFields(input: {
  depth: GlobalProfileStatusDepth;
  activeProfile: string | null;
  profileExists: boolean;
  applied: boolean;
  snapshotId: string | null;
  snapshotAt: string | null;
  stackInSync: boolean;
  hasDrift: boolean;
  changes: DriftFileChange[];
  warning?: string;
  projectPath?: string;
  expectedApply?: ApplyProfilePluginResult;
  pluginIds?: string[];
}): GlobalProfileStatus {
  const asOf = new Date().toISOString();
  const homeRoot = resolveHomeRoot();
  const ownedFiles = collectOwnedGlobalProfileFiles(input.snapshotId);
  const blockingChanges = input.changes.filter((change) => !driftChangeIsKept(change));
  const { owned, nonOwned } = classifyGlobalDriftChanges(blockingChanges, ownedFiles);

  const declaredPins =
    input.pluginIds && input.pluginIds.length > 0
      ? mergePluginsForApply(input.pluginIds).pluginPins
      : [];
  const declaredFromExpected = input.expectedApply
    ? declaredMcpFromExpectedApply(input.expectedApply)
    : null;
  const declaredMcpByHarness =
    declaredFromExpected?.namesByHarness
    ?? (input.pluginIds
      ? declaredMcpNamesFromMergedPlugins(input.pluginIds)
      : { "claude-code": [], cursor: [] });

  const harnesses = buildHarnessLiveStatusMap({
    depth: input.depth,
    homeRoot,
    declaredPins,
    declaredMcpByHarness,
    ...(declaredFromExpected
      ? { expectedMcpConfigsByHarness: declaredFromExpected.configsByHarness }
      : {}),
  });
  const { missingPlugins, missingMcp } =
    input.depth === "full"
      ? countMissingHarnessRows(harnesses)
      : { missingPlugins: 0, missingMcp: 0 };

  const contents = input.activeProfile
    ? buildProfileContents(input.activeProfile)
    : null;
  const hostManaged =
    input.depth === "full"
      ? buildHostManagedStatus({
          homeRoot,
          profileSkills: profileSkillNameMap(contents?.resources ?? []),
        })
      : undefined;

  const projectDrift = resolveProjectDriftSummary(input.projectPath);
  const panel = computeGlobalProfilePanelStatus({
    depth: input.depth,
    applied: input.applied,
    activeProfile: input.activeProfile,
    stackInSync: input.stackInSync,
    ownedDriftCount: owned.length,
    nonOwnedDriftCount: nonOwned.length,
    missingPluginCount: missingPlugins,
    missingMcpCount: missingMcp,
    projectDrift,
    warning: input.warning,
    hostManagedCollisionCount: hostManaged?.cursor?.collisions.length ?? 0,
  });

  const driftSummary: GlobalProfileDriftSummary = {
    global: {
      status: !input.applied
        ? "pending"
        : input.hasDrift
          ? "drifted"
          : "clean",
      owned_changes: owned.length,
      non_owned_changes: nonOwned.length,
    },
    ...(projectDrift ? { project: projectDrift } : {}),
  };

  return {
    active_profile: input.activeProfile,
    profile_exists: input.profileExists,
    applied: input.applied,
    snapshot_id: input.snapshotId,
    snapshot_at: input.snapshotAt,
    stack_in_sync: input.stackInSync,
    has_drift: input.hasDrift,
    changes: input.changes,
    ...(input.warning ? { warning: input.warning } : {}),
    depth: input.depth,
    as_of: asOf,
    panel,
    harnesses,
    drift_summary: driftSummary,
    contents,
    ...(hostManaged ? { host_managed: hostManaged } : {}),
  };
}

async function finalizeGlobalProfileStatus(
  fields: Parameters<typeof buildBaseStatusFields>[0],
  harness?: string,
): Promise<GlobalProfileStatus> {
  const status = buildBaseStatusFields(fields);
  if (
    fields.depth !== "full"
    || !status.active_profile
    || isEmptyBuiltinProfile(status.active_profile)
  ) {
    return status;
  }
  try {
    const notStaged = await detectNotStagedProfileResources({
      profileSelector: status.active_profile,
      scope: "home",
      ...(harness ? { harness } : {}),
    });
    return {
      ...status,
      untracked_resource_count: notStaged.length,
      not_staged_count: notStaged.length,
    };
  } catch {
    return status;
  }
}

/**
 * Fast depth keeps the same drift fields as a full read (`changes`,
 * `has_drift`, `stack_in_sync`, `drift_summary`). The desktop drift pill
 * replaces those from every fast poll, so a cold fast read still runs the
 * dry-run. The full result, including that dry-run and profile contents, is
 * cached. A warm read is a map lookup while file watchers are healthy.
 * Status does not read Cursor's state.vscdb or logs folder. Where a watcher
 * could not be installed, mtimes and sizes of the remaining files are
 * checked instead.
 * A later read, including fast after full of the same inputs,
 * skips the dry-run. When a watched input changes, the previous result is
 * returned with `refreshing` set and the new read runs on a background
 * thread. A warm or stale response does not wait for that read.
 * Apply, switch, and install clear the cache first, so the next read waits
 * and is not stale. Overlapping callers share one in-flight computation.
 */
export async function detectGlobalProfileStatus(input: {
  harness?: string;
  depth?: GlobalProfileStatusDepth;
  projectPath?: string;
} = {}): Promise<GlobalProfileStatus> {
  const depth = input.depth ?? "full";
  const request = {
    depth,
    harness: input.harness,
    projectPath: input.projectPath,
  };
  const status = await withStatusReadCache(request, () => runInStatusComputation(async () => {
    const core = await withStatusReadCache(
      { ...request, includeDepth: false },
      async () => {
        const loaded = await loadDriftCore(input);
        return { value: loaded, watchedPaths: loaded.watchedPaths };
      },
    );
    const projected = await finalizeGlobalProfileStatus(
      { ...core.fields, depth },
      core.harness,
    );
    return { value: projected, watchedPaths: core.watchedPaths };
  }), { staleWhileRefresh: true });
  return {
    ...status,
    as_of: new Date().toISOString(),
    refreshing: status.refreshing === true,
  };
}

/**
 * Full status computation with no cache. The refresh worker runs this off the
 * request thread. A warm or stale response must not wait for it.
 */
export async function loadGlobalProfileStatusSnapshot(input: {
  harness?: string;
  depth?: GlobalProfileStatusDepth;
  projectPath?: string;
} = {}): Promise<{ value: GlobalProfileStatus; watchedPaths: string[] }> {
  const depth = input.depth ?? "full";
  return runInStatusComputation(async () => {
    const loaded = await loadDriftCore(input);
    const projected = await finalizeGlobalProfileStatus(
      { ...loaded.fields, depth },
      loaded.harness,
    );
    return { value: projected, watchedPaths: loaded.watchedPaths };
  });
}

async function loadDriftCore(input: {
  harness?: string;
  depth?: GlobalProfileStatusDepth;
  projectPath?: string;
}): Promise<DriftCore> {
  driftCoreComputes += 1;
  const homeRoot = resolveHomeRoot();
  const activeProfile = getActiveProfileName() ?? null;
  if (!activeProfile) {
    return driftCore(
      {
        activeProfile: null,
        profileExists: false,
        applied: false,
        snapshotId: null,
        snapshotAt: null,
        stackInSync: false,
        hasDrift: false,
        changes: [],
        projectPath: input.projectPath,
      },
      input.harness,
      homeRoot,
    );
  }

  const plugin = resolvePluginSelector(activeProfile);
  if (!plugin) {
    if (isEmptyBuiltinProfile(activeProfile)) {
      const latestSnapshot = getLatestGlobalApplySnapshotForProfile(activeProfile);
      let expectedApply: ApplyProfilePluginResult;
      try {
        expectedApply = await clearGlobalProfileApply({
          dryRun: true,
          harness: input.harness,
          conflictPolicy: "replace",
          pull: false,
        });
      } catch (error) {
        return driftCore({
          activeProfile,
          profileExists: true,
          applied: Boolean(latestSnapshot),
          snapshotId: latestSnapshot?.id ?? null,
          snapshotAt: latestSnapshot?.created_at ?? null,
          stackInSync: false,
          hasDrift: true,
          changes: [],
          warning: error instanceof Error ? error.message : String(error),
          projectPath: input.projectPath,
          pluginIds: [],
        }, input.harness, homeRoot);
      }

      const stackInSync = latestSnapshot
        ? pluginIdsMatch(latestSnapshot.plugin_ids, expectedApply.configured_plugin_ids)
        : false;
      const applied = Boolean(latestSnapshot);
      const hasDrift = !applied || !stackInSync;

      return driftCore({
        activeProfile,
        profileExists: true,
        applied,
        snapshotId: latestSnapshot?.id ?? null,
        snapshotAt: latestSnapshot?.created_at ?? null,
        stackInSync,
        hasDrift,
        changes: [],
        projectPath: input.projectPath,
        expectedApply,
        pluginIds: [],
      }, input.harness, homeRoot);
    }

    return driftCore({
      activeProfile,
      profileExists: false,
      applied: false,
      snapshotId: null,
      snapshotAt: null,
      stackInSync: false,
      hasDrift: true,
      changes: [],
      warning: `missing plugin "${activeProfile}"`,
      projectPath: input.projectPath,
    }, input.harness, homeRoot);
  }

  if (!isProfilePlugin(plugin)) {
    return driftCore({
      activeProfile,
      profileExists: true,
      applied: false,
      snapshotId: null,
      snapshotAt: null,
      stackInSync: false,
      hasDrift: true,
      changes: [],
      warning: `plugin "${plugin.name}" is not tagged as a profile`,
      projectPath: input.projectPath,
    }, input.harness, homeRoot);
  }

  const latestSnapshot = getLatestGlobalApplySnapshotForProfile(activeProfile);
  const pluginIds = collectProfilePluginIds(plugin);
  let expectedApply: ApplyProfilePluginResult;
  try {
    expectedApply = await applyProfilePlugin(activeProfile, {
      dryRun: true,
      harness: input.harness,
      conflictPolicy: "replace",
      pull: false,
      pinSkillEmits: false,
      mergeLiveSkillMarkdown: false,
    });
  } catch (error) {
    return driftCore({
      activeProfile,
      profileExists: true,
      applied: Boolean(latestSnapshot),
      snapshotId: latestSnapshot?.id ?? null,
      snapshotAt: latestSnapshot?.created_at ?? null,
      stackInSync: false,
      hasDrift: true,
      changes: [],
      warning: error instanceof Error ? error.message : String(error),
      projectPath: input.projectPath,
      pluginIds,
    }, input.harness, homeRoot);
  }

  const stackInSync = latestSnapshot
    ? pluginIdsMatch(latestSnapshot.plugin_ids, expectedApply.configured_plugin_ids)
    : false;

  const changes: DriftFileChange[] = [];
  const keptModified = new Set(expectedApply.removals?.owned_modified ?? []);
  const keptUnmanaged = new Set(expectedApply.removals?.unmanaged ?? []);
  const scopeByResource = resourceScopesForPlugins(pluginIds);
  const expectedPathsByResource = new Map<string, string[]>();
  for (const file of expectedApply.expected_files ?? []) {
    const mapped = resourceKeyFromManagedPath(file.path);
    if (!mapped) {
      continue;
    }
    const key = `${mapped.type}:${mapped.name}`;
    const paths = expectedPathsByResource.get(key) ?? [];
    paths.push(file.path);
    expectedPathsByResource.set(key, paths);
  }
  for (const file of expectedApply.expected_files ?? []) {
    if (isNativeAgentPluginCachePath(file.path)) continue;
    const current = readGlobalFile(homeRoot, file.path);
    const owned = listMaterializationsForRootPath(homeRoot, file.path);
    if (current === null) {
      if (owned.length === 0 && isMissingExpectedFileTransparent(
        homeRoot,
        file.path,
        expectedPathsByResource,
        scopeByResource,
      )) {
        continue;
      }
      changes.push(
        withAffectedResources({ path: file.path, type: "deleted" }, file.content, null),
      );
      continue;
    }
    if (owned.length > 0) {
      const diskHash = hashOnDiskFile(join(homeRoot, file.path));
      if (owned.some((row) => row.generated_hash === diskHash)) {
        continue;
      }
      if (fileContentsEquivalentForDrift(file.path, current, file.content)) {
        continue;
      }
      changes.push(
        withAffectedResources(
          keptContentDiff(file.path, keptModified, keptUnmanaged),
          file.content,
          current,
        ),
      );
      continue;
    }
    if (!fileContentsEquivalentForDrift(file.path, current, file.content)) {
      changes.push(
        withAffectedResources(
          keptContentDiff(file.path, keptModified, keptUnmanaged),
          file.content,
          current,
        ),
      );
    }
  }

  const applied = Boolean(latestSnapshot);
  const blockingChanges = changes.filter((change) => !driftChangeIsKept(change));
  const hasDrift = !applied || !stackInSync || blockingChanges.length > 0;

  return driftCore(
    {
      activeProfile,
      profileExists: true,
      applied,
      snapshotId: latestSnapshot?.id ?? null,
      snapshotAt: latestSnapshot?.created_at ?? null,
      stackInSync,
      hasDrift,
      changes,
      projectPath: input.projectPath,
      expectedApply,
      pluginIds,
    },
    input.harness,
    homeRoot,
  );
}
