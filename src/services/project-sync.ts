import { existsSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  getHarnessPreference,
  getProjectHarnessConfig,
  setProjectHarnessConfig,
} from "../models/harness.js";
import { upsertProject } from "../models/project.js";
import { createSnapshot } from "../models/snapshot.js";
import type { SnapshotState } from "../types.js";
import { detectPlatforms, scanPlatform } from "./scanner.js";
import { generateFiles, writeFiles } from "./applier.js";
import { getGitOrigin, normalizeGitUrl, projectNameFromUrl } from "./git.js";
import type { SerializedFile } from "../types.js";

export interface ProjectSyncOptions {
  projectRoot: string;
  dryRun?: boolean;
  forceShiftReference?: string;
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

/**
 * Sync alias harness outputs from the main harness on-disk configuration.
 */
export async function syncProject(
  options: ProjectSyncOptions,
): Promise<ProjectSyncResult> {
  const { projectRoot, dryRun, forceShiftReference } = options;
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
      });
    }
  }

  const harnesses = resolveSyncHarnesses(
    projectId,
    projectRoot,
    forceShiftReference,
  );

  const mainScan = await scanPlatform(harnesses.main_harness, projectRoot);
  const resources = mainScan.resources.map((r) => ({
    ...r,
    id: `sync:${r.type}:${r.name}`,
    created_at: "",
    updated_at: "",
  }));

  if (resources.length === 0) {
    throw new Error(
      `No resources found for main harness "${harnesses.main_harness}" in ${projectRoot}`,
    );
  }

  const aliasPlatforms =
    harnesses.alias_harnesses.length > 0
      ? harnesses.alias_harnesses
      : detectPlatforms(projectRoot).filter((p) => p !== harnesses.main_harness);

  const mainGenerated = await generateFiles(
    resources,
    [harnesses.main_harness],
    projectRoot,
  );
  const aliasGenerated =
    aliasPlatforms.length > 0
      ? await generateFiles(resources, aliasPlatforms, projectRoot)
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
      presets: [],
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
