import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
} from "../models/plugin-model.js";
import { PROFILE_PLUGIN_TAG, isEmptyBuiltinProfile } from "../constants/profile.js";
import { listResources } from "../models/resource.js";
import type { Plugin, Resource, ResourceCreateInput } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { ProfileReservedNameError } from "./profile-commands.js";
import {
  persistScanResults,
  scanHomeDefaults,
} from "./scanner.js";

export type ProfileConflictPolicy = "skip" | "overwrite";

export class ProfilePluginExistsError extends Error {
  constructor(name: string) {
    super(`Plugin already exists: ${name}`);
    this.name = "ProfilePluginExistsError";
  }
}

export interface ProfileFromHomePreview {
  totalImports: number;
  platformIds: string[];
  conflicts: Array<{
    type: string;
    name: string;
    namespace: string | null;
  }>;
  warning?: string;
}

export interface ProfileFromHomeResult {
  plugin: Plugin;
  imported_count: number;
  resources: Resource[];
}

function resourceNamespace(resource: ResourceCreateInput): string {
  return resource.namespace ?? "";
}

function resourceKey(resource: ResourceCreateInput): string {
  return `${resource.type}:${resource.name}:${resourceNamespace(resource)}`;
}

function createNewProfilePlugin(input: {
  name: string;
  description?: string;
}): Plugin {
  try {
    return createPlugin({
      name: input.name,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      tags: [PROFILE_PLUGIN_TAG],
    });
  } catch (error) {
    if (getPluginByName(input.name)) {
      throw new ProfilePluginExistsError(input.name);
    }
    throw error;
  }
}

export async function previewProfileFromHome(input?: {
  homeRoot?: string;
  platform?: string;
}): Promise<ProfileFromHomePreview> {
  const homeRoot = input?.homeRoot ?? resolveHomeRoot();
  const results = await scanHomeDefaults(input?.platform, homeRoot);
  const scannedResources = results.flatMap((result) => result.resources);
  const existingByKey = new Map(
    listResources().map((resource) => [resourceKey(resource), resource]),
  );
  const conflicts = [];
  const conflictKeys = new Set<string>();

  for (const scanned of scannedResources) {
    const key = resourceKey(scanned);
    const existing = existingByKey.get(key);
    if (
      !existing
      || existing.content === scanned.content
      || conflictKeys.has(key)
    ) {
      continue;
    }
    conflictKeys.add(key);
    conflicts.push({
      type: scanned.type,
      name: scanned.name,
      namespace: resourceNamespace(scanned) || null,
    });
  }

  const preview: ProfileFromHomePreview = {
    totalImports: scannedResources.length,
    platformIds: results.map((result) => result.platformId),
    conflicts,
  };
  if (scannedResources.length === 0) {
    preview.warning = "No supported home resources found";
  }
  return preview;
}

export async function createProfileFromHome(input: {
  name: string;
  description?: string;
  homeRoot?: string;
  platform?: string;
  conflictPolicy: ProfileConflictPolicy;
}): Promise<ProfileFromHomeResult> {
  if (isEmptyBuiltinProfile(input.name)) {
    throw new ProfileReservedNameError(input.name);
  }
  if (getPluginByName(input.name)) {
    throw new ProfilePluginExistsError(input.name);
  }

  const homeRoot = input.homeRoot ?? resolveHomeRoot();
  const scanResults = await scanHomeDefaults(input.platform, homeRoot);
  const persisted = persistScanResults(scanResults, {
    conflictPolicy: input.conflictPolicy,
    originRef: homeRoot,
  });
  const plugin = createNewProfilePlugin({
    name: input.name,
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
  });

  for (const resource of persisted.resolved) {
    addResourceToPlugin(plugin.id, resource.id);
  }

  return {
    plugin,
    imported_count: persisted.resolved.length,
    resources: persisted.resolved,
  };
}
