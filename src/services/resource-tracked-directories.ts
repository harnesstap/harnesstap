import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { listResources } from "../models/resource.js";
import { getAllPlatforms } from "../platforms/registry.js";
import type { PlatformPaths } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import {
  detectHomePlatforms,
  detectPlatforms,
  scanAndPersist,
  scanAndPersistHomeDefaults,
} from "./scanner.js";

const TRACKED_DIRECTORIES_FILE = "resource-tracked-directories.json";

export class ResourceTrackedDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceTrackedDirectoryError";
  }
}

interface TrackedDirectoriesFile {
  directories: string[];
}

export interface ResourceTrackedFolderEntry {
  path: string;
  label: string;
  platform_ids: string[];
}

export interface ResourceTrackedDirectoryEntry {
  path: string;
  kind: "home_default" | "custom";
  label: string;
  platform_ids: string[];
  resource_count: number;
  removable: boolean;
  folders: ResourceTrackedFolderEntry[];
  display_path?: string;
}

function trackedDirectoriesPath(): string {
  return resolve(getHarnesstapDir(), TRACKED_DIRECTORIES_FILE);
}

function readCustomDirectories(): string[] {
  const filePath = trackedDirectoriesPath();
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(
      readFileSync(filePath, "utf-8"),
    ) as Partial<TrackedDirectoriesFile>;
    if (!Array.isArray(parsed.directories)) {
      return [];
    }
    return parsed.directories.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function writeCustomDirectories(directories: string[]): void {
  const home = getHarnesstapDir();
  mkdirSync(home, { recursive: true });
  const normalized = [...new Set(directories.map((entry) => resolve(entry)))].sort();
  writeFileSync(
    trackedDirectoriesPath(),
    `${JSON.stringify({ directories: normalized } satisfies TrackedDirectoriesFile, null, 2)}\n`,
    "utf-8",
  );
}

function countResourcesByOriginRef(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const resource of listResources()) {
    const originRef = resource.origin_ref?.trim();
    if (!originRef) {
      continue;
    }
    counts.set(originRef, (counts.get(originRef) ?? 0) + 1);
  }
  return counts;
}

function resolveConfiguredPath(rootPath: string, configuredPath: string): string {
  return configuredPath.startsWith("~/")
    ? join(rootPath, configuredPath.slice(2))
    : join(rootPath, configuredPath);
}

function configuredPathValues(paths: PlatformPaths): string[] {
  const result: string[] = [];
  for (const [key, value] of Object.entries(paths)) {
    if (key === "pathAlternates" || typeof value !== "string" || !value) {
      continue;
    }
    result.push(value);
  }
  for (const alternates of Object.values(paths.pathAlternates ?? {})) {
    if (alternates) {
      result.push(...alternates);
    }
  }
  return result;
}

function topLevelFolderUnderRoot(
  rootPath: string,
  absolutePath: string,
): string | null {
  const rel = relative(rootPath, absolutePath);
  if (!rel || rel === "." || rel.startsWith("..")) {
    return null;
  }
  const first = rel.split(/[/\\]/)[0];
  if (!first) {
    return null;
  }
  return join(rootPath, first);
}

function foldersFromConfiguredPaths(
  rootPath: string,
  configured: Array<{ path: string; platformId: string }>,
): ResourceTrackedFolderEntry[] {
  const folders = new Map<string, ResourceTrackedFolderEntry>();

  for (const entry of configured) {
    const absolute = resolveConfiguredPath(rootPath, entry.path);
    if (!existsSync(absolute)) {
      continue;
    }
    let target = absolute;
    try {
      if (!lstatSync(absolute).isDirectory()) {
        target = dirname(absolute);
      }
    } catch {
      continue;
    }
    const top = topLevelFolderUnderRoot(rootPath, target);
    if (!top) {
      continue;
    }
    const existing = folders.get(top);
    if (existing) {
      if (!existing.platform_ids.includes(entry.platformId)) {
        existing.platform_ids.push(entry.platformId);
      }
      continue;
    }
    folders.set(top, {
      path: top,
      label: basename(top) || top,
      platform_ids: [entry.platformId],
    });
  }

  return [...folders.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function homeResourceFolders(homeRoot: string): ResourceTrackedFolderEntry[] {
  return foldersFromConfiguredPaths(
    homeRoot,
    detectHomePlatforms(homeRoot).flatMap((result) =>
      result.discoveredPaths.map((path) => ({
        path,
        platformId: result.platformId,
      })),
    ),
  );
}

function projectResourceFolders(projectRoot: string): ResourceTrackedFolderEntry[] {
  const configured: Array<{ path: string; platformId: string }> = [];
  for (const platform of getAllPlatforms()) {
    for (const path of configuredPathValues(platform.projectPaths)) {
      configured.push({ path, platformId: platform.id });
    }
  }
  return foldersFromConfiguredPaths(projectRoot, configured);
}

function entryForCustomDirectory(
  path: string,
  resourceCounts: Map<string, number>,
): ResourceTrackedDirectoryEntry {
  const resolved = resolve(path);
  return {
    path: resolved,
    kind: "custom",
    label: basename(resolved) || resolved,
    platform_ids: detectPlatforms(resolved),
    resource_count: resourceCounts.get(resolved) ?? 0,
    removable: true,
    folders: projectResourceFolders(resolved),
    display_path: resolved,
  };
}

export function listResourceTrackedDirectories(): ResourceTrackedDirectoryEntry[] {
  const homeRoot = resolve(homeRootPath());
  const detected = detectHomePlatforms(homeRoot);
  const resourceCounts = countResourcesByOriginRef();

  const entries: ResourceTrackedDirectoryEntry[] = [
    {
      path: homeRoot,
      kind: "home_default",
      label: "Home harness defaults",
      platform_ids: detected.map((result) => result.platformId),
      resource_count: resourceCounts.get(homeRoot) ?? 0,
      removable: false,
      folders: homeResourceFolders(homeRoot),
      display_path: "~",
    },
  ];

  for (const directory of readCustomDirectories()) {
    const resolved = resolve(directory);
    if (resolved === homeRoot) {
      continue;
    }
    entries.push(entryForCustomDirectory(resolved, resourceCounts));
  }

  return entries;
}

function homeRootPath(): string {
  return resolveHomeRoot();
}

export async function addResourceTrackedDirectory(inputPath: string): Promise<{
  directory: ResourceTrackedDirectoryEntry;
  imported_count: number;
}> {
  const resolved = resolve(inputPath.trim());
  if (!existsSync(resolved)) {
    throw new ResourceTrackedDirectoryError(`Directory not found: ${resolved}`);
  }

  const homeRoot = resolve(homeRootPath());
  if (resolved === homeRoot) {
    throw new ResourceTrackedDirectoryError(
      "Home directory is already tracked as harness defaults.",
    );
  }

  const custom = readCustomDirectories();
  if (custom.some((entry) => resolve(entry) === resolved)) {
    throw new ResourceTrackedDirectoryError(`Directory already tracked: ${resolved}`);
  }

  custom.push(resolved);
  writeCustomDirectories(custom);

  const imported = await scanAndPersist(resolved, undefined, {
    conflictPolicy: "skip",
    originRef: resolved,
  });

  const resourceCounts = countResourcesByOriginRef();
  return {
    directory: entryForCustomDirectory(resolved, resourceCounts),
    imported_count: imported.length,
  };
}

export function removeResourceTrackedDirectory(inputPath: string): void {
  const resolved = resolve(inputPath.trim());
  const homeRoot = resolve(homeRootPath());
  if (resolved === homeRoot) {
    throw new ResourceTrackedDirectoryError("Cannot remove home harness defaults.");
  }

  const custom = readCustomDirectories();
  const next = custom.filter((entry) => resolve(entry) !== resolved);
  if (next.length === custom.length) {
    throw new ResourceTrackedDirectoryError(`Directory not tracked: ${resolved}`);
  }
  writeCustomDirectories(next);
}

export interface ResourceTrackedDirectoryRescanEntry {
  path: string;
  kind: "home_default" | "custom";
  imported_count: number;
  skipped: boolean;
  error?: string;
}

export interface ResourceTrackedDirectoriesRescanResult {
  directories: ResourceTrackedDirectoryEntry[];
  rescanned: ResourceTrackedDirectoryRescanEntry[];
  imported_count: number;
}

/**
 * Re-scan home harness defaults and every custom tracked directory into the library.
 * Uses skip conflict policy so existing library rows are not overwritten.
 */
export async function rescanResourceTrackedDirectories(): Promise<ResourceTrackedDirectoriesRescanResult> {
  const homeRoot = resolve(homeRootPath());
  const rescanned: ResourceTrackedDirectoryRescanEntry[] = [];
  let importedCount = 0;

  const homeDefaults = await scanAndPersistHomeDefaults(undefined, homeRoot);
  const homeImported = homeDefaults.resources.length;
  importedCount += homeImported;
  rescanned.push({
    path: homeRoot,
    kind: "home_default",
    imported_count: homeImported,
    skipped: false,
  });

  for (const directory of readCustomDirectories()) {
    const resolved = resolve(directory);
    if (resolved === homeRoot) {
      continue;
    }
    if (!existsSync(resolved)) {
      rescanned.push({
        path: resolved,
        kind: "custom",
        imported_count: 0,
        skipped: true,
        error: `Directory not found: ${resolved}`,
      });
      continue;
    }
    try {
      const beforeIds = new Set(
        listResources().map((resource) => resource.id),
      );
      const resolvedResources = await scanAndPersist(resolved, undefined, {
        conflictPolicy: "skip",
        originRef: resolved,
      });
      const imported = resolvedResources.filter(
        (resource) => !beforeIds.has(resource.id),
      ).length;
      importedCount += imported;
      rescanned.push({
        path: resolved,
        kind: "custom",
        imported_count: imported,
        skipped: false,
      });
    } catch (error) {
      rescanned.push({
        path: resolved,
        kind: "custom",
        imported_count: 0,
        skipped: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    directories: listResourceTrackedDirectories(),
    rescanned,
    imported_count: importedCount,
  };
}
