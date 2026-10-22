import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ulid } from "ulid";
import { getHarnesstapDir } from "../../db/connection.js";
import { listApplyRemovalBackups } from "../../models/apply-removal-backup.js";
import { executeSafeFileRemovals } from "../safe-file-removal.js";
import { planHostPluginViewRemovals } from "./host-plugin-view-ownership.js";
import { forgetHostPluginViewFiles } from "./host-plugin-views.js";

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
  const result = executeSafeFileRemovals(
    input.homeRoot,
    paths.map((path) => toHomePath(input.homeRoot, input.hostView, path)),
    { mode: "listed", applyId: backupId },
  );
  if (result.removed.length === 0) return undefined;
  const backups = readBackups();
  backups[backupId] = {
    home_root: input.homeRoot,
    host_view: input.hostView,
    files: [...paths],
    created_at: new Date().toISOString(),
  };
  try {
    mkdirSync(dirname(backupsPath()), { recursive: true });
    writeFileSync(backupsPath(), `${JSON.stringify({ version: 1, backups }, null, 2)}\n`);
  } catch {
    // The bytes are still in the HarnessTap trash under the backup id.
  }
  return backupId;
}

export function isHostPluginViewBackupId(id: string): boolean {
  return readBackups()[id] !== undefined;
}

export interface HostPluginViewRestoreResult {
  hostView: string;
  restored: string[];
  skipped: Array<{ path: string; reason: "unchanged" | "changed" }>;
  /** Set when --force-remove backed up current files before restoring over them. */
  replacedBackupId?: string;
}

function sameAsBackup(fullPath: string, content: Buffer, isLink: boolean): boolean {
  try {
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
  const toWrite: Array<{ path: string; fullPath: string; content: Buffer; isLink: boolean }> = [];
  const toReplace: string[] = [];
  for (const row of rows) {
    const fullPath = resolve(backup.home_root, row.relative_path);
    const path = relative(backup.host_view, fullPath).split(sep).join("/");
    const content = Buffer.from(row.content);
    const isLink = ((row.mode ?? 0) & S_IFMT) === S_IFLNK;
    if (sameAsBackup(fullPath, content, isLink)) {
      result.skipped.push({ path, reason: "unchanged" });
      continue;
    }
    if (present(fullPath) && !options.forceRemove) {
      result.skipped.push({ path, reason: "changed" });
      continue;
    }
    if (present(fullPath)) toReplace.push(path);
    toWrite.push({ path, fullPath, content, isLink });
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
      if (existsSync(file.fullPath) || present(file.fullPath)) rmSync(file.fullPath, { force: true });
      symlinkSync(file.content.toString("utf-8"), file.fullPath);
    } else {
      writeFileSync(file.fullPath, file.content);
    }
    result.restored.push(file.path);
  }
  forgetHostPluginViewFiles(backup.host_view, result.restored);
  return result;
}
