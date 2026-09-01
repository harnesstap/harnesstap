import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isEmptyBuiltinProfile, isProfilePlugin } from "../constants/profile.js";
import { getLatestGlobalApplySnapshotForProfile } from "../models/global-apply-snapshot.js";
import { resolvePluginSelector } from "../models/plugin-model.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { getActiveProfileName } from "./active-profile.js";
import {
  applyProfilePlugin,
  clearGlobalProfileApply,
  collectProfilePluginIds,
  type ApplyProfilePluginResult,
} from "./profile-apply.js";
import { mergePluginsForApply } from "./plugin-apply-merge.js";
import { fileContentsEquivalentForDrift } from "./file-contents-drift.js";
import type { DriftFileChange } from "./project-drift.js";
import { detectNotStagedProfileResources } from "./profile-untracked-resources.js";
import {
  buildProfileContents,
  type ProfileContents,
} from "./profile-contents.js";
import {
  buildHostManagedStatus,
  profileSkillNameMap,
  type HostManagedStatus,
} from "./cursor-host-managed-skills.js";
import {
  buildHarnessLiveStatusMap,
  classifyGlobalDriftChanges,
  collectOwnedGlobalProfileFiles,
  computeGlobalProfilePanelStatus,
  countMissingHarnessRows,
  declaredMcpFromExpectedFiles,
  resolveProjectDriftSummary,
  type GlobalProfileDriftSummary,
  type GlobalProfilePanelStatus,
  type GlobalProfileStatusDepth,
  type HarnessLiveStatus,
} from "./global-profile-status-panel.js";

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
  const { owned, nonOwned } = classifyGlobalDriftChanges(input.changes, ownedFiles);

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

export async function detectGlobalProfileStatus(input: {
  harness?: string;
  depth?: GlobalProfileStatusDepth;
  projectPath?: string;
} = {}): Promise<GlobalProfileStatus> {
  const depth = input.depth ?? "full";
  const activeProfile = getActiveProfileName() ?? null;
  if (!activeProfile) {
    return finalizeGlobalProfileStatus(
      {
        depth,
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
        return finalizeGlobalProfileStatus({
          depth,
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
        });
      }

      const stackInSync = latestSnapshot
        ? pluginIdsMatch(latestSnapshot.plugin_ids, expectedApply.configured_plugin_ids)
        : false;
      const applied = Boolean(latestSnapshot);
      const hasDrift = !applied || !stackInSync;

      return finalizeGlobalProfileStatus({
        depth,
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
      });
    }

    return finalizeGlobalProfileStatus({
      depth,
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
    });
  }

  if (!isProfilePlugin(plugin)) {
    return finalizeGlobalProfileStatus({
      depth,
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
    });
  }

  const latestSnapshot = getLatestGlobalApplySnapshotForProfile(activeProfile);
  const homeRoot = resolveHomeRoot();
  const pluginIds = collectProfilePluginIds(plugin);
  let expectedApply: ApplyProfilePluginResult;
  try {
    expectedApply = await applyProfilePlugin(activeProfile, {
      dryRun: true,
      harness: input.harness,
      conflictPolicy: "replace",
      pull: false,
    });
  } catch (error) {
    return finalizeGlobalProfileStatus({
      depth,
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
    });
  }

  const stackInSync = latestSnapshot
    ? pluginIdsMatch(latestSnapshot.plugin_ids, expectedApply.configured_plugin_ids)
    : false;

  const changes: DriftFileChange[] = [];
  for (const file of expectedApply.expected_files ?? []) {
    const current = readGlobalFile(homeRoot, file.path);
    if (current === null) {
      changes.push({ path: file.path, type: "deleted" });
      continue;
    }
    if (!fileContentsEquivalentForDrift(file.path, current, file.content)) {
      changes.push({ path: file.path, type: "modified" });
    }
  }

  const applied = Boolean(latestSnapshot);
  const hasDrift = !applied || !stackInSync || changes.length > 0;

  return finalizeGlobalProfileStatus(
    {
      depth,
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
  );
}
