import { getHarnesstapDir } from "../db/connection.js";
import type { PluginOrigin } from "../types.js";
import {
  type VisibleMarketplaceEntry,
  listVisibleMarketplaces,
} from "./host-marketplaces.js";
import {
  type CatalogPlugin,
  listCatalogPlugins,
} from "./marketplace-catalog.js";
import { catalogPluginMatchesQuery } from "./marketplace-catalog-index.js";
import { listMarketplacePlugins } from "./marketplace-plugin-tree.js";

export type DiscoverSearchHead = {
  name: string;
  version?: string;
  description: string | null;
  origin?: PluginOrigin;
  id: string;
  tags?: string[];
};

export type DiscoverSearchResource = {
  name: string;
  type: string;
  description: string | null;
  namespace: string | null;
  origin_kind?: string | null;
  id: string;
  tags?: string[];
};

export type DiscoverSearchMarketplacePlugin = {
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  contents?: CatalogPlugin["contents"];
  ref: string;
};

export type DiscoverSearchGroup = {
  sourceId: string;
  sourceLabel: string;
  heads?: DiscoverSearchHead[];
  resources?: DiscoverSearchResource[];
  plugins?: DiscoverSearchMarketplacePlugin[];
};

export type DiscoverSearchResult = {
  groups: DiscoverSearchGroup[];
};

type ParsedDiscoverSourceId =
  | { kind: "local"; sourceId: string }
  | { kind: "marketplace"; sourceId: string; name: string }
  | { kind: "cloud-org"; sourceId: string }
  | { kind: "cloud-catalog"; sourceId: string }
  | { kind: "unknown"; sourceId: string };

function parseDiscoverSourceId(sourceId: string): ParsedDiscoverSourceId {
  if (sourceId === "local") {
    return { kind: "local", sourceId };
  }
  if (sourceId.startsWith("mkt:")) {
    const name = sourceId.slice("mkt:".length).trim();
    if (name.length === 0) {
      return { kind: "unknown", sourceId };
    }
    return { kind: "marketplace", sourceId, name };
  }
  if (sourceId.startsWith("org:")) {
    return { kind: "cloud-org", sourceId };
  }
  if (sourceId.startsWith("cat:")) {
    return { kind: "cloud-catalog", sourceId };
  }
  return { kind: "unknown", sourceId };
}

function marketplacePluginsForEntry(
  harnesstapDir: string,
  entry: VisibleMarketplaceEntry,
): CatalogPlugin[] {
  if (!entry.managed && entry.contentRoot) {
    return listMarketplacePlugins(harnesstapDir, entry);
  }
  return listCatalogPlugins(harnesstapDir, { name: entry.name });
}

function marketplaceGroup(
  q: string,
  sourceId: string,
  name: string,
  harnesstapDir: string,
): DiscoverSearchGroup | undefined {
  const entry = listVisibleMarketplaces(harnesstapDir).find(
    (marketplace) => marketplace.name === name,
  );
  if (!entry) {
    return undefined;
  }
  const plugins = marketplacePluginsForEntry(harnesstapDir, entry).filter((plugin) =>
    catalogPluginMatchesQuery(plugin, q),
  );
  return {
    sourceId,
    sourceLabel: entry.name,
    plugins: plugins.map((plugin) => ({
      name: plugin.name,
      ref: plugin.ref,
      ...(plugin.version ? { version: plugin.version } : {}),
      ...(plugin.description ? { description: plugin.description } : {}),
      ...(plugin.tags ? { tags: plugin.tags } : {}),
      ...(plugin.contents ? { contents: plugin.contents } : {}),
    })),
  };
}

export function searchDiscover(input: {
  q: string;
  sourceIds: string[];
}): DiscoverSearchResult {
  if (input.sourceIds.length === 0) {
    return { groups: [] };
  }

  const harnesstapDir = getHarnesstapDir();
  const groups: DiscoverSearchGroup[] = [];

  for (const sourceId of input.sourceIds) {
    const parsed = parseDiscoverSourceId(sourceId);
    switch (parsed.kind) {
      case "marketplace": {
        const group = marketplaceGroup(
          input.q,
          parsed.sourceId,
          parsed.name,
          harnesstapDir,
        );
        if (group) {
          groups.push(group);
        }
        break;
      }
      case "local":
      case "cloud-org":
      case "cloud-catalog":
      case "unknown":
        break;
      default: {
        const exhaustive: never = parsed;
        return exhaustive;
      }
    }
  }

  return { groups };
}
