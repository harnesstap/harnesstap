import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getPluginResources } from "../models/plugin-model.js";
import type { Plugin, Resource } from "../types.js";
import {
  importApPackageFiles,
  type ImportApPackageOptions,
  parseApPackageFiles,
} from "./agent-plugins/import.js";
import {
  isApEnvelopePath,
  readApEnvelope,
} from "./agent-plugins/envelope.js";
import { readApPackageFiles, type ApPackageFiles } from "./agent-plugins/files.js";
import {
  isLegacyTomlTransportPath,
  legacyTomlTransportRejection,
} from "./legacy-toml-transport.js";

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

function rejectLegacyToml(filePath: string): void {
  if (isLegacyTomlTransportPath(filePath)) {
    throw new Error(legacyTomlTransportRejection(filePath));
  }
}

export function readPackageFilesFromPath(filePath: string): ApPackageFiles {
  const resolved = resolve(filePath);
  rejectLegacyToml(resolved);

  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    if (!existsSync(join(resolved, "plugin.json"))) {
      throw new Error(
        `${resolved} is a directory but has no plugin.json — expected an Agent Plugins package.`,
      );
    }
    return readApPackageFiles(resolved);
  }

  if (isApEnvelopePath(resolved)) {
    return readApEnvelope(resolved);
  }

  throw new Error(
    `Cannot tell what ${resolved} is. Pass an Agent Plugins package directory or an .ap.json envelope.`,
  );
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
