import { getPluginResources } from "../models/plugin-model.js";
import type { Plugin, Resource } from "../types.js";
import {
  importApPackageFiles,
  type ImportApPackageOptions,
  parseApPackageFiles,
} from "./agent-plugins/import.js";
import type { ApPackageFiles } from "./agent-plugins/files.js";
import { loadVerifiedPackageFiles } from "./apm-bundle.js";

export interface ImportPluginOptions {
  /** Override the imported plugin name. */
  pluginNameOverride?: string;
  /** Override the resource source label recorded on imported resources. */
  resourceSource?: string;
  /** @deprecated Embedded plugins are handled inside AP packages. */
  embeddedTargetDir?: string;
}

export interface ImportedPluginBundleEntry {
  plugin: Plugin;
  resources: Resource[];
}

export interface ImportedPluginBundle {
  plugin: Plugin;
  resources: Resource[];
  plugins: ImportedPluginBundleEntry[];
}

export interface ParsedPluginExportSummary {
  plugins: Array<{ name: string; version: string; description: string }>;
  multiPlugin: boolean;
}

export function readPackageFilesFromPath(filePath: string): ApPackageFiles {
  return loadVerifiedPackageFiles(filePath);
}

export function inspectPluginExportFile(filePath: string): ParsedPluginExportSummary {
  const parsed = parseApPackageFiles(readPackageFilesFromPath(filePath));
  return {
    plugins: [
      {
        name: parsed.sourceName,
        version: parsed.version,
        description: parsed.description,
      },
    ],
    multiPlugin: false,
  };
}

/**
 * Import a package from a directory or `.ap.json` envelope.
 */
export function importFromFile(
  filePath: string,
  opts?: ImportPluginOptions,
): ImportedPluginBundle {
  const files = readPackageFilesFromPath(filePath);
  const importOpts: ImportApPackageOptions = {
    ...(opts?.pluginNameOverride ? { as: opts.pluginNameOverride } : {}),
  };
  const plugin = importApPackageFiles(files, importOpts);
  const resources = getPluginResources(plugin.id);
  const entry = { plugin, resources };
  return {
    plugin,
    resources,
    plugins: [entry],
  };
}
