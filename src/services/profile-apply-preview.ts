import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isEmptyBuiltinProfile, isProfileLayer } from "../constants/profile.js";
import { getProjectByLocalPath, getProjectByOrigin } from "../models/project.js";
import { getLatestSnapshot } from "../models/snapshot.js";
import { resolveLayerSelector } from "../models/layer-model.js";
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
import { mergeLayersForApply } from "./layer-apply-merge.js";
import { parseMcpServersDocument } from "./mcp-config-bridge.js";
import { fileContentsEquivalentForDrift } from "./file-contents-drift.js";
import {
  applyProfileLayer,
  clearGlobalProfileApply,
  collectProfileLayerIds,
  type ApplyProfileLayerResult,
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
  /** App-managed inventory for home scope; never applied or persisted. */
  host_managed?: HostManagedStatus;
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
  expectedApply: ApplyProfileLayerResult,
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

function profileManagesClaudeSettings(layerIds: string[] | undefined): boolean {
  if (!layerIds || layerIds.length === 0) {
    return false;
  }
  const merged = mergeLayersForApply(layerIds);
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
  layerIds?: string[],
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
      profileManagesClaudeSettings(layerIds),
    ),
  );
}

function isMaterialResource(resource: Resource): boolean {
  return resource.type !== "plugin_pin" && resource.type !== "layer";
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
  expectedApply?: ApplyProfileLayerResult;
  layerIds?: string[];
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
        warning: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const layer = resolveLayerSelector(profile);
  if (!layer) {
    return {
      rootPath: homeRoot,
      expectedFiles: [],
      warning: `missing layer "${profile}"`,
    };
  }
  if (!isProfileLayer(layer)) {
    return {
      rootPath: homeRoot,
      expectedFiles: [],
      warning: `layer "${layer.name}" is not tagged as a profile`,
    };
  }

  const layerIds = collectProfileLayerIds(layer);
  try {
    const expectedApply = await applyProfileLayer(profile, {
      dryRun: true,
      harness,
      conflictPolicy: "replace",
      pull: false,
    });
    return {
      rootPath: homeRoot,
      expectedFiles: uniqueExpectedFiles(expectedApply.expected_files ?? []),
      expectedApply,
      layerIds,
      removedFiles: expectedApply.removed_files,
    };
  } catch (error) {
    return {
      rootPath: homeRoot,
      expectedFiles: [],
      layerIds,
      warning: error instanceof Error ? error.message : String(error),
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
  const layer = resolveLayerSelector(profile);
  if (!layer) {
    return {
      rootPath: resolvedRoot,
      expectedFiles: [],
      warning: `missing layer "${profile}"`,
    };
  }
  if (!isProfileLayer(layer) && !isEmptyBuiltinProfile(profile)) {
    return {
      rootPath: resolvedRoot,
      expectedFiles: [],
      warning: `layer "${layer.name}" is not tagged as a profile`,
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

  const layerIds = collectProfileLayerIds(layer);
  const merged = mergeLayersForApply(layerIds);
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
      layerIds,
      removedFiles,
    };
  } catch (error) {
    return {
      rootPath: resolvedRoot,
      expectedFiles: [],
      layerIds,
      warning: error instanceof Error ? error.message : String(error),
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
): Promise<Pick<ProfileApplyPreview, "harnesses" | "files" | "warning">> {
  const collected = await collectHomeExpectedManagedFiles(profile, harness);

  if (collected.warning) {
    if (collected.layerIds) {
      const merged = mergeLayersForApply(collected.layerIds);
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
        warning: collected.warning,
      };
    }
    return {
      files: {
        expected_count: 0,
        changes: withMappedResources([]),
        root_path: collected.rootPath,
      },
      warning: collected.warning,
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
          collected.layerIds,
        ),
        root_path: collected.rootPath,
      },
    };
  }

  const declaredPins = collected.layerIds
    ? mergeLayersForApply(collected.layerIds).pluginPins
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
        collected.layerIds,
      ),
      root_path: collected.rootPath,
    },
  };
}

async function previewProjectApply(
  profile: string,
  projectPath?: string,
  harness?: string,
): Promise<Pick<ProfileApplyPreview, "files" | "warning">> {
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
        collected.layerIds,
      ),
      root_path: collected.rootPath,
    },
    ...(collected.warning ? { warning: collected.warning } : {}),
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
      ...(projectPreview.warning ? { warning: projectPreview.warning } : {}),
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
    ...(homePreview.warning ? { warning: homePreview.warning } : {}),
  };
}
