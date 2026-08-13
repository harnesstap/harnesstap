import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isEmptyBuiltinProfile, isProfilePlugin } from "../constants/profile.js";
import { getProjectByLocalPath, getProjectByOrigin } from "../models/project.js";
import { getLatestSnapshot } from "../models/snapshot.js";
import { resolvePluginSelector } from "../models/plugin-model.js";
import { listResources } from "../models/resource.js";
import type { Resource } from "../types.js";
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
  type HarnessLiveStatus,
} from "./global-profile-status-panel.js";
import { mergePluginsForApply } from "./plugin-apply-merge.js";
import { parseMcpServersDocument } from "./mcp-config-bridge.js";
import { fileContentsEquivalentForDrift } from "./file-contents-drift.js";
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
  /** Material resources on disk not attached to any profile (not staged). */
  not_staged: ProfileContentsResource[];
  /** @deprecated Use not_staged. */
  untracked_resources: ProfileContentsResource[];
  files: {
    expected_count: number;
    /** File changes for tracked (profile-managed) paths only. */
    changes: DriftFileChange[];
    root_path: string;
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

function declaredMcpNamesFromExpectedApply(
  expectedApply: ApplyProfilePluginResult,
): Record<string, string[]> {
  const byHarness: Record<string, string[]> = {};

  for (const harnessId of expectedApply.harnesses) {
    const mcpPaths = new Set<string>();
    if (harnessId === "cursor") {
      mcpPaths.add(".cursor/mcp.json");
    } else if (harnessId === "claude-code") {
      mcpPaths.add(".mcp.json");
    }

    const names = new Set<string>();
    for (const file of expectedApply.expected_files ?? []) {
      if (!mcpPaths.has(file.path)) {
        continue;
      }
      try {
        const document = JSON.parse(file.content) as unknown;
        for (const name of Object.keys(parseMcpServersDocument(document))) {
          names.add(name);
        }
      } catch {
        // skip invalid MCP config payloads
      }
    }
    byHarness[harnessId] = [...names];
  }

  return byHarness;
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
  for (const file of uniqueExpectedFiles(expectedFiles)) {
    const current = readRootFile(rootPath, file.path);
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

const CLAUDE_SETTINGS_RELATIVE = ".claude/settings.json";
const CLAUDE_MERGED_CONTAINER_RESOURCE_TYPES = new Set([
  "permission",
  "env_var",
  "hook",
]);

function profileManagesClaudeSettings(pluginIds: string[] | undefined): boolean {
  if (!pluginIds || pluginIds.length === 0) {
    return false;
  }
  const merged = mergePluginsForApply(pluginIds);
  return merged.resources.some((resource) =>
    CLAUDE_MERGED_CONTAINER_RESOURCE_TYPES.has(resource.type),
  );
}

/**
 * When Claude `.claude/settings.json` exists on disk but is not among expected
 * apply files, surface it as drift type `added` (on disk, not expected by the
 * profile).
 */
function withUnmanagedMergedContainers(
  rootPath: string,
  expectedFiles: Array<{ path: string; content: string }>,
  changes: DriftFileChange[],
  profileManagesSettings: boolean,
): DriftFileChange[] {
  const expectedNormalized = new Set(
    expectedFiles.map((file) =>
      file.path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^~\//, ""),
    ),
  );
  const settingsAlreadyExpected = [...expectedNormalized].some(
    (path) => path === CLAUDE_SETTINGS_RELATIVE || path.endsWith(`/${CLAUDE_SETTINGS_RELATIVE}`),
  );
  if (settingsAlreadyExpected || profileManagesSettings) {
    return changes;
  }
  if (readRootFile(rootPath, CLAUDE_SETTINGS_RELATIVE) === null) {
    return changes;
  }
  const alreadyListed = changes.some(
    (change) =>
      change.path.replace(/\\/g, "/").replace(/^~\//, "") === CLAUDE_SETTINGS_RELATIVE
      || change.path.replace(/\\/g, "/").endsWith(`/${CLAUDE_SETTINGS_RELATIVE}`),
  );
  if (alreadyListed) {
    return changes;
  }
  return [...changes, { path: CLAUDE_SETTINGS_RELATIVE, type: "added" }];
}

function withMappedResources(changes: DriftFileChange[]): DriftFileChange[] {
  const originsByKey = new Map<string, string>();
  for (const resource of listResources()) {
    const key = `${resource.type}:${resource.name}`;
    if (!originsByKey.has(key)) {
      originsByKey.set(key, resource.origin_kind);
    }
  }
  return changes.map((change) => {
    const mapped = resourceKeyFromManagedPath(change.path);
    if (!mapped) {
      return change;
    }
    const origin_kind = originsByKey.get(`${mapped.type}:${mapped.name}`);
    return {
      ...change,
      resource: origin_kind ? { ...mapped, origin_kind } : mapped,
    };
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
    if (seen.has(path)) {
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

function buildPreviewFileChanges(
  rootPath: string,
  expectedFiles: Array<{ path: string; content: string }>,
  removedFiles: string[] | undefined,
  pluginIds?: string[],
): DriftFileChange[] {
  return withMappedResources(
    withUnmanagedMergedContainers(
      rootPath,
      expectedFiles,
      withManagedRemovals(
        rootPath,
        omitTransparentCrossHarnessAdds(
          rootPath,
          expectedFiles,
          compareExpectedFiles(rootPath, expectedFiles),
        ),
        removedFiles,
      ),
      profileManagesClaudeSettings(pluginIds),
    ),
  );
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
      files: {
        expected_count: collected.expectedFiles.length,
        changes: buildPreviewFileChanges(
          collected.rootPath,
          collected.expectedFiles,
          collected.removedFiles,
          collected.pluginIds,
        ),
        root_path: collected.rootPath,
      },
    };
  }

  const declaredPins = collected.pluginIds
    ? mergePluginsForApply(collected.pluginIds).pluginPins
    : [];
  return {
    harnesses: buildHarnessLiveStatusMap({
      depth: "full",
      homeRoot: collected.rootPath,
      declaredPins,
      declaredMcpByHarness: collected.expectedApply
        ? declaredMcpNamesFromExpectedApply(collected.expectedApply)
        : {},
    }),
    files: {
      expected_count: collected.expectedFiles.length,
      changes: buildPreviewFileChanges(
        collected.rootPath,
        collected.expectedFiles,
        collected.removedFiles,
        collected.pluginIds,
      ),
      root_path: collected.rootPath,
    },
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
    files: {
      expected_count: collected.expectedFiles.length,
      changes: buildPreviewFileChanges(
        collected.rootPath,
        collected.expectedFiles,
        collected.removedFiles,
        collected.pluginIds,
      ),
      root_path: collected.rootPath,
    },
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
