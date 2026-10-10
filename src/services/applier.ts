import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { hasParentTraversalSegment } from "../utils/path-containment.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import {
  findImportedSnapshotOwnersByFile,
  getImportedSnapshot,
  listImportedSnapshots,
  listImportedSnapshotInstalls,
  removeImportedSnapshotOwnershipForFiles,
  recordImportedSnapshotInstall,
} from "../models/imported-snapshot.js";
import { getResourcesByIds } from "../models/resource.js";
import { applyClaudePluginExtensions } from "../platforms/claude-plugin-extensions.js";
import type {
  ClaudePluginConfig,
  HookMetadata,
  Resource,
  SerializedFile,
  SerializeOptions,
  SnapshotState,
  SurfaceWarning,
} from "../types.js";
import { getPlatformSerializer } from "./platform-serializers.js";
import {
  attachResourceOwnership,
  persistWrittenMaterializations,
} from "./materialization-ownership.js";
import { isCursorHostManagedSkillsPath } from "./cursor-host-managed-skills.js";
import { omitHostPluginBundledSkills } from "./host-plugin-material.js";
import { skippedDuplicateCommand, skippedHostPluginHook } from "../copy/cli.js";
import { gateDeployFiles } from "./deploy-gate.js";
import { pruneManagedCursorLocalPlugins } from "../plugins/cursor-local-plugin.js";
import {
  type EnvironmentFragment,
  mergeResolvedEnvironmentIntoResources,
} from "./environment-cascade.js";
import { pinSkillEmitsToExistingLivePaths } from "./shared-emit-paths.js";
import { resourceAppliesToHarness } from "./harness-scope.js";
import { hookRequiresPluginRoot } from "./hook-serialization.js";
import { recordPreexistingPath } from "../models/preexisting-path.js";
import { isMergeableHostConfigPath } from "./merged-host-config.js";
import {
  isAggregateConfigManagedPath,
  isPluginRegistryManagedPath,
} from "./profile-commit-resource.js";
import {
  executeSafeFileRemovals,
  hashOnDiskFile,
  isHarnessTapOwnedPath,
  type SafeFileRemovalOptions,
  type SafeFileRemovalResult,
} from "./safe-file-removal.js";
import { captureManagedSnapshotState } from "./snapshot-capture.js";
import { fileContentsEquivalentForDrift } from "./file-contents-drift.js";

export interface ApplyResult {
  platformId: string;
  files: SerializedFile[];
  surface_warnings?: SurfaceWarning[];
}

export type ConflictPolicy = "prompt" | "replace" | "skip" | "cancel";
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
  claudeConfig?: ClaudePluginConfig;
  resolvedEnvironment?: EnvironmentFragment;
  previousManagedPlacements?: ReadonlyMap<string, readonly string[]>;
  /** When false, keep per-harness skill emits (status/drift). Default true. */
  pinSkillEmits?: boolean;
}

export interface GlobalApplyOptions extends GenerateFilesOptions, MaterializeFilesOptions {
  snapshotId?: string;
  forceUnicode?: boolean;
  previousTrackedFiles?: readonly string[];
}

export interface MaterializationResult {
  cancelled: boolean;
  writtenFiles: string[];
  skippedFiles: string[];
  conflicts: MaterializationConflict[];
}

export interface GlobalApplyResult extends MaterializationResult {
  results: ApplyResult[];
  preApplyState: SnapshotState;
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
  if (
    !relativePath ||
    hasParentTraversalSegment(relativePath) ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\")
  ) {
    throw new Error(`Refusing to materialize path outside root: ${relativePath}`);
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

function shouldPreserveUnownedFile(path: string): boolean {
  if (/\.(md|mdc)$/i.test(path)) {
    return false;
  }
  return (
    isMergeableHostConfigPath(path)
    || isAggregateConfigManagedPath(path)
    || isPluginRegistryManagedPath(path)
  );
}

export function removeGlobalMaterializedFiles(
  rootPath: string,
  filePaths: string[],
  options: SafeFileRemovalOptions = {},
): SafeFileRemovalResult {
  const filtered = [...new Set(filePaths)].filter(
    (filePath) => !isCursorHostManagedSkillsPath(filePath),
  );
  for (const filePath of filtered) {
    assertMaterializedPathIsSafe(rootPath, filePath);
  }
  return executeSafeFileRemovals(rootPath, filtered, options);
}

function removeMaterializedFiles(
  rootPath: string,
  filePaths: string[],
  options: SafeFileRemovalOptions = {},
): SafeFileRemovalResult {
  return removeGlobalMaterializedFiles(rootPath, filePaths, options);
}

function fileContentMatchesExisting(fullPath: string, file: SerializedFile): boolean {
  if (!existsSync(fullPath)) return false;
  try {
    const existing = readFileSync(fullPath);
    return existing.equals(serializedFileBytes(file));
  } catch {
    return false;
  }
}

function semanticallyMatchesExisting(fullPath: string, file: SerializedFile): boolean {
  if (fileContentMatchesExisting(fullPath, file)) {
    return true;
  }
  if (!existsSync(fullPath)) {
    return false;
  }
  try {
    return fileContentsEquivalentForDrift(
      file.path,
      readFileSync(fullPath, "utf-8"),
      file.content,
    );
  } catch {
    return false;
  }
}

function isGenerateFilesOptions(
  value: ClaudePluginConfig | GenerateFilesOptions | undefined,
): value is GenerateFilesOptions {
  return Boolean(
    value &&
      ("target" in value ||
        "claudeConfig" in value ||
        "resolvedEnvironment" in value ||
        "skillCursorMode" in value ||
        "skillSourceRoot" in value ||
        "previousManagedPlacements" in value ||
        "mergeLiveSkillMarkdown" in value ||
        "pinSkillEmits" in value),
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
  claudeConfigOrOptions?: ClaudePluginConfig | GenerateFilesOptions,
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
      : (claudeConfigOrOptions as ClaudePluginConfig | undefined));

  const results: ApplyResult[] = [];
  const target = options.target ?? "project";
  const serializedResources = options.resolvedEnvironment
    ? mergeResolvedEnvironmentIntoResources(resources, options.resolvedEnvironment)
    : resources;
  const skillSourceRoot =
    options.skillSourceRoot ??
    resources.find((r) => r.type === "skill" && r.origin_ref)?.origin_ref;

  const homeRoot = resolveHomeRoot();
  for (const pid of platforms) {
    const platformResources = omitHostPluginBundledSkills(
      serializedResources.filter((resource) => resourceAppliesToHarness(resource, pid)),
      pid,
      homeRoot,
      target,
    );
    const serializer = getPlatformSerializer(pid);
    const surfaceWarnings: SurfaceWarning[] = [];
    const skillNames = new Set(
      platformResources.filter((resource) => resource.type === "skill").map((resource) => resource.name),
    );
    const emitResources = platformResources.filter((resource) => {
      if (resource.type === "command" && skillNames.has(resource.name)) {
        surfaceWarnings.push({
          harness: pid,
          path: "",
          category: "duplicate-command",
          message: skippedDuplicateCommand(resource.name),
          alias_harnesses: [],
        });
        return false;
      }
      if (resource.type !== "hook") {
        return true;
      }
      if (!hookRequiresPluginRoot(resource.metadata as HookMetadata)) {
        return true;
      }
      surfaceWarnings.push({
        harness: pid,
        path: ".claude/settings.json",
        category: "plugin-root-hook",
        message: skippedHostPluginHook(resource.name),
        alias_harnesses: [],
      });
      return false;
    });
    let files = await serializer.serialize(emitResources, projectRoot, {
      target,
      skillCursorMode: options.skillCursorMode,
      skillSourceRoot,
      projectRoot,
      mergeLiveSkillMarkdown: options.mergeLiveSkillMarkdown,
      surfaceWarnings,
    });
    if (pid === "claude-code" && claudeConfig) {
      files = applyClaudePluginExtensions(files, claudeConfig, projectRoot);
    }
    files = await attachResourceOwnership(files, platformResources, {
      platformId: pid,
      rootPath: projectRoot,
      target,
      serializeOptions: {
        skillCursorMode: options.skillCursorMode,
        skillSourceRoot,
        mergeLiveSkillMarkdown: options.mergeLiveSkillMarkdown,
      },
    });
    results.push({
      platformId: pid,
      files,
      ...(surfaceWarnings.length > 0 ? { surface_warnings: surfaceWarnings } : {}),
    });
  }

  if (options.pinSkillEmits === false) {
    return results;
  }
  return pinSkillEmitsToExistingLivePaths(
    projectRoot,
    results,
    platforms,
    target,
    options.previousManagedPlacements !== undefined
      ? { previousManagedPlacements: options.previousManagedPlacements }
      : undefined,
  );
}

function normalizeDeployedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function removeStaleProjectDeployedFiles(
  projectRoot: string,
  previousPaths: readonly string[],
  desiredPaths: readonly string[],
  options: SafeFileRemovalOptions = {},
): SafeFileRemovalResult {
  const desired = new Set(desiredPaths.map(normalizeDeployedPath));
  const stale = previousPaths
    .map(normalizeDeployedPath)
    .filter((path) => path.length > 0 && !desired.has(path));
  return removeGlobalMaterializedFiles(projectRoot, stale, options);
}

/**
 * Write serialized files to disk, creating directories as needed.
 */
function serializedFileBytes(file: SerializedFile): Buffer {
  if (file.encoding === "base64") {
    return Buffer.from(file.content, "base64");
  }
  return Buffer.from(file.content, "utf-8");
}

function applySerializedFileMode(fullPath: string, file: SerializedFile): void {
  if (typeof file.mode !== "number") {
    return;
  }
  try {
    chmodSync(fullPath, file.mode & 0o777);
  } catch {
    // Some filesystems do not support chmod.
  }
}

function writeSerializedFile(fullPath: string, file: SerializedFile): void {
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, serializedFileBytes(file));
  applySerializedFileMode(fullPath, file);
}

export function writeFiles(
  files: SerializedFile[],
  projectRoot: string,
): void {
  pruneManagedCursorLocalPlugins(projectRoot, files);
  for (const file of files) {
    const fullPath = assertMaterializedPathIsSafe(projectRoot, file.path);
    writeSerializedFile(fullPath, file);
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
    if (fileContentMatchesExisting(fullPath, file)) return [];
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
    if (conflictPolicy === "cancel") {
      decisions.set(conflict.path, "cancel");
      break;
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
    const skippedPreexisting = files.filter((file) => {
      if (decisions.get(file.path) === "skip") {
        return false;
      }
      if (shouldPreserveUnownedFile(file.path)) {
        const fullMergeable = assertMaterializedPathIsSafe(rootPath, file.path);
        return semanticallyMatchesExisting(fullMergeable, file);
      }
      const fullPath = assertMaterializedPathIsSafe(rootPath, file.path);
      return (
        (existsSync(fullPath) && !isHarnessTapOwnedPath(rootPath, file.path))
        || semanticallyMatchesExisting(fullPath, file)
      );
    });
    const skippedPreexistingPaths = new Set(skippedPreexisting.map((file) => file.path));
    return {
      cancelled: false,
      writtenFiles: files
        .filter((file) =>
          decisions.get(file.path) !== "skip" && !skippedPreexistingPaths.has(file.path),
        )
        .map((file) => file.path),
      skippedFiles: files
        .filter((file) =>
          decisions.get(file.path) === "skip" || skippedPreexistingPaths.has(file.path),
        )
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

  pruneManagedCursorLocalPlugins(rootPath, files);
  for (const file of files) {
    const decision = decisions.get(file.path);
    if (decision === "skip") {
      skippedFiles.push(file.path);
      continue;
    }
    const fullPath = assertMaterializedPathIsSafe(rootPath, file.path);
    if (existsSync(fullPath) && !isHarnessTapOwnedPath(rootPath, file.path)) {
      recordPreexistingPath({
        root_path: rootPath,
        path: file.path,
        content_hash: hashOnDiskFile(fullPath) ?? "",
      });
      if (!shouldPreserveUnownedFile(file.path)) {
        skippedFiles.push(file.path);
        continue;
      }
    }
    if (semanticallyMatchesExisting(fullPath, file)) {
      skippedFiles.push(file.path);
      continue;
    }
    writeSerializedFile(fullPath, file);
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
  claudeConfig?: ClaudePluginConfig,
  options: Pick<GenerateFilesOptions, "skillCursorMode"> & {
    project_id?: string | null;
  } = {},
): Promise<ApplyResult[]> {
  const results = await generateFiles(resources, platforms, projectRoot, claudeConfig, {
    target: "project",
    skillCursorMode: options.skillCursorMode,
  });

  for (const result of results) {
    writeFiles(result.files, projectRoot);
  }

  persistWrittenMaterializations({
    scope: "project",
    project_id: options.project_id ?? null,
    root_path: projectRoot,
    platformResults: results.map((result) => ({
      platformId: result.platformId,
      files: result.files,
      writtenPaths: result.files.map((file) => file.path),
    })),
  });

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
  gateDeployFiles(allFiles, { forceUnicode: options.forceUnicode });
  const preApplyState = captureManagedSnapshotState({
    rootPath: homeRoot,
    generated: results,
    extraPaths: options.previousTrackedFiles,
  });
  const materialized = await materializeFiles(allFiles, homeRoot, {
    conflictPolicy: options.conflictPolicy ?? "prompt",
    conflictResolver: options.conflictResolver,
    currentSnapshotId: options.snapshotId,
    replaceOwnedSnapshotIds: options.replaceOwnedSnapshotIds,
  });

  const ownedSkippedFiles = materialized.skippedFiles.filter((filePath) =>
    isHarnessTapOwnedPath(homeRoot, filePath),
  );
  const persistedPaths = [...new Set([...materialized.writtenFiles, ...ownedSkippedFiles])];

  if (!materialized.cancelled) {
    persistWrittenMaterializations({
      scope: "global",
      project_id: null,
      root_path: homeRoot,
      platformResults: results.map((result) => ({
        platformId: result.platformId,
        files: result.files,
        writtenPaths: persistedPaths.filter((filePath) =>
          result.files.some((file) => file.path === filePath),
        ),
      })),
    });
  }

  if (!materialized.cancelled && options.snapshotId) {
    removeImportedSnapshotOwnershipForFiles(persistedPaths, options.snapshotId);
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
          materialized.skippedFiles.includes(filePath)
          && (
            previousFiles.includes(filePath)
            || ownedSkippedFiles.includes(filePath)
          ),
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
    removeMaterializedFiles(homeRoot, staleFiles, {
      applyId: options.snapshotId,
      snapshotId: options.snapshotId,
    });
    removeImportedSnapshotOwnershipForFiles(staleFiles);
  }

  return {
    results,
    ...materialized,
    preApplyState,
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
