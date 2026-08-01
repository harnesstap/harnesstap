import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { listResources } from "../models/resource.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import {
  detectHomePlatforms,
  scanAndPersist,
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

export interface ResourceTrackedDirectoryEntry {
  path: string;
  kind: "home_default" | "custom";
  label: string;
  platform_ids: string[];
  resource_count: number;
  removable: boolean;
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

function entryForCustomDirectory(
  path: string,
  resourceCounts: Map<string, number>,
): ResourceTrackedDirectoryEntry {
  const resolved = resolve(path);
  return {
    path: resolved,
    kind: "custom",
    label: basename(resolved) || resolved,
    platform_ids: [],
    resource_count: resourceCounts.get(resolved) ?? 0,
    removable: true,
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
