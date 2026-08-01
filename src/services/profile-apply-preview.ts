import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isEmptyBuiltinProfile, isProfileLayer } from "../constants/profile.js";
import { getProjectByLocalPath, getProjectByOrigin } from "../models/project.js";
import { getLatestSnapshot } from "../models/snapshot.js";
import { resolveLayerSelector } from "../models/layer-model.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { getActiveProfileName } from "./active-profile.js";
import { getGitOrigin, normalizeGitUrl } from "./git.js";
import {
  buildHarnessLiveStatusMap,
  resolveProjectDriftSummary,
  type HarnessLiveStatus,
} from "./global-profile-status-panel.js";
import { mergeLayersForApply } from "./layer-apply-merge.js";
import { parseMcpServersDocument } from "./mcp-config-bridge.js";
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
import { detectUntrackedProfileResources } from "./profile-untracked-resources.js";
import type { DriftFileChange } from "./project-drift.js";

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
  /** Material resources on disk that are not in the profile stack. */
  untracked_resources: ProfileContentsResource[];
  files: {
    expected_count: number;
    /** File changes for tracked (profile-managed) paths only. */
    changes: DriftFileChange[];
  };
  relative_to_active: boolean;
  warning?: string;
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

function compareExpectedHomeFiles(
  homeRoot: string,
  expectedFiles: Array<{ path: string; content: string }>,
): DriftFileChange[] {
  const changes: DriftFileChange[] = [];
  for (const file of expectedFiles) {
    const current = readGlobalFile(homeRoot, file.path);
    if (current === null) {
      changes.push({ path: file.path, type: "deleted" });
      continue;
    }
    if (current !== file.content) {
      changes.push({ path: file.path, type: "modified" });
    }
  }
  return changes;
}

async function previewHomeApply(
  profile: string,
  harness?: string,
): Promise<Pick<ProfileApplyPreview, "harnesses" | "files" | "warning">> {
  if (isEmptyBuiltinProfile(profile)) {
    let expectedApply: ApplyProfileLayerResult;
    try {
      expectedApply = await clearGlobalProfileApply({
        dryRun: true,
        harness,
        conflictPolicy: "replace",
        pull: false,
      });
    } catch (error) {
      return {
        files: { expected_count: 0, changes: [] },
        warning: error instanceof Error ? error.message : String(error),
      };
    }
    const homeRoot = resolveHomeRoot();
    const expectedFiles = expectedApply.expected_files ?? [];
    return {
      harnesses: buildHarnessLiveStatusMap({
        depth: "full",
        homeRoot,
        declaredPins: [],
        declaredMcpByHarness: {},
      }),
      files: {
        expected_count: expectedFiles.length,
        changes: compareExpectedHomeFiles(homeRoot, expectedFiles),
      },
    };
  }

  const layer = resolveLayerSelector(profile);
  if (!layer) {
    return {
      files: { expected_count: 0, changes: [] },
      warning: `missing layer "${profile}"`,
    };
  }
  if (!isProfileLayer(layer)) {
    return {
      files: { expected_count: 0, changes: [] },
      warning: `layer "${layer.name}" is not tagged as a profile`,
    };
  }

  const layerIds = collectProfileLayerIds(layer);
  let expectedApply: ApplyProfileLayerResult;
  try {
    expectedApply = await applyProfileLayer(profile, {
      dryRun: true,
      harness,
      conflictPolicy: "replace",
      pull: false,
    });
  } catch (error) {
    const merged = mergeLayersForApply(layerIds);
    const homeRoot = resolveHomeRoot();
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
        homeRoot,
        declaredPins: merged.pluginPins,
        declaredMcpByHarness,
      }),
      files: { expected_count: 0, changes: [] },
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  const homeRoot = resolveHomeRoot();
  const expectedFiles = expectedApply.expected_files ?? [];
  const declaredPins = mergeLayersForApply(layerIds).pluginPins;

  return {
    harnesses: buildHarnessLiveStatusMap({
      depth: "full",
      homeRoot,
      declaredPins,
      declaredMcpByHarness: declaredMcpNamesFromExpectedApply(expectedApply),
    }),
    files: {
      expected_count: expectedFiles.length,
      changes: compareExpectedHomeFiles(homeRoot, expectedFiles),
    },
  };
}

function countSnapshotFiles(
  platformFiles: Record<string, Record<string, string>>,
): number {
  let count = 0;
  for (const files of Object.values(platformFiles)) {
    count += Object.keys(files).length;
  }
  return count;
}

function previewProjectApply(projectPath?: string): Pick<
  ProfileApplyPreview,
  "files" | "warning"
> {
  if (!projectPath) {
    return {
      files: { expected_count: 0, changes: [] },
      warning: "projectPath is required for project scope",
    };
  }

  const projectDrift = resolveProjectDriftSummary(projectPath);
  if (!projectDrift || projectDrift.status === "na" || !projectDrift.report) {
    return {
      files: { expected_count: 0, changes: [] },
      warning: "Project is not tracked yet — bootstrap or apply to create a snapshot",
    };
  }

  const resolvedRoot = resolve(projectPath);
  const gitOriginRaw = getGitOrigin(resolvedRoot);
  const gitOrigin = gitOriginRaw ? normalizeGitUrl(gitOriginRaw) : null;
  const project =
    getProjectByLocalPath(resolvedRoot)
    ?? (gitOrigin ? getProjectByOrigin(gitOrigin) : undefined)
    ?? null;
  const snapshot = project ? getLatestSnapshot(project.id) : null;
  const expectedCount = snapshot
    ? countSnapshotFiles(snapshot.state.platform_files)
    : 0;

  return {
    files: {
      expected_count: expectedCount,
      changes: projectDrift.report.changes,
    },
  };
}

export async function previewProfileApply(
  input: ProfileApplyPreviewRequest,
): Promise<ProfileApplyPreview> {
  const profile = input.profile.trim();
  const contents = buildProfileContents(profile);
  const relativeToActive = getActiveProfileName() === profile;
  const untrackedResources = await detectUntrackedProfileResources({
    profileSelector: profile,
    scope: input.scope,
    ...(input.projectPath ? { projectPath: input.projectPath } : {}),
    ...(input.harness ? { harness: input.harness } : {}),
  });

  if (input.scope === "project") {
    const projectPreview = previewProjectApply(input.projectPath);
    return {
      profile,
      scope: "project",
      contents,
      untracked_resources: untrackedResources,
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
    untracked_resources: untrackedResources,
    ...(homePreview.harnesses ? { harnesses: homePreview.harnesses } : {}),
    files: homePreview.files,
    relative_to_active: relativeToActive,
    ...(homePreview.warning ? { warning: homePreview.warning } : {}),
  };
}
