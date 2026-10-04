import { getHarnesstapDir } from "../db/connection.js";
import {
  createPlugin,
  deletePlugin,
  getPluginById,
  getPluginByName,
} from "../models/plugin-model.js";
import { trackPluginInstalled } from "../telemetry/index.js";
import type { Plugin } from "../types.js";
import {
  marketplaceCacheDir,
  type RefreshMarketplaceCatalogResult,
  refreshMarketplaceCatalog,
} from "./marketplace-catalog.js";
import { listMarketplaces } from "./marketplace-registry.js";
import { getPluginOrigin, setPluginOrigin } from "./plugin-origin.js";
import {
  applyCheckedPluginOrigin,
  resolveMarketplacePluginDirectory,
} from "./plugin-origin-apply.js";
import {
  formatOriginLocator,
  recoverOriginLocator,
} from "./plugin-origin-locator.js";

export type MarketplacePluginImportCode =
  | "invalid_ref"
  | "marketplace_not_found"
  | "plugin_not_found"
  | "name_conflict"
  | "import_failed";

export class MarketplacePluginImportError extends Error {
  readonly code: MarketplacePluginImportCode;

  constructor(code: MarketplacePluginImportCode, message: string) {
    super(message);
    this.name = "MarketplacePluginImportError";
    this.code = code;
  }
}

export type ImportPluginFromMarketplaceDeps = {
  refreshMarketplace?: (
    harnesstapDir: string,
    options: { name: string; force?: boolean },
  ) => RefreshMarketplaceCatalogResult | Promise<RefreshMarketplaceCatalogResult>;
};

export interface ImportedMarketplacePlugin {
  plugin: Plugin;
  origin_locator: string;
  origin_fingerprint: string;
  created: boolean;
}

function sameMarketplaceLocator(plugin: Plugin, ref: string): boolean {
  const locator = recoverOriginLocator(plugin);
  if (!locator || locator.kind !== "marketplace") {
    return false;
  }
  return formatOriginLocator(locator) === ref;
}

export async function importPluginFromMarketplace(
  input: {
    marketplace: string;
    plugin: string;
    as?: string;
  } & ImportPluginFromMarketplaceDeps,
): Promise<ImportedMarketplacePlugin> {
  const marketplace = input.marketplace.trim();
  const pluginName = input.plugin.trim();
  if (!marketplace || !pluginName) {
    throw new MarketplacePluginImportError(
      "invalid_ref",
      "marketplace and plugin are required",
    );
  }

  const harnesstapDir = getHarnesstapDir();
  const registered = listMarketplaces(harnesstapDir).find(
    (entry) => entry.name === marketplace,
  );
  if (!registered) {
    throw new MarketplacePluginImportError(
      "marketplace_not_found",
      `Marketplace not found: ${marketplace}`,
    );
  }

  const refreshMarketplace = input.refreshMarketplace ?? refreshMarketplaceCatalog;
  const refresh = await refreshMarketplace(harnesstapDir, { name: marketplace });
  if (!refresh.ok) {
    throw new MarketplacePluginImportError(
      "import_failed",
      refresh.message || `Failed to refresh marketplace ${marketplace}`,
    );
  }

  const cacheDir = marketplaceCacheDir(harnesstapDir, marketplace);
  const pluginDir = resolveMarketplacePluginDirectory(cacheDir, pluginName);
  if (!pluginDir) {
    throw new MarketplacePluginImportError(
      "plugin_not_found",
      `Plugin ${pluginName} was not found in marketplace ${marketplace}`,
    );
  }

  const originLocator = `${pluginName}@${marketplace}`;
  const localName = input.as?.trim() || pluginName;
  const existing = getPluginByName(localName);
  let plugin: Plugin;
  let created = false;
  if (existing) {
    if (
      getPluginOrigin(existing.id) !== "upstream"
      || !sameMarketplaceLocator(existing, originLocator)
    ) {
      throw new MarketplacePluginImportError(
        "name_conflict",
        `Plugin name already exists: ${localName}. Use a different local name or delete the existing plugin first.`,
      );
    }
    plugin = existing;
  } else {
    plugin = createPlugin({
      name: localName,
      version: "0.0.0",
      description: `Upstream plugin ${originLocator}`,
      origin: "upstream",
    });
    setPluginOrigin(plugin.id, "upstream");
    created = true;
  }

  const fingerprint = refresh.sha ?? "";
  try {
    await applyCheckedPluginOrigin(plugin, {
      origin_locator: originLocator,
      origin_fingerprint: fingerprint,
    });
    const updated = getPluginById(plugin.id) ?? plugin;
    if (created) {
      trackPluginInstalled({ pluginSlug: updated.name, source: "url" });
    }
    return {
      plugin: updated,
      origin_locator: originLocator,
      origin_fingerprint: updated.origin_fingerprint || fingerprint,
      created,
    };
  } catch (error) {
    if (created) {
      deletePlugin(plugin.id);
    }
    if (error instanceof MarketplacePluginImportError) {
      throw error;
    }
    throw new MarketplacePluginImportError(
      "import_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}
