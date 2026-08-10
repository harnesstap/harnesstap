import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import type { Plugin } from "../types.js";
import { exportToFile } from "./plugin-export.js";

export function resolvePluginDefinitionPath(plugin: Pick<Plugin, "name" | "version">): string {
  return join(
    getHarnesstapDir(),
    "plugins",
    `${plugin.name}@${plugin.version}.harnesstap.toml`,
  );
}

export function exportPluginDefinition(
  plugin: Pick<Plugin, "id" | "name" | "version">,
  filePath?: string,
): string {
  const definitionPath = filePath ?? resolvePluginDefinitionPath(plugin);
  mkdirSync(dirname(definitionPath), { recursive: true });
  exportToFile(plugin.id, definitionPath);
  return definitionPath;
}
