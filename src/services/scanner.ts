import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getAllPlatforms } from "../platforms/registry.js";
import { ClaudeCodeSerializer } from "../platforms/claude-code.js";
import { CursorSerializer } from "../platforms/cursor.js";
import { CodexSerializer } from "../platforms/codex.js";
import { OpenCodeSerializer } from "../platforms/opencode.js";
import { CopilotSerializer } from "../platforms/copilot.js";
import { GenericAgentsSerializer } from "../platforms/generic-agents.js";
import type { PlatformPaths, PlatformSerializer, Resource } from "../types.js";
import { createResource } from "../models/resource.js";
import { listResources } from "../models/resource.js";

// ── Serializer factory ─────────────────────────────────────────────────

function getSerializer(platformId: string): PlatformSerializer {
  switch (platformId) {
    case "claude-code":
      return new ClaudeCodeSerializer();
    case "cursor":
      return new CursorSerializer();
    case "codex":
      return new CodexSerializer();
    case "opencode":
      return new OpenCodeSerializer();
    case "github-copilot":
      return new CopilotSerializer("github-copilot");
    case "copilot-cli":
      return new CopilotSerializer("copilot-cli");
    default:
      return new GenericAgentsSerializer(platformId);
  }
}
function resolveHomeRoot(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function resolveConfiguredPath(
  rootPath: string,
  configuredPath: string,
): string {
  return configuredPath.startsWith("~/")
    ? join(rootPath, configuredPath.slice(2))
    : join(rootPath, configuredPath);
}

function existingPaths(paths: PlatformPaths, rootPath: string): string[] {
  return Object.values(paths)
    .filter((configuredPath): configuredPath is string =>
      Boolean(configuredPath),
    )
    .filter((configuredPath) =>
      existsSync(resolveConfiguredPath(rootPath, configuredPath)),
    );
}

// ── Platform detection ─────────────────────────────────────────────────

/** Check if a platform has any recognizable files in the project. */
function platformHasFiles(platformId: string, projectRoot: string): boolean {
  const platform = getAllPlatforms().find((p) => p.id === platformId);
  if (!platform) return false;

  const pathsToCheck = Object.values(platform.projectPaths).filter(
    Boolean,
  ) as string[];

  for (const p of pathsToCheck) {
    const fullPath = join(projectRoot, p);
    if (existsSync(fullPath)) return true;
  }

  return false;
}

/** Detect all platforms with configuration in a project directory. */
export function detectPlatforms(projectRoot: string): string[] {
  return getAllPlatforms()
    .filter((p) => platformHasFiles(p.id, projectRoot))
    .map((p) => p.id);
}

export interface DetectedHomePlatform {
  platformId: string;
  discoveredPaths: string[];
}

export function detectHomePlatforms(
  homeRoot = resolveHomeRoot(),
): DetectedHomePlatform[] {
  return getAllPlatforms()
    .map((platform) => ({
      platformId: platform.id,
      discoveredPaths: existingPaths(platform.globalPaths, homeRoot),
    }))
    .filter((result) => result.discoveredPaths.length > 0);
}

// ── Scanning ───────────────────────────────────────────────────────────

export interface ScanResult {
  platformId: string;
  resources: Omit<Resource, "id" | "created_at" | "updated_at">[];
}

export interface HomeScanResult extends ScanResult {
  discoveredPaths: string[];
}

export interface PersistedScanResults {
  resources: Resource[];
  importedCounts: Map<string, number>;
}

/** Scan a single platform in a project directory. */
export async function scanPlatform(
  platformId: string,
  projectRoot: string,
): Promise<ScanResult> {
  const serializer = getSerializer(platformId);
  const resources = await serializer.scan(projectRoot);
  return { platformId, resources };
}

/** Scan all detected platforms in a project directory. */
export async function scanProject(
  projectRoot: string,
  platformFilter?: string,
): Promise<ScanResult[]> {
  const platforms = platformFilter
    ? [platformFilter]
    : detectPlatforms(projectRoot);

  const results: ScanResult[] = [];
  for (const pid of platforms) {
    results.push(await scanPlatform(pid, projectRoot));
  }
  return results;
}

export async function scanHomeDefaults(
  platformFilter?: string,
  homeRoot = resolveHomeRoot(),
): Promise<HomeScanResult[]> {
  const detected = detectHomePlatforms(homeRoot);
  const platforms = platformFilter
    ? detected.filter((result) => result.platformId === platformFilter)
    : detected;

  const results: HomeScanResult[] = [];
  for (const result of platforms) {
    const serializer = getSerializer(result.platformId);
    const resources = serializer.scanGlobal
      ? await serializer.scanGlobal(homeRoot)
      : await serializer.scan(homeRoot);
    results.push({
      platformId: result.platformId,
      discoveredPaths: result.discoveredPaths,
      resources,
    });
  }

  return results;
}

function resourceDedupKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

function persistScanResults(
  results: ScanResult[],
  options?: { skipExistingDuplicates?: boolean },
): PersistedScanResults {
  const seen = new Set<string>();
  const persisted: Resource[] = [];
  const importedCounts = new Map<string, number>();
  const existing = options?.skipExistingDuplicates
    ? new Set(listResources().map((resource) => resourceDedupKey(resource)))
    : undefined;

  for (const result of results) {
    for (const r of result.resources) {
      const key = resourceDedupKey(r);
      if (seen.has(key) || existing?.has(key)) continue;
      seen.add(key);

      const saved = createResource({
        type: r.type,
        name: r.name,
        description: r.description,
        content: r.content,
        metadata: r.metadata,
        source: r.source,
      });
      persisted.push(saved);
      importedCounts.set(
        result.platformId,
        (importedCounts.get(result.platformId) ?? 0) + 1,
      );
    }
  }

  return { resources: persisted, importedCounts };
}

/**
 * Scan and persist: scan all platforms and save unique resources to the database.
 * Deduplicates by name+type to avoid re-importing the same resource.
 */
export async function scanAndPersist(
  projectRoot: string,
  platformFilter?: string,
): Promise<Resource[]> {
  const results = await scanProject(projectRoot, platformFilter);
  return persistScanResults(results).resources;
}

export async function scanAndPersistHomeDefaults(
  platformFilter?: string,
  homeRoot = resolveHomeRoot(),
): Promise<{
  detected: DetectedHomePlatform[];
  results: Array<HomeScanResult & { importedCount: number }>;
  resources: Resource[];
}> {
  const detected = detectHomePlatforms(homeRoot);
  const results = await scanHomeDefaults(platformFilter, homeRoot);
  const persisted = persistScanResults(results, {
    skipExistingDuplicates: true,
  });

  return {
    detected: platformFilter
      ? detected.filter((result) => result.platformId === platformFilter)
      : detected,
    results: results.map((result) => ({
      ...result,
      importedCount: persisted.importedCounts.get(result.platformId) ?? 0,
    })),
    resources: persisted.resources,
  };
}
