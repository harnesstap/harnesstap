import { readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlugin } from "../models/plugin-model.js";
import { importFromFile, inspectPluginExportFile } from "./plugin-import.js";
import { isApEnvelopePath } from "./agent-plugins/envelope.js";

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

function listBuiltinPackagePaths(pluginsDir: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(pluginsDir)) {
    const fullPath = join(pluginsDir, entry);
    if (isApEnvelopePath(fullPath)) {
      paths.push(fullPath);
      continue;
    }
    try {
      if (statSync(fullPath).isDirectory() && existsSync(join(fullPath, "plugin.json"))) {
        paths.push(fullPath);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return paths.sort();
}

export function seedBuiltInPlugins(): number {
  const pluginsDir = getBuiltInPluginsDir();
  if (!existsSync(pluginsDir)) return 0;

  let seeded = 0;

  for (const filePath of listBuiltinPackagePaths(pluginsDir)) {
    const summary = inspectPluginExportFile(filePath);
    const missingPluginKeys = new Set(
      summary.plugins
        .filter((plugin) => !hasPluginInstalled(plugin.name, plugin.version))
        .map((plugin) => pluginKey(plugin.name, plugin.version)),
    );
    if (missingPluginKeys.size === 0) continue;

    importFromFile(filePath, {
      resourceSource: `builtin:${filePath}`,
    });
    seeded++;
  }

  return seeded;
}

/** @deprecated Use seedBuiltInPlugins */
export const seedBuiltInLayers = seedBuiltInPlugins;
