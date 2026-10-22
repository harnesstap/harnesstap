import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";
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
  const push = (path: string, content: string): void => {
    if (seen.has(path)) {
      return;
    }
    seen.add(path);
    files.push({ path, content });
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
  return files;
}

/** Live bytes to restore on revert. New captures store those in disk_files. */
export function flattenLiveRestoreFiles(state: SnapshotState): SerializedFile[] {
  const hasLiveCapture =
    (state.disk_files !== undefined && Object.keys(state.disk_files).length > 0)
    || (state.absent_paths?.length ?? 0) > 0
    || Object.keys(state.disk_links ?? {}).length > 0;
  if (!hasLiveCapture) {
    return flattenSnapshotFiles(state);
  }
  const files: SerializedFile[] = [];
  for (const [path, content] of Object.entries(state.disk_files ?? {})) {
    files.push({ path, content });
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

function readLiveFile(rootPath: string, relativePath: string): string | undefined {
  const fullPath = join(rootPath, relativePath);
  try {
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return undefined;
    }
    return readFileSync(fullPath, "utf-8");
  } catch {
    return undefined;
  }
}

export function captureManagedSnapshotState(input: {
  rootPath: string;
  plugins?: Plugin[];
  resources?: Resource[];
  generated: ReadonlyArray<{
    platformId: string;
    files: ReadonlyArray<{ path: string; content?: string }>;
  }>;
  extraPaths?: readonly string[];
}): SnapshotState {
  const platform_files: Record<string, Record<string, string>> = {};
  const disk_files: Record<string, string> = {};
  const disk_links: Record<string, string> = {};
  const absent: string[] = [];
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
        if (file.content !== undefined) bucket[file.path] = file.content;
        continue;
      }
      const live = readLiveFile(input.rootPath, file.path);
      if (live === undefined) {
        absent.push(file.path);
      } else {
        disk_files[file.path] = live;
      }
      const expected = file.content ?? live;
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
    disk_files[extra] = live;
  }

  return {
    plugins: input.plugins ?? [],
    resources: input.resources ?? [],
    platform_files,
    ...(Object.keys(disk_files).length > 0 ? { disk_files } : {}),
    ...(absent.length > 0 ? { absent_paths: absent } : {}),
    ...(Object.keys(disk_links).length > 0 ? { disk_links } : {}),
  };
}
