import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { getResource } from "../models/resource.js";
import { listMaterializationsForRootPath } from "../models/resource-materialization.js";
import { isPreexistingPath } from "../models/preexisting-path.js";
import type { Resource } from "../types.js";
import { isMergeableHostConfigPath } from "./merged-host-config.js";
import { backupAndRewriteFile } from "./safe-file-removal.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function pluginRegistryKeys(resource: Pick<Resource, "name" | "namespace" | "origin_ref">): string[] {
  const keys = new Set<string>();
  if (resource.origin_ref) {
    keys.add(resource.origin_ref);
  }
  keys.add(resource.name);
  if (resource.namespace) {
    keys.add(`${resource.name}@${resource.namespace}`);
  }
  return [...keys];
}

function matchingRecordKeys(
  record: Record<string, unknown>,
  resource: Pick<Resource, "name" | "namespace" | "origin_ref">,
): string[] {
  const wanted = new Set(pluginRegistryKeys(resource));
  return Object.keys(record).filter((key) => wanted.has(key));
}

function isInstalledPluginsRegistry(obj: Record<string, unknown>): boolean {
  if (!obj.plugins || typeof obj.plugins !== "object" || Array.isArray(obj.plugins)) {
    return false;
  }
  const values = Object.values(obj.plugins as Record<string, unknown>);
  return values.length === 0 || values.every((value) => Array.isArray(value));
}

const MCP_WRAPPERS = ["mcpServers", "mcp_servers", "mcp"] as const;

function stripMcpServer(
  obj: Record<string, unknown>,
  resource: Pick<Resource, "name">,
): Record<string, unknown> | null {
  for (const wrapper of MCP_WRAPPERS) {
    const raw = obj[wrapper];
    if (!isRecord(raw) || !(resource.name in raw)) {
      continue;
    }
    const servers = { ...raw };
    delete servers[resource.name];
    const next = { ...obj };
    if (Object.keys(servers).length === 0) {
      delete next[wrapper];
    } else {
      next[wrapper] = servers;
    }
    return next;
  }
  return null;
}

function stripJsonObject(
  obj: Record<string, unknown>,
  resource: Resource,
): Record<string, unknown> | null {
  const mcpNext = stripMcpServer(obj, resource);
  if (mcpNext) {
    return mcpNext;
  }

  if (isInstalledPluginsRegistry(obj)) {
    const plugins = { ...(obj.plugins as Record<string, unknown>) };
    const keys = matchingRecordKeys(plugins, resource);
    if (keys.length === 0) {
      return null;
    }
    for (const key of keys) {
      delete plugins[key];
    }
    return { ...obj, plugins };
  }

  if (isRecord(obj.enabledPlugins)) {
    const enabled = { ...obj.enabledPlugins };
    const keys = matchingRecordKeys(enabled, resource);
    if (keys.length > 0) {
      for (const key of keys) {
        delete enabled[key];
      }
      const next = { ...obj };
      if (Object.keys(enabled).length === 0) {
        delete next.enabledPlugins;
      } else {
        next.enabledPlugins = enabled;
      }
      return next;
    }
  }

  if (resource.type === "env_var" && isRecord(obj.env) && resource.name in obj.env) {
    const env = { ...obj.env };
    delete env[resource.name];
    const next = { ...obj };
    if (Object.keys(env).length === 0) {
      delete next.env;
    } else {
      next.env = env;
    }
    return next;
  }

  if (resource.name in obj && (resource.type === "mcp_server" || resource.type === "plugin")) {
    const next = { ...obj };
    delete next[resource.name];
    return next;
  }

  return null;
}

export function tryEditAggregateContent(
  content: string,
  resource: Resource,
): { ok: true; content: string; emptied: boolean } | { ok: false; reason: string } {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(content);
      if (!isRecord(parsed)) {
        return { ok: false, reason: "Shared file section cannot be identified" };
      }
      const next = stripJsonObject(parsed, resource);
      if (!next) {
        return { ok: false, reason: "Shared file section cannot be identified" };
      }
      return {
        ok: true,
        content: `${JSON.stringify(next, null, 2)}\n`,
        emptied: Object.keys(next).length === 0,
      };
    } catch {
      return { ok: false, reason: "Shared file section cannot be identified" };
    }
  }

  try {
    const parsed: unknown = parseToml(content);
    if (!isRecord(parsed)) {
      return { ok: false, reason: "Shared file section cannot be identified" };
    }
    const next = stripJsonObject(parsed, resource);
    if (!next) {
      return { ok: false, reason: "Shared file section cannot be identified" };
    }
    return {
      ok: true,
      content: `${stringifyToml(next)}\n`,
      emptied: Object.keys(next).length === 0,
    };
  } catch {
    return { ok: false, reason: "Shared file section cannot be identified" };
  }
}

export interface HostConfigRewriteResult {
  rewritten: string[];
  removed: string[];
  skipped: string[];
}

/**
 * Remove HarnessTap-owned keys/servers from shared config files. Instruction
 * files and preexisting configs are left on disk. The file is deleted only when
 * it is empty, HarnessTap created it, and no keys remain.
 */
export function rewriteStaleMergeableHostConfigs(
  rootPath: string,
  relativePaths: readonly string[],
  options: {
    applyId: string;
    snapshotId?: string | null;
    dryRun?: boolean;
  },
): HostConfigRewriteResult {
  const rewritten: string[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];

  for (const relativePath of [...new Set(relativePaths)]) {
    if (isMergeableHostConfigPath(relativePath) && /\.(md|mdc)$/i.test(relativePath)) {
      skipped.push(relativePath);
      continue;
    }
    const fullPath = resolve(rootPath, relativePath);
    if (!existsSync(fullPath)) {
      skipped.push(relativePath);
      continue;
    }
    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      skipped.push(relativePath);
      continue;
    }

    const rows = listMaterializationsForRootPath(rootPath, relativePath);
    let next = content;
    let emptied = false;
    let changed = false;
    for (const row of rows) {
      const resource = getResource(row.resource_id);
      if (!resource) {
        continue;
      }
      const edit = tryEditAggregateContent(next, resource);
      if (!edit.ok) {
        continue;
      }
      next = edit.content;
      emptied = edit.emptied;
      changed = true;
    }

    if (!changed) {
      skipped.push(relativePath);
      continue;
    }

    const preexisting = isPreexistingPath(rootPath, relativePath);
    if (emptied && !preexisting) {
      if (!options.dryRun) {
        backupAndRewriteFile({
          rootPath,
          relativePath,
          nextContent: null,
          applyId: options.applyId,
          snapshotId: options.snapshotId,
        });
      }
      removed.push(relativePath);
      continue;
    }

    if (!options.dryRun) {
      backupAndRewriteFile({
        rootPath,
        relativePath,
        nextContent: next,
        applyId: options.applyId,
        snapshotId: options.snapshotId,
      });
    }
    rewritten.push(relativePath);
  }

  return { rewritten, removed, skipped };
}
