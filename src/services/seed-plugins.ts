import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlugin } from "../models/plugin-model.js";
import { importFromFile } from "./plugin-import.js";
import { inspectPluginExportFile } from "./plugin-export.js";

function normalizePluginVersion(version: string | undefined): string {
  return typeof version === "string" && version.length > 0 ? version : "";
}

function pluginKey(name: string, version: string | undefined): string {
  return `${name}\u0000${normalizePluginVersion(version)}`;
}

function hasPluginInstalled(name: string, version: string | undefined): boolean {
  const normalizedVersion = normalizePluginVersion(version);
  return normalizedVersion.length > 0
    ? getPlugin(`${name}@${normalizedVersion}`) !== undefined
    : getPlugin(name) !== undefined;
}

function getBuiltInPluginsDir(): string {
  const overrideDir =
    process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR ??
    process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR;
  if (overrideDir && existsSync(overrideDir)) {
    return overrideDir;
  }

  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const candidates = [
    join(currentDir, "..", "builtin-plugins"),
    join(currentDir, "..", "..", "builtin-plugins"),
    join(process.cwd(), "builtin-plugins"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const [firstCandidate] = candidates;
  if (!firstCandidate) {
    throw new Error("No built-in plugins directories configured");
  }

  return firstCandidate;
}

export function seedBuiltInPlugins(): number {
  const pluginsDir = getBuiltInPluginsDir();
  if (!existsSync(pluginsDir)) return 0;

  let seeded = 0;

  for (const file of readdirSync(pluginsDir)) {
    if (!file.endsWith(".toml")) continue;

    const filePath = join(pluginsDir, file);
    const summary = inspectPluginExportFile(filePath);
    const missingPluginKeys = new Set(
      summary.plugins
        .filter((plugin) => !hasPluginInstalled(plugin.name, plugin.version))
        .map((plugin) => pluginKey(plugin.name, plugin.version)),
    );
    if (missingPluginKeys.size === 0) continue;

    importFromFile(filePath, {
      resourceSource: `builtin:${file}`,
      includePlugins: (plugin) =>
        missingPluginKeys.has(pluginKey(plugin.name, plugin.version)),
    });
    seeded++;
  }

  return seeded;
}

/** @deprecated Use seedBuiltInPlugins */
export const seedBuiltInLayers = seedBuiltInPlugins;
