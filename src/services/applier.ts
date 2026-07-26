import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  findImportedSnapshotOwnersByFile,
  getImportedSnapshot,
  listImportedSnapshots,
  listImportedSnapshotInstalls,
  removeImportedSnapshotOwnershipForFiles,
  recordImportedSnapshotInstall,
} from "../models/imported-snapshot.js";
import { getResourcesByIds } from "../models/resource.js";
import { applyClaudeLayerExtensions } from "../platforms/claude-layer-extensions.js";
import type {
  ClaudeLayerConfig,
  Resource,
  SerializedFile,
  SerializeOptions,
} from "../types.js";
import { getPlatformSerializer } from "./platform-serializers.js";
import {
  type EnvironmentFragment,
  mergeResolvedEnvironmentIntoResources,
} from "./environment-cascade.js";

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
  currentSnapshotId?: string;
  replaceOwnedSnapshotIds?: string[];
  dryRun?: boolean;
}

export interface GenerateFilesOptions extends SerializeOptions {
  claudeConfig?: ClaudeLayerConfig;
  resolvedEnvironment?: EnvironmentFragment;
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

function isAutoReplaceConflict(
  conflict: MaterializationConflict,
  snapshotId?: string,
  replaceOwnedSnapshotIds: readonly string[] = [],
): boolean {
  const allowedSnapshotIds = new Set([
    ...replaceOwnedSnapshotIds,
    ...(snapshotId ? [snapshotId] : []),
  ]);
  return Boolean(
    allowedSnapshotIds.size > 0 &&
      conflict.owners.length > 0 &&
      conflict.owners.every((owner) => allowedSnapshotIds.has(owner.snapshot_id)),
  );
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

function removeEmptyParentDirectory(filePath: string): void {
  const parent = dirname(filePath);
  try {
    if (existsSync(parent) && readdirSync(parent).length === 0) {
      rmSync(parent, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup for empty skill directories.
  }
}

export function removeGlobalMaterializedFiles(
  rootPath: string,
  filePaths: string[],
): void {
  for (const filePath of new Set(filePaths)) {
    const fullPath = assertMaterializedPathIsSafe(rootPath, filePath);
    if (filePath.endsWith("/SKILL.md")) {
      const skillDir = dirname(fullPath);
      if (existsSync(skillDir)) {
        rmSync(skillDir, { recursive: true, force: true });
        removeEmptyParentDirectory(skillDir);
        continue;
      }
    }
    rmSync(fullPath, { force: true });
    removeEmptyParentDirectory(fullPath);
  }
}

function removeMaterializedFiles(rootPath: string, filePaths: string[]): void {
  removeGlobalMaterializedFiles(rootPath, filePaths);
}

function readExistingFileContent(fullPath: string): string | null {
  if (!existsSync(fullPath)) {
    return null;
  }
  try {
    return readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

function fileContentMatchesExisting(fullPath: string, expectedContent: string): boolean {
  const existingContent = readExistingFileContent(fullPath);
  return existingContent !== null && existingContent === expectedContent;
}

function isGenerateFilesOptions(
  value: ClaudeLayerConfig | GenerateFilesOptions | undefined,
): value is GenerateFilesOptions {
  return Boolean(
    value &&
      ("target" in value ||
        "claudeConfig" in value ||
        "resolvedEnvironment" in value ||
        "skillCursorMode" in value ||
        "skillSourceRoot" in value),
  );
}

/**
 * Generate platform files from resources without writing to disk.
 * Useful for dry-run / diff.
 */
export async function generateFiles(
  resources: Resource[],
  platforms: string[],
  projectRoot: string,
  claudeConfigOrOptions?: ClaudeLayerConfig | GenerateFilesOptions,
  maybeOptions?: GenerateFilesOptions,
): Promise<ApplyResult[]> {
  const options =
    maybeOptions ??
    (isGenerateFilesOptions(claudeConfigOrOptions) ? claudeConfigOrOptions : undefined) ??
    {};
  const claudeConfig =
    maybeOptions?.claudeConfig ??
    (isGenerateFilesOptions(claudeConfigOrOptions)
      ? claudeConfigOrOptions.claudeConfig
      : (claudeConfigOrOptions as ClaudeLayerConfig | undefined));

  const results: ApplyResult[] = [];
  const target = options.target ?? "project";
  const serializedResources = options.resolvedEnvironment
    ? mergeResolvedEnvironmentIntoResources(resources, options.resolvedEnvironment)
    : resources;
  const skillSourceRoot =
    options.skillSourceRoot ??
    resources.find((r) => r.type === "skill" && r.origin_ref)?.origin_ref;

  for (const pid of platforms) {
    const serializer = getPlatformSerializer(pid);
    let files = await serializer.serialize(serializedResources, projectRoot, {
      target,
      skillCursorMode: options.skillCursorMode,
      skillSourceRoot,
    });
    if (pid === "claude-code" && claudeConfig) {
      files = applyClaudeLayerExtensions(files, claudeConfig, projectRoot);
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

export async function planMaterializationConflicts(
  files: SerializedFile[],
  rootPath: string,
): Promise<MaterializationConflict[]> {
  const pathCounts = files.reduce((counts, file) => {
    counts.set(file.path, (counts.get(file.path) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const seen = new Set<string>();
  return files.flatMap((file) => {
    if (seen.has(file.path)) return [];
    seen.add(file.path);
    const fullPath = assertMaterializedPathIsSafe(rootPath, file.path);
    if ((pathCounts.get(file.path) ?? 0) > 1) {
      return [{
        path: file.path,
        fullPath,
        owners: [],
      }];
    }
    if (!existsSync(fullPath)) return [];
    if (fileContentMatchesExisting(fullPath, file.content)) return [];
    const owners = findImportedSnapshotOwnersByFile(file.path);
    return [{
      path: file.path,
      fullPath,
      owners,
    }];
  });
}

export async function materializeFiles(
  files: SerializedFile[],
  rootPath: string,
  options: MaterializeFilesOptions = {},
): Promise<MaterializationResult> {
  const conflictPolicy = options.conflictPolicy ?? "replace";
  const conflicts = await planMaterializationConflicts(files, rootPath);
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
    if (
      !options.conflictResolver &&
      isAutoReplaceConflict(
        conflict,
        options.currentSnapshotId,
        options.replaceOwnedSnapshotIds,
      )
    ) {
      decisions.set(conflict.path, "replace");
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
      conflicts: conflicts.filter(
        (conflict) =>
          !(
            !options.conflictResolver &&
            isAutoReplaceConflict(
              conflict,
              options.currentSnapshotId,
              options.replaceOwnedSnapshotIds,
            )
          ),
      ),
    };
  }

  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];

  if (options.dryRun) {
    return {
      cancelled: false,
      writtenFiles: files
        .filter((file) => decisions.get(file.path) !== "skip")
        .map((file) => file.path),
      skippedFiles: files
        .filter((file) => decisions.get(file.path) === "skip")
        .map((file) => file.path),
      conflicts: conflicts.filter(
        (conflict) =>
          !(
            !options.conflictResolver &&
            isAutoReplaceConflict(
              conflict,
              options.currentSnapshotId,
              options.replaceOwnedSnapshotIds,
            )
          ),
      ),
    };
  }

  for (const file of files) {
    const decision = decisions.get(file.path);
    if (decision === "skip") {
      skippedFiles.push(file.path);
      continue;
    }
    const fullPath = assertMaterializedPathIsSafe(rootPath, file.path);
    if (fileContentMatchesExisting(fullPath, file.content)) {
      writtenFiles.push(file.path);
      continue;
    }
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, "utf-8");
    writtenFiles.push(file.path);
  }

  return {
    cancelled: false,
    writtenFiles,
    skippedFiles,
    conflicts: conflicts.filter(
      (conflict) =>
        !(
          !options.conflictResolver &&
          isAutoReplaceConflict(
            conflict,
            options.currentSnapshotId,
            options.replaceOwnedSnapshotIds,
          )
        ),
    ),
  };
}

/**
 * Full apply: serialize resources for each platform and write to disk.
 */
export async function applyToProject(
  resources: Resource[],
  platforms: string[],
  projectRoot: string,
  claudeConfig?: ClaudeLayerConfig,
  options: Pick<GenerateFilesOptions, "skillCursorMode"> = {},
): Promise<ApplyResult[]> {
  const results = await generateFiles(resources, platforms, projectRoot, claudeConfig, {
    target: "project",
    skillCursorMode: options.skillCursorMode,
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
    currentSnapshotId: options.snapshotId,
    replaceOwnedSnapshotIds: options.replaceOwnedSnapshotIds,
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

    const desiredFiles = new Set(allFiles.map((file) => file.path));
    const staleFiles = [
      ...new Set(
        [options.snapshotId, ...(options.replaceOwnedSnapshotIds ?? [])]
          .flatMap((snapshotId) => listImportedSnapshotInstalls(snapshotId))
          .flatMap((install) => install.files)
          .filter((filePath) => !desiredFiles.has(filePath)),
      ),
    ];
    removeMaterializedFiles(homeRoot, staleFiles);
    removeImportedSnapshotOwnershipForFiles(staleFiles);
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

  const replaceOwnedSnapshotIds = listImportedSnapshots()
    .filter((candidate) =>
      candidate.id !== snapshot.id &&
      candidate.source_kind === snapshot.source_kind &&
      candidate.source_label === snapshot.source_label &&
      candidate.plugin_name === snapshot.plugin_name,
    )
    .map((candidate) => candidate.id);

  return applyToGlobal(resources, platforms, homeRoot, {
    ...options,
    snapshotId,
    replaceOwnedSnapshotIds,
  });
}
