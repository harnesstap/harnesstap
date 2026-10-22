import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ulid } from "ulid";
import { getHarnesstapDir } from "../../db/connection.js";
import { listApplyRemovalBackups, type ApplyRemovalBackup } from "../../models/apply-removal-backup.js";
import { executeSafeFileRemovals } from "../safe-file-removal.js";
import { hostViewFileOwnership, planHostPluginViewRemovals } from "./host-plugin-view-ownership.js";
import { forgetHostPluginViewFiles, readHostPluginViewRecord } from "./host-plugin-views.js";
import { removeFileOrLink } from "../../utils/remove-file-or-link.js";

/**
 * Files a host plugin cache refresh backed up before replacing or removing
 * them, kept in `<harnesstap>/cache/host-plugin-view-backups.json` so
 * `ht revert <backup id>` can put them back. The bytes are in the apply
 * removal backups under the same id.
 */
interface HostPluginViewBackup {
  home_root: string;
  host_view: string;
  /** Paths inside the folder. */
  files: string[];
  created_at: string;
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function backupsPath(): string {
  return join(getHarnesstapDir(), "cache", "host-plugin-view-backups.json");
}

function readBackups(): Record<string, HostPluginViewBackup> {
  try {
    const parsed = JSON.parse(readFileSync(backupsPath(), "utf8")) as {
      backups?: Record<string, HostPluginViewBackup>;
    };
    return parsed.backups ?? {};
  } catch {
    return {};
  }
}

function toHomePath(homeRoot: string, hostView: string, path: string): string {
  return relative(homeRoot, join(hostView, path)).split(sep).join("/");
}

/**
 * Back up, then remove files of a host plugin folder (paths inside the
 * folder). Real folders and files HarnessTap did not write are never removed,
 * even with --force-remove (see `planHostPluginViewRemovals`, which callers use
 * to know what stays). Returns the backup id `ht revert` takes, or undefined
 * when there was nothing to remove.
 */
export function backUpAndRemoveHostPluginViewFiles(input: {
  homeRoot: string;
  hostView: string;
  paths: readonly string[];
}): string | undefined {
  const paths = planHostPluginViewRemovals(input).allowed;
  if (paths.length === 0) return undefined;
  const backupId = ulid();
  // Record the id before anything goes to the trash, so every backed-up byte
  // can be put back with `ht revert <id>`, even when a removal fails midway.
  const backups = readBackups();
  backups[backupId] = {
    home_root: input.homeRoot,
    host_view: input.hostView,
    files: [...paths],
    created_at: new Date().toISOString(),
  };
  writeBackups(backups);
  const result = executeSafeFileRemovals(
    input.homeRoot,
    paths.map((path) => toHomePath(input.homeRoot, input.hostView, path)),
    { mode: "listed", applyId: backupId },
  );
  if (result.removed.length === 0) {
    delete backups[backupId];
    writeBackups(backups);
    return undefined;
  }
  return backupId;
}

function writeBackups(backups: Record<string, HostPluginViewBackup>): void {
  try {
    mkdirSync(dirname(backupsPath()), { recursive: true });
    writeFileSync(backupsPath(), `${JSON.stringify({ version: 1, backups }, null, 2)}\n`);
  } catch {
    // The bytes are still in the HarnessTap trash under the backup id.
  }
}

export function isHostPluginViewBackupId(id: string): boolean {
  return readBackups()[id] !== undefined;
}

export interface HostPluginViewRestoreResult {
  hostView: string;
  restored: string[];
  /**
   * `blocked`: a file or link sits where one of the file's folders goes.
   * `blockedBy` names it; `canForce` says --force-remove may back it up and
   * remove it (HarnessTap wrote it and it is unchanged, or it changed since).
   */
  skipped: Array<{
    path: string;
    reason: "unchanged" | "changed" | "blocked";
    blockedBy?: string;
    canForce?: boolean;
  }>;
  /** Set when --force-remove backed up current files before restoring over them. */
  replacedBackupId?: string;
}

/**
 * The path (inside the folder) of a file or link that sits where one of
 * `path`'s folders goes, so the file cannot be written without removing it.
 */
function folderBlocker(hostView: string, path: string): string | undefined {
  const parts = path.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const at = parts.slice(0, index).join("/");
    try {
      const stats = lstatSync(join(hostView, at));
      if (stats.isSymbolicLink() || !stats.isDirectory()) return at;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function sameAsBackup(fullPath: string, row: ApplyRemovalBackup, isLink: boolean): boolean {
  try {
    const content = row.content;
    if (isLink) {
      return lstatSync(fullPath).isSymbolicLink() && readlinkSync(fullPath) === content.toString("utf-8");
    }
    return !lstatSync(fullPath).isSymbolicLink() && readFileSync(fullPath).equals(content);
  } catch {
    return false;
  }
}

function present(fullPath: string): boolean {
  try {
    lstatSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Put back the files a host plugin cache refresh backed up. A file that is
 * missing is restored. A file that is there with other bytes (for example
 * the plugin's newer copy) is kept unless `forceRemove`, which backs it up
 * first. Restored files are no longer recorded as HarnessTap's, so a later
 * refresh keeps them.
 */
export function restoreHostPluginViewBackup(
  backupId: string,
  options: { dryRun?: boolean; forceRemove?: boolean } = {},
): HostPluginViewRestoreResult | undefined {
  const backup = readBackups()[backupId];
  if (!backup) return undefined;
  const result: HostPluginViewRestoreResult = {
    hostView: backup.host_view,
    restored: [],
    skipped: [],
  };
  const rows = listApplyRemovalBackups({ apply_id: backupId });
  // Rows read their bytes only when asked: a big folder is never held in memory.
  const toWrite: Array<{ path: string; fullPath: string; row: ApplyRemovalBackup; isLink: boolean }> = [];
  const toReplace: string[] = [];
  const recorded = { ...(readHostPluginViewRecord(backup.host_view)?.files ?? {}) };
  for (const row of rows) {
    const fullPath = resolve(backup.home_root, row.relative_path);
    const path = relative(backup.host_view, fullPath).split(sep).join("/");
    const isLink = ((row.mode ?? 0) & S_IFMT) === S_IFLNK;
    if (sameAsBackup(fullPath, row, isLink)) {
      result.skipped.push({ path, reason: "unchanged" });
      continue;
    }
    const blocker = folderBlocker(backup.host_view, path);
    if (blocker !== undefined) {
      // A file now sits where the backup needs a folder: like a changed
      // file, it goes only with --force-remove, and only when the guard allows.
      const canForce = planHostPluginViewRemovals({
        homeRoot: backup.home_root,
        hostView: backup.host_view,
        paths: [blocker],
      }).refused.length === 0;
      if (!options.forceRemove || !canForce) {
        result.skipped.push({ path, reason: "blocked", blockedBy: blocker, canForce });
        continue;
      }
      if (!toReplace.includes(blocker)) toReplace.push(blocker);
      toWrite.push({ path, fullPath, row, isLink });
      continue;
    }
    // A file with exactly the bytes HarnessTap wrote there (for example the
    // plugin's version that replaced the backed-up one) is backed up and
    // replaced without --force-remove; anything else needs it.
    if (
      present(fullPath)
      && !options.forceRemove
      && hostViewFileOwnership({ homeRoot: backup.home_root, hostView: backup.host_view, path, recorded }) !== "owned"
    ) {
      result.skipped.push({ path, reason: "changed" });
      continue;
    }
    if (present(fullPath)) toReplace.push(path);
    toWrite.push({ path, fullPath, row, isLink });
  }
  // Never restore over a folder or a file HarnessTap did not write, even with --force-remove.
  const refused = new Set(
    planHostPluginViewRemovals({ homeRoot: backup.home_root, hostView: backup.host_view, paths: toReplace })
      .refused.map((entry) => entry.path),
  );
  if (refused.size > 0) {
    for (const path of refused) result.skipped.push({ path, reason: "changed" });
    toWrite.splice(0, toWrite.length, ...toWrite.filter((file) => !refused.has(file.path)));
    toReplace.splice(0, toReplace.length, ...toReplace.filter((path) => !refused.has(path)));
  }
  if (options.dryRun) {
    result.restored = toWrite.map((file) => file.path);
    return result;
  }
  result.replacedBackupId = backUpAndRemoveHostPluginViewFiles({
    homeRoot: backup.home_root,
    hostView: backup.host_view,
    paths: toReplace,
  });
  for (const file of toWrite) {
    mkdirSync(dirname(file.fullPath), { recursive: true });
    if (file.isLink) {
      if (existsSync(file.fullPath) || present(file.fullPath)) removeFileOrLink(file.fullPath);
      symlinkSync(file.row.content.toString("utf-8"), file.fullPath);
    } else {
      writeFileSync(file.fullPath, file.row.content);
    }
    result.restored.push(file.path);
  }
  forgetHostPluginViewFiles(backup.host_view, result.restored);
  return result;
}
