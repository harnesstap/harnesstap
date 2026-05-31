import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  findImportedSnapshotOwnersByFile,
  getImportedSnapshot,
  listImportedSnapshotInstalls,
  removeImportedSnapshotOwnershipForFiles,
  recordImportedSnapshotInstall,
} from "../models/imported-snapshot.js";
import { getResourcesByIds } from "../models/resource.js";
import { applyClaudePresetExtensions } from "../platforms/claude-preset-extensions.js";
import type {
  ClaudePresetConfig,
  Resource,
  SerializedFile,
  SerializeOptions,
} from "../types.js";
import { getPlatformSerializer } from "./platform-serializers.js";

export interface ApplyResult {
  platformId: string;
  files: SerializedFile[];
}

export type ConflictPolicy = "prompt" | "replace" | "skip";
export type ConflictResolution = "replace" | "skip" | "cancel";

export interface ImportedSnapshotConflictOwner {
  snapshot_id: string;
  platform_id: string;
  plugin_name: string;
  plugin_version?: string;
}

export interface MaterializationConflict {
  path: string;
  fullPath: string;
  owners: ImportedSnapshotConflictOwner[];
}

export interface MaterializeFilesOptions {
  conflictPolicy?: ConflictPolicy;
  conflictResolver?: (
    conflict: MaterializationConflict,
  ) => Promise<ConflictResolution> | ConflictResolution;
}

export interface GenerateFilesOptions extends SerializeOptions {
  claudeConfig?: ClaudePresetConfig;
}

export interface GlobalApplyOptions extends GenerateFilesOptions, MaterializeFilesOptions {
  snapshotId?: string;
}

export interface MaterializationResult {
  cancelled: boolean;
  writtenFiles: string[];
  skippedFiles: string[];
  conflicts: MaterializationConflict[];
}

export interface GlobalApplyResult extends MaterializationResult {
  results: ApplyResult[];
}

function resolveMaterializedPath(rootPath: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.startsWith("\\")) {
    throw new Error(`Refusing to materialize non-relative path: ${relativePath}`);
  }

  const resolvedRoot = resolve(rootPath);
  const fullPath = resolve(resolvedRoot, relativePath);
  if (fullPath !== resolvedRoot && !fullPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Refusing to materialize path outside root: ${relativePath}`);
  }

  return fullPath;
}

function assertMaterializedPathIsSafe(rootPath: string, relativePath: string): string {
  const fullPath = resolveMaterializedPath(rootPath, relativePath);
  const resolvedRoot = realpathSync(rootPath);

  if (existsSync(fullPath)) {
    const resolvedTarget = realpathSync(fullPath);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
      throw new Error(`Refusing to materialize path outside root via symlink: ${relativePath}`);
    }
  }

  let probePath = dirname(fullPath);
  while (!existsSync(probePath)) {
    const parentPath = dirname(probePath);
    if (parentPath === probePath) {
      throw new Error(`Refusing to materialize path outside root: ${relativePath}`);
    }
    probePath = parentPath;
  }

  const resolvedProbe = realpathSync(probePath);
  if (resolvedProbe !== resolvedRoot && !resolvedProbe.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Refusing to materialize path outside root via symlink: ${relativePath}`);
  }

  return fullPath;
}

/**
 * Generate platform files from resources without writing to disk.
 * Useful for dry-run / diff.
 */
export async function generateFiles(
  resources: Resource[],
  platforms: string[],
  projectRoot: string,
  claudeConfigOrOptions?: ClaudePresetConfig | GenerateFilesOptions,
  maybeOptions?: GenerateFilesOptions,
): Promise<ApplyResult[]> {
  const options =
    maybeOptions ??
    (claudeConfigOrOptions &&
    ("target" in claudeConfigOrOptions || "claudeConfig" in claudeConfigOrOptions)
      ? claudeConfigOrOptions
      : undefined) ??
    {};
  const claudeConfig =
    maybeOptions?.claudeConfig ??
    ("target" in (claudeConfigOrOptions ?? {}) || "claudeConfig" in (claudeConfigOrOptions ?? {})
      ? (claudeConfigOrOptions as GenerateFilesOptions | undefined)?.claudeConfig
      : (claudeConfigOrOptions as ClaudePresetConfig | undefined));

  const results: ApplyResult[] = [];
  const target = options.target ?? "project";

  for (const pid of platforms) {
    const serializer = getPlatformSerializer(pid);
    let files = await serializer.serialize(resources, projectRoot, { target });
    if (pid === "claude-code" && claudeConfig) {
      files = applyClaudePresetExtensions(files, claudeConfig, projectRoot);
    }
    results.push({ platformId: pid, files });
  }

  return results;
}

/**
 * Write serialized files to disk, creating directories as needed.
 */
export function writeFiles(
  files: SerializedFile[],
  projectRoot: string,
): void {
  for (const file of files) {
    const fullPath = join(projectRoot, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, "utf-8");
  }
}

async function planConflicts(
  files: SerializedFile[],
  rootPath: string,
): Promise<MaterializationConflict[]> {
  const seen = new Set<string>();
  return files.flatMap((file) => {
    if (seen.has(file.path)) return [];
    seen.add(file.path);
    const fullPath = assertMaterializedPathIsSafe(rootPath, file.path);
    if (!existsSync(fullPath)) return [];
    return [{
      path: file.path,
      fullPath,
      owners: findImportedSnapshotOwnersByFile(file.path),
    }];
  });
}

export async function materializeFiles(
  files: SerializedFile[],
  rootPath: string,
  options: MaterializeFilesOptions = {},
): Promise<MaterializationResult> {
  const conflictPolicy = options.conflictPolicy ?? "replace";
  const conflicts = await planConflicts(files, rootPath);
  const decisions = new Map<string, ConflictResolution>();

  for (const conflict of conflicts) {
    if (conflictPolicy === "replace") {
      decisions.set(conflict.path, "replace");
      continue;
    }
    if (conflictPolicy === "skip") {
      decisions.set(conflict.path, "skip");
      continue;
    }
    if (!options.conflictResolver) {
      decisions.set(conflict.path, "cancel");
      break;
    }
    const decision = await options.conflictResolver(conflict);
    decisions.set(conflict.path, decision);
    if (decision === "cancel") {
      break;
    }
  }

  if ([...decisions.values()].includes("cancel")) {
    return {
      cancelled: true,
      writtenFiles: [],
      skippedFiles: files
        .filter((file) => decisions.get(file.path) === "skip")
        .map((file) => file.path),
      conflicts,
    };
  }

  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const file of files) {
    const decision = decisions.get(file.path);
    if (decision === "skip") {
      skippedFiles.push(file.path);
      continue;
    }
    const fullPath = assertMaterializedPathIsSafe(rootPath, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, "utf-8");
    writtenFiles.push(file.path);
  }

  return {
    cancelled: false,
    writtenFiles,
    skippedFiles,
    conflicts,
  };
}

/**
 * Full apply: serialize resources for each platform and write to disk.
 */
export async function applyToProject(
  resources: Resource[],
  platforms: string[],
  projectRoot: string,
  claudeConfig?: ClaudePresetConfig,
): Promise<ApplyResult[]> {
  const results = await generateFiles(resources, platforms, projectRoot, claudeConfig, {
    target: "project",
  });

  for (const result of results) {
    writeFiles(result.files, projectRoot);
  }

  return results;
}

export async function applyToGlobal(
  resources: Resource[],
  platforms: string[],
  homeRoot: string,
  options: GlobalApplyOptions = {},
): Promise<GlobalApplyResult> {
  const results = await generateFiles(resources, platforms, homeRoot, {
    ...options,
    target: "global",
  });
  const allFiles = results.flatMap((result) => result.files);
  const materialized = await materializeFiles(allFiles, homeRoot, {
    conflictPolicy: options.conflictPolicy ?? "prompt",
    conflictResolver: options.conflictResolver,
  });

  if (!materialized.cancelled && options.snapshotId) {
    removeImportedSnapshotOwnershipForFiles(materialized.writtenFiles, options.snapshotId);
    const existingInstalls = listImportedSnapshotInstalls(options.snapshotId);
    for (const result of results) {
      const previousFiles =
        existingInstalls.find((install) => install.platform_id === result.platformId)?.files ??
        [];
      const emittedFiles = result.files.map((file) => file.path);
      const writtenFiles = emittedFiles.filter((filePath) =>
        materialized.writtenFiles.includes(filePath),
      );
      const preservedSkippedFiles = emittedFiles.filter(
        (filePath) =>
          materialized.skippedFiles.includes(filePath) &&
          previousFiles.includes(filePath),
      );
      const installFiles = [...new Set([...writtenFiles, ...preservedSkippedFiles])];
      if (installFiles.length === 0) continue;
      recordImportedSnapshotInstall({
        snapshot_id: options.snapshotId,
        platform_id: result.platformId,
        files: installFiles,
      });
    }
  }

  return {
    results,
    ...materialized,
  };
}

export async function applyImportedSnapshotToGlobal(
  snapshotId: string,
  platforms: string[],
  homeRoot: string,
  options: Omit<GlobalApplyOptions, "snapshotId"> = {},
): Promise<GlobalApplyResult> {
  const snapshot = getImportedSnapshot(snapshotId);
  if (!snapshot) {
    throw new Error(`Imported snapshot not found: ${snapshotId}`);
  }

  const resources = getResourcesByIds(snapshot.resource_ids);
  if (resources.length !== snapshot.resource_ids.length) {
    throw new Error(`Imported snapshot ${snapshotId} is missing one or more resources`);
  }

  return applyToGlobal(resources, platforms, homeRoot, {
    ...options,
    snapshotId,
  });
}
