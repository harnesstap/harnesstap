import {
  createPreset,
  addResourceToPreset,
  getPreset,
  getPresetResources,
  deletePreset,
} from "../models/preset.js";
import { scanAndPersist } from "./scanner.js";
import type { Preset, Resource } from "../types.js";

export interface PresetFromProjectResult {
  preset: Preset;
  resources: Resource[];
  imported_count: number;
}

export interface ConflictInfo {
  existingResource: Resource;
  newContent: string;
  newDescription?: string;
}

export interface PresetFromProjectPreview {
  presetExists: boolean;
  existingPreset?: Preset;
  newResources: Resource[];
  conflicts: ConflictInfo[];
  totalImports: number;
}

/**
 * Preview what would happen if we created a preset from a project.
 * Does not modify database.
 */
export async function previewPresetFromProject(input: {
  name: string;
  projectRoot: string;
  platform?: string;
}): Promise<PresetFromProjectPreview> {
  const existingPreset = getPreset(input.name);
  const scannedResources = await scanAndPersist(input.projectRoot, input.platform);
  
  if (!existingPreset) {
    return {
      presetExists: false,
      newResources: scannedResources,
      conflicts: [],
      totalImports: scannedResources.length,
    };
  }

  // Check for conflicts
  const existingResources = getPresetResources(existingPreset.id);
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
    presetExists: true,
    existingPreset,
    newResources,
    conflicts,
    totalImports: scannedResources.length,
  };
}

/**
 * Scan a project and create a preset containing all imported resources.
 * Now supports conflict resolution strategies.
 */
export async function createPresetFromProject(input: {
  name: string;
  description?: string;
  projectRoot: string;
  platform?: string;
  conflictStrategy?: "overwrite" | "skip";
}): Promise<PresetFromProjectResult> {
  const existing = getPreset(input.name);
  
  if (existing && input.conflictStrategy !== "overwrite") {
    throw new Error(`Preset already exists: ${input.name}`);
  }

  const resources = await scanAndPersist(input.projectRoot, input.platform);
  
  let preset: Preset;
  if (existing && input.conflictStrategy === "overwrite") {
    // Delete and recreate preset to avoid complex update logic
    const oldDescription = existing.description;
    deletePreset(existing.id);
    
    preset = createPreset({
      name: input.name,
      description: input.description ?? oldDescription,
    });

    for (const resource of resources) {
      addResourceToPreset(preset.id, resource.id);
    }
  } else {
    // Create new preset
    preset = createPreset({
      name: input.name,
      description: input.description ?? `Inferred from ${input.projectRoot}`,
    });

    for (const resource of resources) {
      addResourceToPreset(preset.id, resource.id);
    }
  }

  const finalized = getPreset(preset.id);
  if (!finalized) {
    throw new Error(`Failed to create preset: ${input.name}`);
  }

  return {
    preset: finalized,
    resources,
    imported_count: resources.length,
  };
}
