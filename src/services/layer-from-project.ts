import {
  createLayer,
  addResourceToLayer,
  getLayer,
  getLayerResources,
  deleteLayer,
} from "../models/plugin-model.js";
import {
  scanProjectWithPluginSource,
  persistMergedProjectScan,
} from "./scanner.js";
import type { Layer, Resource } from "../types.js";

export interface LayerFromProjectResult {
  layer: Layer;
  resources: Resource[];
  imported_count: number;
}

export interface ConflictInfo {
  existingResource: Resource;
  newContent: string;
  newDescription?: string;
}

export interface LayerFromProjectPreview {
  layerExists: boolean;
  existingLayer?: Layer;
  newResources: Resource[];
  conflicts: ConflictInfo[];
  totalImports: number;
}

/**
 * Preview what would happen if we created a layer from a project.
 * Does not modify database.
 */
export async function previewLayerFromProject(input: {
  name: string;
  projectRoot: string;
  platform?: string;
}): Promise<LayerFromProjectPreview> {
  const existingLayer = getLayer(input.name);
  const { harness, plugin } = await scanProjectWithPluginSource(
    input.projectRoot,
    input.platform,
  );
  const scannedResources = [
    ...harness.flatMap((result) => result.resources),
    ...plugin.flatMap((result) => result.resources),
  ];

  if (!existingLayer) {
    return {
      layerExists: false,
      newResources: scannedResources as Resource[],
      conflicts: [],
      totalImports: scannedResources.length,
    };
  }

  const existingResources = getLayerResources(existingLayer.id);
  const conflicts: ConflictInfo[] = [];
  const newResources: Resource[] = [];

  for (const scanned of scannedResources) {
    const existing = existingResources.find(
      (resource) => resource.name === scanned.name && resource.type === scanned.type,
    );
    if (existing && existing.content !== scanned.content) {
      conflicts.push({
        existingResource: existing,
        newContent: scanned.content,
        newDescription: scanned.description,
      });
    } else if (!existing) {
      newResources.push(scanned as Resource);
    }
  }

  return {
    layerExists: true,
    existingLayer,
    newResources,
    conflicts,
    totalImports: scannedResources.length,
  };
}

/**
 * Scan a project and create a layer containing all imported resources.
 * Now supports conflict resolution strategies.
 */
export async function createLayerFromProject(input: {
  name: string;
  description?: string;
  projectRoot: string;
  platform?: string;
  conflictStrategy?: "overwrite" | "skip";
}): Promise<LayerFromProjectResult> {
  const existing = getLayer(input.name);

  if (existing && input.conflictStrategy !== "overwrite") {
    throw new Error(`Layer already exists: ${input.name}`);
  }

  const namespace =
    existing && input.conflictStrategy === "overwrite" ? "" : input.name;
  const resources = (
    await persistMergedProjectScan(input.projectRoot, input.platform, {
      conflictPolicy: input.conflictStrategy === "skip" ? "skip" : "overwrite",
      originRef: input.projectRoot,
      namespace,
    })
  ).resources;

  let layer: Layer;
  if (existing && input.conflictStrategy === "overwrite") {
    const oldDescription = existing.description;
    deleteLayer(existing.id);

    layer = createLayer({
      name: input.name,
      description: input.description ?? oldDescription,
    });

    for (const resource of resources) {
      addResourceToLayer(layer.id, resource.id);
    }
  } else {
    layer = createLayer({
      name: input.name,
      description: input.description ?? `Inferred from ${input.projectRoot}`,
    });

    for (const resource of resources) {
      addResourceToLayer(layer.id, resource.id);
    }
  }

  const finalized = getLayer(layer.id);
  if (!finalized) {
    throw new Error(`Failed to create layer: ${input.name}`);
  }

  return {
    layer: finalized,
    resources,
    imported_count: resources.length,
  };
}
