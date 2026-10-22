import { getHarnesstapDir } from "../db/connection.js";
import { listResources } from "../models/resource.js";
import { marketplaceIsConfigured } from "../plugins/claude-plugin-ref.js";
import type { PluginDependencyMetadata } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { listPlugins } from "../models/plugin-model.js";
import { wellKnownMarketplaceEntry } from "./builtin-marketplaces.js";
import { registerDeclaredMarketplaces } from "./claude-marketplace-bootstrap.js";
import { installMarketplacePinIntoCache } from "./marketplace-pin-cache.js";
import { findKnownMarketplace } from "./marketplace-registry.js";
import { parseDependencyRef } from "./plugin-dependency.js";
import {
  resolveInstallRoot,
  syncLinkedResources,
  syncPluginResource,
  type SyncLinkedResourcesOptions,
  type SyncLinkedResourcesResult,
} from "./resource-sync.js";

/** `plugin:<name>@<marketplace>` (or `plugin_pin:`) to the dependency ref, else undefined. */
export function marketplaceDependencySelectorRef(selector: string | undefined): string | undefined {
  const trimmed = selector?.trim();
  if (!trimmed) return undefined;
  const ref = trimmed.replace(/^(plugin|plugin_pin):/, "");
  return parseDependencyRef(ref).source_kind === "marketplace" ? ref : undefined;
}

function marketplaceIsResolvable(marketplace: string, homeRoot: string): boolean {
  return Boolean(
    findKnownMarketplace(getHarnesstapDir(), marketplace)
      ?? wellKnownMarketplaceEntry(marketplace)
      ?? (marketplaceIsConfigured(homeRoot, marketplace) ? marketplace : undefined),
  );
}

function unknownMarketplaceReason(marketplace: string): string {
  return `marketplace ${marketplace} is not configured. Add it with ht marketplace add <git-url> --name ${marketplace}, then run this command again`;
}

/** Register `marketplace` when a library plugin's claude.toml declares its source. */
function registerMarketplaceDeclaredByLibrary(marketplace: string): void {
  const harnesstapDir = getHarnesstapDir();
  if (findKnownMarketplace(harnesstapDir, marketplace)) return;
  for (const plugin of listPlugins()) {
    const entry = plugin.claude?.marketplaces?.[marketplace];
    if (!entry) continue;
    if (registerDeclaredMarketplaces({ marketplaces: { [marketplace]: entry } }, harnesstapDir).added.length > 0) {
      return;
    }
  }
}

/**
 * `ht resource sync plugin:<name>@<marketplace>` is the fix apply prints for
 * a marketplace dependency with no local version. Sync alone only rereads an
 * existing install, so for a dependency that was never installed it checked
 * nothing. Install each such dependency at its constraint first (resolving a
 * well-known marketplace by name), then sync it, and report why when the
 * install fails.
 */
export async function syncResourcesInstallingDependencies(
  options: SyncLinkedResourcesOptions = {},
): Promise<SyncLinkedResourcesResult> {
  const ref = marketplaceDependencySelectorRef(options.selector);
  const pins = ref
    ? listResources({ type: "plugin", includeComposition: true }).filter(
        (resource) => resource.origin_ref === ref,
      )
    : [];
  if (!ref) {
    return syncLinkedResources(options);
  }
  if (pins.length === 0) {
    // No library plugin depends on it, so there is nothing to install; an
    // unknown marketplace is still worth saying how to fix.
    const result = await syncLinkedResources(options);
    const marketplace = parseDependencyRef(ref).namespace;
    const homeRoot = options.homeRoot ?? resolveHomeRoot();
    registerMarketplaceDeclaredByLibrary(marketplace);
    if (!marketplaceIsResolvable(marketplace, homeRoot)) {
      result.failed = [
        ...(result.failed ?? []),
        { ref, reason: unknownMarketplaceReason(marketplace) },
      ];
    }
    return result;
  }

  const homeRoot = options.homeRoot ?? resolveHomeRoot();
  const aggregated: SyncLinkedResourcesResult = {
    checked: 0,
    updated: [],
    stale: [],
    unchanged: [],
    skipped: [],
    failed: [],
  };
  for (const pin of pins) {
    if (!options.dryRun && !resolveInstallRoot(ref, homeRoot, options.claudePluginsRoot)) {
      const metadata = pin.metadata as PluginDependencyMetadata;
      const marketplace = parseDependencyRef(ref).namespace;
      registerMarketplaceDeclaredByLibrary(marketplace);
      if (!marketplaceIsResolvable(marketplace, homeRoot)) {
        aggregated.checked += 1;
        aggregated.stale.push({
          resource: pin,
          reason: unknownMarketplaceReason(marketplace),
        });
        aggregated.failed?.push({ ref, reason: unknownMarketplaceReason(marketplace) });
        continue;
      }
      try {
        await installMarketplacePinIntoCache({
          originRef: ref,
          versionConstraint: metadata.version_constraint,
          homeRoot,
        });
      } catch (error) {
        aggregated.checked += 1;
        const reason = `could not install ${ref}: ${error instanceof Error ? error.message : String(error)}`;
        aggregated.stale.push({ resource: pin, reason });
        aggregated.failed?.push({ ref, reason });
        continue;
      }
    }
    const result = await syncPluginResource(pin, { ...options, homeRoot });
    aggregated.checked += result.checked;
    aggregated.updated.push(...result.updated);
    aggregated.stale.push(...result.stale);
    aggregated.unchanged.push(...result.unchanged);
    aggregated.skipped.push(...result.skipped);
  }
  return aggregated;
}
