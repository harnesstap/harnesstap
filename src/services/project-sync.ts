import { existsSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  getHarnessPreference,
  getProjectHarnessConfig,
  setProjectHarnessConfig,
} from "../models/harness.js";
import { upsertProject } from "../models/project.js";
import { createSnapshot } from "../models/snapshot.js";
import type { CursorSkillMode, Resource, ResourceCreateInput, SerializedFile, SnapshotState } from "../types.js";
import { detectPlatforms, hasPluginSourceLayout, scanPlatform } from "./scanner.js";
import { scanPluginSourceForMerge } from "./plugin-source-import.js";
import {
  mainScanLacksPluginSkills,
  mergeReferenceResourceInputs,
} from "./reference-resources.js";
import { generateFiles, writeFiles } from "./applier.js";
import { getGitOrigin, normalizeGitUrl, projectNameFromUrl } from "./git.js";
import {
  detectHarnessSurfaces,
  mirrorSurfaceWarnings,
  type MirrorSurfaceWarning,
} from "./harness-surface-gaps.js";
import {
  uniqueHarnessTargets,
} from "./harness-targets.js";

export type ProjectReferenceStrategy = "disk" | "plugin" | "agents" | "auto" | "main";

export interface ProjectSyncOptions {
  projectRoot: string;
  dryRun?: boolean;
  forceShiftReference?: string;
  /** Where to load reference resources when rematerializing (default: disk). */
  referenceStrategy?: ProjectReferenceStrategy;
}

export interface ProjectSyncResult {
  registered_harnesses: string[];
  from_harness: string;
  materialization_strategy: "symlink-preferred" | "copy";
  platforms_synced: string[];
  files_written: number;
  surface_warnings: MirrorSurfaceWarning[];
}

function resolveSyncHarnesses(
  projectId: string | undefined,
  projectRoot: string,
  fromHarness?: string,
): {
  registered_harnesses: string[];
  from_harness: string;
  materialization_strategy: "symlink-preferred" | "copy";
  cursor_skill_mode?: CursorSkillMode;
} {
  const projectConfig = projectId
    ? getProjectHarnessConfig(projectId)
    : undefined;
  const global = getHarnessPreference();

  const detected = detectPlatforms(projectRoot);
  const registered = uniqueHarnessTargets([
    ...(fromHarness ? [fromHarness] : []),
    ...(projectConfig?.registered_harnesses
      ?? global?.registered_harnesses
      ?? detected),
  ]);

  const from = fromHarness ?? registered[0];

  if (!from) {
    throw new Error(
      "No harnesses configured. Run harnesstap harness project set or harnesstap harness set.",
    );
  }

  return {
    registered_harnesses: registered.length > 0 ? registered : [from],
    from_harness: from,
    materialization_strategy:
      projectConfig?.materialization_strategy ?? "symlink-preferred",
    ...(projectConfig?.cursor_skill_mode
      ? { cursor_skill_mode: projectConfig.cursor_skill_mode }
      : {}),
  };
}

function writeAliasFiles(
  files: SerializedFile[],
  projectRoot: string,
  strategy: "symlink-preferred" | "copy",
  mainFiles: SerializedFile[],
): number {
  const mainByContent = new Map<string, string>();
  for (const file of mainFiles) {
    mainByContent.set(file.content, file.path);
  }

  let written = 0;
  for (const file of files) {
    const fullPath = join(projectRoot, file.path);
    const parent = dirname(fullPath);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }

    const mainPathForContent = mainByContent.get(file.content);
    const useSymlink =
      strategy === "symlink-preferred" &&
      mainPathForContent !== undefined &&
      mainPathForContent !== file.path;

    if (useSymlink) {
      const target = join(projectRoot, mainPathForContent);
      if (existsSync(fullPath)) {
        try {
          unlinkSync(fullPath);
        } catch {
          // ignore
        }
      }
      const relTarget = relative(dirname(fullPath), target);
      symlinkSync(relTarget, fullPath);
      written++;
      continue;
    }

    writeFiles([file], projectRoot);
    written++;
  }
  return written;
}

const AGENTS_REFERENCE_PLATFORMS = [
  "codex",
  "cursor",
  "warp",
  "opencode",
  "copilot-cli",
  "gemini-cli",
  "cline",
  "roo",
  "continue",
  "goose",
  "trae",
  "openhands",
  "kiro",
  "pi",
] as const;

function toSyncResources(inputs: ResourceCreateInput[]): Resource[] {
  return inputs.map((resource) => ({
    ...resource,
    id: `sync:${resource.type}:${resource.name}`,
    namespace: resource.namespace ?? "",
    origin_kind: resource.origin_kind ?? "manual",
    origin_ref: resource.origin_ref ?? "",
    content_hash: resource.content_hash ?? "",
    content_blob_ref: resource.content_blob_ref ?? "",
    created_at: "",
    updated_at: "",
  }));
}

async function scanPluginReferenceResources(
  projectRoot: string,
): Promise<ResourceCreateInput[]> {
  if (!hasPluginSourceLayout(projectRoot)) {
    return [];
  }
  const imports = await scanPluginSourceForMerge(projectRoot);
  return imports.flatMap((entry) => entry.resources);
}

async function scanAgentsReferenceResources(
  projectRoot: string,
): Promise<ResourceCreateInput[]> {
  const detected = new Set(detectPlatforms(projectRoot));
  const resources: ResourceCreateInput[] = [];
  const seen = new Set<string>();

  for (const platformId of AGENTS_REFERENCE_PLATFORMS) {
    if (!detected.has(platformId)) continue;
    const scan = await scanPlatform(platformId, projectRoot);
    for (const resource of scan.resources) {
      const key = `${resource.type}:${resource.name}:${resource.namespace ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resources.push(resource);
    }
  }

  return resources;
}

function emptyReferenceError(
  fromHarness: string,
  projectRoot: string,
): Error {
  return new Error(
    `Harness "${fromHarness}" has no on-disk resources in ${projectRoot}. ` +
      "Try: harnesstap mirror --reference plugin " +
      "or harnesstap scan . " +
      "or harnesstap harness project set --harnesses claude-code,cursor",
  );
}

async function resolveReferenceResources(
  projectRoot: string,
  fromHarness: string,
  strategy: ProjectReferenceStrategy,
): Promise<Resource[]> {
  if (strategy === "plugin") {
    const pluginResources = await scanPluginReferenceResources(projectRoot);
    if (pluginResources.length === 0) {
      throw new Error(
        `No plugin-source resources found in ${projectRoot}. ` +
          "Try: harnesstap scan .",
      );
    }
    return toSyncResources(pluginResources);
  }

  if (strategy === "agents") {
    const agentResources = await scanAgentsReferenceResources(projectRoot);
    if (agentResources.length === 0) {
      throw new Error(
        `No AGENTS.md instruction resources found in ${projectRoot}.`,
      );
    }
    return toSyncResources(agentResources);
  }

  const diskScan = await scanPlatform(fromHarness, projectRoot);

  if (strategy === "main" || strategy === "disk") {
    if (diskScan.resources.length === 0) {
      throw emptyReferenceError(fromHarness, projectRoot);
    }
    return toSyncResources(diskScan.resources);
  }

  if (diskScan.resources.length > 0) {
    if (strategy === "auto" && hasPluginSourceLayout(projectRoot)) {
      const pluginResources = await scanPluginReferenceResources(projectRoot);
      if (mainScanLacksPluginSkills(diskScan.resources, pluginResources)) {
        return toSyncResources(
          mergeReferenceResourceInputs(diskScan.resources, pluginResources),
        );
      }
    }
    return toSyncResources(diskScan.resources);
  }

  const pluginResources = await scanPluginReferenceResources(projectRoot);
  if (pluginResources.length > 0) {
    return toSyncResources(pluginResources);
  }

  const agentResources = await scanAgentsReferenceResources(projectRoot);
  if (agentResources.length > 0) {
    return toSyncResources(agentResources);
  }

  throw emptyReferenceError(fromHarness, projectRoot);
}

/**
 * Rematerialize registered harness outputs from one on-disk source (`--from`).
 */
export async function syncProject(
  options: ProjectSyncOptions,
): Promise<ProjectSyncResult> {
  const {
    projectRoot,
    dryRun,
    forceShiftReference,
    referenceStrategy = "disk",
  } = options;
  const gitOrigin = getGitOrigin(projectRoot);

  let projectId: string | undefined;
  if (gitOrigin) {
    const project = upsertProject({
      git_origin: normalizeGitUrl(gitOrigin),
      name: projectNameFromUrl(gitOrigin),
      local_path: projectRoot,
    });
    projectId = project.id;

    if (forceShiftReference) {
      const current = getProjectHarnessConfig(project.id);
      setProjectHarnessConfig({
        project_id: project.id,
        registered_harnesses: uniqueHarnessTargets([
          forceShiftReference,
          ...(current?.registered_harnesses ?? []),
        ]),
        materialization_strategy: current?.materialization_strategy,
        cursor_skill_mode: current?.cursor_skill_mode,
      });
    }
  }

  const harnesses = resolveSyncHarnesses(
    projectId,
    projectRoot,
    forceShiftReference,
  );

  const resources = await resolveReferenceResources(
    projectRoot,
    harnesses.from_harness,
    referenceStrategy,
  );

  const otherPlatforms = harnesses.registered_harnesses.filter(
    (id) => id !== harnesses.from_harness,
  );
  const aliasPlatforms =
    otherPlatforms.length > 0
      ? otherPlatforms
      : detectPlatforms(projectRoot).filter((p) => p !== harnesses.from_harness);

  const serializeOptions = harnesses.cursor_skill_mode
    ? { skillCursorMode: harnesses.cursor_skill_mode }
    : undefined;

  const mainGenerated = await generateFiles(
    resources,
    [harnesses.from_harness],
    projectRoot,
    serializeOptions,
  );
  const aliasGenerated =
    aliasPlatforms.length > 0
      ? await generateFiles(resources, aliasPlatforms, projectRoot, serializeOptions)
      : [];

  const allGenerated = [...mainGenerated, ...aliasGenerated];

  const surfaceWarnings = mirrorSurfaceWarnings(
    detectHarnessSurfaces(projectRoot),
    aliasPlatforms,
  );

  if (dryRun) {
    return {
      ...harnesses,
      platforms_synced: allGenerated.map((r) => r.platformId),
      files_written: allGenerated.reduce((n, r) => n + r.files.length, 0),
      surface_warnings: surfaceWarnings,
    };
  }

  if (gitOrigin && projectId) {
    const snapshotState: SnapshotState = {
      plugins: [],
      resources,
      platform_files: Object.fromEntries(
        allGenerated.map((result) => [
          result.platformId,
          Object.fromEntries(
            result.files.map((f) => [f.path, f.content]),
          ),
        ]),
      ),
    };
    createSnapshot({
      project_id: projectId,
      label: `Before mirror (${harnesses.from_harness})`,
      state: snapshotState,
    });
  }

  const mainFiles = mainGenerated[0]?.files ?? [];
  let filesWritten = 0;

  for (const result of aliasGenerated) {
    filesWritten += writeAliasFiles(
      result.files,
      projectRoot,
      harnesses.materialization_strategy,
      mainFiles,
    );
  }

  return {
    ...harnesses,
    platforms_synced: aliasGenerated.map((r) => r.platformId),
    files_written: filesWritten,
    surface_warnings: surfaceWarnings,
  };
}
