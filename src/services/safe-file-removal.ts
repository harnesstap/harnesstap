import {
  hostPluginViewWrittenHash,
  pruneCreatedHostPluginViews,
} from "./package-cache/host-plugin-views.js";
import { computationSlot, inStatusComputation } from "./status-computation.js";
import { readDiskTextOnce } from "./status-disk-read.js";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { ulid } from "ulid";
import { getHarnesstapDir } from "../db/connection.js";
import {
  listApplyRemovalBackups,
  listTrashPinnedApplyIds,
  recordApplyRemovalBackup,
  recordTrashedApplyRemovalBackup,
  removalBackupTrashFile,
} from "../models/apply-removal-backup.js";
import { isPreexistingPath } from "../models/preexisting-path.js";
import {
  deleteMaterializationsForRootPaths,
  listMaterializationsForRootPath,
} from "../models/resource-materialization.js";
import { hashGeneratedContent } from "./materialization-ownership.js";
import { isMergeableHostConfigPath } from "./merged-host-config.js";
import { saveRemovedHostPluginViews, saveRemovedOwnership } from "./removed-ownership.js";
import { restoreBlockedMessage, restoreBlocker } from "./restore-blocker.js";
import { hashFileContentStreaming } from "./streaming-content-hash.js";
import { shortenHomePath } from "../utils/home-path.js";
import { removeFileOrLink } from "../utils/remove-file-or-link.js";

const APPLY_TRASH_KEEP = 10;
const CONTAINER_DIR_NAMES = new Set([
  "skills",
  "agents",
  "commands",
  "hooks",
  "rules",
  "plugins",
]);

export type SafeRemovalSkipReason =
  | "preexisting"
  | "unmanaged"
  | "modified"
  | "missing";

export interface SafeRemovalSkip {
  path: string;
  reason: SafeRemovalSkipReason;
  /** A revert left the path alone because this path (home-relative) is in the way. */
  blockedBy?: string;
  message: string;
  /** False when `--force-remove` would not remove the path either, so no hint should suggest it. */
  forceable?: boolean;
}

/** A file `--force-remove` removed that would otherwise have been kept. */
export interface SafeRemovalForced {
  path: string;
  reason: "unmanaged" | "modified";
}

export interface SafeRemovalPlan {
  remove: string[];
  skip: SafeRemovalSkip[];
  forced?: SafeRemovalForced[];
}

export interface SafeFileRemovalOptions {
  applyId?: string;
  snapshotId?: string | null;
  forceRemove?: boolean;
  dryRun?: boolean;
  /**
   * `owned` (default): only remove HarnessTap-tracked files whose hash still
   * matches, unless `forceRemove` is set. `listed` deletes the exact listed
   * files (explicit user actions such as stash) after backing them up.
   */
  mode?: "owned" | "listed";
}

export interface SafeFileRemovalResult {
  applyId: string;
  backupDir: string;
  removed: string[];
  skipped: SafeRemovalSkip[];
  warnings: string[];
  forced?: SafeRemovalForced[];
}

export function applyTrashRoot(): string {
  return join(getHarnesstapDir(), "trash");
}

export function isApplyTrashTarget(target: string): boolean {
  const root = resolve(applyTrashRoot());
  const resolved = resolve(String(target));
  return resolved === root || resolved.startsWith(`${root}${sep}`);
}

export function hashOnDiskFile(fullPath: string): string | undefined {
  if (!inStatusComputation()) return hashOnDiskFileUncached(fullPath);
  const hashes = computationSlot("on-disk-hashes", () => new Map<string, string | undefined>());
  if (hashes.has(fullPath)) return hashes.get(fullPath);
  const hash = hashOnDiskFileUncached(fullPath);
  hashes.set(fullPath, hash);
  return hash;
}

function hashOnDiskFileUncached(fullPath: string): string | undefined {
  if (inStatusComputation()) {
    const text = readDiskTextOnce(fullPath);
    return text === null ? undefined : hashGeneratedContent(text);
  }
  return hashFileContentStreaming(fullPath);
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** True when `fullPath` is a folder itself, not a link to one. */
function isRealDirectory(fullPath: string): boolean {
  try {
    return lstatSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

/** True when `fullPath` is a symbolic link, dangling or not. */
export function isSymlinkPath(fullPath: string): boolean {
  try {
    return lstatSync(fullPath).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * True when the path is a link (the user's) whose target is outside the root.
 * HarnessTap never writes through such a link and never replaces it while
 * writing; the user keeps it.
 */
export function leafLinkLeavesRoot(rootPath: string, fullPath: string): boolean {
  if (!isSymlinkPath(fullPath)) return false;
  let root: string;
  try {
    root = realpathSync(rootPath);
  } catch {
    return true;
  }
  let target: string;
  try {
    target = realpathSync(fullPath);
  } catch {
    // Dangling: judge where it points.
    try {
      target = resolve(dirname(fullPath), readlinkSync(fullPath));
    } catch {
      return true;
    }
  }
  return target !== root && !target.startsWith(`${root}${sep}`);
}

/**
 * Hash of a host plugin folder entry: a link hashes as its target (never
 * followed), any other file as its bytes.
 */
export function hashFileOrLink(fullPath: string): string | undefined {
  if (isSymlinkPath(fullPath)) {
    try {
      return hashGeneratedContent(`symlink:${readlinkSync(fullPath)}`);
    } catch {
      return undefined;
    }
  }
  return hashOnDiskFile(fullPath);
}

function normalizeRelative(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export type ManagedPathOwnership = "unowned" | "owned" | "modified";

/**
 * Ownership is manifest row plus current hash. A tracked path whose bytes no
 * longer match what HarnessTap last wrote is `modified` and is never owned
 * again until a later apply actually writes the file.
 */
const HOST_PLUGIN_CACHE_SEGMENT = "plugins/cache/";

/** True when a host plugin folder's record says HarnessTap did not write the path. */
function hostPluginViewSaysNotWritten(rootPath: string, relativePath: string): boolean {
  const normalized = normalizeRelative(relativePath);
  return normalized.includes(HOST_PLUGIN_CACHE_SEGMENT)
    && hostPluginViewWrittenHash(resolve(rootPath, normalized)) === null;
}

export function classifyManagedPathOwnership(
  rootPath: string,
  relativePath: string,
): ManagedPathOwnership {
  const normalized = normalizeRelative(relativePath);
  const fullPath = resolve(rootPath, normalized);
  // A link out of the root is the user's: hash the link, never what it points at.
  const linkLeavesRoot = leafLinkLeavesRoot(rootPath, fullPath);
  if (normalized.includes(HOST_PLUGIN_CACHE_SEGMENT)) {
    // In a host plugin folder the folder's record says what HarnessTap wrote,
    // files an install wrote (such as links) that no apply row lists included.
    const written = hostPluginViewWrittenHash(fullPath);
    if (written === null) return "unowned";
    if (written !== undefined) {
      // Records from before links were kept as links hold the linked bytes.
      const same = written === hashFileOrLink(fullPath)
        || (isSymlinkPath(fullPath) && !linkLeavesRoot && written === hashOnDiskFile(fullPath));
      return same ? "owned" : "modified";
    }
  }
  const owned = listMaterializationsForRootPath(rootPath, normalized);
  if (owned.length === 0) {
    return "unowned";
  }
  const diskHash = linkLeavesRoot ? hashFileOrLink(fullPath) : hashOnDiskFile(fullPath);
  if (owned.some((row) => row.generated_hash === diskHash)) {
    return "owned";
  }
  return "modified";
}

export function hasHarnessTapMaterialization(
  rootPath: string,
  relativePath: string,
): boolean {
  return listMaterializationsForRootPath(rootPath, normalizeRelative(relativePath)).length > 0;
}

/** True when an apply row records the bytes now on disk at the path. */
export function hasCurrentHarnessTapMaterialization(
  rootPath: string,
  relativePath: string,
): boolean {
  const normalized = normalizeRelative(relativePath);
  const diskHash = hashOnDiskFile(resolve(rootPath, normalized));
  return listMaterializationsForRootPath(rootPath, normalized)
    .some((row) => row.generated_hash === diskHash);
}

export function isHarnessTapOwnedPath(rootPath: string, relativePath: string): boolean {
  return classifyManagedPathOwnership(rootPath, relativePath) === "owned";
}

/** JSON and TOML host configs that apply merges by key. Instruction markdown is written whole. */
export function isSharedMergedConfigPath(path: string): boolean {
  return isMergeableHostConfigPath(path) && !/\.(md|mdc)$/i.test(path);
}

export function skippedWriteKeepsForOwnership(
  rootPath: string,
  skippedFiles: readonly string[],
): SafeRemovalSkip[] {
  const seen = new Set<string>();
  const skips: SafeRemovalSkip[] = [];
  for (const rawPath of skippedFiles) {
    const relativePath = normalizeRelative(rawPath);
    if (!relativePath || seen.has(relativePath)) {
      continue;
    }
    seen.add(relativePath);
    // Shared host configs (.claude.json, settings.json) are merged key by key
    // and never removed. Other keys change all the time (the harness itself
    // writes them), so a whole-file hash mismatch is not a user edit to keep.
    if (isSharedMergedConfigPath(relativePath)) {
      continue;
    }
    if (classifyManagedPathOwnership(rootPath, relativePath) !== "modified") {
      continue;
    }
    skips.push({
      path: relativePath,
      reason: "modified",
      message: skipMessage(relativePath, "modified"),
    });
  }
  return skips;
}

export function mergeSafeRemovalSkips(
  ...lists: Array<readonly SafeRemovalSkip[] | undefined>
): SafeRemovalSkip[] {
  const seen = new Set<string>();
  const merged: SafeRemovalSkip[] = [];
  for (const list of lists) {
    for (const skip of list ?? []) {
      const key = `${skip.path}:${skip.reason}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(skip);
    }
  }
  return merged;
}

function skipMessage(path: string, reason: SafeRemovalSkipReason): string {
  switch (reason) {
    case "preexisting":
      return `Skipped removing ${path} (present before HarnessTap managed it).`;
    case "unmanaged":
      return `Skipped removing ${path} (not managed by HarnessTap).`;
    case "modified":
      return `Skipped removing ${path} (modified since HarnessTap wrote it).`;
    case "missing":
      return `Skipped removing ${path} (already missing).`;
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

export function planSafeFileRemovals(
  rootPath: string,
  relativePaths: readonly string[],
  options: SafeFileRemovalOptions = {},
): SafeRemovalPlan {
  const remove: string[] = [];
  const skip: SafeRemovalSkip[] = [];
  const forced: SafeRemovalForced[] = [];
  const mode = options.mode ?? "owned";
  const seen = new Set<string>();

  for (const rawPath of relativePaths) {
    const relativePath = normalizeRelative(rawPath);
    if (!relativePath || seen.has(relativePath)) {
      continue;
    }
    seen.add(relativePath);

    const fullPath = resolve(rootPath, relativePath);
    if (!existsSync(fullPath) && !isSymlinkPath(fullPath)) {
      skip.push({
        path: relativePath,
        reason: "missing",
        message: skipMessage(relativePath, "missing"),
      });
      continue;
    }

    if (mode === "listed") {
      remove.push(relativePath);
      continue;
    }

    // HarnessTap only writes files and links here. A real folder at a tracked
    // path is the user's, so it is kept even with --force-remove (reading it
    // as a file would also abort the run after earlier removals).
    if (isRealDirectory(fullPath)) {
      skip.push({
        path: relativePath,
        reason: "unmanaged",
        message: `Skipped removing ${relativePath} (a folder HarnessTap didn't create).`,
        forceable: false,
      });
      continue;
    }

    if (isPreexistingPath(rootPath, relativePath)) {
      skip.push({
        path: relativePath,
        reason: "preexisting",
        message: skipMessage(relativePath, "preexisting"),
        forceable: false,
      });
      continue;
    }

    const ownership = classifyManagedPathOwnership(rootPath, relativePath);
    if (ownership === "unowned") {
      // In a host plugin folder the folder's record says what HarnessTap
      // wrote: a file it did not write is the user's, kept even with --force-remove.
      if (options.forceRemove && !hostPluginViewSaysNotWritten(rootPath, relativePath)) {
        remove.push(relativePath);
        forced.push({ path: relativePath, reason: "unmanaged" });
        continue;
      }
      skip.push({
        path: relativePath,
        reason: "unmanaged",
        message: skipMessage(relativePath, "unmanaged"),
        ...(hostPluginViewSaysNotWritten(rootPath, relativePath) ? { forceable: false } : {}),
      });
      continue;
    }

    if (ownership === "owned" || options.forceRemove) {
      remove.push(relativePath);
      if (ownership !== "owned") {
        forced.push({ path: relativePath, reason: "modified" });
      }
      continue;
    }
    skip.push({
      path: relativePath,
      reason: "modified",
      message: skipMessage(relativePath, "modified"),
    });
  }

  return forced.length > 0 ? { remove, skip, forced } : { remove, skip };
}

function copyToTrash(applyId: string, relativePath: string, bytes: Buffer): string {
  const dest = removalBackupTrashFile(applyId, relativePath);
  // A file already there may be the only copy of an earlier backup row.
  if (pathExists(dest)) return dest;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  return dest;
}

/**
 * A removed link goes into the trash as a link, so the trash looks like what
 * was removed. Where a link cannot be made the target is kept as text.
 */
function linkToTrash(applyId: string, relativePath: string, target: Buffer): void {
  const dest = removalBackupTrashFile(applyId, relativePath);
  if (pathExists(dest)) return;
  mkdirSync(dirname(dest), { recursive: true });
  try {
    symlinkSync(target.toString("utf-8"), dest);
  } catch {
    writeFileSync(dest, target);
  }
}

/**
 * Trash folders past the newest `keepLast` are deleted, except any folder that
 * holds the only copy of a backup row (the file was moved there): deleting it
 * would strand a removal `ht revert` can still undo. When the database cannot
 * be read nothing is pruned.
 */
export function pruneApplyTrash(keepLast = APPLY_TRASH_KEEP): void {
  const root = applyTrashRoot();
  if (!existsSync(root)) {
    return;
  }
  let pinned: Set<string>;
  try {
    pinned = listTrashPinnedApplyIds();
  } catch {
    return;
  }
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  const dirs = entries
    .filter((name) => !pinned.has(name))
    .map((name) => {
      const full = join(root, name);
      try {
        const stat = statSync(full);
        return { full, mtime: stat.mtimeMs, isDir: stat.isDirectory() };
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is { full: string; mtime: number; isDir: boolean } =>
      Boolean(entry?.isDir),
    )
    .sort((a, b) => b.mtime - a.mtime);
  for (const extra of dirs.slice(keepLast)) {
    rmSync(extra.full, { recursive: true, force: true });
  }
}

const EMPTY_DIR_PRUNE_STOP = new Set(CONTAINER_DIR_NAMES);

export function pruneEmptyAncestors(filePath: string, stopAt: string): void {
  const stop = resolve(stopAt);
  let current = dirname(filePath);
  while (current !== stop) {
    if (resolve(current) === stop) {
      break;
    }
    const base = basename(current);
    if (EMPTY_DIR_PRUNE_STOP.has(base)) {
      break;
    }
    try {
      if (!existsSync(current)) {
        current = dirname(current);
        continue;
      }
      if (readdirSync(current).length > 0) {
        break;
      }
      rmdirSync(current);
    } catch {
      break;
    }
    current = dirname(current);
  }
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Put an unchanged file of HarnessTap's into the apply's trash folder without
 * reading it: it is moved when `move` is set (the caller then has nothing
 * left to remove), copied by the filesystem otherwise. Returns false when the
 * trash already has a file at that place, so nothing there is overwritten.
 */
function stashPristineFile(input: {
  fullPath: string;
  relativePath: string;
  applyId: string;
  snapshotId?: string | null;
  mode: number;
  move: boolean;
}): boolean {
  const dest = removalBackupTrashFile(input.applyId, input.relativePath);
  if (pathExists(dest)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  if (input.move) {
    try {
      renameSync(input.fullPath, dest);
    } catch (error) {
      // Another filesystem: copy; the caller removes the original.
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      copyFileSync(input.fullPath, dest);
    }
  } else {
    copyFileSync(input.fullPath, dest);
  }
  recordTrashedApplyRemovalBackup({
    apply_id: input.applyId,
    snapshot_id: input.snapshotId,
    relative_path: input.relativePath,
    mode: input.mode,
  });
  return true;
}

/**
 * Back a file up before it goes. A regular file HarnessTap wrote and nobody
 * changed (`pristine`) costs no copy of its bytes in the database: its trash
 * file is the backup. Anything else (a file the user edited, a forced
 * removal, a link) keeps the full copy in the database as well.
 */
function backupOnDiskFile(input: {
  rootPath: string;
  relativePath: string;
  applyId: string;
  snapshotId?: string | null;
  pristine?: boolean;
  move?: boolean;
}): void {
  const fullPath = resolve(input.rootPath, input.relativePath);
  if (isSymlinkPath(fullPath)) {
    // A link is backed up as its target, so it can be put back as a link.
    const target = Buffer.from(readlinkSync(fullPath));
    recordApplyRemovalBackup({
      apply_id: input.applyId,
      snapshot_id: input.snapshotId,
      relative_path: input.relativePath,
      content: target,
      mode: S_IFLNK | 0o777,
    });
    linkToTrash(input.applyId, input.relativePath, target);
    return;
  }
  let mode = 0;
  try {
    mode = statSync(fullPath).mode;
  } catch {
    mode = 0;
  }
  if (
    input.pristine
    && stashPristineFile({
      fullPath,
      relativePath: input.relativePath,
      applyId: input.applyId,
      snapshotId: input.snapshotId,
      mode,
      move: input.move === true,
    })
  ) {
    return;
  }
  const bytes = readFileSync(fullPath);
  recordApplyRemovalBackup({
    apply_id: input.applyId,
    snapshot_id: input.snapshotId,
    relative_path: input.relativePath,
    content: bytes,
    mode,
  });
  copyToTrash(input.applyId, input.relativePath, bytes);
}

function backupAndUnlink(input: {
  rootPath: string;
  relativePath: string;
  applyId: string;
  snapshotId?: string | null;
  pristine: boolean;
  /** Collects the removed path, so the host plugin folder records are pruned once at the end. */
  removedPaths: string[];
}): void {
  const fullPath = resolve(input.rootPath, input.relativePath);
  backupOnDiskFile({ ...input, move: true });
  removeFileOrLink(fullPath);
  pruneEmptyAncestors(fullPath, input.rootPath);
  input.removedPaths.push(fullPath);
}

export function backupAndRewriteFile(input: {
  rootPath: string;
  relativePath: string;
  nextContent: string | null;
  applyId: string;
  snapshotId?: string | null;
}): void {
  const fullPath = resolve(input.rootPath, input.relativePath);
  if (!existsSync(fullPath)) {
    // Nothing on disk to back up: a revert restoring a file an apply removed.
    if (input.nextContent === null) return;
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, input.nextContent);
    return;
  }
  backupOnDiskFile(input);
  if (input.nextContent === null) {
    saveRemovedHostPluginViews(input.snapshotId, input.rootPath, [input.relativePath]);
    removeFileOrLink(fullPath);
    pruneEmptyAncestors(fullPath, input.rootPath);
    saveRemovedOwnership(input.snapshotId, input.rootPath, [input.relativePath]);
    deleteMaterializationsForRootPaths(input.rootPath, [input.relativePath]);
    return;
  }
  writeFileSync(fullPath, input.nextContent);
}

export function executeSafeFileRemovals(
  rootPath: string,
  relativePaths: readonly string[],
  options: SafeFileRemovalOptions = {},
): SafeFileRemovalResult {
  const applyId = options.applyId ?? ulid();
  const plan = planSafeFileRemovals(rootPath, relativePaths, options);
  const warnings = plan.skip
    .filter((entry) => entry.reason !== "missing")
    .map((entry) => entry.message);
  const backupDir = join(applyTrashRoot(), applyId);

  if (options.dryRun) {
    return {
      applyId,
      backupDir,
      removed: plan.remove,
      skipped: plan.skip,
      warnings,
      ...(plan.forced ? { forced: plan.forced } : {}),
    };
  }

  saveRemovedHostPluginViews(options.snapshotId, rootPath, plan.remove);
  const forcedPaths = new Set((plan.forced ?? []).map((entry) => entry.path));
  const removedPaths: string[] = [];
  try {
    for (const relativePath of plan.remove) {
      const pristine = forcedPaths.has(relativePath)
        ? false
        : options.mode === "listed"
          ? classifyManagedPathOwnership(rootPath, relativePath) === "owned"
          : true;
      backupAndUnlink({
        rootPath,
        relativePath,
        applyId,
        snapshotId: options.snapshotId,
        pristine,
        removedPaths,
      });
    }
  } finally {
    pruneCreatedHostPluginViews(removedPaths);
  }
  saveRemovedOwnership(options.snapshotId, rootPath, plan.remove);
  deleteMaterializationsForRootPaths(rootPath, plan.remove);
  pruneApplyTrash();

  return {
    applyId,
    backupDir,
    removed: plan.remove,
    skipped: plan.skip,
    warnings,
    ...(plan.forced ? { forced: plan.forced } : {}),
  };
}

export function restoreSafeRemovalBackup(input: {
  applyId?: string;
  snapshotId?: string;
  rootPath: string;
  /** Called for a path left alone because something is in the way. */
  onSkip?: (skip: SafeRemovalSkip) => void;
}): string[] {
  /** True when `fullPath` can take the restored file; says why not otherwise. */
  const free = (relativePath: string, fullPath: string): boolean => {
    const blocker = restoreBlocker(input.rootPath, relativePath);
    if (blocker === undefined && !pathExists(fullPath)) return true;
    input.onSkip?.({
      path: relativePath,
      reason: "unmanaged",
      ...(blocker === undefined ? {} : { blockedBy: blocker }),
      message: blocker === undefined
        ? `Skipped restoring ${relativePath} (something is at that path now).`
        : restoreBlockedMessage(relativePath, blocker),
    });
    return false;
  };
  const backups = listApplyRemovalBackups({
    apply_id: input.applyId,
    snapshot_id: input.snapshotId,
  });
  const restored: string[] = [];
  for (const backup of backups) {
    const fullPath = resolve(input.rootPath, backup.relative_path);
    if (!free(backup.relative_path, fullPath)) continue;
    mkdirSync(dirname(fullPath), { recursive: true });
    if (((backup.mode ?? 0) & S_IFMT) === S_IFLNK) {
      symlinkSync(Buffer.from(backup.content).toString("utf-8"), fullPath);
    } else {
      writeFileSync(fullPath, backup.content);
    }
    restored.push(backup.relative_path);
  }
  if (backups.length > 0) {
    return restored;
  }

  const applyId = input.applyId;
  if (!applyId) {
    return restored;
  }
  const trashDir = join(applyTrashRoot(), applyId);
  if (!existsSync(trashDir)) {
    return restored;
  }
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(full);
      if (stat.isDirectory()) {
        walk(full, rel);
        continue;
      }
      const dest = resolve(input.rootPath, rel);
      if (!free(rel, dest)) continue;
      mkdirSync(dirname(dest), { recursive: true });
      if (stat.isSymbolicLink()) {
        // A link goes back as a link, never as the bytes it points to.
        symlinkSync(readlinkSync(full), dest);
      } else {
        writeFileSync(dest, readFileSync(full));
      }
      restored.push(rel);
    }
  };
  walk(trashDir, "");
  return restored;
}

export interface PlannedRemovals {
  owned_unmodified: string[];
  owned_modified: string[];
  unmanaged: string[];
}

export type PlannedRemovalGroup = keyof PlannedRemovals;

export function emptyPlannedRemovals(): PlannedRemovals {
  return { owned_unmodified: [], owned_modified: [], unmanaged: [] };
}

export function groupPlannedRemovals(plan: SafeRemovalPlan): PlannedRemovals {
  const groups = emptyPlannedRemovals();
  groups.owned_unmodified.push(...plan.remove);
  for (const skip of plan.skip) {
    switch (skip.reason) {
      case "modified":
        groups.owned_modified.push(skip.path);
        break;
      case "unmanaged":
      case "preexisting":
        groups.unmanaged.push(skip.path);
        break;
      case "missing":
        break;
      default: {
        const _exhaustive: never = skip.reason;
        return _exhaustive;
      }
    }
  }
  return groups;
}

export function plannedRemovalsFromApplyFields(input: {
  removed_files?: string[];
  skipped_removals?: SafeRemovalSkip[];
}): PlannedRemovals {
  return groupPlannedRemovals({
    remove: input.removed_files ?? [],
    skip: input.skipped_removals ?? [],
  });
}

export function riskyRemovalPaths(groups: PlannedRemovals): string[] {
  return [...groups.owned_modified, ...groups.unmanaged];
}

export function formatRemovalBackupNotice(
  result: SafeFileRemovalResult,
  homeRoot: string,
): string | undefined {
  if (result.removed.length === 0) {
    return undefined;
  }
  const count = result.removed.length;
  const noun = count === 1 ? "file" : "files";
  const backup = `Backup: ${shortenHomePath(result.backupDir, homeRoot)}`;
  const forced = result.forced ?? [];
  if (forced.length === 0) {
    return `Removed ${count} ${noun}. ${backup}`;
  }
  const listed = forced
    .map((entry) => `${entry.path} (${entry.reason === "modified" ? "you changed it" : "not made by HarnessTap"})`)
    .join(", ");
  return `Removed ${count} ${noun}, including ${forced.length} only because of --force-remove: ${listed}. ${backup}`;
}
