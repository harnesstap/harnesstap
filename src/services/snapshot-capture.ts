import { existsSync, readFileSync, statSync } from "node:fs";
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

export function snapshotAbsentPaths(state: SnapshotState): string[] {
  return [...new Set(state.absent_paths ?? [])];
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
    files: ReadonlyArray<{ path: string }>;
  }>;
  extraPaths?: readonly string[];
}): SnapshotState {
  const platform_files: Record<string, Record<string, string>> = {};
  const disk_files: Record<string, string> = {};
  const absent: string[] = [];
  const seen = new Set<string>();

  for (const result of input.generated) {
    const bucket: Record<string, string> = { ...platform_files[result.platformId] };
    for (const file of result.files) {
      if (seen.has(file.path)) {
        continue;
      }
      seen.add(file.path);
      const live = readLiveFile(input.rootPath, file.path);
      if (live === undefined) {
        absent.push(file.path);
        continue;
      }
      bucket[file.path] = live;
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
  };
}
