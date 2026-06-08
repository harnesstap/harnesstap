import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { getAllPlatforms } from "../platforms/registry.js";
import type { PlatformPaths, Resource } from "../types.js";
import {
  deleteResource,
  listResources,
  normalizeResourceInput,
  upsertResource,
  type ImportConflictPolicy,
  type ResourceCreateInput,
  type UpsertResourceInput,
  type UpsertResult,
} from "../models/resource.js";
import {
  createImportedSnapshot,
} from "../models/imported-snapshot.js";
import { getPlatformSerializer } from "./platform-serializers.js";
import { scanPluginSource } from "./plugin-source-import.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { loadScanIgnore } from "./scanner-ignore.js";
import type { ImportedSnapshot } from "../types.js";

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

export function isPluginSourcePath(sourcePath: string): boolean {
  if (!existsSync(sourcePath)) {
    return false;
  }

  if (basename(sourcePath) === "marketplace.json") {
    return true;
  }

  return (
    existsSync(join(sourcePath, ".cursor-plugin", "plugin.json")) ||
    existsSync(join(sourcePath, ".claude-plugin", "plugin.json"))
  );
}

// ── Scanning ───────────────────────────────────────────────────────────

export interface ScanResult {
  platformId: string;
  resources: ResourceCreateInput[];
}

export interface HomeScanResult extends ScanResult {
  discoveredPaths: string[];
}

export interface ScanConflict {
  platformId: string;
  existing: Resource;
  incoming: UpsertResourceInput;
}

export interface PersistScanOptions {
  conflictPolicy?: ImportConflictPolicy;
  namespace?: string;
  originRef?: string;
}

export interface PersistedScanResults {
  /** Newly created or updated resources from this import run. */
  resources: Resource[];
  /** All resources matching the scan batch, including unchanged rows. */
  resolved: Resource[];
  importedCounts: Map<string, number>;
  conflicts: ScanConflict[];
}

export interface PersistedPluginSourceResults {
  imports: Awaited<ReturnType<typeof scanPluginSource>>;
  resources: Resource[];
  snapshots: ImportedSnapshot[];
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
  return normalizeProjectScanResults(projectRoot, results);
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

function resourceDedupKey(
  resource: Pick<Resource, "type" | "name" | "namespace">,
): string {
  return `${resource.type}:${resource.name}:${resource.namespace ?? ""}`;
}

function pluginImportIdentity(result: {
  source_kind: string;
  source_label: string;
  plugin_name: string;
  metadata: Record<string, unknown>;
}): {
  namespace: string;
  origin_kind: "marketplace_link";
  origin_ref: string;
} {
  const marketplaceName = String(
    result.metadata.marketplace_name ?? result.source_label ?? result.plugin_name,
  );
  return {
    namespace: result.plugin_name,
    origin_kind: "marketplace_link",
    origin_ref:
      result.source_kind === "marketplace"
        ? `${result.plugin_name}@${marketplaceName}`
        : `${result.plugin_name}@${result.plugin_name}`,
  };
}

function canonicalInstructionNameForSource(source: string): string | undefined {
  return SHARED_PROJECT_INSTRUCTION_NAMES.get(source);
}

function normalizeProjectScanResults(
  projectRoot: string,
  results: ScanResult[],
): ScanResult[] {
  const ignore = loadScanIgnore(projectRoot);
  const seenSharedSources = new Set<string>();

  return results.map((result) => ({
    ...result,
    resources: result.resources.flatMap((resource) => {
      if (ignore.ignores(resource.source)) {
        return [];
      }

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
  options?: PersistScanOptions,
): PersistedScanResults {
  const seen = new Set<string>();
  const persisted: Resource[] = [];
  const resolved: Resource[] = [];
  const importedCounts = new Map<string, number>();
  const conflicts: ScanConflict[] = [];
  const conflictPolicy = options?.conflictPolicy ?? "skip";
  const namespace = options?.namespace ?? "";
  const originRef = options?.originRef ?? "";

  for (const result of results) {
    for (const r of result.resources) {
      const incoming = normalizeResourceInput({
        ...r,
        namespace,
        origin_kind: "local_snapshot",
        origin_ref: originRef || r.source,
      });
      const key = resourceDedupKey({ ...incoming, namespace });
      if (seen.has(key)) continue;
      seen.add(key);

      let upsertResult: UpsertResult;
      try {
        upsertResult = upsertResource(incoming, {
          policy: conflictPolicy === "prompt" ? "fail" : conflictPolicy,
        });
      } catch {
        const existing = listResources().find(
          (resource) =>
            resource.type === incoming.type &&
            resource.name === incoming.name &&
            resource.namespace === namespace,
        );
        if (existing) {
          conflicts.push({ platformId: result.platformId, existing, incoming });
          continue;
        }
        throw new Error(
          `Resource conflict: ${incoming.type}:${incoming.name}${namespace ? `@${namespace}` : ""}`,
        );
      }

      const savedResource =
        upsertResult.action === "skipped"
          ? upsertResult.existing
          : upsertResult.resource;
      resolved.push(savedResource);

      if (upsertResult.action === "skipped") {
        if (conflictPolicy === "prompt" || conflictPolicy === "fail") {
          conflicts.push({
            platformId: result.platformId,
            existing: upsertResult.existing,
            incoming,
          });
        }
        continue;
      }

      if (upsertResult.action === "unchanged") {
        continue;
      }

      persisted.push(savedResource);
      importedCounts.set(
        result.platformId,
        (importedCounts.get(result.platformId) ?? 0) + 1,
      );
    }
  }

  cleanupSharedInstructionDuplicates(persisted);

  return { resources: persisted, resolved, importedCounts, conflicts };
}

export function applyScanConflicts(
  conflicts: ScanConflict[],
  resolution: "overwrite" | "skip",
): Resource[] {
  const updated: Resource[] = [];
  for (const conflict of conflicts) {
    const result = upsertResource(conflict.incoming, {
      policy: resolution === "overwrite" ? "overwrite" : "skip",
    });
    if (result.action === "created" || result.action === "updated") {
      updated.push(result.resource);
    }
    if (result.action === "unchanged") {
      updated.push(result.resource);
    }
  }
  return updated;
}

/**
 * Scan and persist: scan all platforms and save unique resources to the database.
 * Deduplicates by name+type to avoid re-importing the same resource.
 */
export async function scanAndPersist(
  projectRoot: string,
  platformFilter?: string,
  options?: PersistScanOptions,
): Promise<Resource[]> {
  const results = await scanProject(projectRoot, platformFilter);
  return persistScanResults(results, {
    ...options,
    originRef: options?.originRef ?? projectRoot,
  }).resolved;
}

export async function scanAndPersistPluginSource(
  sourcePath: string,
): Promise<PersistedPluginSourceResults> {
  const imports = await scanPluginSource(sourcePath);
  const resources: Resource[] = [];
  const snapshots: ImportedSnapshot[] = [];
  const returnedResourceIds = new Set<string>();

  for (const result of imports) {
    const resourceIds: string[] = [];

    const identity = pluginImportIdentity(result);

    for (const resource of result.resources) {
      const upserted = upsertResource(
        normalizeResourceInput({
          ...resource,
          ...identity,
        }),
        { policy: "overwrite" },
      );

      const saved =
        upserted.action === "skipped"
          ? upserted.existing
          : upserted.resource;

      resourceIds.push(saved.id);
      if (!returnedResourceIds.has(saved.id)) {
        returnedResourceIds.add(saved.id);
        resources.push(saved);
      }
    }

    snapshots.push(
      createImportedSnapshot({
        source_kind: result.source_kind,
        source_label: result.source_label,
        plugin_name: result.plugin_name,
        plugin_version: result.plugin_version,
        resource_ids: resourceIds,
        metadata: result.metadata,
      }),
    );
  }

  return { imports, resources, snapshots };
}

/** @deprecated Plugin inventory is declared via composition `plugin` resources and `resource sync`. */
export async function persistClaudePluginInventoryForProject(_opts: {
  projectRoot: string;
  projectId: string;
  scannedPlatformIds: readonly string[];
  homeRoot?: string;
}): Promise<null> {
  return null;
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
    conflictPolicy: "skip",
    originRef: homeRoot,
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
