import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { getDb, getHarnesstapDir } from "../../db/connection.js";
import { getPluginById } from "../../models/plugin-model.js";
import { getResource } from "../../models/resource.js";
import type { Plugin } from "../../types.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import { marketplaceCacheDir } from "../marketplace-catalog.js";
import { resolveCanonicalHostPluginRoot } from "../package-cache/host-plugin.js";
import { parseDependencyRef } from "../plugin-dependency.js";
import {
  gitOriginCacheDir,
  resolveMarketplacePluginDirectory,
} from "../plugin-origin-apply.js";
import { recoverOriginLocator } from "../plugin-origin-locator.js";
import { isPluginInstallRoot } from "../plugin-source-import.js";
import { resolveInstallRoot } from "../resource-sync.js";
import { recordedPluginInstallRoot } from "./install-root.js";

function pluginsForResource(resourceId: string): Plugin[] {
  const rows = getDb()
    .prepare(
      `SELECT p.id AS id
       FROM plugins p
       JOIN plugin_resources pr ON pr.plugin_id = p.id
       WHERE pr.resource_id = ?
       ORDER BY p.updated_at DESC`,
    )
    .all(resourceId) as Array<{ id: string }>;
  const plugins: Plugin[] = [];
  for (const row of rows) {
    const plugin = getPluginById(row.id);
    if (plugin) plugins.push(plugin);
  }
  return plugins;
}

function pathInstallRoot(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const looksLikePath =
    trimmed.startsWith("/")
    || trimmed.startsWith("./")
    || trimmed.startsWith("../")
    || /^[A-Za-z]:[\\/]/.test(trimmed);
  if (!looksLikePath) return undefined;
  if (isPluginInstallRoot(trimmed)) return trimmed;
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    const absolute = resolve(trimmed);
    if (isPluginInstallRoot(absolute)) return absolute;
  }
  return undefined;
}

/**
 * Directory that holds an installed plugin package.
 * Import uses the owned agent-plugins cache. Marketplace, git, and local
 * installs use the host-plugin cache, the marketplace or git checkout, or a
 * harness install tree. Missing packages return undefined.
 */
export function resolvePluginPackageRoot(plugin: Plugin): string | undefined {
  const recorded = recordedPluginInstallRoot(plugin.name, plugin.version);
  if (recorded) return recorded;

  const locator = recoverOriginLocator(plugin);
  const harnesstapDir = getHarnesstapDir();
  const homeRoot = resolveHomeRoot();
  if (!locator) {
    return pathInstallRoot(plugin.origin_locator) ?? resolveInstallRoot(plugin.name, homeRoot);
  }

  switch (locator.kind) {
    case "marketplace": {
      const canonical = resolveCanonicalHostPluginRoot({
        harnesstapDir,
        originRef: locator.ref,
        version: plugin.version,
      });
      if (canonical) return canonical;
      const parsed = parseDependencyRef(locator.ref);
      const cacheDir = marketplaceCacheDir(harnesstapDir, parsed.namespace);
      const fromCache =
        resolveMarketplacePluginDirectory(cacheDir, parsed.name)
        ?? resolveMarketplacePluginDirectory(cacheDir, plugin.name);
      if (fromCache) return fromCache;
      return (
        resolveInstallRoot(locator.ref, homeRoot)
        ?? resolveInstallRoot(`${plugin.name}@${parsed.namespace}`, homeRoot)
      );
    }
    case "git": {
      const canonical = resolveCanonicalHostPluginRoot({
        harnesstapDir,
        originRef: `${plugin.name}@local`,
        version: plugin.version,
      });
      if (canonical) return canonical;
      const cacheDir = gitOriginCacheDir(harnesstapDir, locator.url);
      return (
        resolveMarketplacePluginDirectory(cacheDir, plugin.name)
        ?? (existsSync(cacheDir) ? cacheDir : undefined)
      );
    }
    case "catalog":
      return undefined;
    default: {
      const _exhaustive: never = locator;
      return _exhaustive;
    }
  }
}

export function installedPackageForResource(
  resourceId: string,
): { name: string; version: string; path: string } | undefined {
  if (!resourceId) return undefined;
  for (const plugin of pluginsForResource(resourceId)) {
    const path = resolvePluginPackageRoot(plugin);
    if (!path) continue;
    return { name: plugin.name, version: plugin.version, path };
  }

  const resource = getResource(resourceId);
  const origin = resource?.origin_ref;
  if (!origin) return undefined;
  const path = pathInstallRoot(origin) ?? resolveInstallRoot(origin);
  if (!path) return undefined;
  const parsedName = parseDependencyRef(origin).name;
  const name = parsedName.includes("/") || parsedName.includes("\\")
    ? basename(path)
    : parsedName;
  return { name: name || basename(path), version: "0.0.0", path };
}
