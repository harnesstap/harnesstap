import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  addResourceToLayer,
  resolveLayerSelector,
  touchLayerUpdatedAt,
} from "../models/layer-model.js";
import { isProfileLayer } from "../constants/profile.js";
import {
  MATERIAL_RESOURCE_TYPES,
  type MaterialResourceType,
  type Resource,
  type ResourceCreateInput,
} from "../types.js";
import { mergeLayersForApply } from "./layer-apply-merge.js";
import { collectProfileLayerIds } from "./profile-apply.js";
import {
  type ProfileContents,
  type ProfileContentsResource,
  toContentsResource,
} from "./profile-contents.js";
import type { ProfileApplyPreviewScope } from "./profile-apply-preview.js";
import { resolveMainHarnessTarget } from "./profile-harness-sync.js";
import { assessProjectScanStatus } from "./project-scan-status.js";
import { generateFiles, removeGlobalMaterializedFiles } from "./applier.js";
import {
  persistScanResults,
  scanHomeDefaults,
  scanProject,
  type ScanResult,
} from "./scanner.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import type { DriftFileChange } from "./project-drift.js";

const MATERIAL_RESOURCE_TYPE_SET = new Set<string>(MATERIAL_RESOURCE_TYPES);

function isMaterialResource(
  resource: Pick<Resource, "type"> | Pick<ResourceCreateInput, "type">,
): resource is Resource & { type: MaterialResourceType } {
  return MATERIAL_RESOURCE_TYPE_SET.has(resource.type);
}

function profileResourceKey(
  resource: Pick<Resource, "type" | "name"> | Pick<ResourceCreateInput, "type" | "name">,
): string {
  return `${resource.type}:${resource.name}`;
}

function trackedResourceKeys(profileSelector: string): Set<string> {
  const profileLayer = resolveLayerSelector(profileSelector);
  if (!profileLayer) {
    return new Set();
  }
  const profileResources = mergeLayersForApply(
    collectProfileLayerIds(profileLayer),
  ).resources;
  return new Set(
    profileResources
      .filter(isMaterialResource)
      .map((resource) => profileResourceKey(resource)),
  );
}

function scanInputToUntrackedResource(
  input: ResourceCreateInput,
  originRef: string,
): ProfileContentsResource {
  return {
    id: `untracked:${input.type}:${input.name}`,
    type: input.type,
    name: input.name,
    source: input.source ?? originRef,
  };
}

async function untrackedFromHomeScan(
  profileSelector: string,
  harness?: string,
): Promise<ProfileContentsResource[]> {
  const profileLayer = resolveLayerSelector(profileSelector);
  if (!profileLayer || !isProfileLayer(profileLayer)) {
    return [];
  }

  const trackedKeys = trackedResourceKeys(profileSelector);
  const mainHarness = resolveMainHarnessTarget(harness);
  const homeRoot = resolveHomeRoot();
  const scanned = await scanHomeDefaults(mainHarness, homeRoot);
  const untracked: ProfileContentsResource[] = [];
  const seen = new Set<string>();

  for (const result of scanned) {
    for (const resource of result.resources) {
      if (!isMaterialResource(resource)) {
        continue;
      }
      const key = profileResourceKey(resource);
      if (trackedKeys.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      untracked.push(scanInputToUntrackedResource(resource, homeRoot));
    }
  }

  return untracked.sort((a, b) => {
    const typeOrder = a.type.localeCompare(b.type);
    return typeOrder !== 0 ? typeOrder : a.name.localeCompare(b.name);
  });
}

async function untrackedFromProjectScan(
  profileSelector: string,
  projectPath: string,
): Promise<ProfileContentsResource[]> {
  const profileLayer = resolveLayerSelector(profileSelector);
  if (!profileLayer || !isProfileLayer(profileLayer)) {
    return [];
  }

  const trackedKeys = trackedResourceKeys(profileSelector);
  const resolvedRoot = resolve(projectPath);
  const scanStatus = await assessProjectScanStatus(resolvedRoot);
  const untracked: ProfileContentsResource[] = [];
  const seen = new Set<string>();

  for (const resource of scanStatus.on_disk.resources) {
    if (!isMaterialResource(resource)) {
      continue;
    }
    const key = profileResourceKey(resource);
    if (trackedKeys.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    untracked.push(toContentsResource(resource));
  }

  return untracked.sort((a, b) => {
    const typeOrder = a.type.localeCompare(b.type);
    return typeOrder !== 0 ? typeOrder : a.name.localeCompare(b.name);
  });
}

export async function detectUntrackedProfileResources(input: {
  profileSelector: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<ProfileContentsResource[]> {
  if (input.scope === "project") {
    if (!input.projectPath) {
      return [];
    }
    return untrackedFromProjectScan(input.profileSelector, input.projectPath);
  }
  return untrackedFromHomeScan(input.profileSelector, input.harness);
}

function filterScanResultsForResource(
  results: ScanResult[],
  resourceType: string,
  resourceName: string,
): ScanResult[] {
  const filtered: ScanResult[] = [];
  for (const result of results) {
    const resources = result.resources.filter(
      (resource) => resource.type === resourceType && resource.name === resourceName,
    );
    if (resources.length === 0) {
      continue;
    }
    filtered.push({ ...result, resources });
  }
  return filtered;
}

export async function addResourceToProfile(input: {
  profileSelector: string;
  resourceType: string;
  resourceName: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<ProfileContentsResource> {
  const profileLayer = resolveLayerSelector(input.profileSelector);
  if (!profileLayer) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfileLayer(profileLayer)) {
    throw new Error(`Layer "${profileLayer.name}" is not tagged as a profile`);
  }
  if (!MATERIAL_RESOURCE_TYPE_SET.has(input.resourceType)) {
    throw new Error(`Unsupported resource type: ${input.resourceType}`);
  }

  const trackedKeys = trackedResourceKeys(input.profileSelector);
  const key = `${input.resourceType}:${input.resourceName}`;
  if (trackedKeys.has(key)) {
    throw new Error(`Resource is already in profile: ${key}`);
  }

  const { originRef, scanResults } = await resolveUntrackedScanResults(input);
  const matchingResults = filterScanResultsForResource(
    scanResults,
    input.resourceType,
    input.resourceName,
  );
  if (matchingResults.length === 0) {
    throw new Error(
      `Resource not found on disk: ${input.resourceType}:${input.resourceName}`,
    );
  }

  const persisted = persistScanResults(matchingResults, {
    conflictPolicy: "overwrite",
    originRef,
  });
  const resource = persisted.resolved.find(
    (entry) =>
      entry.type === input.resourceType && entry.name === input.resourceName,
  );
  if (!resource) {
    throw new Error(
      `Could not import resource: ${input.resourceType}:${input.resourceName}`,
    );
  }

  addResourceToLayer(profileLayer.id, resource.id);
  touchLayerUpdatedAt(profileLayer.id);

  return toContentsResource(resource);
}

async function resolveUntrackedScanResults(input: {
  profileSelector: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<{ originRef: string; scanResults: ScanResult[] }> {
  const profileLayer = resolveLayerSelector(input.profileSelector);
  if (!profileLayer || !isProfileLayer(profileLayer)) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }

  const trackedKeys = trackedResourceKeys(input.profileSelector);

  if (input.scope === "project") {
    if (!input.projectPath) {
      throw new Error("projectPath is required for project scope");
    }
    const originRef = resolve(input.projectPath);
    const scanned = await scanProject(originRef);
    return {
      originRef,
      scanResults: filterScanResultsToUntracked(scanned, trackedKeys),
    };
  }

  const mainHarness = resolveMainHarnessTarget(input.harness);
  const originRef = resolveHomeRoot();
  const scanned = await scanHomeDefaults(mainHarness, originRef);
  return {
    originRef,
    scanResults: filterScanResultsToUntracked(scanned, trackedKeys),
  };
}

export async function addAllUntrackedResourcesToProfile(input: {
  profileSelector: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<{ resources: ProfileContentsResource[]; added_count: number }> {
  const profileLayer = resolveLayerSelector(input.profileSelector);
  if (!profileLayer) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfileLayer(profileLayer)) {
    throw new Error(`Layer "${profileLayer.name}" is not tagged as a profile`);
  }

  const { originRef, scanResults } = await resolveUntrackedScanResults(input);
  if (scanResults.length === 0) {
    throw new Error("No untracked resources to add to profile.");
  }

  const persisted = persistScanResults(scanResults, {
    conflictPolicy: "overwrite",
    originRef,
  });
  const materialResources = persisted.resolved.filter(isMaterialResource);
  if (materialResources.length === 0) {
    throw new Error("No untracked resources to add to profile.");
  }

  for (const resource of materialResources) {
    addResourceToLayer(profileLayer.id, resource.id);
  }
  touchLayerUpdatedAt(profileLayer.id);

  const resources = materialResources.map((resource) => toContentsResource(resource));
  return {
    resources,
    added_count: resources.length,
  };
}

export interface StashedFileSnapshot {
  path: string;
  content: string;
  platform?: string;
}

export interface UntrackedStashCapture {
  resources: ProfileContentsResource[];
  files: StashedFileSnapshot[];
}

function filterScanResultsToUntracked(
  results: ScanResult[],
  trackedKeys: ReadonlySet<string>,
): ScanResult[] {
  const filtered: ScanResult[] = [];
  for (const result of results) {
    const resources = result.resources.filter(
      (resource) =>
        isMaterialResource(resource)
        && !trackedKeys.has(profileResourceKey(resource)),
    );
    if (resources.length > 0) {
      filtered.push({ ...result, resources });
    }
  }
  return filtered;
}

function readHomeFile(homeRoot: string, relativePath: string): string | null {
  const fullPath = resolve(homeRoot, relativePath);
  if (!existsSync(fullPath)) {
    return null;
  }
  try {
    return readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

export function buildContentsFromResources(
  resources: ProfileContentsResource[],
): ProfileContents {
  const typeCounts: Record<string, number> = {};
  for (const resource of resources) {
    typeCounts[resource.type] = (typeCounts[resource.type] ?? 0) + 1;
  }
  const summaryParts = Object.entries(typeCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `${count} ${type}${count === 1 ? "" : "s"}`);
  return {
    layers: [],
    stack_resource_count: resources.length,
    stack_summary: summaryParts.join(", ") || null,
    type_counts: typeCounts,
    resources,
    plugin_pins: [],
    mcp_servers: [],
  };
}

export async function captureUntrackedResourcesForStash(input: {
  profileSelector: string;
  harness?: string;
}): Promise<UntrackedStashCapture> {
  const profileLayer = resolveLayerSelector(input.profileSelector);
  if (!profileLayer || !isProfileLayer(profileLayer)) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }

  const mainHarness = resolveMainHarnessTarget(input.harness);
  const homeRoot = resolveHomeRoot();
  const { scanResults: untrackedScanResults } = await resolveUntrackedScanResults({
    profileSelector: input.profileSelector,
    scope: "home",
    harness: input.harness,
  });
  if (untrackedScanResults.length === 0) {
    throw new Error("No untracked resources to stash.");
  }

  const persisted = persistScanResults(untrackedScanResults, {
    conflictPolicy: "overwrite",
    originRef: homeRoot,
  });
  const resources = persisted.resolved
    .filter(isMaterialResource)
    .map((resource) => toContentsResource(resource));

  const generated = await generateFiles(
    persisted.resolved.filter(isMaterialResource),
    [mainHarness],
    homeRoot,
    { target: "global" },
  );

  const files: StashedFileSnapshot[] = [];
  const seenPaths = new Set<string>();
  for (const result of generated) {
    for (const file of result.files) {
      if (seenPaths.has(file.path)) {
        continue;
      }
      seenPaths.add(file.path);
      const current = readHomeFile(homeRoot, file.path);
      if (current === null) {
        continue;
      }
      files.push({
        path: file.path,
        content: current,
        platform: result.platformId,
      });
    }
  }

  if (resources.length === 0) {
    throw new Error("No untracked resources to stash.");
  }

  return { resources, files };
}

export function removeUntrackedStashFiles(
  homeRoot: string,
  files: StashedFileSnapshot[],
  dryRun = false,
): string[] {
  const paths = files.map((file) => file.path);
  if (!dryRun) {
    removeGlobalMaterializedFiles(homeRoot, paths);
  }
  return paths;
}

export function restoreUntrackedStashFiles(
  homeRoot: string,
  files: StashedFileSnapshot[],
  dryRun = false,
): string[] {
  const restored: string[] = [];
  for (const file of files) {
    if (dryRun) {
      restored.push(file.path);
      continue;
    }
    const fullPath = resolve(homeRoot, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, "utf-8");
    restored.push(file.path);
  }
  return restored;
}

export function stashedFilesToDriftChanges(
  files: StashedFileSnapshot[],
): DriftFileChange[] {
  return files.map((file) => ({
    path: file.path,
    type: "added" as const,
    ...(file.platform ? { platform: file.platform } : {}),
  }));
}
