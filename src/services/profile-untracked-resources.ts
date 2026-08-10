import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  addResourceToPlugin,
  resolvePluginSelector,
  touchPluginUpdatedAt,
} from "../models/plugin-model.js";
import { isProfilePlugin, listProfilePlugins } from "../constants/profile.js";
import {
  MATERIAL_RESOURCE_TYPES,
  type MaterialResourceType,
  type Resource,
  type ResourceCreateInput,
} from "../types.js";
import { mergePluginsForApply } from "./plugin-apply-merge.js";
import { markPluginDirty } from "./plugin-versioning.js";
import { collectProfilePluginIds } from "./profile-apply.js";
import {
  type ProfileContents,
  type ProfileContentsResource,
  toContentsResource,
} from "./profile-contents.js";
import type { ProfileApplyPreviewScope } from "./profile-apply-preview.js";
import { resolveMainHarnessTarget } from "./profile-harness-sync.js";
import { assessProjectScanStatus } from "./project-scan-status.js";
import { generateFiles, removeGlobalMaterializedFiles } from "./applier.js";
import { ensureLiveLibraryRef } from "./live-library-ref.js";
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

/** Keys attached to the given profile stack (including nested plugins). */
function trackedResourceKeys(profileSelector: string): Set<string> {
  const profilePlugin = resolvePluginSelector(profileSelector);
  if (!profilePlugin) {
    return new Set();
  }
  const profileResources = mergePluginsForApply(
    collectProfilePluginIds(profilePlugin),
  ).resources;
  return new Set(
    profileResources
      .filter(isMaterialResource)
      .map((resource) => profileResourceKey(resource)),
  );
}

/** Keys attached to any profile — used for not-staged detection. */
function resourceKeysAttachedToAnyProfile(): Set<string> {
  const keys = new Set<string>();
  for (const profile of listProfilePlugins()) {
    const profileResources = mergePluginsForApply(
      collectProfilePluginIds(profile),
    ).resources;
    for (const resource of profileResources) {
      if (isMaterialResource(resource)) {
        keys.add(profileResourceKey(resource));
      }
    }
  }
  return keys;
}

/** Normalize on-disk / expected paths for ownership comparisons. */
export function normalizeManagedPath(path: string, rootPath?: string): string {
  let normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("~/")) {
    normalized = normalized.slice(2);
  }
  if (rootPath) {
    const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      normalized = normalized.slice(root.length).replace(/^\//, "");
    }
  }
  return normalized.replace(/^\.\//, "");
}

const MERGED_CONTAINER_RESOURCE_TYPES = new Set([
  "permission",
  "env_var",
  "hook",
]);

function isClaudeSettingsPath(normalizedPath: string): boolean {
  const path = normalizedPath.replace(/^~\//, "");
  return path === ".claude/settings.json" || path.endsWith("/.claude/settings.json");
}

function isMergedContainerResource(
  resource: Pick<Resource, "type" | "source"> | Pick<ResourceCreateInput, "type" | "source">,
  rootPath: string,
): boolean {
  if (!MERGED_CONTAINER_RESOURCE_TYPES.has(resource.type)) {
    return false;
  }
  const sourcePath = normalizeManagedPath(resource.source ?? "", rootPath);
  return Boolean(sourcePath) && isClaudeSettingsPath(sourcePath);
}

async function profileOwnedPaths(
  profileSelector: string,
  rootPath: string,
  platformIds: string[],
  target: "global" | "project",
): Promise<Set<string>> {
  const profilePlugin = resolvePluginSelector(profileSelector);
  if (!profilePlugin || !isProfilePlugin(profilePlugin) || platformIds.length === 0) {
    return new Set();
  }
  const merged = mergePluginsForApply(collectProfilePluginIds(profilePlugin));
  const material = merged.resources.filter(isMaterialResource);
  if (material.length === 0) {
    return new Set();
  }
  try {
    const generated = await generateFiles(material, platformIds, rootPath, {
      target,
      claudeConfig: merged.claude,
    });
    const paths = new Set<string>();
    for (const result of generated) {
      for (const file of result.files) {
        paths.add(normalizeManagedPath(file.path, rootPath));
      }
    }
    return paths;
  } catch {
    return new Set();
  }
}

function sortContentsResources(
  resources: ProfileContentsResource[],
): ProfileContentsResource[] {
  return resources.sort((a, b) => {
    const typeOrder = a.type.localeCompare(b.type);
    return typeOrder !== 0 ? typeOrder : a.name.localeCompare(b.name);
  });
}

async function notStagedFromHomeScan(
  profileSelector: string,
  harness?: string,
): Promise<ProfileContentsResource[]> {
  const profilePlugin = resolvePluginSelector(profileSelector);
  if (!profilePlugin || !isProfilePlugin(profilePlugin)) {
    return [];
  }

  const committedKeys = resourceKeysAttachedToAnyProfile();
  const homeRoot = resolveHomeRoot();
  // Scan all detected harnesses unless a specific harness filter is requested.
  const scanned = await scanHomeDefaults(
    harness ? resolveMainHarnessTarget(harness) : undefined,
    homeRoot,
  );
  const platformIds = scanned.map((result) => result.platformId);
  const ownedPaths = await profileOwnedPaths(
    profileSelector,
    homeRoot,
    platformIds,
    "global",
  );
  const notStaged: ProfileContentsResource[] = [];
  const seen = new Set<string>();

  for (const result of scanned) {
    for (const resource of result.resources) {
      if (!isMaterialResource(resource)) {
        continue;
      }
      const key = profileResourceKey(resource);
      if (committedKeys.has(key) || seen.has(key)) {
        continue;
      }
      const sourcePath = normalizeManagedPath(resource.source ?? "", homeRoot);
      if (
        sourcePath &&
        ownedPaths.has(sourcePath) &&
        !isMergedContainerResource(resource, homeRoot)
      ) {
        // Singleton file materialized by the profile (e.g. CLAUDE.md).
        continue;
      }
      seen.add(key);
      const live = ensureLiveLibraryRef(resource, homeRoot);
      notStaged.push(toContentsResource(live));
    }
  }

  return sortContentsResources(notStaged);
}

async function notStagedFromProjectScan(
  profileSelector: string,
  projectPath: string,
): Promise<ProfileContentsResource[]> {
  const profilePlugin = resolvePluginSelector(profileSelector);
  if (!profilePlugin || !isProfilePlugin(profilePlugin)) {
    return [];
  }

  const committedKeys = resourceKeysAttachedToAnyProfile();
  const resolvedRoot = resolve(projectPath);
  const scanStatus = await assessProjectScanStatus(resolvedRoot);
  const scanned = await scanProject(resolvedRoot);
  const platformIds = scanned.map((result) => result.platformId);
  const ownedPaths = await profileOwnedPaths(
    profileSelector,
    resolvedRoot,
    platformIds,
    "project",
  );
  const notStaged: ProfileContentsResource[] = [];
  const seen = new Set<string>();

  for (const resource of scanStatus.on_disk.resources) {
    if (!isMaterialResource(resource)) {
      continue;
    }
    const key = profileResourceKey(resource);
    if (committedKeys.has(key) || seen.has(key)) {
      continue;
    }
    const sourcePath = normalizeManagedPath(resource.source ?? "", resolvedRoot);
    if (
      sourcePath &&
      ownedPaths.has(sourcePath) &&
      !isMergedContainerResource(resource, resolvedRoot)
    ) {
      continue;
    }
    seen.add(key);
    const live = ensureLiveLibraryRef(
      {
        type: resource.type,
        name: resource.name,
        description: resource.description,
        content: resource.content,
        metadata: resource.metadata,
        source: resource.source,
        namespace: resource.namespace,
      },
      resolvedRoot,
    );
    notStaged.push(toContentsResource(live));
  }

  return sortContentsResources(notStaged);
}

/** @deprecated Prefer detectNotStagedProfileResources — same behavior. */
export async function detectUntrackedProfileResources(input: {
  profileSelector: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<ProfileContentsResource[]> {
  return detectNotStagedProfileResources(input);
}

export async function detectNotStagedProfileResources(input: {
  profileSelector: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<ProfileContentsResource[]> {
  if (input.scope === "project") {
    if (!input.projectPath) {
      return [];
    }
    return notStagedFromProjectScan(input.profileSelector, input.projectPath);
  }
  return notStagedFromHomeScan(input.profileSelector, input.harness);
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
  const profilePlugin = resolvePluginSelector(input.profileSelector);
  if (!profilePlugin) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfilePlugin(profilePlugin)) {
    throw new Error(`Plugin "${profilePlugin.name}" is not tagged as a profile`);
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

  markPluginDirty(profilePlugin.id);
  addResourceToPlugin(profilePlugin.id, resource.id);
  touchPluginUpdatedAt(profilePlugin.id);

  return toContentsResource(resource);
}

async function resolveUntrackedScanResults(input: {
  profileSelector: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<{ originRef: string; scanResults: ScanResult[] }> {
  const profilePlugin = resolvePluginSelector(input.profileSelector);
  if (!profilePlugin || !isProfilePlugin(profilePlugin)) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }

  const committedKeys = resourceKeysAttachedToAnyProfile();

  if (input.scope === "project") {
    if (!input.projectPath) {
      throw new Error("projectPath is required for project scope");
    }
    const originRef = resolve(input.projectPath);
    const scanned = await scanProject(originRef);
    const ownedPaths = await profileOwnedPaths(
      input.profileSelector,
      originRef,
      scanned.map((result) => result.platformId),
      "project",
    );
    return {
      originRef,
      scanResults: filterScanResultsToNotStaged(
        scanned,
        committedKeys,
        ownedPaths,
        originRef,
      ),
    };
  }

  const originRef = resolveHomeRoot();
  const scanned = await scanHomeDefaults(
    input.harness ? resolveMainHarnessTarget(input.harness) : undefined,
    originRef,
  );
  const ownedPaths = await profileOwnedPaths(
    input.profileSelector,
    originRef,
    scanned.map((result) => result.platformId),
    "global",
  );
  return {
    originRef,
    scanResults: filterScanResultsToNotStaged(
      scanned,
      committedKeys,
      ownedPaths,
      originRef,
    ),
  };
}

export async function addAllUntrackedResourcesToProfile(input: {
  profileSelector: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<{ resources: ProfileContentsResource[]; added_count: number }> {
  const profilePlugin = resolvePluginSelector(input.profileSelector);
  if (!profilePlugin) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfilePlugin(profilePlugin)) {
    throw new Error(`Plugin "${profilePlugin.name}" is not tagged as a profile`);
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

  markPluginDirty(profilePlugin.id);
  for (const resource of materialResources) {
    addResourceToPlugin(profilePlugin.id, resource.id);
  }
  touchPluginUpdatedAt(profilePlugin.id);

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

function filterScanResultsToNotStaged(
  results: ScanResult[],
  committedKeys: ReadonlySet<string>,
  ownedPaths: ReadonlySet<string>,
  rootPath: string,
): ScanResult[] {
  const filtered: ScanResult[] = [];
  for (const result of results) {
    const resources = result.resources.filter((resource) => {
      if (!isMaterialResource(resource)) {
        return false;
      }
      if (committedKeys.has(profileResourceKey(resource))) {
        return false;
      }
      const sourcePath = normalizeManagedPath(resource.source ?? "", rootPath);
      if (
        sourcePath &&
        ownedPaths.has(sourcePath) &&
        !isMergedContainerResource(resource, rootPath)
      ) {
        return false;
      }
      return true;
    });
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
    plugins: [],
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
  const profilePlugin = resolvePluginSelector(input.profileSelector);
  if (!profilePlugin || !isProfilePlugin(profilePlugin)) {
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
