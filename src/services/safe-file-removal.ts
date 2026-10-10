import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { ulid } from "ulid";
import { getHarnesstapDir } from "../db/connection.js";
import {
  listApplyRemovalBackups,
  recordApplyRemovalBackup,
} from "../models/apply-removal-backup.js";
import { isPreexistingPath } from "../models/preexisting-path.js";
import {
  deleteMaterializationsForRootPaths,
  listMaterializationsForRootPath,
} from "../models/resource-materialization.js";
import { hashGeneratedContent } from "./materialization-ownership.js";

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
  message: string;
}

export interface SafeRemovalPlan {
  remove: string[];
  skip: SafeRemovalSkip[];
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
  try {
    const bytes = readFileSync(fullPath);
    return hashGeneratedContent(bytes.toString("utf-8"));
  } catch {
    return undefined;
  }
}

function normalizeRelative(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isHarnessTapOwnedPath(rootPath: string, relativePath: string): boolean {
  return listMaterializationsForRootPath(rootPath, normalizeRelative(relativePath)).length > 0;
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
  const mode = options.mode ?? "owned";
  const seen = new Set<string>();

  for (const rawPath of relativePaths) {
    const relativePath = normalizeRelative(rawPath);
    if (!relativePath || seen.has(relativePath)) {
      continue;
    }
    seen.add(relativePath);

    const fullPath = resolve(rootPath, relativePath);
    if (!existsSync(fullPath)) {
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

    if (isPreexistingPath(rootPath, relativePath)) {
      skip.push({
        path: relativePath,
        reason: "preexisting",
        message: skipMessage(relativePath, "preexisting"),
      });
      continue;
    }

    const owned = listMaterializationsForRootPath(rootPath, relativePath);
    if (owned.length === 0) {
      if (options.forceRemove) {
        remove.push(relativePath);
        continue;
      }
      skip.push({
        path: relativePath,
        reason: "unmanaged",
        message: skipMessage(relativePath, "unmanaged"),
      });
      continue;
    }

    const diskHash = hashOnDiskFile(fullPath);
    const hashMatches = owned.some((row) => row.generated_hash === diskHash);
    if (hashMatches || options.forceRemove) {
      remove.push(relativePath);
      continue;
    }
    skip.push({
      path: relativePath,
      reason: "modified",
      message: skipMessage(relativePath, "modified"),
    });
  }

  return { remove, skip };
}

function copyToTrash(applyId: string, relativePath: string, bytes: Buffer): string {
  const dest = join(applyTrashRoot(), applyId, ...relativePath.split("/"));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  return dest;
}

export function pruneApplyTrash(keepLast = APPLY_TRASH_KEEP): void {
  const root = applyTrashRoot();
  if (!existsSync(root)) {
    return;
  }
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  const dirs = entries
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

function backupOnDiskFile(input: {
  rootPath: string;
  relativePath: string;
  applyId: string;
  snapshotId?: string | null;
}): Buffer {
  const fullPath = resolve(input.rootPath, input.relativePath);
  const bytes = readFileSync(fullPath);
  let mode = 0;
  try {
    mode = statSync(fullPath).mode;
  } catch {
    mode = 0;
  }
  recordApplyRemovalBackup({
    apply_id: input.applyId,
    snapshot_id: input.snapshotId,
    relative_path: input.relativePath,
    content: bytes,
    mode,
  });
  copyToTrash(input.applyId, input.relativePath, bytes);
  return bytes;
}

function backupAndUnlink(input: {
  rootPath: string;
  relativePath: string;
  applyId: string;
  snapshotId?: string | null;
}): void {
  const fullPath = resolve(input.rootPath, input.relativePath);
  backupOnDiskFile(input);
  rmSync(fullPath, { force: true });
  pruneEmptyAncestors(fullPath, input.rootPath);
}

export function backupAndRewriteFile(input: {
  rootPath: string;
  relativePath: string;
  nextContent: string | null;
  applyId: string;
  snapshotId?: string | null;
}): void {
  const fullPath = resolve(input.rootPath, input.relativePath);
  backupOnDiskFile(input);
  if (input.nextContent === null) {
    rmSync(fullPath, { force: true });
    pruneEmptyAncestors(fullPath, input.rootPath);
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
    };
  }

  for (const relativePath of plan.remove) {
    backupAndUnlink({
      rootPath,
      relativePath,
      applyId,
      snapshotId: options.snapshotId,
    });
  }
  deleteMaterializationsForRootPaths(rootPath, plan.remove);
  pruneApplyTrash();

  return {
    applyId,
    backupDir,
    removed: plan.remove,
    skipped: plan.skip,
    warnings,
  };
}

export function restoreSafeRemovalBackup(input: {
  applyId?: string;
  snapshotId?: string;
  rootPath: string;
}): string[] {
  const backups = listApplyRemovalBackups({
    apply_id: input.applyId,
    snapshot_id: input.snapshotId,
  });
  const restored: string[] = [];
  for (const backup of backups) {
    const fullPath = resolve(input.rootPath, backup.relative_path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, backup.content);
    restored.push(backup.relative_path);
  }
  if (restored.length > 0) {
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
      if (statSync(full).isDirectory()) {
        walk(full, rel);
        continue;
      }
      const dest = resolve(input.rootPath, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(full));
      restored.push(rel);
    }
  };
  walk(trashDir, "");
  return restored;
}

export function formatRemovalBackupNotice(
  result: SafeFileRemovalResult,
  homeRoot: string,
): string | undefined {
  if (result.removed.length === 0) {
    return undefined;
  }
  const relativeTrash = result.backupDir.startsWith(homeRoot)
    ? result.backupDir.slice(homeRoot.length).replace(/^[\\/]/, "")
    : result.backupDir;
  const count = result.removed.length;
  const noun = count === 1 ? "file" : "files";
  return `Removed ${count} ${noun}. Backup: ~/${relativeTrash.replace(/\\/g, "/")}`;
}
