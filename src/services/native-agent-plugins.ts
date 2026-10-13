import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { loadSettings } from "../config/settings.js";
import { getHarnesstapDir, harnesstapDirForHomeRoot } from "../db/connection.js";
import type { McpServerMetadata, Resource, SerializedFile, SurfaceWarning } from "../types.js";
import { AP_SCHEMA_URL } from "./agent-plugins/schema-registry.js";
import { buildSpecMcpJson, formatSpecMcpJson } from "./agent-plugins/spec-mcp.js";
import {
  applyJsonObjectUpdatePreservingFormat,
  applyTomlObjectUpdatePreservingFormat,
  parseJsonObject,
} from "./format-preserving-config.js";

const NATIVE_PLATFORMS = new Set(["codex", "copilot-cli"]);
const EXTRACTED_TYPES = new Set(["skill", "command", "agent", "mcp_server", "hook"]);
const CACHE_RELATIVE = ".harnesstap/cache/native-agent-plugins";

interface AgentPluginGroup {
  pluginName: string;
  resources: Resource[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nativeAgentPluginsEnabled(): boolean {
  try {
    return loadSettings(getHarnesstapDir()).harnessSync.nativeAgentPlugins === true;
  } catch {
    return false;
  }
}

export function isNativeAgentPluginPlatform(platformId: string): boolean {
  return NATIVE_PLATFORMS.has(platformId);
}

function provenancePluginName(resource: Resource): string | undefined {
  const imported = (resource.metadata as { imported_from?: unknown }).imported_from;
  if (!isRecord(imported)) return undefined;
  if (imported.source_plugin_kind !== "agent-plugin") return undefined;
  const name = imported.plugin_name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : undefined;
}

function safePluginDir(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 128) : "plugin";
}

export function splitNativeAgentPluginExtract(resources: readonly Resource[]): {
  kept: Resource[];
  groups: AgentPluginGroup[];
} {
  const groups = new Map<string, Resource[]>();
  const kept: Resource[] = [];
  for (const resource of resources) {
    const pluginName = provenancePluginName(resource);
    if (!pluginName || !EXTRACTED_TYPES.has(resource.type)) {
      kept.push(resource);
      continue;
    }
    const list = groups.get(pluginName) ?? [];
    list.push(resource);
    groups.set(pluginName, list);
  }
  return {
    kept,
    groups: [...groups.entries()].map(([pluginName, grouped]) => ({
      pluginName,
      resources: grouped,
    })),
  };
}

function pluginJson(name: string): string {
  return `${JSON.stringify({
    $schema: AP_SCHEMA_URL,
    name,
    version: "0.0.0",
    description: name,
  }, null, 2)}\n`;
}

function skillFile(resource: Resource): string {
  const description = resource.description.trim() || resource.name;
  return `---\nname: ${resource.name}\ndescription: ${description}\n---\n\n${resource.content}\n`;
}

function packageFiles(group: AgentPluginGroup): SerializedFile[] {
  const dir = `${CACHE_RELATIVE}/plugins/${safePluginDir(group.pluginName)}`;
  const files: SerializedFile[] = [
    { path: `${dir}/plugin.json`, content: pluginJson(group.pluginName) },
  ];
  for (const resource of group.resources) {
    if (resource.type === "skill") {
      files.push({
        path: `${dir}/skills/${resource.name}/SKILL.md`,
        content: skillFile(resource),
      });
    }
  }
  const servers: Record<string, McpServerMetadata> = {};
  for (const resource of group.resources) {
    if (resource.type !== "mcp_server") continue;
    servers[resource.name] = resource.metadata as McpServerMetadata;
  }
  if (Object.keys(servers).length > 0) {
    const built = buildSpecMcpJson(servers);
    files.push({ path: `${dir}/mcp.json`, content: formatSpecMcpJson(built.document) });
  }
  return files;
}

function marketplaceFile(groups: readonly AgentPluginGroup[]): SerializedFile {
  return {
    path: `${CACHE_RELATIVE}/.agents/plugins/marketplace.json`,
    content: `${JSON.stringify({
      name: "harnesstap",
      plugins: groups.map((group) => ({
        name: group.pluginName,
        source: {
          source: "local",
          path: `./plugins/${safePluginDir(group.pluginName)}`,
        },
      })),
    }, null, 2)}\n`,
  };
}

function readExisting(applyRoot: string, files: readonly SerializedFile[], path: string): string | undefined {
  const generated = files.find((file) => file.path === path)?.content;
  if (generated !== undefined) return generated;
  const absolute = join(applyRoot, path);
  if (!existsSync(absolute)) return undefined;
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return undefined;
  }
}

function codexConfig(
  applyRoot: string,
  files: readonly SerializedFile[],
  groups: readonly AgentPluginGroup[],
): SerializedFile | undefined {
  const path = ".codex/config.toml";
  const existingRaw = readExisting(applyRoot, files, path);
  let existing: Record<string, unknown> = {};
  if (existingRaw && existingRaw.trim().length > 0) {
    try {
      const parsed = parseToml(existingRaw);
      if (!isRecord(parsed)) return undefined;
      existing = parsed;
    } catch {
      return undefined;
    }
  }
  const plugins = isRecord(existing.plugins) ? { ...existing.plugins } : {};
  const managed = new Set(groups.map((group) => `${group.pluginName}@harnesstap`));
  for (const key of Object.keys(plugins)) {
    if (key.endsWith("@harnesstap") && !managed.has(key)) {
      delete plugins[key];
    }
  }
  const cacheRoot = harnesstapDirForHomeRoot(applyRoot);
  for (const group of groups) {
    const key = `${group.pluginName}@harnesstap`;
    const previous = isRecord(plugins[key]) ? plugins[key] : {};
    plugins[key] = {
      ...previous,
      enabled: true,
      source: join(cacheRoot, "cache", "native-agent-plugins", "plugins", safePluginDir(group.pluginName)),
    };
  }
  if (groups.length === 0 && existingRaw === undefined) return undefined;
  const next = { ...existing, plugins };
  const content = existingRaw
    ? applyTomlObjectUpdatePreservingFormat(existingRaw, next)
    : applyTomlObjectUpdatePreservingFormat("", next);
  return { path, content };
}

function copilotSettings(
  applyRoot: string,
  files: readonly SerializedFile[],
  groups: readonly AgentPluginGroup[],
): SerializedFile | undefined {
  const path = ".copilot/settings.json";
  const existingRaw = readExisting(applyRoot, files, path);
  const existing = existingRaw ? parseJsonObject(existingRaw) : {};
  if (existingRaw && !existing) return undefined;
  const enabled = isRecord(existing?.enabledPlugins) ? { ...existing.enabledPlugins } : {};
  const managed = new Set(groups.map((group) => `${group.pluginName}@harnesstap`));
  for (const key of Object.keys(enabled)) {
    if (key.endsWith("@harnesstap") && !managed.has(key)) {
      delete enabled[key];
    }
  }
  for (const group of groups) {
    enabled[`${group.pluginName}@harnesstap`] = true;
  }
  if (groups.length === 0 && !existingRaw) return undefined;
  const next = { ...(existing ?? {}), enabledPlugins: enabled };
  const content = existingRaw
    ? applyJsonObjectUpdatePreservingFormat(existingRaw, next)
    : applyJsonObjectUpdatePreservingFormat("", next);
  return { path, content };
}

export function nativeAgentPluginFiles(input: {
  platformId: string;
  applyRoot: string;
  groups: readonly AgentPluginGroup[];
  files: readonly SerializedFile[];
}): { files: SerializedFile[]; warnings: SurfaceWarning[] } {
  if (!isNativeAgentPluginPlatform(input.platformId)) {
    return { files: [], warnings: [] };
  }
  const warnings: SurfaceWarning[] = [];
  const packageFilesForGroups = input.groups.flatMap((group) => packageFiles(group));
  const files = [...packageFilesForGroups];
  if (input.groups.length > 0) {
    files.push(marketplaceFile(input.groups));
  }
  const config = input.platformId === "codex"
    ? codexConfig(input.applyRoot, input.files, input.groups)
    : input.platformId === "copilot-cli"
      ? copilotSettings(input.applyRoot, input.files, input.groups)
      : undefined;
  if (config) files.push(config);
  if (input.groups.length > 0) {
    warnings.push({
      harness: input.platformId,
      path: CACHE_RELATIVE,
      category: "native-agent-plugin",
      message:
        "Agent Plugins packages are registered for native loading. Skills and MCP servers from those packages are not also extracted.",
      alias_harnesses: [],
    });
  }
  return { files, warnings };
}

export function mergeNativeAgentPluginFiles(
  serialized: SerializedFile[],
  native: readonly SerializedFile[],
): SerializedFile[] {
  const files = [...serialized];
  for (const file of native) {
    const index = files.findIndex((existing) => existing.path === file.path);
    if (index >= 0) {
      files[index] = file;
      continue;
    }
    files.push(file);
  }
  return files;
}
