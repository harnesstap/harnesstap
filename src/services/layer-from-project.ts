import {
  createLayer,
  addResourceToLayer,
  getLayer,
  getLayerResources,
  deleteLayer,
} from "../models/layer.js";
import { scanAndPersist } from "./scanner.js";
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
  const scannedResources = await scanAndPersist(input.projectRoot, input.platform);
  
  if (!existingLayer) {
    return {
      layerExists: false,
      newResources: scannedResources,
      conflicts: [],
      totalImports: scannedResources.length,
    };
  }

  // Check for conflicts
  const existingResources = getLayerResources(existingLayer.id);
  const conflicts: ConflictInfo[] = [];
  const newResources: Resource[] = [];

  for (const scanned of scannedResources) {
    const existing = existingResources.find(r => r.name === scanned.name && r.type === scanned.type);
    if (existing && existing.content !== scanned.content) {
      conflicts.push({
        existingResource: existing,
        newContent: scanned.content,
        newDescription: scanned.description,
      });
    } else if (!existing) {
      newResources.push(scanned);
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

  const resources = await scanAndPersist(input.projectRoot, input.platform);
  
  let layer: Layer;
  if (existing && input.conflictStrategy === "overwrite") {
    // Delete and recreate layer to avoid complex update logic
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
    // Create new layer
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
