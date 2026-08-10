import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { getPlugin } from "../models/plugin-model.js";
import { assertPluginsCleanForShare } from "./plugin-versioning.js";
import {
  buildApPackageFiles,
  writeApPackageFiles,
  type ApPackageFiles,
  type BuildApPackageOptions,
} from "./agent-plugins/files.js";
import {
  isApEnvelopePath,
  writeApEnvelope,
} from "./agent-plugins/envelope.js";
import { slugifyApName } from "./agent-plugins/name.js";

export interface ExportPluginOptions extends BuildApPackageOptions {
  /** @deprecated Embedding is handled by the AP package builder. */
  embedPlugins?: boolean;
  projectRoot?: string;
  homeRoot?: string;
  /** Write a single-file `.ap.json` envelope instead of a package directory. */
  singleFile?: boolean;
}

type ExportPluginSelector = string | string[];

/**
 * Build an Agent Plugins package file map for one plugin.
 */
export function exportPlugin(
  pluginNameOrId: ExportPluginSelector,
  exportOpts?: ExportPluginOptions,
): ApPackageFiles {
  if (Array.isArray(pluginNameOrId) && pluginNameOrId.length !== 1) {
    throw new Error(
      "Multi-plugin exports are no longer supported. Export each plugin as its own Agent Plugins package.",
    );
  }
  const selector = Array.isArray(pluginNameOrId) ? pluginNameOrId[0] : pluginNameOrId;
  if (!selector) throw new Error("Plugin selector is required");
  const plugin = getPlugin(selector);
  if (!plugin) throw new Error(`Plugin not found: ${selector}`);
  assertPluginsCleanForShare([plugin]);
  return buildApPackageFiles(plugin.id, {
    skillSourceRoot: exportOpts?.skillSourceRoot ?? exportOpts?.projectRoot,
  });
}

/**
 * Write a plugin as an Agent Plugins package directory or `.ap.json` envelope.
 */
export function exportToFile(
  pluginNameOrId: ExportPluginSelector,
  filePath: string,
  exportOpts?: ExportPluginOptions,
): void {
  const files = exportPlugin(pluginNameOrId, exportOpts);
  const target = resolve(filePath);
  const singleFile =
    exportOpts?.singleFile === true ||
    isApEnvelopePath(target) ||
    basename(target).endsWith(".ap.json");

  if (singleFile) {
    writeApEnvelope(files, target);
    return;
  }

  if (existsSync(target) && statSync(target).isFile()) {
    throw new Error(
      `Refusing to overwrite file ${target} with a package directory. Pass --single-file or a .ap.json path.`,
    );
  }

  writeApPackageFiles(files, target);
}

export function defaultPackageOutputPath(pluginName: string, singleFile = false): string {
  const slug = slugifyApName(pluginName);
  return singleFile ? `./${slug}.ap.json` : `./${slug}`;
}
