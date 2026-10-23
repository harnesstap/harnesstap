import { forgetMissingSettingsMarketplaces, recordAddedSettingsMarketplaces } from "./claude-settings-marketplaces.js";
import { forgetMissingEnabledKeys, isClaudeSettingsPath, recordAddedEnabledKeys } from "./claude-enabled-plugin-keys.js";
import { pruneLeavingClaudeRegistrations } from "./claude-plugin-registration-prune.js";
import { computationSlot, inStatusComputation } from "./status-computation.js";
import { readDiskBytesOnce, readDiskTextOnce } from "./status-disk-read.js";
import { traceSpan } from "./status-trace.js";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import {
  hostPluginViewWrittenHash,
  isInHostPluginViewCreatedByHarnessTap,
  recordHostPluginViewWrite,
} from "./package-cache/host-plugin-views.js";
import { keptLinkOutsideRoot, skippedRemovalOutsideRoot, skippedDuplicateCommand, skippedHostPluginHook } from "../copy/cli.js";
import {
  findImportedSnapshotOwnersByFile,
  getImportedSnapshot,
  listImportedSnapshotInstalls,
  listImportedSnapshots,
  recordImportedSnapshotInstall,
  removeImportedSnapshotOwnershipForFiles,
} from "../models/imported-snapshot.js";
import { recordPreexistingPath } from "../models/preexisting-path.js";
import { getResourcesByIds } from "../models/resource.js";
import { applyClaudePluginExtensions } from "../platforms/claude-plugin-extensions.js";
import { pruneManagedCursorLocalPlugins } from "../plugins/cursor-local-plugin.js";
import type {
  ClaudePluginConfig,
  HookMetadata,
  McpServerMetadata,
  Resource,
  SerializedFile,
  SerializeOptions,
  SnapshotState,
  SurfaceWarning,
} from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { hasParentTraversalSegment } from "../utils/path-containment.js";
import { resolveInstalledMcpResources } from "./agent-plugins/mcp-host-paths.js";
import { mcpSerializationWarnings } from "./agent-plugins/plugin-vars.js";
import { isCursorHostManagedSkillsPath } from "./cursor-host-managed-skills.js";
import { gateDeployFiles } from "./deploy-gate.js";
import {
  type EnvironmentFragment,
  mergeResolvedEnvironmentIntoResources,
} from "./environment-cascade.js";
import { fileContentsEquivalentForDrift } from "./file-contents-drift.js";
import { resourceAppliesToHarness } from "./harness-scope.js";
import { hookRequiresPluginRoot } from "./hook-serialization.js";
import { omitHostPluginBundledSkills } from "./host-plugin-material.js";
import {
  attachResourceOwnership,
  persistWrittenMaterializations,
} from "./materialization-ownership.js";
import { isMergeableHostConfigPath } from "./merged-host-config.js";
import {
  isNativeAgentPluginCachePath,
  isNativeAgentPluginPlatform,
  mergeNativeAgentPluginFiles,
  nativeAgentPluginFiles,
  nativeAgentPluginsEnabled,
  splitNativeAgentPluginExtract,
} from "./native-agent-plugins.js";
import { getPlatformSerializer } from "./platform-serializers.js";
import {
  isAggregateConfigManagedPath,
  isPluginRegistryManagedPath,
} from "./profile-commit-resource.js";
import {
  classifyManagedPathOwnership,
  executeSafeFileRemovals,
  hasCurrentHarnessTapMaterialization,
  hasHarnessTapMaterialization,
  hashFileOrLink,
  hashOnDiskFile,
  leafLinkLeavesRoot,
  isHarnessTapOwnedPath,
  type SafeFileRemovalOptions,
  type SafeFileRemovalResult,
  type SafeRemovalSkip,
} from "./safe-file-removal.js";
import { pinSkillEmitsToExistingLivePaths } from "./shared-emit-paths.js";
import { captureManagedSnapshotState } from "./snapshot-capture.js";

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
  /**
   * The resources are the whole global profile: Claude Code plugin
   * registrations HarnessTap wrote for plugins outside it are taken out of
   * the shared registry files.
   */
  replacesHarnessTapRegistrations?: boolean;
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
  /**
   * Skipped because identical, in a host plugin folder a HarnessTap install
   * created: recorded as owned like written files.
   */
  adoptedFiles?: string[];
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
  if (!inStatusComputation()) return assertMaterializedPathIsSafeUncached(rootPath, relativePath);
  // A status computation checks each planned path several times. Only safe
  // paths are kept; an unsafe one throws again on every call.
  const safe = computationSlot("safe-materialized-paths", () => new Map<string, string>());
  const key = `${rootPath}\0${relativePath}`;
  const known = safe.get(key);
  if (known !== undefined) return known;
  const fullPath = assertMaterializedPathIsSafeUncached(rootPath, relativePath);
  safe.set(key, fullPath);
  return fullPath;
}

function assertMaterializedPathIsSafeUncached(rootPath: string, relativePath: string): string {
  const fullPath = resolveMaterializedPath(rootPath, relativePath);
  const resolvedRoot = inStatusComputation()
    ? computationSlot(`realpath-root:${rootPath}`, () => realpathSync(rootPath))
    : realpathSync(rootPath);

  // A link at the path itself is never followed: removal backs up and
  // unlinks the link, and writers skip a link that leads out of the root
  // (`leafLinkLeavesRoot`). Only the folders above it must stay inside.
  if (existsSync(fullPath) && !isLeafLink(fullPath)) {
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

function isLeafLink(fullPath: string): boolean {
  try {
    return lstatSync(fullPath).isSymbolicLink();
  } catch {
    return false;
  }
}

function warnKeptOutsideLink(relativePath: string): void {
  console.error(`warning: ${keptLinkOutsideRoot(relativePath)}`);
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
  // A path whose folders lead out of the root is never touched. It is kept
  // and reported instead of failing the apply after its writes are done.
  const unsafe: SafeRemovalSkip[] = [];
  const safe = filtered.filter((filePath) => {
    try {
      assertMaterializedPathIsSafe(rootPath, filePath);
      return true;
    } catch {
      unsafe.push({ path: filePath, reason: "unmanaged", message: skippedRemovalOutsideRoot(filePath) });
      return false;
    }
  });
  const result = executeSafeFileRemovals(rootPath, safe, options);
  if (unsafe.length === 0) return result;
  return {
    ...result,
    skipped: [...result.skipped, ...unsafe],
    warnings: [...result.warnings, ...unsafe.map((skip) => skip.message)],
  };
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
  if (inStatusComputation()) {
    const existing = readDiskBytesOnce(fullPath);
    return existing !== null && existing.equals(serializedFileBytes(file));
  }
  try {
    const existing = readFileSync(fullPath);
    return existing.equals(serializedFileBytes(file));
  } catch {
    return false;
  }
}

function semanticallyMatchesExisting(fullPath: string, file: SerializedFile): boolean {
  if (!inStatusComputation()) return semanticallyMatchesExistingUncached(fullPath, file);
  // The dry-run plan asks this for the same file more than once.
  const seen = computationSlot(
    "semantic-matches",
    () => new Map<string, { content: string; encoding: SerializedFile["encoding"]; matches: boolean }>(),
  );
  const previous = seen.get(`${file.path}\0${fullPath}`);
  if (previous && previous.content === file.content && previous.encoding === file.encoding) {
    return previous.matches;
  }
  const matches = semanticallyMatchesExistingUncached(fullPath, file);
  seen.set(`${file.path}\0${fullPath}`, { content: file.content, encoding: file.encoding, matches });
  return matches;
}

function semanticallyMatchesExistingUncached(fullPath: string, file: SerializedFile): boolean {
  if (fileContentMatchesExisting(fullPath, file)) {
    return true;
  }
  if (!existsSync(fullPath)) {
    return false;
  }
  if (inStatusComputation()) {
    const text = readDiskTextOnce(fullPath);
    return text !== null && fileContentsEquivalentForDrift(file.path, text, file.content);
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
    const platformResources = traceSpan("gen.omit-bundled-skills", () =>
      omitHostPluginBundledSkills(
        serializedResources.filter((resource) => resourceAppliesToHarness(resource, pid)),
        pid,
        homeRoot,
        target,
      ),
    pid);
    const serializer = getPlatformSerializer(pid);
    const surfaceWarnings: SurfaceWarning[] = [];
    const skillNames = new Set(
      platformResources.filter((resource) => resource.type === "skill").map((resource) => resource.name),
    );
    let emitResources = platformResources.filter((resource) => {
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
    const nativeGroups = nativeAgentPluginsEnabled() && isNativeAgentPluginPlatform(pid)
      ? splitNativeAgentPluginExtract(emitResources)
      : undefined;
    if (nativeGroups) {
      emitResources = nativeGroups.kept;
    }
    for (const resource of emitResources) {
      if (resource.type !== "mcp_server") continue;
      for (const message of mcpSerializationWarnings(
        resource.name,
        resource.metadata as McpServerMetadata,
        pid,
      )) {
        surfaceWarnings.push({
          harness: pid,
          path: "",
          category: "mcp-spec-field",
          message,
          alias_harnesses: [],
        });
      }
    }
    const resolvedMcp = traceSpan("gen.resolve-mcp", () => resolveInstalledMcpResources(emitResources), pid);
    emitResources = resolvedMcp.resources;
    for (const message of resolvedMcp.warnings) {
      surfaceWarnings.push({
        harness: pid,
        path: "",
        category: "plugin-data-dir",
        message,
        alias_harnesses: [],
      });
    }
    let files = await traceSpan("gen.serialize", () =>
      serializer.serialize(emitResources, projectRoot, {
        target,
        skillCursorMode: options.skillCursorMode,
        skillSourceRoot,
        projectRoot,
        mergeLiveSkillMarkdown: options.mergeLiveSkillMarkdown,
        surfaceWarnings,
      }),
    pid);
    if (nativeGroups) {
      const native = nativeAgentPluginFiles({
        platformId: pid,
        applyRoot: projectRoot,
        groups: nativeGroups.groups,
        files,
      });
      files = mergeNativeAgentPluginFiles(files, native.files);
      surfaceWarnings.push(...native.warnings);
    }
    if (pid === "claude-code" && claudeConfig) {
      files = traceSpan("gen.claude-plugin-extensions", () =>
        applyClaudePluginExtensions(files, claudeConfig, projectRoot),
      pid);
    }
    if (pid === "claude-code" && target === "global" && options.replacesHarnessTapRegistrations) {
      files = pruneLeavingClaudeRegistrations(files, projectRoot);
    }
    const serialized = files;
    files = await traceSpan("gen.resource-ownership", () =>
      attachResourceOwnership(serialized, platformResources, {
        platformId: pid,
        rootPath: projectRoot,
        target,
        serializeOptions: {
          skillCursorMode: options.skillCursorMode,
          skillSourceRoot,
          mergeLiveSkillMarkdown: options.mergeLiveSkillMarkdown,
        },
      }),
    pid);
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
  const settings = isClaudeSettingsPath(file.path);
  const before = settings && existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : undefined;
  writeFileSync(fullPath, serializedFileBytes(file));
  applySerializedFileMode(fullPath, file);
  if (settings) {
    // The enabledPlugins keys this write added are HarnessTap's to take out again.
    recordAddedEnabledKeys(fullPath, before, file.content);
    forgetMissingEnabledKeys(fullPath);
    // Likewise the extraKnownMarketplaces entries it added.
    recordAddedSettingsMarketplaces(fullPath, before, file.content);
    forgetMissingSettingsMarketplaces(fullPath);
  }
}

function pruneCursorLocalPlugins(rootPath: string, files: readonly SerializedFile[]): void {
  const undesired = pruneManagedCursorLocalPlugins(rootPath, files);
  const result = executeSafeFileRemovals(rootPath, undesired);
  for (const warning of result.warnings) {
    console.error(`warning: ${warning}`);
  }
}

export function writeFiles(
  files: SerializedFile[],
  projectRoot: string,
): void {
  pruneCursorLocalPlugins(projectRoot, files);
  for (const file of files) {
    const fullPath = assertMaterializedPathIsSafe(projectRoot, file.path);
    if (leafLinkLeavesRoot(projectRoot, fullPath)) {
      warnKeptOutsideLink(file.path);
      continue;
    }
    if (semanticallyMatchesExisting(fullPath, file)) {
      continue;
    }
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
    if (isNativeAgentPluginCachePath(file.path)) return [];
    const fullPath = assertMaterializedPathIsSafe(rootPath, file.path);
    // Kept as the user's link, never written through: not a conflict.
    if (leafLinkLeavesRoot(rootPath, fullPath)) return [];
    if ((pathCounts.get(file.path) ?? 0) > 1) {
      return [{
        path: file.path,
        fullPath,
        owners: [],
      }];
    }
    if (!existsSync(fullPath)) return [];
    // Byte differences that apply would skip (JSON/TOML/MCP semantic
    // equality) are not conflicts. A no-op must not cancel the apply.
    if (semanticallyMatchesExisting(fullPath, file)) return [];
    // A managed file the user edited is kept, not overwritten. It is not a
    // conflict that should cancel the apply.
    const ownership = classifyManagedPathOwnership(rootPath, file.path);
    if (ownership === "modified") {
      return [];
    }
    // The host plugin registry is merged entry by entry, and HarnessTap still
    // owns the bytes on disk: pointing its own entry at a new version (after
    // `ht plugin update`) is not someone else's change.
    if (ownership === "owned" && isPluginRegistryManagedPath(file.path)) {
      return [];
    }
    const owners = findImportedSnapshotOwnersByFile(file.path);
    return [{
      path: file.path,
      fullPath,
      owners,
    }];
  });
}

/**
 * True when `fullPath` is in a host plugin folder and still holds the bytes
 * HarnessTap recorded writing there. That holds for a folder that existed
 * before HarnessTap too: the files it added there are its own. A version 1
 * record (written before files were recorded) covers the whole folder, but
 * only for a folder a HarnessTap install created.
 */
function holdsHarnessTapHostViewBytes(fullPath: string): boolean {
  const written = hostPluginViewWrittenHash(fullPath);
  if (written === undefined) return isInHostPluginViewCreatedByHarnessTap(fullPath);
  return written !== null && written === hashFileOrLink(fullPath);
}

/** Keep a host plugin folder's record in step with what an apply writes into it. */
function noteHostPluginViewWrite(fullPath: string): void {
  if (!fullPath.split(sep).join("/").includes("/plugins/cache/")) return;
  if (hostPluginViewWrittenHash(fullPath) === undefined) return;
  const hash = hashFileOrLink(fullPath);
  if (hash) recordHostPluginViewWrite(fullPath, hash);
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

  // A dry run reports the replace plan. Cancelling here would hide the
  // writes --on-conflict replace would make, and would not change disk.
  if ([...decisions.values()].includes("cancel") && !options.dryRun) {
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
  const adoptedFiles: string[] = [];

  if (options.dryRun) {
    const skippedPreexisting = files.filter((file) => {
      if (decisions.get(file.path) === "skip") {
        return false;
      }
      if (leafLinkLeavesRoot(rootPath, assertMaterializedPathIsSafe(rootPath, file.path))) {
        return true;
      }
      if (shouldPreserveUnownedFile(file.path)) {
        const fullMergeable = assertMaterializedPathIsSafe(rootPath, file.path);
        return semanticallyMatchesExisting(fullMergeable, file);
      }
      const fullPath = assertMaterializedPathIsSafe(rootPath, file.path);
      return (
        (existsSync(fullPath)
          && !isHarnessTapOwnedPath(rootPath, file.path)
          && !holdsHarnessTapHostViewBytes(fullPath))
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

  pruneCursorLocalPlugins(rootPath, files);
  for (const file of files) {
    const decision = decisions.get(file.path);
    if (decision === "skip") {
      skippedFiles.push(file.path);
      continue;
    }
    const fullPath = assertMaterializedPathIsSafe(rootPath, file.path);
    if (leafLinkLeavesRoot(rootPath, fullPath)) {
      warnKeptOutsideLink(file.path);
      skippedFiles.push(file.path);
      continue;
    }
    // A host plugin folder a HarnessTap install created holds HarnessTap's
    // bytes: never record them as preexisting. Anything else in it (a file
    // the user added or changed) is the user's and is never adopted.
    const htHostViewBytes = existsSync(fullPath) && holdsHarnessTapHostViewBytes(fullPath);
    if (existsSync(fullPath) && !isHarnessTapOwnedPath(rootPath, file.path) && !htHostViewBytes) {
      if (!hasHarnessTapMaterialization(rootPath, file.path)) {
        recordPreexistingPath({
          root_path: rootPath,
          path: file.path,
          content_hash: hashOnDiskFile(fullPath) ?? "",
        });
      }
      if (!shouldPreserveUnownedFile(file.path)) {
        skippedFiles.push(file.path);
        continue;
      }
    }
    if (semanticallyMatchesExisting(fullPath, file)) {
      // The folder's record already proves these bytes are HarnessTap's; give
      // them an apply row too.
      if (htHostViewBytes && !hasCurrentHarnessTapMaterialization(rootPath, file.path)) {
        adoptedFiles.push(file.path);
      }
      skippedFiles.push(file.path);
      continue;
    }
    writeSerializedFile(fullPath, file);
    writtenFiles.push(file.path);
    noteHostPluginViewWrite(fullPath);
  }

  await clearLiveReadCachesAfterWrite();

  return {
    cancelled: false,
    writtenFiles,
    skippedFiles,
    adoptedFiles,
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
 * Status and Cursor inventory caches import the Cursor provider, and that
 * provider imports this module to write install files. A static import would
 * cycle through plugin registry initialization.
 */
async function clearLiveReadCachesAfterWrite(): Promise<void> {
  const { clearLiveReadCaches } = await import("./live-read-cache.js");
  clearLiveReadCaches();
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

  await clearLiveReadCachesAfterWrite();
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
  gateDeployFiles(allFiles, { forceUnicode: options.forceUnicode, rootPath: homeRoot });
  // A tracked file the apply no longer emits can only change by being
  // removed, and every removal keeps its own backup. Read only the rest.
  const emittedPaths = new Set(allFiles.map((file) => file.path));
  const previousTracked = options.previousTrackedFiles ?? [];
  const preApplyState = captureManagedSnapshotState({
    rootPath: homeRoot,
    generated: results,
    extraPaths: previousTracked.filter((path) => emittedPaths.has(path)),
    removalBackedPaths: previousTracked.filter((path) => !emittedPaths.has(path)),
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

  if (!materialized.cancelled) {
    persistWrittenMaterializations({
      scope: "global",
      project_id: null,
      root_path: homeRoot,
      platformResults: results.map((result) => ({
        platformId: result.platformId,
        files: result.files,
        writtenPaths: [
          ...materialized.writtenFiles.filter((filePath) =>
            result.files.some((file) => file.path === filePath),
          ),
          ...(materialized.adoptedFiles ?? []).filter((filePath) =>
            result.files.some((file) => file.path === filePath),
          ),
        ],
      })),
    });
  }

  if (!materialized.cancelled && options.snapshotId) {
    const currentlyOwnedPaths = [
      ...new Set([...materialized.writtenFiles, ...ownedSkippedFiles, ...(materialized.adoptedFiles ?? [])]),
    ];
    removeImportedSnapshotOwnershipForFiles(currentlyOwnedPaths, options.snapshotId);
    for (const result of results) {
      const emittedFiles = result.files.map((file) => file.path);
      const writtenFiles = emittedFiles.filter((filePath) =>
        materialized.writtenFiles.includes(filePath),
      );
      const preservedSkippedFiles = emittedFiles.filter(
        (filePath) =>
          materialized.skippedFiles.includes(filePath)
          && ownedSkippedFiles.includes(filePath),
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

  await clearLiveReadCachesAfterWrite();
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
