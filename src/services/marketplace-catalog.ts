import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_MARKETPLACE_REFRESH_MAX_AGE_MINUTES,
  type PluginMarketplacePlatform,
  loadSettings,
  marketplaceRefreshMaxAgeMs,
  parseTrackedBranches,
} from "../config/settings.js";
import { refreshGitSource } from "../plugins/refresh.js";
import { runCommandWithTimeout } from "../utils/run-command-with-timeout.js";
import {
  builtinMarketplaceEntry,
  builtinMarketplaceGitUrl,
} from "./builtin-marketplaces.js";
import {
  catalogPluginMatchesQuery,
  enrichCatalogPlugins,
} from "./marketplace-catalog-index.js";
import {
  type CatalogPlugin,
  mergeCatalogPluginsByIdentity,
  type ParsedMarketplaceCatalog,
  parseClaudeMarketplaceManifest,
  parseCursorMarketplaceManifest,
} from "./marketplace-catalog-parse.js";
import { listMarketplaces } from "./marketplace-registry.js";

export type { CatalogPlugin } from "./marketplace-catalog-parse.js";

export interface MarketplacePluginBranchVersion {
  name: string;
  version: string;
  branch: string;
}

export interface StoredMarketplaceCatalog extends ParsedMarketplaceCatalog {
  marketplaceEntryName: string;
  manifestName?: string;
  refreshedAt: string;
  sha?: string;
  pluginVersions?: MarketplacePluginBranchVersion[];
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

export const MARKETPLACE_CATALOG_MAX_AGE_MS = marketplaceRefreshMaxAgeMs(
  DEFAULT_MARKETPLACE_REFRESH_MAX_AGE_MINUTES,
);

export function relocateMarketplaceCache(
  harnesstapDir: string,
  fromName: string,
  toName: string,
): void {
  if (fromName === toName) return;
  const fromDir = marketplaceCacheDir(harnesstapDir, fromName);
  if (!existsSync(fromDir)) return;
  const toDir = marketplaceCacheDir(harnesstapDir, toName);
  if (existsSync(toDir)) {
    rmSync(toDir, { recursive: true, force: true });
  }
  mkdirSync(dirname(toDir), { recursive: true });
  renameSync(fromDir, toDir);
}

function isGooseOnly(platforms: PluginMarketplacePlatform[]): boolean {
  return platforms.length === 1 && platforms[0] === "goose";
}

function catalogIsFresh(catalogPath: string, maxAgeMs: number): boolean {
  if (!existsSync(catalogPath)) return false;
  const ageMs = Date.now() - statSync(catalogPath).mtimeMs;
  return ageMs < maxAgeMs;
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

    if (platforms.includes("claude-code") || platforms.includes("copilot-cli")) {
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
    case "copilot-cli":
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

function catalogRefreshEntry(
  harnesstapDir: string,
  name: string,
):
  | {
      name: string;
      url: string;
      platforms: PluginMarketplacePlatform[];
      trackedBranches?: string[];
    }
  | undefined {
  const registered = listMarketplaces(harnesstapDir).find((entry) => entry.name === name);
  if (registered) {
    return registered;
  }
  const url = builtinMarketplaceGitUrl(name);
  if (!url) {
    return undefined;
  }
  return builtinMarketplaceEntry();
}

function parseCatalogFromDir(
  dir: string,
  platforms: PluginMarketplacePlatform[],
  registryName: string,
):
  | { ok: true; catalog: ReturnType<typeof catalogWithRegistryIdentity> }
  | { ok: false; message: string } {
  const manifest = resolveManifest(dir, platforms);
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

  return {
    ok: true,
    catalog: catalogWithRegistryIdentity(parseManifest(manifest.platform, raw), registryName),
  };
}

function checkoutBranchName(dir: string): string {
  const result = runCommandWithTimeout("git", [
    "-c",
    "protocol.file.allow=always",
    "-C",
    dir,
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  const name = result.stdout.trim();
  return result.exitCode === 0 && name && name !== "HEAD" ? name : "HEAD";
}

function versionsFromPlugins(
  plugins: CatalogPlugin[],
  branch: string,
): MarketplacePluginBranchVersion[] {
  const rows: MarketplacePluginBranchVersion[] = [];
  for (const plugin of plugins) {
    if (!plugin.version) continue;
    rows.push({ name: plugin.name, version: plugin.version, branch });
  }
  return rows;
}

export function refreshMarketplaceCatalog(
  harnesstapDir: string,
  options: RefreshMarketplaceCatalogOptions,
): RefreshMarketplaceCatalogResult {
  const entry = catalogRefreshEntry(harnesstapDir, options.name);
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
  const maxAgeMs = marketplaceRefreshMaxAgeMs(
    settings.plugins.marketplaceRefreshMaxAgeMinutes,
  );

  if (!options.force && catalogIsFresh(catalogPath, maxAgeMs)) {
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

  const defaultCatalog = parseCatalogFromDir(cacheDir, entry.platforms, entry.name);
  if (!defaultCatalog.ok) {
    return defaultCatalog;
  }

  const defaultBranch = checkoutBranchName(cacheDir);
  const extraBranches = parseTrackedBranches(entry.trackedBranches ?? []).filter(
    (branch) => branch !== defaultBranch,
  );
  const pluginVersions = versionsFromPlugins(defaultCatalog.catalog.plugins, defaultBranch);
  const pluginBatches: CatalogPlugin[][] = [defaultCatalog.catalog.plugins];

  for (const branch of extraBranches) {
    const branchDir = mkdtempSync(join(tmpdir(), "ht-mkt-branch-"));
    try {
      const branchRefresh = refreshGitSource({
        url: entry.url,
        targetDir: branchDir,
        ref: branch,
      });
      if (!branchRefresh.ok) {
        return {
          ok: false,
          message: `Tracked branch "${branch}": ${branchRefresh.message}`,
        };
      }
      const branchCatalog = parseCatalogFromDir(branchDir, entry.platforms, entry.name);
      if (!branchCatalog.ok) {
        return {
          ok: false,
          message: `Tracked branch "${branch}": ${branchCatalog.message}`,
        };
      }
      pluginBatches.push(branchCatalog.catalog.plugins);
      pluginVersions.push(...versionsFromPlugins(branchCatalog.catalog.plugins, branch));
    } finally {
      rmSync(branchDir, { recursive: true, force: true });
    }
  }

  const catalog = {
    ...defaultCatalog.catalog,
    plugins: mergeCatalogPluginsByIdentity(pluginBatches.flat()),
  };
  const stored: StoredMarketplaceCatalog = {
    ...catalog,
    marketplaceEntryName: entry.name,
    refreshedAt: new Date().toISOString(),
    ...(refresh.sha ? { sha: refresh.sha } : {}),
    ...(pluginVersions.length > 0 ? { pluginVersions } : {}),
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
  const plugins = stored?.plugins ?? [];
  return enrichCatalogPlugins(marketplaceCacheDir(harnesstapDir, options.name), plugins);
}

/** Refresh from git only when the on-disk catalog is missing or stale, then list. */
export function ensureMarketplaceCatalog(
  harnesstapDir: string,
  options: ListCatalogPluginsOptions & { force?: boolean },
): CatalogPlugin[] {
  refreshMarketplaceCatalog(harnesstapDir, {
    name: options.name,
    force: options.force ?? false,
  });
  return listCatalogPlugins(harnesstapDir, { name: options.name });
}

export function listCatalogPluginBranchVersions(
  harnesstapDir: string,
  marketplace: string,
  pluginName: string,
): MarketplacePluginBranchVersion[] {
  const stored = readStoredCatalog(marketplaceCatalogPath(harnesstapDir, marketplace));
  return (stored?.pluginVersions ?? []).filter((row) => row.name === pluginName);
}

export function listPluginsFromMarketplaceRoot(
  root: string,
  registryName: string,
  platforms: PluginMarketplacePlatform[] = ["claude-code"],
): CatalogPlugin[] {
  const manifest = resolveManifest(root, platforms);
  if (!manifest) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifest.manifestPath, "utf8"));
  } catch {
    return [];
  }

  const plugins = catalogWithRegistryIdentity(
    parseManifest(manifest.platform, raw),
    registryName,
  ).plugins;
  return enrichCatalogPlugins(root, plugins);
}

export function readMarketplaceManifest(root: string): unknown | undefined {
  const manifest = resolveManifest(root, ["claude-code", "cursor", "copilot-cli"]);
  if (!manifest) return undefined;
  try {
    return JSON.parse(readFileSync(manifest.manifestPath, "utf8"));
  } catch {
    return undefined;
  }
}

function pluginMatchesQuery(plugin: CatalogPlugin, query: string): boolean {
  return catalogPluginMatchesQuery(plugin, query);
}

function listCatalogSearchMarketplaces(
  harnesstapDir: string,
): Array<{ name: string }> {
  const registered = listMarketplaces(harnesstapDir);
  if (registered.some((entry) => builtinMarketplaceGitUrl(entry.name))) {
    return registered;
  }
  return [...registered, builtinMarketplaceEntry()];
}

export interface SearchCatalogPluginsOptions {
  refresh?: boolean;
}

export function searchCatalogPlugins(
  harnesstapDir: string,
  query: string,
  options: SearchCatalogPluginsOptions = {},
): CatalogPlugin[] {
  const marketplaces = listCatalogSearchMarketplaces(harnesstapDir);
  if (options.refresh) {
    for (const marketplace of marketplaces) {
      refreshMarketplaceCatalog(harnesstapDir, {
        name: marketplace.name,
        force: true,
      });
    }
  }

  const trimmed = query.trim();
  const results: CatalogPlugin[] = [];
  for (const marketplace of marketplaces) {
    const plugins = listCatalogPlugins(harnesstapDir, { name: marketplace.name });
    for (const plugin of plugins) {
      if (!trimmed || pluginMatchesQuery(plugin, trimmed)) {
        results.push(plugin);
      }
    }
  }
  return results;
}
