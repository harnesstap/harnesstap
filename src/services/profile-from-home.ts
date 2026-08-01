import {
  addResourceToLayer,
  createLayer,
  getLayerByName,
} from "../models/layer-model.js";
import { PROFILE_LAYER_TAG, isEmptyBuiltinProfile } from "../constants/profile.js";
import { listResources } from "../models/resource.js";
import type { Layer, Resource, ResourceCreateInput } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { ProfileReservedNameError } from "./profile-commands.js";
import {
  persistScanResults,
  scanHomeDefaults,
} from "./scanner.js";

export type ProfileConflictPolicy = "skip" | "overwrite";

export class ProfileLayerExistsError extends Error {
  constructor(name: string) {
    super(`Layer already exists: ${name}`);
    this.name = "ProfileLayerExistsError";
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
  layer: Layer;
  imported_count: number;
  resources: Resource[];
}

function resourceNamespace(resource: ResourceCreateInput): string {
  return resource.namespace ?? "";
}

function resourceKey(resource: ResourceCreateInput): string {
  return `${resource.type}:${resource.name}:${resourceNamespace(resource)}`;
}

function createNewProfileLayer(input: {
  name: string;
  description?: string;
}): Layer {
  try {
    return createLayer({
      name: input.name,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      tags: [PROFILE_LAYER_TAG],
    });
  } catch (error) {
    if (getLayerByName(input.name)) {
      throw new ProfileLayerExistsError(input.name);
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
  if (getLayerByName(input.name)) {
    throw new ProfileLayerExistsError(input.name);
  }

  const homeRoot = input.homeRoot ?? resolveHomeRoot();
  const scanResults = await scanHomeDefaults(input.platform, homeRoot);
  const persisted = persistScanResults(scanResults, {
    conflictPolicy: input.conflictPolicy,
    originRef: homeRoot,
  });
  const layer = createNewProfileLayer({
    name: input.name,
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
  });

  for (const resource of persisted.resolved) {
    addResourceToLayer(layer.id, resource.id);
  }

  return {
    layer,
    imported_count: persisted.resolved.length,
    resources: persisted.resolved,
  };
}
