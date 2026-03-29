import { readFileSync, writeFileSync } from "node:fs";
import { getPreset, getPresetResources, createPreset, addResourceToPreset } from "../models/preset.js";
import { createResource } from "../models/resource.js";
import type { ExportBundle, Preset, Resource } from "../types.js";

const BUNDLE_SCHEMA = "https://skillset.dev/bundle-v1.json";
const BUNDLE_VERSION = 1;

/**
 * Export a preset and its resources as a portable JSON bundle.
 */
export function exportPreset(presetNameOrId: string): ExportBundle {
  const preset = getPreset(presetNameOrId);
  if (!preset) throw new Error(`Preset not found: ${presetNameOrId}`);

  const resources = getPresetResources(preset.id);

  return {
    $schema: BUNDLE_SCHEMA,
    version: BUNDLE_VERSION,
    preset: {
      name: preset.name,
      description: preset.description,
      tags: preset.tags,
      is_template: preset.is_template,
    },
    resources: resources.map((r) => ({
      type: r.type,
      name: r.name,
      description: r.description,
      content: r.content,
      metadata: r.metadata,
    })),
  };
}

/**
 * Write a bundle to a file.
 */
export function exportToFile(presetNameOrId: string, filePath: string): void {
  const bundle = exportPreset(presetNameOrId);
  writeFileSync(filePath, JSON.stringify(bundle, null, 2), "utf-8");
}

/**
 * Import a bundle from a file, creating the preset and resources.
 */
export function importFromFile(filePath: string): { preset: Preset; resources: Resource[] } {
  const raw = readFileSync(filePath, "utf-8");
  const bundle = JSON.parse(raw) as ExportBundle;

  if (bundle.version !== BUNDLE_VERSION) {
    throw new Error(`Unsupported bundle version: ${bundle.version}`);
  }

  // Create the preset
  const preset = createPreset({
    name: bundle.preset.name,
    description: bundle.preset.description,
    tags: bundle.preset.tags,
    is_template: bundle.preset.is_template,
  });

  // Create resources and add them to the preset
  const resources: Resource[] = [];
  for (const r of bundle.resources) {
    const resource = createResource({
      type: r.type,
      name: r.name,
      description: r.description,
      content: r.content,
      metadata: r.metadata,
      source: `import:${filePath}`,
    });
    addResourceToPreset(preset.id, resource.id);
    resources.push(resource);
  }

  return { preset, resources };
}
