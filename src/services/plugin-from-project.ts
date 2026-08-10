import {
  createPlugin,
  addResourceToPlugin,
  getPlugin,
  getPluginResources,
  deletePlugin,
} from "../models/plugin-model.js";
import {
  scanProjectWithPluginSource,
  persistMergedProjectScan,
} from "./scanner.js";
import type { Plugin, Resource } from "../types.js";

export interface PluginFromProjectResult {
  plugin: Plugin;
  resources: Resource[];
  imported_count: number;
}

export interface ConflictInfo {
  existingResource: Resource;
  newContent: string;
  newDescription?: string;
}

export interface PluginFromProjectPreview {
  pluginExists: boolean;
  existingPlugin?: Plugin;
  newResources: Resource[];
  conflicts: ConflictInfo[];
  totalImports: number;
}

/**
 * Preview what would happen if we created a plugin from a project.
 * Does not modify database.
 */
export async function previewPluginFromProject(input: {
  name: string;
  projectRoot: string;
  platform?: string;
}): Promise<PluginFromProjectPreview> {
  const existingPlugin = getPlugin(input.name);
  const { harness, plugin } = await scanProjectWithPluginSource(
    input.projectRoot,
    input.platform,
  );
  const scannedResources = [
    ...harness.flatMap((result) => result.resources),
    ...plugin.flatMap((result) => result.resources),
  ];

  if (!existingPlugin) {
    return {
      pluginExists: false,
      newResources: scannedResources as Resource[],
      conflicts: [],
      totalImports: scannedResources.length,
    };
  }

  const existingResources = getPluginResources(existingPlugin.id);
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
    pluginExists: true,
    existingPlugin,
    newResources,
    conflicts,
    totalImports: scannedResources.length,
  };
}

/**
 * Scan a project and create a plugin containing all imported resources.
 * Now supports conflict resolution strategies.
 */
export async function createPluginFromProject(input: {
  name: string;
  description?: string;
  projectRoot: string;
  platform?: string;
  conflictStrategy?: "overwrite" | "skip";
}): Promise<PluginFromProjectResult> {
  const existing = getPlugin(input.name);

  if (existing && input.conflictStrategy !== "overwrite") {
    throw new Error(`Plugin already exists: ${input.name}`);
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

  let plugin: Plugin;
  if (existing && input.conflictStrategy === "overwrite") {
    const oldDescription = existing.description;
    deletePlugin(existing.id);

    plugin = createPlugin({
      name: input.name,
      description: input.description ?? oldDescription,
    });

    for (const resource of resources) {
      addResourceToPlugin(plugin.id, resource.id);
    }
  } else {
    plugin = createPlugin({
      name: input.name,
      description: input.description ?? `Inferred from ${input.projectRoot}`,
    });

    for (const resource of resources) {
      addResourceToPlugin(plugin.id, resource.id);
    }
  }

  const finalized = getPlugin(plugin.id);
  if (!finalized) {
    throw new Error(`Failed to create plugin: ${input.name}`);
  }

  return {
    plugin: finalized,
    resources,
    imported_count: resources.length,
  };
}
