import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPluginResources } from "../models/plugin-model.js";
import { MATERIAL_RESOURCE_TYPES, type Plugin, type PluginSourceScanResult, type Resource } from "../types.js";
import { resolvePluginPackageRoot } from "./agent-plugins/package-root.js";
import {
  attachScannedOriginResources,
  resolveMarketplacePluginDirectory,
} from "./plugin-origin-apply.js";
import {
  formatOriginLocator,
  recoverOriginLocator,
} from "./plugin-origin-locator.js";
import {
  scanPluginSourceSync,
} from "./plugin-source-import.js";

const MATERIAL_TYPES = new Set<string>(MATERIAL_RESOURCE_TYPES);

function hasMaterialResources(resources: Resource[]): boolean {
  return resources.some((resource) => MATERIAL_TYPES.has(resource.type));
}

function pickScan(
  scans: PluginSourceScanResult[],
  pluginName: string,
): PluginSourceScanResult | undefined {
  return (
    scans.find(
      (scan) => scan.plugin_name === pluginName && scan.resources.length > 0,
    ) ?? scans.find((scan) => scan.resources.length > 0)
  );
}

function tryScan(sourcePath: string, pluginName: string): PluginSourceScanResult | undefined {
  try {
    return pickScan(scanPluginSourceSync(sourcePath), pluginName);
  } catch {
    return undefined;
  }
}

function scanMarketplaceManifests(
  sourcePath: string,
  pluginName: string,
): PluginSourceScanResult | undefined {
  const manifestCandidates = [
    join(sourcePath, ".claude-plugin", "marketplace.json"),
    join(sourcePath, ".cursor-plugin", "marketplace.json"),
    join(sourcePath, ".github", "plugin", "marketplace.json"),
    join(sourcePath, ".agents", "plugins", "marketplace.json"),
    join(sourcePath, "marketplace.json"),
  ];
  for (const manifestPath of manifestCandidates) {
    if (!existsSync(manifestPath)) {
      continue;
    }
    const scan = tryScan(manifestPath, pluginName);
    if (scan) {
      return scan;
    }
  }
  return undefined;
}

function scanPackageTree(
  plugin: Plugin,
  sourcePath: string,
): PluginSourceScanResult | undefined {
  const fromManifest = scanMarketplaceManifests(sourcePath, plugin.name);
  if (fromManifest) {
    return fromManifest;
  }
  const nested = resolveMarketplacePluginDirectory(sourcePath, plugin.name);
  if (nested && nested !== sourcePath) {
    const nestedScan = tryScan(nested, plugin.name);
    if (nestedScan) {
      return nestedScan;
    }
  }
  return tryScan(sourcePath, plugin.name);
}

/**
 * Attach on-disk package contents when an upstream/catalog plugin has no
 * material resources in the library yet (marketplace install trees, nested
 * `plugins/claude/<name>` layouts).
 */
export function ensureUpstreamPluginResources(plugin: Plugin): Resource[] {
  const attached = getPluginResources(plugin.id);
  if (hasMaterialResources(attached)) {
    return attached;
  }
  if (plugin.origin === "authored") {
    return attached;
  }

  const packageRoot = resolvePluginPackageRoot(plugin);
  if (!packageRoot) {
    return attached;
  }

  const scan = scanPackageTree(plugin, packageRoot);
  if (!scan || scan.resources.length === 0) {
    return attached;
  }

  const locator = recoverOriginLocator(plugin);
  const locatorStr = locator ? formatOriginLocator(locator) : plugin.name;
  attachScannedOriginResources(plugin.id, scan.resources, locatorStr);
  return getPluginResources(plugin.id);
}
