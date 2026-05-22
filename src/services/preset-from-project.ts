import {
  createPreset,
  addResourceToPreset,
  getPreset,
} from "../models/preset.js";
import { scanAndPersist } from "./scanner.js";
import type { Preset, Resource } from "../types.js";

export interface PresetFromProjectResult {
  preset: Preset;
  resources: Resource[];
  imported_count: number;
}

/**
 * Scan a project and create a preset containing all imported resources.
 */
export async function createPresetFromProject(input: {
  name: string;
  description?: string;
  projectRoot: string;
  platform?: string;
}): Promise<PresetFromProjectResult> {
  const existing = getPreset(input.name);
  if (existing) {
    throw new Error(`Preset already exists: ${input.name}`);
  }

  const resources = await scanAndPersist(input.projectRoot, input.platform);
  const preset = createPreset({
    name: input.name,
    description: input.description ?? `Inferred from ${input.projectRoot}`,
  });

  for (const resource of resources) {
    addResourceToPreset(preset.id, resource.id);
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
