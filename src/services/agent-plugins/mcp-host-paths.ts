import { isAbsolute, relative, resolve } from "node:path";
import type { McpServerMetadata, Resource } from "../../types.js";
import { ensurePluginDataDir } from "../plugin-data-dir.js";
import { installedPluginForResource } from "./install-root.js";
import { translateMcpMetadata } from "./plugin-vars.js";

export interface ResolvedMcpResources {
  resources: Resource[];
  warnings: string[];
}

/**
 * Resolve a `./` path against the plugin root as one token.
 * Splitting on spaces would turn `probe token.sh` into two arguments.
 * A path that leaves the root is left unchanged.
 */
export function resolvePluginRelativePath(value: string, root: string): string {
  if (!value.startsWith("./")) return value;
  const parts = value.slice(2).split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    return value;
  }
  const absolute = resolve(root, ...parts);
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) return value;
  return absolute;
}

function resolveMetadata(metadata: McpServerMetadata, root: string, dataDir: string): McpServerMetadata {
  const translated = translateMcpMetadata(metadata, "absolute", { root, dataDir });
  return {
    ...translated,
    ...(translated.command !== undefined
      ? { command: resolvePluginRelativePath(translated.command, root) }
      : {}),
    ...(translated.cwd !== undefined
      ? { cwd: resolvePluginRelativePath(translated.cwd, root) }
      : {}),
  };
}

/**
 * Copy MCP metadata for host configs. The library resource is not modified.
 * Plugins without an installed package keep their literal placeholders.
 */
export function resolveInstalledMcpResources(resources: readonly Resource[]): ResolvedMcpResources {
  const warnings: string[] = [];
  const warnedDataDirs = new Set<string>();
  const resourcesOut = resources.map((resource) => {
    if (resource.type !== "mcp_server") return resource;
    const installed = installedPluginForResource(resource.id);
    if (!installed) return resource;
    const data = ensurePluginDataDir(installed.name);
    if (data.warning && !warnedDataDirs.has(installed.name)) {
      warnedDataDirs.add(installed.name);
      warnings.push(data.warning);
    }
    return {
      ...resource,
      metadata: resolveMetadata(resource.metadata as McpServerMetadata, installed.path, data.path),
    };
  });
  return { resources: resourcesOut, warnings };
}
