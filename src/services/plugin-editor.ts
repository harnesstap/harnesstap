import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import type { Plugin } from "../types.js";
import { exportToFile } from "./plugin-export.js";
import { slugifyApName } from "./agent-plugins/name.js";

export function resolvePluginDefinitionPath(plugin: Pick<Plugin, "name" | "version">): string {
  return join(
    getHarnesstapDir(),
    "plugins",
    `${slugifyApName(plugin.name)}@${plugin.version}.ap.json`,
  );
}

export function exportPluginDefinition(
  plugin: Pick<Plugin, "id" | "name" | "version">,
  filePath?: string,
): string {
  const definitionPath = filePath ?? resolvePluginDefinitionPath(plugin);
  mkdirSync(dirname(definitionPath), { recursive: true });
  exportToFile(plugin.id, definitionPath, { singleFile: true });
  return definitionPath;
}
