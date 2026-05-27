import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAllPlatforms } from "../platforms/registry.js";
import type { PlatformPaths, Resource } from "../types.js";
import { createResource } from "../models/resource.js";
import { deleteResource } from "../models/resource.js";
import { listResources } from "../models/resource.js";
import { upsertProjectPluginState } from "../models/plugin.js";
import { scanClaudePluginInventory } from "./claude-plugin-inventory.js";
import { getPlatformSerializer } from "./platform-serializers.js";
import { resolveHomeRoot } from "../utils/home-root.js";

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

const SHARED_PROJECT_INSTRUCTION_NAMES = new Map<string, string>([
  ["AGENTS.md", "agents-instructions"],
]);

const SYNTHETIC_INSTRUCTION_NAMES = new Set(
  getAllPlatforms().map((platform) => `${platform.id}-instructions`),
);

/** Scan a single platform in a project directory. */
export async function scanPlatform(
  platformId: string,
  projectRoot: string,
): Promise<ScanResult> {
  const serializer = getPlatformSerializer(platformId);
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
    const serializer = getPlatformSerializer(result.platformId);
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

function canonicalInstructionNameForSource(source: string): string | undefined {
  return SHARED_PROJECT_INSTRUCTION_NAMES.get(source);
}

function normalizeProjectScanResults(results: ScanResult[]): ScanResult[] {
  const seenSharedSources = new Set<string>();

  return results.map((result) => ({
    ...result,
    resources: result.resources.flatMap((resource) => {
      const canonicalName =
        resource.type === "instruction"
          ? canonicalInstructionNameForSource(resource.source)
          : undefined;

      if (!canonicalName) {
        return [resource];
      }

      if (seenSharedSources.has(resource.source)) {
        return [];
      }

      seenSharedSources.add(resource.source);
      return [{ ...resource, name: canonicalName }];
    }),
  }));
}

function cleanupSharedInstructionDuplicates(resources: Resource[]): void {
  const existing = listResources();

  for (const resource of resources) {
    if (resource.type !== "instruction") continue;

    const canonicalName = canonicalInstructionNameForSource(resource.source);
    if (!canonicalName) continue;

    for (const duplicate of existing) {
      if (duplicate.type !== "instruction") continue;
      if (duplicate.source !== resource.source) continue;
      if (duplicate.content !== resource.content) continue;
      if (!SYNTHETIC_INSTRUCTION_NAMES.has(duplicate.name)) continue;
      if (duplicate.name === canonicalName) continue;

      deleteResource(duplicate.id);
    }
  }
}

export function persistScanResults(
  results: ScanResult[],
  options?: { skipExistingDuplicates?: boolean },
): PersistedScanResults {
  const normalizedResults = normalizeProjectScanResults(results);
  const seen = new Set<string>();
  const persisted: Resource[] = [];
  const importedCounts = new Map<string, number>();
  const existing = options?.skipExistingDuplicates
    ? new Set(listResources().map((resource) => resourceDedupKey(resource)))
    : undefined;

  for (const result of normalizedResults) {
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

  cleanupSharedInstructionDuplicates(persisted);

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

/** Persist Claude Code plugin inventory for a registered project after a scan including that platform. */
export async function persistClaudePluginInventoryForProject(opts: {
  projectRoot: string;
  projectId: string;
  scannedPlatformIds: readonly string[];
  homeRoot?: string;
}): Promise<{
  scanned_at: string;
  committed_count: number;
  effective_count: number;
} | null> {
  if (!opts.scannedPlatformIds.includes("claude-code")) {
    return null;
  }
  const root = opts.homeRoot ?? resolveHomeRoot();
  const inventory = await scanClaudePluginInventory({
    projectRoot: opts.projectRoot,
    homeRoot: root,
  });
  upsertProjectPluginState(opts.projectId, inventory);
  return {
    scanned_at: inventory.scanned_at,
    committed_count: inventory.committed.length,
    effective_count: inventory.effective.length,
  };
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
