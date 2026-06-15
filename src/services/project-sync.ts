import { existsSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  getHarnessPreference,
  getProjectHarnessConfig,
  setProjectHarnessConfig,
} from "../models/harness.js";
import { upsertProject } from "../models/project.js";
import { createSnapshot } from "../models/snapshot.js";
import type { CursorSkillMode, SnapshotState } from "../types.js";
import { detectPlatforms, hasPluginSourceLayout, scanPlatform } from "./scanner.js";
import { scanPluginSource } from "./plugin-source-import.js";
import { generateFiles, writeFiles } from "./applier.js";
import { getGitOrigin, normalizeGitUrl, projectNameFromUrl } from "./git.js";
import type { Resource, ResourceCreateInput, SerializedFile } from "../types.js";

export type ProjectReferenceStrategy = "main" | "plugin" | "agents" | "auto";

export interface ProjectSyncOptions {
  projectRoot: string;
  dryRun?: boolean;
  forceShiftReference?: string;
  /** Where to load reference resources when mirroring (default: main). */
  referenceStrategy?: ProjectReferenceStrategy;
}

export interface ProjectSyncResult {
  main_harness: string;
  alias_harnesses: string[];
  materialization_strategy: "symlink-preferred" | "copy";
  platforms_synced: string[];
  files_written: number;
}

function resolveSyncHarnesses(
  projectId: string | undefined,
  projectRoot: string,
  forceMain?: string,
): {
  main_harness: string;
  alias_harnesses: string[];
  materialization_strategy: "symlink-preferred" | "copy";
  cursor_skill_mode?: CursorSkillMode;
} {
  const projectConfig = projectId
    ? getProjectHarnessConfig(projectId)
    : undefined;
  const global = getHarnessPreference();

  const detected = detectPlatforms(projectRoot);
  const main =
    forceMain ??
    projectConfig?.main_harness ??
    global?.main_harness ??
    detected[0];

  if (!main) {
    throw new Error(
      "No main harness configured. Run harnessdeck harness project set or harnessdeck harness set.",
    );
  }

  const aliases =
    projectConfig?.alias_harnesses ??
    global?.alias_harnesses ??
    detected.filter((p) => p !== main);

  return {
    main_harness: main,
    alias_harnesses: aliases.filter((a) => a !== main),
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
  const imports = await scanPluginSource(projectRoot);
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
  mainHarness: string,
  projectRoot: string,
): Error {
  return new Error(
    `Main harness "${mainHarness}" has no on-disk resources in ${projectRoot}. ` +
      "Try: harnessdeck project mirror --reference plugin " +
      "or harnessdeck project scan --include-plugin-source always " +
      "or harnessdeck harness project set --main codex",
  );
}

async function resolveReferenceResources(
  projectRoot: string,
  mainHarness: string,
  strategy: ProjectReferenceStrategy,
): Promise<Resource[]> {
  if (strategy === "plugin") {
    const pluginResources = await scanPluginReferenceResources(projectRoot);
    if (pluginResources.length === 0) {
      throw new Error(
        `No plugin-source resources found in ${projectRoot}. ` +
          "Try: harnessdeck project scan --include-plugin-source always",
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

  const mainScan = await scanPlatform(mainHarness, projectRoot);
  if (mainScan.resources.length > 0 || strategy === "main") {
    if (mainScan.resources.length === 0) {
      throw emptyReferenceError(mainHarness, projectRoot);
    }
    return toSyncResources(mainScan.resources);
  }

  const pluginResources = await scanPluginReferenceResources(projectRoot);
  if (pluginResources.length > 0) {
    return toSyncResources(pluginResources);
  }

  const agentResources = await scanAgentsReferenceResources(projectRoot);
  if (agentResources.length > 0) {
    return toSyncResources(agentResources);
  }

  throw emptyReferenceError(mainHarness, projectRoot);
}

/**
 * Sync alias harness outputs from the main harness on-disk configuration.
 */
export async function syncProject(
  options: ProjectSyncOptions,
): Promise<ProjectSyncResult> {
  const {
    projectRoot,
    dryRun,
    forceShiftReference,
    referenceStrategy = "main",
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
        main_harness: forceShiftReference,
        alias_harnesses: current?.alias_harnesses,
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
    harnesses.main_harness,
    referenceStrategy,
  );

  const aliasPlatforms =
    harnesses.alias_harnesses.length > 0
      ? harnesses.alias_harnesses
      : detectPlatforms(projectRoot).filter((p) => p !== harnesses.main_harness);

  const serializeOptions = harnesses.cursor_skill_mode
    ? { skillCursorMode: harnesses.cursor_skill_mode }
    : undefined;

  const mainGenerated = await generateFiles(
    resources,
    [harnesses.main_harness],
    projectRoot,
    serializeOptions,
  );
  const aliasGenerated =
    aliasPlatforms.length > 0
      ? await generateFiles(resources, aliasPlatforms, projectRoot, serializeOptions)
      : [];

  const allGenerated = [...mainGenerated, ...aliasGenerated];

  if (dryRun) {
    return {
      ...harnesses,
      platforms_synced: allGenerated.map((r) => r.platformId),
      files_written: allGenerated.reduce((n, r) => n + r.files.length, 0),
    };
  }

  if (gitOrigin && projectId) {
    const snapshotState: SnapshotState = {
      layers: [],
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
      label: `Before project sync (${harnesses.main_harness})`,
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
  };
}
