import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { PluginMarketplacePlatform } from "../config/settings.js";
import { loadSettings } from "../config/settings.js";
import { refreshGitSource } from "../plugins/refresh.js";
import {
  type CatalogPlugin,
  type ParsedMarketplaceCatalog,
  parseClaudeMarketplaceManifest,
  parseCursorMarketplaceManifest,
} from "./marketplace-catalog-parse.js";
import { listMarketplaces } from "./marketplace-registry.js";

export type { CatalogPlugin } from "./marketplace-catalog-parse.js";

export interface StoredMarketplaceCatalog extends ParsedMarketplaceCatalog {
  marketplaceEntryName: string;
  manifestName?: string;
  refreshedAt: string;
  sha?: string;
}

export interface RefreshMarketplaceCatalogOptions {
  name: string;
  force?: boolean;
}

export interface RefreshMarketplaceCatalogResult {
  ok: boolean;
  message: string;
  sha?: string;
}

export interface ListCatalogPluginsOptions {
  name: string;
}

const MANIFEST_PATHS = [
  { path: ".claude-plugin/marketplace.json", platform: "claude-code" as const },
  { path: ".cursor-plugin/marketplace.json", platform: "cursor" as const },
  { path: "marketplace.json", platform: null },
];

export function marketplaceCacheDir(harnesstapDir: string, name: string): string {
  return join(harnesstapDir, "cache", "marketplaces", name);
}

export function marketplaceCatalogPath(harnesstapDir: string, name: string): string {
  return join(marketplaceCacheDir(harnesstapDir, name), "catalog.json");
}

function isGooseOnly(platforms: PluginMarketplacePlatform[]): boolean {
  return platforms.length === 1 && platforms[0] === "goose";
}

function catalogIsFresh(catalogPath: string, maxAgeHours: number): boolean {
  if (!existsSync(catalogPath)) return false;
  const ageMs = Date.now() - statSync(catalogPath).mtimeMs;
  return ageMs < maxAgeHours * 60 * 60 * 1000;
}

function readStoredCatalog(catalogPath: string): StoredMarketplaceCatalog | undefined {
  if (!existsSync(catalogPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(catalogPath, "utf8")) as StoredMarketplaceCatalog;
    if (!Array.isArray(raw.plugins)) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

function writeStoredCatalog(
  catalogPath: string,
  catalog: StoredMarketplaceCatalog,
): void {
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

function resolveManifest(
  cacheDir: string,
  platforms: PluginMarketplacePlatform[],
): { manifestPath: string; platform: PluginMarketplacePlatform } | undefined {
  for (const candidate of MANIFEST_PATHS) {
    const manifestPath = join(cacheDir, candidate.path);
    if (!existsSync(manifestPath)) continue;

    if (candidate.platform) {
      return { manifestPath, platform: candidate.platform };
    }

    if (platforms.includes("claude-code")) {
      return { manifestPath, platform: "claude-code" };
    }
    if (platforms.includes("cursor")) {
      return { manifestPath, platform: "cursor" };
    }
    return undefined;
  }
  return undefined;
}

function parseManifest(
  platform: PluginMarketplacePlatform,
  raw: unknown,
): ParsedMarketplaceCatalog {
  switch (platform) {
    case "claude-code":
      return parseClaudeMarketplaceManifest(raw);
    case "cursor":
      return parseCursorMarketplaceManifest(raw);
    case "goose":
      return { marketplaceName: "", plugins: [] };
    default: {
      const _exhaustive: never = platform;
      return _exhaustive;
    }
  }
}

function catalogWithRegistryIdentity(
  parsed: ParsedMarketplaceCatalog,
  registryName: string,
): Pick<StoredMarketplaceCatalog, "marketplaceName" | "manifestName" | "plugins"> {
  const manifestName =
    parsed.marketplaceName.length > 0 && parsed.marketplaceName !== registryName
      ? parsed.marketplaceName
      : undefined;

  return {
    marketplaceName: registryName,
    ...(manifestName ? { manifestName } : {}),
    plugins: parsed.plugins.map((plugin) => ({
      ...plugin,
      ref: `${plugin.name}@${registryName}`,
    })),
  };
}

export function refreshMarketplaceCatalog(
  harnesstapDir: string,
  options: RefreshMarketplaceCatalogOptions,
): RefreshMarketplaceCatalogResult {
  const entry = listMarketplaces(harnesstapDir).find((m) => m.name === options.name);
  if (!entry) {
    return { ok: false, message: `Marketplace not found: ${options.name}` };
  }

  if (isGooseOnly(entry.platforms)) {
    return {
      ok: false,
      message:
        "Marketplace catalog refresh is not supported for Goose-only marketplaces.",
    };
  }

  const cacheDir = marketplaceCacheDir(harnesstapDir, entry.name);
  const catalogPath = marketplaceCatalogPath(harnesstapDir, entry.name);
  const settings = loadSettings(harnesstapDir);

  if (!options.force && catalogIsFresh(catalogPath, settings.plugins.refreshMaxAgeHours)) {
    const stored = readStoredCatalog(catalogPath);
    return {
      ok: true,
      message: "Catalog is up to date",
      ...(stored?.sha ? { sha: stored.sha } : {}),
    };
  }

  const refresh = refreshGitSource({
    url: entry.url,
    targetDir: cacheDir,
  });
  if (!refresh.ok) {
    return { ok: false, message: refresh.message };
  }

  const manifest = resolveManifest(cacheDir, entry.platforms);
  if (!manifest) {
    return {
      ok: false,
      message:
        "No marketplace manifest found (.claude-plugin/marketplace.json, .cursor-plugin/marketplace.json, or marketplace.json).",
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifest.manifestPath, "utf8"));
  } catch {
    return { ok: false, message: "Failed to parse marketplace manifest JSON" };
  }

  const parsed = parseManifest(manifest.platform, raw);
  const catalog = catalogWithRegistryIdentity(parsed, entry.name);
  const stored: StoredMarketplaceCatalog = {
    ...catalog,
    marketplaceEntryName: entry.name,
    refreshedAt: new Date().toISOString(),
    ...(refresh.sha ? { sha: refresh.sha } : {}),
  };
  writeStoredCatalog(catalogPath, stored);

  return {
    ok: true,
    message: refresh.message,
    ...(refresh.sha ? { sha: refresh.sha } : {}),
  };
}

export function listCatalogPlugins(
  harnesstapDir: string,
  options: ListCatalogPluginsOptions,
): CatalogPlugin[] {
  const stored = readStoredCatalog(marketplaceCatalogPath(harnesstapDir, options.name));
  return stored?.plugins ?? [];
}

function pluginMatchesQuery(plugin: CatalogPlugin, query: string): boolean {
  const needle = query.toLowerCase();
  if (plugin.name.toLowerCase().includes(needle)) return true;
  if (plugin.ref.toLowerCase().includes(needle)) return true;
  if (plugin.description?.toLowerCase().includes(needle)) return true;
  return false;
}

export interface SearchCatalogPluginsOptions {
  refresh?: boolean;
}

export function searchCatalogPlugins(
  harnesstapDir: string,
  query: string,
  options: SearchCatalogPluginsOptions = {},
): CatalogPlugin[] {
  if (options.refresh) {
    for (const marketplace of listMarketplaces(harnesstapDir)) {
      refreshMarketplaceCatalog(harnesstapDir, {
        name: marketplace.name,
        force: true,
      });
    }
  }

  const trimmed = query.trim();
  const results: CatalogPlugin[] = [];
  for (const marketplace of listMarketplaces(harnesstapDir)) {
    const plugins = listCatalogPlugins(harnesstapDir, { name: marketplace.name });
    for (const plugin of plugins) {
      if (!trimmed || pluginMatchesQuery(plugin, trimmed)) {
        results.push(plugin);
      }
    }
  }
  return results;
}
