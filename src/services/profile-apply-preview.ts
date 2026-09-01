import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isEmptyBuiltinProfile, isProfilePlugin } from "../constants/profile.js";
import { getProjectByLocalPath, getProjectByOrigin } from "../models/project.js";
import { getLatestSnapshot } from "../models/snapshot.js";
import { resolvePluginSelector } from "../models/plugin-model.js";
import type { McpServerMetadata, Resource } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { getActiveProfileName } from "./active-profile.js";
import { generateFiles } from "./applier.js";
import { getGitOrigin, normalizeGitUrl } from "./git.js";
import {
  buildHostManagedStatus,
  profileSkillNameMap,
  type HostManagedStatus,
} from "./cursor-host-managed-skills.js";
import {
  buildHarnessLiveStatusMap,
  declaredMcpFromExpectedFiles,
  type HarnessLiveStatus,
} from "./global-profile-status-panel.js";
import { mergePluginsForApply } from "./plugin-apply-merge.js";
import { fileContentsEquivalentForDrift } from "./file-contents-drift.js";
import {
  collectOwnedPreviewResources,
  expectedFileMatchesLiveForPreview,
  omitInheritedPluginFileChanges,
} from "./apply-preview-inherited.js";
import {
  applyProfilePlugin,
  clearGlobalProfileApply,
  collectProfilePluginIds,
  type ApplyProfilePluginResult,
} from "./profile-apply.js";
import {
  buildProfileContents,
  type ProfileContents,
  type ProfileContentsResource,
} from "./profile-contents.js";
import { resourceKeyFromManagedPath } from "./profile-commit-resource.js";
import type { DriftFileChange } from "./project-drift.js";
import { detectNotStagedProfileResources } from "./profile-untracked-resources.js";
import {
  isMergeableHostConfigPath,
} from "./merged-host-config.js";
import { detectPlatforms } from "./scanner.js";
import {
  SingletonConflictError,
  UnsatisfiableConstraintError,
  type RecoveryAction,
} from "./resolve/types.js";

export type ProfileApplyPreviewScope = "home" | "project";

export interface ProfileApplyPreviewRequest {
  profile: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}

export interface ProfileApplyPreview {
  profile: string;
  scope: ProfileApplyPreviewScope;
  contents: ProfileContents | null;
  harnesses?: Record<string, HarnessLiveStatus>;
  /** Material resources on disk not attached to the target profile (not staged). */
  not_staged: ProfileContentsResource[];
  /** @deprecated Use not_staged. */
  untracked_resources: ProfileContentsResource[];
  files: {
    expected_count: number;
    /** File changes for tracked (profile-managed) paths only. */
    changes: DriftFileChange[];
    root_path: string;
    /** Resource identities owned by the target apply set (including inherited plugin material). */
    owned_resources?: Array<{ type: string; name: string }>;
  };
  relative_to_active: boolean;
  warning?: string;
  recovery_actions?: RecoveryAction[];
  /** App-managed inventory for home scope; never applied or persisted. */
  host_managed?: HostManagedStatus;
}

function warningFromError(error: unknown): {
  warning: string;
  recovery_actions?: RecoveryAction[];
} {
  if (error instanceof UnsatisfiableConstraintError) {
    return {
      warning: error.message,
      recovery_actions: error.actions,
    };
  }
  if (error instanceof SingletonConflictError) {
    return {
      warning: error.message,
      recovery_actions: error.actions,
    };
  }
  return {
    warning: error instanceof Error ? error.message : String(error),
  };
}

function notProfileWarning(pluginName: string): {
  warning: string;
  recovery_actions: RecoveryAction[];
} {
  return {
    warning: `plugin "${pluginName}" is not tagged as a profile`,
    recovery_actions: [
      {
        id: "tag-as-profile",
        label: `Tag ${pluginName} as a profile`,
        pluginName,
      },
    ],
  };
}

function spreadWarningFields(input: {
  warning?: string;
  recovery_actions?: RecoveryAction[];
}): { warning?: string; recovery_actions?: RecoveryAction[] } {
  return {
    ...(input.warning ? { warning: input.warning } : {}),
    ...(input.recovery_actions ? { recovery_actions: input.recovery_actions } : {}),
  };
}

function readRootFile(rootPath: string, relativePath: string): string | null {
  const fullPath = join(rootPath, relativePath);
  if (!existsSync(fullPath)) {
    return null;
  }
  try {
    return readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

function declaredMcpFromExpectedApply(expectedApply: ApplyProfilePluginResult): {
  namesByHarness: Record<string, string[]>;
  configsByHarness: Record<string, Record<string, McpServerMetadata>>;
} {
  return declaredMcpFromExpectedFiles(
    expectedApply.harnesses,
    expectedApply.expected_files ?? [],
  );
}

function uniqueExpectedFiles(
  expectedFiles: Array<{ path: string; content: string }>,
): Array<{ path: string; content: string }> {
  const seen = new Set<string>();
  const unique: Array<{ path: string; content: string }> = [];
  for (const file of expectedFiles) {
    if (seen.has(file.path)) {
      continue;
    }
    seen.add(file.path);
    unique.push(file);
  }
  return unique;
}

function compareExpectedFiles(
  rootPath: string,
  expectedFiles: Array<{ path: string; content: string }>,
): DriftFileChange[] {
  const changes: DriftFileChange[] = [];
  const homeRoot = resolveHomeRoot();
  for (const file of uniqueExpectedFiles(expectedFiles)) {
    const current = readRootFile(rootPath, file.path);
    if (expectedFileMatchesLiveForPreview(homeRoot, file, current)) {
      continue;
    }
    if (current === null) {
      changes.push({ path: file.path, type: "deleted" });
      continue;
    }
    if (!fileContentsEquivalentForDrift(file.path, current, file.content)) {
      changes.push({ path: file.path, type: "modified" });
    }
  }
  return changes;
}

/**
 * Hide "would add" gaps for alternate harness materializations when the same
 * profile resource is already present on disk under another harness path.
 * Apply still writes those files; File changes stays transparent.
 */
export function omitTransparentCrossHarnessAdds(
  rootPath: string,
  expectedFiles: Array<{ path: string; content: string }>,
  changes: DriftFileChange[],
): DriftFileChange[] {
  const siblingPathsByResource = new Map<string, string[]>();
  for (const file of uniqueExpectedFiles(expectedFiles)) {
    const mapped = resourceKeyFromManagedPath(file.path);
    if (!mapped) {
      continue;
    }
    const key = `${mapped.type}:${mapped.name}`;
    const siblings = siblingPathsByResource.get(key) ?? [];
    siblings.push(file.path);
    siblingPathsByResource.set(key, siblings);
  }

  return changes.filter((change) => {
    if (change.type !== "deleted") {
      return true;
    }
    const mapped = resourceKeyFromManagedPath(change.path);
    if (!mapped) {
      return true;
    }
    const siblings = siblingPathsByResource.get(`${mapped.type}:${mapped.name}`) ?? [];
    const materializedElsewhere = siblings.some(
      (path) =>
        path !== change.path && readRootFile(rootPath, path) !== null,
    );
    return !materializedElsewhere;
  });
}

/**
 * Claude `.claude/settings.json` is a shared host config. Apply merges
 * profile-managed keys and never deletes the whole file, so preview must not
 * list it as a would-delete (`added`) stack item.
 */
function omitMergeableHostConfigRemovals(
  changes: DriftFileChange[],
): DriftFileChange[] {
  return changes.filter(
    (change) =>
      !(change.type === "added" && isMergeableHostConfigPath(change.path)),
  );
}

function withMappedResources(changes: DriftFileChange[]): DriftFileChange[] {
  return changes.map((change) => {
    const mapped = resourceKeyFromManagedPath(change.path);
    return mapped ? { ...change, resource: mapped } : change;
  });
}

/**
 * Map planned apply removals into File changes as drift "added" (on disk, not
 * expected → apply would delete). Skip paths that are already gone so Target
 * preview does not show phantom − rows.
 */
export function withManagedRemovals(
  rootPath: string,
  changes: DriftFileChange[],
  removedFiles: string[] | undefined,
): DriftFileChange[] {
  if (!removedFiles || removedFiles.length === 0) {
    return changes;
  }
  const seen = new Set(changes.map((change) => change.path));
  const next = [...changes];
  for (const path of removedFiles) {
    if (seen.has(path) || isMergeableHostConfigPath(path)) {
      continue;
    }
    if (readRootFile(rootPath, path) === null) {
      continue;
    }
    seen.add(path);
    next.push({ path, type: "added" });
  }
  return next;
}

function targetPinRefs(pluginIds?: string[]): Set<string> {
  if (!pluginIds || pluginIds.length === 0) {
    return new Set();
  }
  return new Set(
    mergePluginsForApply(pluginIds).pluginPins.map((pin) => pin.ref),
  );
}

function buildPreviewFileChanges(
  rootPath: string,
  expectedFiles: Array<{ path: string; content: string }>,
  removedFiles: string[] | undefined,
  pluginIds?: string[],
): DriftFileChange[] {
  const mapped = withMappedResources(
    omitMergeableHostConfigRemovals(
      withManagedRemovals(
        rootPath,
        omitTransparentCrossHarnessAdds(
          rootPath,
          expectedFiles,
          compareExpectedFiles(rootPath, expectedFiles),
        ),
        removedFiles,
      ),
    ),
  );
  return omitInheritedPluginFileChanges(
    resolveHomeRoot(),
    mapped,
    targetPinRefs(pluginIds),
  );
}

function previewFilesResult(
  rootPath: string,
  expectedFiles: Array<{ path: string; content: string }>,
  removedFiles: string[] | undefined,
  pluginIds?: string[],
): ProfileApplyPreview["files"] {
  return {
    expected_count: expectedFiles.length,
    changes: buildPreviewFileChanges(
      rootPath,
      expectedFiles,
      removedFiles,
      pluginIds,
    ),
    root_path: rootPath,
    owned_resources: collectOwnedPreviewResources(expectedFiles),
  };
}

function isMaterialResource(resource: Resource): boolean {
  return resource.type !== "plugin";
}

export interface CollectExpectedManagedFilesInput {
  profile: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}

export interface CollectExpectedManagedFilesResult {
  rootPath: string;
  expectedFiles: Array<{ path: string; content: string }>;
  warning?: string;
  recovery_actions?: RecoveryAction[];
  expectedApply?: ApplyProfilePluginResult;
  pluginIds?: string[];
  removedFiles?: string[];
}

async function collectHomeExpectedManagedFiles(
  profile: string,
  harness?: string,
): Promise<CollectExpectedManagedFilesResult> {
  const homeRoot = resolveHomeRoot();

  if (isEmptyBuiltinProfile(profile)) {
    try {
      const expectedApply = await clearGlobalProfileApply({
        dryRun: true,
        harness,
        conflictPolicy: "replace",
        pull: false,
      });
      return {
        rootPath: homeRoot,
        expectedFiles: uniqueExpectedFiles(expectedApply.expected_files ?? []),
        expectedApply,
        removedFiles: expectedApply.removed_files,
      };
    } catch (error) {
      return {
        rootPath: homeRoot,
        expectedFiles: [],
        ...warningFromError(error),
      };
    }
  }

  const plugin = resolvePluginSelector(profile);
  if (!plugin) {
    return {
      rootPath: homeRoot,
      expectedFiles: [],
      warning: `missing plugin "${profile}"`,
    };
  }
  if (!isProfilePlugin(plugin)) {
    return {
      rootPath: homeRoot,
      expectedFiles: [],
      ...notProfileWarning(plugin.name),
    };
  }

  const pluginIds = collectProfilePluginIds(plugin);
  try {
    const expectedApply = await applyProfilePlugin(profile, {
      dryRun: true,
      harness,
      conflictPolicy: "replace",
      pull: false,
    });
    return {
      rootPath: homeRoot,
      expectedFiles: uniqueExpectedFiles(expectedApply.expected_files ?? []),
      expectedApply,
      pluginIds,
      removedFiles: expectedApply.removed_files,
    };
  } catch (error) {
    return {
      rootPath: homeRoot,
      expectedFiles: [],
      pluginIds,
      ...warningFromError(error),
    };
  }
}

function snapshotPreviousPaths(resolvedRoot: string): string[] {
  const gitOriginRaw = getGitOrigin(resolvedRoot);
  const gitOrigin = gitOriginRaw ? normalizeGitUrl(gitOriginRaw) : null;
  const project =
    getProjectByLocalPath(resolvedRoot)
    ?? (gitOrigin ? getProjectByOrigin(gitOrigin) : undefined)
    ?? null;
  const snapshot = project ? getLatestSnapshot(project.id) : null;
  return snapshot
    ? Object.values(snapshot.state.platform_files).flatMap((files) =>
        Object.keys(files),
      )
    : [];
}

async function collectProjectExpectedManagedFiles(
  profile: string,
  projectPath?: string,
  harness?: string,
): Promise<CollectExpectedManagedFilesResult> {
  if (!projectPath) {
    return {
      rootPath: resolve(""),
      expectedFiles: [],
      warning: "projectPath is required for project scope",
    };
  }

  const resolvedRoot = resolve(projectPath);
  const plugin = resolvePluginSelector(profile);
  if (!plugin) {
    return {
      rootPath: resolvedRoot,
      expectedFiles: [],
      warning: `missing plugin "${profile}"`,
    };
  }
  if (!isProfilePlugin(plugin) && !isEmptyBuiltinProfile(profile)) {
    return {
      rootPath: resolvedRoot,
      expectedFiles: [],
      ...notProfileWarning(plugin.name),
    };
  }

  const detected = detectPlatforms(resolvedRoot);
  const platformIds = harness
    ? detected.filter((id) => id === harness)
    : detected;

  if (isEmptyBuiltinProfile(profile) || platformIds.length === 0) {
    return {
      rootPath: resolvedRoot,
      expectedFiles: [],
      removedFiles: snapshotPreviousPaths(resolvedRoot),
    };
  }

  const pluginIds = collectProfilePluginIds(plugin);
  const merged = mergePluginsForApply(pluginIds);
  const material = merged.resources.filter(isMaterialResource);
  try {
    const generated = await generateFiles(material, platformIds, resolvedRoot, {
      target: "project",
      claudeConfig: merged.claude,
    });
    const expectedFiles = uniqueExpectedFiles(
      generated.flatMap((result) =>
        result.files.map((file) => ({ path: file.path, content: file.content })),
      ),
    );
    const previousPaths = snapshotPreviousPaths(resolvedRoot);
    const desired = new Set(expectedFiles.map((file) => file.path));
    const removedFiles = previousPaths.filter((path) => !desired.has(path));
    return {
      rootPath: resolvedRoot,
      expectedFiles,
      pluginIds,
      removedFiles,
    };
  } catch (error) {
    return {
      rootPath: resolvedRoot,
      expectedFiles: [],
      pluginIds,
      ...warningFromError(error),
    };
  }
}

export async function collectExpectedManagedFiles(
  input: CollectExpectedManagedFilesInput,
): Promise<CollectExpectedManagedFilesResult> {
  if (input.scope === "project") {
    return collectProjectExpectedManagedFiles(
      input.profile,
      input.projectPath,
      input.harness,
    );
  }
  return collectHomeExpectedManagedFiles(input.profile, input.harness);
}

async function previewHomeApply(
  profile: string,
  harness?: string,
): Promise<
  Pick<ProfileApplyPreview, "harnesses" | "files" | "warning" | "recovery_actions">
> {
  const collected = await collectHomeExpectedManagedFiles(profile, harness);

  if (collected.warning) {
    if (collected.pluginIds) {
      const merged = mergePluginsForApply(collected.pluginIds);
      const declaredMcpByHarness = {
        "claude-code": merged.resources
          .filter((resource) => resource.type === "mcp_server")
          .map((resource) => resource.name),
        cursor: merged.resources
          .filter((resource) => resource.type === "mcp_server")
          .map((resource) => resource.name),
      };
      return {
        harnesses: buildHarnessLiveStatusMap({
          depth: "full",
          homeRoot: collected.rootPath,
          declaredPins: merged.pluginPins,
          declaredMcpByHarness,
        }),
        files: {
          expected_count: 0,
          changes: withMappedResources([]),
          root_path: collected.rootPath,
        },
        ...spreadWarningFields(collected),
      };
    }
    return {
      files: {
        expected_count: 0,
        changes: withMappedResources([]),
        root_path: collected.rootPath,
      },
      ...spreadWarningFields(collected),
    };
  }

  if (isEmptyBuiltinProfile(profile)) {
    return {
      harnesses: buildHarnessLiveStatusMap({
        depth: "full",
        homeRoot: collected.rootPath,
        declaredPins: [],
        declaredMcpByHarness: {},
      }),
      files: previewFilesResult(
        collected.rootPath,
        collected.expectedFiles,
        collected.removedFiles,
        collected.pluginIds,
      ),
    };
  }

  const declaredPins = collected.pluginIds
    ? mergePluginsForApply(collected.pluginIds).pluginPins
    : [];
  const declaredMcp = collected.expectedApply
    ? declaredMcpFromExpectedApply(collected.expectedApply)
    : { namesByHarness: {}, configsByHarness: {} };
  return {
    harnesses: buildHarnessLiveStatusMap({
      depth: "full",
      homeRoot: collected.rootPath,
      declaredPins,
      declaredMcpByHarness: declaredMcp.namesByHarness,
      expectedMcpConfigsByHarness: declaredMcp.configsByHarness,
    }),
    files: previewFilesResult(
      collected.rootPath,
      collected.expectedFiles,
      collected.removedFiles,
      collected.pluginIds,
    ),
  };
}

async function previewProjectApply(
  profile: string,
  projectPath?: string,
  harness?: string,
): Promise<Pick<ProfileApplyPreview, "files" | "warning" | "recovery_actions">> {
  const collected = await collectProjectExpectedManagedFiles(
    profile,
    projectPath,
    harness,
  );

  return {
    files: previewFilesResult(
      collected.rootPath,
      collected.expectedFiles,
      collected.removedFiles,
      collected.pluginIds,
    ),
    ...spreadWarningFields(collected),
  };
}

export async function previewProfileApply(
  input: ProfileApplyPreviewRequest,
): Promise<ProfileApplyPreview> {
  const profile = input.profile.trim();
  const contents = buildProfileContents(profile);
  const relativeToActive = getActiveProfileName() === profile;
  const notStaged = await detectNotStagedProfileResources({
    profileSelector: profile,
    scope: input.scope,
    ...(input.projectPath ? { projectPath: input.projectPath } : {}),
    ...(input.harness ? { harness: input.harness } : {}),
  });

  if (input.scope === "project") {
    const projectPreview = await previewProjectApply(
      profile,
      input.projectPath,
      input.harness,
    );
    return {
      profile,
      scope: "project",
      contents,
      not_staged: notStaged,
      untracked_resources: notStaged,
      files: projectPreview.files,
      relative_to_active: relativeToActive,
      ...spreadWarningFields(projectPreview),
    };
  }

  const homePreview = await previewHomeApply(profile, input.harness);
  return {
    profile,
    scope: "home",
    contents,
    not_staged: notStaged,
    untracked_resources: notStaged,
    ...(homePreview.harnesses ? { harnesses: homePreview.harnesses } : {}),
    files: homePreview.files,
    relative_to_active: relativeToActive,
    host_managed: buildHostManagedStatus({
      homeRoot: homePreview.files.root_path,
      profileSkills: profileSkillNameMap(contents?.resources ?? []),
    }),
    ...spreadWarningFields(homePreview),
  };
}
