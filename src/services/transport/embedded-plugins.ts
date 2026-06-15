import type { LayerExportEmbeddedPlugin } from "../../types.js";
import { sortStringRecord } from "./sort.js";

export interface TomlEmbeddedPluginRecord {
  ref: string;
  version_constraint: string;
  root: string;
  files: Record<string, string>;
}

export function embeddedPluginsToTomlRecord(
  plugins: LayerExportEmbeddedPlugin[],
): Record<string, TomlEmbeddedPluginRecord> {
  const record: Record<string, TomlEmbeddedPluginRecord> = {};
  for (const plugin of [...plugins].sort((left, right) =>
    left.ref.localeCompare(right.ref),
  )) {
    record[plugin.ref] = {
      ref: plugin.ref,
      version_constraint: plugin.version_constraint,
      root: plugin.root,
      files: sortStringRecord(plugin.files),
    };
  }
  return record;
}

export function embeddedPluginsFromTomlRecord(
  record: unknown,
): LayerExportEmbeddedPlugin[] {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return [];
  }

  const plugins: LayerExportEmbeddedPlugin[] = [];
  for (const entry of Object.values(record as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const plugin = entry as Record<string, unknown>;
    const ref = typeof plugin.ref === "string" ? plugin.ref : "";
    const versionConstraint =
      typeof plugin.version_constraint === "string"
        ? plugin.version_constraint
        : "*";
    const root = typeof plugin.root === "string" ? plugin.root : "";
    const filesRaw = plugin.files;
    const files: Record<string, string> = {};
    if (filesRaw && typeof filesRaw === "object" && !Array.isArray(filesRaw)) {
      for (const [path, content] of Object.entries(
        filesRaw as Record<string, unknown>,
      )) {
        if (typeof content === "string") {
          files[path] = content;
        }
      }
    }
    if (!ref) {
      continue;
    }
    plugins.push({
      ref,
      version_constraint: versionConstraint,
      root,
      files,
    });
  }

  return plugins.sort((left, right) => left.ref.localeCompare(right.ref));
}
