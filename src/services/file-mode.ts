import { chmodSync, statSync } from "node:fs";
import { removalBackupTrashFile, type ApplyRemovalBackup } from "../models/apply-removal-backup.js";

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** The permission bits (setuid, setgid, sticky and rwx) of a stat mode. */
export function permissionBits(mode: number): number {
  return mode & 0o7777;
}

/**
 * The permission bits a restored backup file should get. The row's mode when
 * it has one; a row from before modes were recorded (mode 0) falls back to the
 * mode of its trash file. Undefined for a link, or when nothing is known: the
 * write then gives the default mode.
 */
export function backupFileMode(
  backup: Pick<ApplyRemovalBackup, "mode" | "in_trash" | "apply_id" | "relative_path">,
): number | undefined {
  const mode = backup.mode ?? 0;
  if ((mode & S_IFMT) === S_IFLNK) return undefined;
  const bits = permissionBits(mode);
  if (bits !== 0) return bits;
  try {
    const fromTrash = permissionBits(statSync(removalBackupTrashFile(backup.apply_id, backup.relative_path)).mode);
    return fromTrash === 0 ? undefined : fromTrash;
  } catch {
    return undefined;
  }
}

/** Gives a regular file the mode a backup or snapshot recorded; nothing to do when none was. */
export function restoreFileMode(fullPath: string, mode: number | undefined): void {
  if (mode === undefined) return;
  try {
    chmodSync(fullPath, permissionBits(mode));
  } catch {
    // A file system without modes keeps what it has.
  }
}
