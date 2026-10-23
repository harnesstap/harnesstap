import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { listApplyRemovalBackups, type ApplyRemovalBackup } from "../models/apply-removal-backup.js";
import { backupFileMode, permissionBits } from "./file-mode.js";
import type { Plugin, Resource, SerializedFile, SnapshotState } from "../types.js";

export function emptySnapshotState(): SnapshotState {
  return {
    plugins: [],
    resources: [],
    platform_files: {},
  };
}

export function flattenSnapshotFiles(state: SnapshotState): SerializedFile[] {
  const files: SerializedFile[] = [];
  const seen = new Set<string>();
  const push = (path: string, content: string, encoding?: SerializedFile["encoding"]): void => {
    if (seen.has(path)) {
      return;
    }
    seen.add(path);
    files.push(encoding ? { path, content, encoding } : { path, content });
  };
  for (const bucket of Object.values(state.platform_files)) {
    for (const [path, content] of Object.entries(bucket)) {
      push(path, content);
    }
  }
  if (state.harness_files) {
    for (const bucket of Object.values(state.harness_files)) {
      for (const [path, content] of Object.entries(bucket)) {
        push(path, content);
      }
    }
  }
  if (state.disk_files) {
    for (const [path, content] of Object.entries(state.disk_files)) {
      push(path, content);
    }
  }
  for (const [path, content] of Object.entries(state.disk_files_base64 ?? {})) {
    push(path, content, "base64");
  }
  return files;
}

/**
 * A file to put back on revert. `bytes` is exactly what to write. `content` is
 * a text view for code that reads JSON or text configs; it is lossy for a file
 * that is not UTF-8 text, so it is never what gets written.
 */
export interface RestoreFile extends SerializedFile {
  readonly bytes: Buffer;
  /** Permission bits to give the restored file; absent when the mode was never recorded. */
  readonly mode?: number;
}

function restoreFileFrom(path: string, readBytes: () => Buffer, mode?: number): RestoreFile {
  return {
    path,
    ...(mode === undefined ? {} : { mode }),
    get bytes(): Buffer {
      return readBytes();
    },
    get content(): string {
      return readBytes().toString("utf-8");
    },
  };
}

/** A plan file with bytes: lazy files pass through, plain serialized files get their bytes decoded. */
export function asRestoreFile(file: SerializedFile | RestoreFile): RestoreFile {
  if ("bytes" in file) return file;
  return restoreFileFrom(file.path, () => serializedFileToBytes(file));
}

/** The bytes of a serialized file: base64 when the encoding says so, otherwise UTF-8. */
export function serializedFileToBytes(file: Pick<SerializedFile, "content" | "encoding">): Buffer {
  return Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf-8");
}

/** True when the bytes survive a trip through a string (they are valid UTF-8 text). */
function isUtf8Text(bytes: Buffer): boolean {
  return Buffer.from(bytes.toString("utf-8"), "utf-8").equals(bytes);
}

/**
 * Files the snapshot left to the removal backups: one entry per path, read
 * from the backup only when the content is asked for. The first backup of a
 * path wins (a later one may hold what a revert overwrote).
 */
function trashedRestoreFiles(state: SnapshotState, snapshotId: string): RestoreFile[] {
  const wanted = new Set(state.trashed_files ?? []);
  if (wanted.size === 0) return [];
  const earliest = new Map<string, ApplyRemovalBackup>();
  for (const backup of listApplyRemovalBackups({ snapshot_id: snapshotId })) {
    if (!wanted.has(backup.relative_path)) continue;
    const current = earliest.get(backup.relative_path);
    if (!current || backup.id < current.id) earliest.set(backup.relative_path, backup);
  }
  const files: RestoreFile[] = [];
  for (const [path, backup] of earliest) {
    files.push(restoreFileFrom(path, () => backup.content, backupFileMode(backup)));
  }
  return files;
}

/**
 * Live bytes to restore on revert. New captures store those in disk_files,
 * plus the files left to the removal backups when the snapshot id is known.
 */
export function flattenLiveRestoreFiles(state: SnapshotState, snapshotId?: string): RestoreFile[] {
  const hasLiveCapture =
    (state.disk_files !== undefined && Object.keys(state.disk_files).length > 0)
    || Object.keys(state.disk_files_base64 ?? {}).length > 0
    || (state.absent_paths?.length ?? 0) > 0
    || Object.keys(state.disk_links ?? {}).length > 0
    || (state.trashed_files?.length ?? 0) > 0;
  if (!hasLiveCapture) {
    return flattenSnapshotFiles(state).map((file) => restoreFileFrom(file.path, () => serializedFileToBytes(file)));
  }
  const files: RestoreFile[] = [];
  for (const [path, content] of Object.entries(state.disk_files ?? {})) {
    files.push(restoreFileFrom(path, () => Buffer.from(content, "utf-8"), state.disk_modes?.[path]));
  }
  for (const [path, content] of Object.entries(state.disk_files_base64 ?? {})) {
    files.push(restoreFileFrom(path, () => Buffer.from(content, "base64"), state.disk_modes?.[path]));
  }
  if (snapshotId) {
    const have = new Set(files.map((file) => file.path));
    for (const file of trashedRestoreFiles(state, snapshotId)) {
      if (!have.has(file.path)) files.push(file);
    }
  }
  return files;
}

export function snapshotAbsentPaths(state: SnapshotState): string[] {
  return [...new Set(state.absent_paths ?? [])];
}

/** Links to restore as links on revert (never as the bytes they point to). */
export function snapshotLinks(state: SnapshotState): Array<{ path: string; target: string }> {
  return Object.entries(state.disk_links ?? {}).map(([path, target]) => ({ path, target }));
}

/** The target of a link at the path, or undefined when it is not a link. */
function readLiveLink(rootPath: string, relativePath: string): string | undefined {
  const fullPath = join(rootPath, relativePath);
  try {
    return lstatSync(fullPath).isSymbolicLink() ? readlinkSync(fullPath) : undefined;
  } catch {
    return undefined;
  }
}

function isLiveRegularFile(rootPath: string, relativePath: string): boolean {
  try {
    return statSync(join(rootPath, relativePath)).isFile();
  } catch {
    return false;
  }
}

/** A live file's exact bytes, as text when they are valid UTF-8 and as base64 otherwise. */
type LiveFile = ({ text: string } | { base64: string }) & { mode: number };

function readLiveFile(rootPath: string, relativePath: string): LiveFile | undefined {
  const fullPath = join(rootPath, relativePath);
  try {
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return undefined;
    }
    const bytes = readFileSync(fullPath);
    const mode = permissionBits(statSync(fullPath).mode);
    return isUtf8Text(bytes)
      ? { text: bytes.toString("utf-8"), mode }
      : { base64: bytes.toString("base64"), mode };
  } catch {
    return undefined;
  }
}

/**
 * The generated file as `readFileSync(path, "utf-8")` would read it back, so
 * drift detection compares like with like. A base64 file (an image, an archive)
 * holds its bytes as base64 text, which never equals what the disk reads as.
 */
function generatedText(file: { content?: string; encoding?: "utf8" | "base64" }): string {
  const content = file.content ?? "";
  return file.encoding === "base64" ? Buffer.from(content, "base64").toString("utf-8") : content;
}

export function captureManagedSnapshotState(input: {
  rootPath: string;
  plugins?: Plugin[];
  resources?: Resource[];
  generated: ReadonlyArray<{
    platformId: string;
    files: ReadonlyArray<{ path: string; content?: string; encoding?: "utf8" | "base64" }>;
  }>;
  extraPaths?: readonly string[];
  /**
   * Paths the apply may remove. A regular file there is noted but not read:
   * if the apply removes it, the removal backup keeps its bytes; if not, it
   * is untouched.
   */
  removalBackedPaths?: readonly string[];
}): SnapshotState {
  const platform_files: Record<string, Record<string, string>> = {};
  const disk_files: Record<string, string> = {};
  const disk_files_base64: Record<string, string> = {};
  const disk_modes: Record<string, number> = {};
  const keepLive = (path: string, live: LiveFile): void => {
    disk_modes[path] = live.mode;
    if ("text" in live) disk_files[path] = live.text;
    else disk_files_base64[path] = live.base64;
  };
  const disk_links: Record<string, string> = {};
  const absent: string[] = [];
  const trashed: string[] = [];
  const seen = new Set<string>();

  for (const result of input.generated) {
    const bucket: Record<string, string> = { ...platform_files[result.platformId] };
    for (const file of result.files) {
      if (seen.has(file.path)) {
        continue;
      }
      seen.add(file.path);
      const link = readLiveLink(input.rootPath, file.path);
      if (link !== undefined) {
        // A link is captured as a link: reading through it would restore a
        // copy of what it points to, or drop a link to a folder.
        disk_links[file.path] = link;
        if (file.content !== undefined) bucket[file.path] = generatedText(file);
        continue;
      }
      const live = readLiveFile(input.rootPath, file.path);
      if (live === undefined) {
        absent.push(file.path);
      } else {
        keepLive(file.path, live);
      }
      const liveText = live !== undefined && "text" in live ? live.text : undefined;
      const expected = file.content === undefined ? liveText : generatedText(file);
      if (expected !== undefined) {
        bucket[file.path] = expected;
      }
    }
    if (Object.keys(bucket).length > 0) {
      platform_files[result.platformId] = bucket;
    }
  }

  for (const extra of input.extraPaths ?? []) {
    if (!extra || seen.has(extra)) {
      continue;
    }
    seen.add(extra);
    const link = readLiveLink(input.rootPath, extra);
    if (link !== undefined) {
      disk_links[extra] = link;
      continue;
    }
    const live = readLiveFile(input.rootPath, extra);
    if (live === undefined) {
      absent.push(extra);
      continue;
    }
    keepLive(extra, live);
  }

  for (const path of input.removalBackedPaths ?? []) {
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    const link = readLiveLink(input.rootPath, path);
    if (link !== undefined) {
      disk_links[path] = link;
      continue;
    }
    if (isLiveRegularFile(input.rootPath, path)) {
      trashed.push(path);
    } else {
      absent.push(path);
    }
  }

  return {
    plugins: input.plugins ?? [],
    resources: input.resources ?? [],
    platform_files,
    ...(Object.keys(disk_files).length > 0 ? { disk_files } : {}),
    ...(Object.keys(disk_files_base64).length > 0 ? { disk_files_base64 } : {}),
    ...(Object.keys(disk_modes).length > 0 ? { disk_modes } : {}),
    ...(absent.length > 0 ? { absent_paths: absent } : {}),
    ...(Object.keys(disk_links).length > 0 ? { disk_links } : {}),
    ...(trashed.length > 0 ? { trashed_files: trashed } : {}),
  };
}
