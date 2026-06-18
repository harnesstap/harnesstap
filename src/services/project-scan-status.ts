import { resolve } from "node:path";
import {
  detectPlatforms,
  hasPluginSourceLayout,
  scanProject,
  type ScanResult,
} from "./scanner.js";
import { scanPluginSourceForMerge } from "./plugin-source-import.js";
import { dropHarnessSkillsDuplicatingPluginSource } from "./scan-dedup.js";
import { listResourcesByOriginRef, normalizeResourceInput } from "../models/resource.js";
import { hashResourceBody } from "./resource-hash.js";
import type { Resource, ResourceCreateInput, ResourceType } from "../types.js";

export type ProjectScanComparisonStatus =
  | "no_harness_files"
  | "not_scanned"
  | "up_to_date"
  | "stale";

export interface ProjectScanStatus {
  on_disk: {
    resources: Resource[];
    harness_resource_count: number;
    plugin_source: boolean;
    platforms: string[];
  };
  in_library: {
    resources: Resource[];
  };
  comparison: {
    status: ProjectScanComparisonStatus;
    new_count: number;
    changed_count: number;
    removed_count: number;
  };
}

function resourceDedupKey(
  resource: Pick<Resource, "type" | "name" | "namespace">,
): string {
  return `${resource.type}:${resource.name}:${resource.namespace ?? ""}`;
}

function scanInputToComparableResource(
  input: ResourceCreateInput,
  projectRoot: string,
): Resource {
  const normalized = normalizeResourceInput({
    ...input,
    namespace: input.namespace ?? "",
    origin_kind: "local_snapshot",
    origin_ref: projectRoot,
  });
  const namespace = normalized.namespace ?? "";
  const contentHash = hashResourceBody({
    type: normalized.type,
    content: normalized.content,
    metadata: normalized.metadata,
  });
  const now = new Date(0).toISOString();
  return {
    id: `scan:${resourceDedupKey({ ...normalized, namespace })}`,
    type: normalized.type,
    name: normalized.name,
    description: normalized.description,
    content: normalized.content,
    metadata: normalized.metadata,
    source: normalized.source,
    namespace,
    origin_kind: normalized.origin_kind ?? "local_snapshot",
    origin_ref: normalized.origin_ref ?? projectRoot,
    content_hash: contentHash,
    content_blob_ref: "",
    created_at: now,
    updated_at: now,
  };
}

function flattenHarnessScanResults(
  projectRoot: string,
  results: ScanResult[],
): Resource[] {
  const seen = new Set<string>();
  const resources: Resource[] = [];

  for (const result of results) {
    for (const resource of result.resources) {
      const comparable = scanInputToComparableResource(resource, projectRoot);
      const key = resourceDedupKey(comparable);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      resources.push(comparable);
    }
  }

  return resources;
}

function flattenPluginScanResults(
  projectRoot: string,
  plugin: Awaited<ReturnType<typeof scanPluginSourceForMerge>>,
): Resource[] {
  const seen = new Set<string>();
  const resources: Resource[] = [];

  for (const result of plugin) {
    for (const resource of result.resources) {
      const comparable = scanInputToComparableResource(resource, projectRoot);
      const key = resourceDedupKey(comparable);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      resources.push(comparable);
    }
  }

  return resources;
}

function compareHarnessResources(
  onDisk: Resource[],
  inLibrary: Resource[],
): Pick<ProjectScanStatus["comparison"], "status" | "new_count" | "changed_count" | "removed_count"> {
  const libraryByKey = new Map(
    inLibrary.map((resource) => [resourceDedupKey(resource), resource]),
  );
  const onDiskKeys = new Set<string>();

  let newCount = 0;
  let changedCount = 0;

  for (const resource of onDisk) {
    const key = resourceDedupKey(resource);
    onDiskKeys.add(key);
    const existing = libraryByKey.get(key);
    if (!existing) {
      newCount += 1;
      continue;
    }
    if (existing.content_hash !== resource.content_hash) {
      changedCount += 1;
    }
  }

  let removedCount = 0;
  for (const resource of inLibrary) {
    const key = resourceDedupKey(resource);
    if (!onDiskKeys.has(key)) {
      removedCount += 1;
    }
  }

  if (onDisk.length === 0) {
    if (inLibrary.length > 0) {
      return {
        status: "stale",
        new_count: 0,
        changed_count: 0,
        removed_count: inLibrary.length,
      };
    }
    return {
      status: "no_harness_files",
      new_count: 0,
      changed_count: 0,
      removed_count: 0,
    };
  }

  if (inLibrary.length === 0) {
    return {
      status: "not_scanned",
      new_count: onDisk.length,
      changed_count: 0,
      removed_count: 0,
    };
  }

  if (newCount > 0 || changedCount > 0 || removedCount > 0) {
    return {
      status: "stale",
      new_count: newCount,
      changed_count: changedCount,
      removed_count: removedCount,
    };
  }

  return {
    status: "up_to_date",
    new_count: 0,
    changed_count: 0,
    removed_count: 0,
  };
}

export function countResourcesByType(
  resources: Pick<Resource, "type">[],
): Partial<Record<ResourceType, number>> {
  const counts: Partial<Record<ResourceType, number>> = {};
  for (const resource of resources) {
    counts[resource.type] = (counts[resource.type] ?? 0) + 1;
  }
  return counts;
}

export async function assessProjectScanStatus(
  projectRoot: string,
): Promise<ProjectScanStatus> {
  const resolvedRoot = resolve(projectRoot);
  const rawHarness = await scanProject(resolvedRoot);
  let plugin: Awaited<ReturnType<typeof scanPluginSourceForMerge>> = [];
  if (hasPluginSourceLayout(resolvedRoot)) {
    try {
      plugin = await scanPluginSourceForMerge(resolvedRoot);
    } catch {
      plugin = [];
    }
  }

  const harness = dropHarnessSkillsDuplicatingPluginSource(rawHarness, plugin);
  const harnessOnDisk = flattenHarnessScanResults(resolvedRoot, harness);
  const pluginOnDisk = flattenPluginScanResults(resolvedRoot, plugin);
  const onDiskResources = [...harnessOnDisk, ...pluginOnDisk];
  const inLibraryResources = listResourcesByOriginRef(resolvedRoot);
  let comparison = compareHarnessResources(harnessOnDisk, inLibraryResources);

  if (
    comparison.status === "no_harness_files"
    && pluginOnDisk.length > 0
    && inLibraryResources.length === 0
  ) {
    comparison = {
      status: "not_scanned",
      new_count: onDiskResources.length,
      changed_count: 0,
      removed_count: 0,
    };
  }

  return {
    on_disk: {
      resources: onDiskResources,
      harness_resource_count: harnessOnDisk.length,
      plugin_source: hasPluginSourceLayout(resolvedRoot),
      platforms: detectPlatforms(resolvedRoot),
    },
    in_library: {
      resources: inLibraryResources,
    },
    comparison,
  };
}
