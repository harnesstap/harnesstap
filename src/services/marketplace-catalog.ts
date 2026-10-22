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
import { resolveTelemetryProduct } from "../telemetry/product.js";
import { runCommandWithTimeout } from "../utils/run-command-with-timeout.js";
import {
  builtinMarketplaceEntry,
  builtinMarketplaceGitUrl,
  wellKnownMarketplaceEntry,
} from "./builtin-marketplaces.js";
import {
  catalogPluginMatchesQuery,
  enrichCatalogPlugins,
} from "./marketplace-catalog-index.js";
import {
  type CatalogPlugin,
  type CatalogPluginFlavor,
  mergeCatalogPluginsByIdentity,
  partitionEscapingCatalogPlugins,
  type ParsedMarketplaceCatalog,
  parseClaudeMarketplaceManifest,
  parseCodexMarketplaceManifest,
  parseCursorMarketplaceManifest,
} from "./marketplace-catalog-parse.js";
import { readCachedMarketplaceJson } from "./marketplace-manifest-cache.js";
import { listMarketplaces, updateMarketplace } from "./marketplace-registry.js";

export type { CatalogPlugin } from "./marketplace-catalog-parse.js";

export interface MarketplacePluginBranchVersion {
  name: string;
  version: string;
  branch: string;
}

export const MARKETPLACE_CATALOG_INDEX_VERSION = 2;

export interface StoredMarketplaceCatalog extends ParsedMarketplaceCatalog {
  marketplaceEntryName: string;
  manifestName?: string;
  refreshedAt: string;
  sha?: string;
  pluginVersions?: MarketplacePluginBranchVersion[];
  indexVersion?: number;
  warnings?: string[];
}

export interface RefreshMarketplaceCatalogOptions {
  name: string;
  force?: boolean;
  /**
   * Background refresh. Serves callers from the cached catalog.
   * Uses a short git timeout and does not prompt.
   */
  unattended?: boolean;
}

export interface RefreshMarketplaceCatalogResult {
  ok: boolean;
  message: string;
  /** git timed out; the cached catalog was left as it was. */
  timedOut?: boolean;
  sha?: string;
  warnings?: string[];
}

export interface ListCatalogPluginsOptions {
  name: string;
}

/** Codex manifests are a catalog flavor. They are not a registry platform. */
export type MarketplaceCatalogFlavor = CatalogPluginFlavor;

const MANIFEST_PATHS: ReadonlyArray<{
  path: string;
  flavor: MarketplaceCatalogFlavor | null;
}> = [
  { path: ".claude-plugin/marketplace.json", flavor: "claude-code" },
  { path: ".cursor-plugin/marketplace.json", flavor: "cursor" },
  { path: ".github/plugin/marketplace.json", flavor: "copilot-cli" },
  { path: ".agents/plugins/marketplace.json", flavor: "codex" },
  { path: "marketplace.json", flavor: null },
];

const MISSING_MANIFEST_MESSAGE =
  "No marketplace manifest found (.claude-plugin/marketplace.json, .cursor-plugin/marketplace.json, .github/plugin/marketplace.json, .agents/plugins/marketplace.json, or marketplace.json).";

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

function rootMarketplaceFlavor(
  platforms: PluginMarketplacePlatform[],
): MarketplaceCatalogFlavor | undefined {
  if (platforms.includes("claude-code") || platforms.includes("copilot-cli")) {
    return "claude-code";
  }
  if (platforms.includes("cursor")) {
    return "cursor";
  }
  return undefined;
}

function resolveManifests(
  cacheDir: string,
  platforms: PluginMarketplacePlatform[],
): Array<{ manifestPath: string; flavor: MarketplaceCatalogFlavor }> {
  const found: Array<{ manifestPath: string; flavor: MarketplaceCatalogFlavor }> = [];
  for (const candidate of MANIFEST_PATHS) {
    const manifestPath = join(cacheDir, candidate.path);
    if (!existsSync(manifestPath)) continue;
    if (candidate.flavor) {
      found.push({ manifestPath, flavor: candidate.flavor });
      continue;
    }
    const flavor = rootMarketplaceFlavor(platforms);
    if (flavor) {
      found.push({ manifestPath, flavor });
    }
  }
  return found;
}

function registryPlatformForFlavor(
  flavor: CatalogPluginFlavor | undefined,
): PluginMarketplacePlatform | undefined {
  switch (flavor) {
    case "claude-code":
    case "cursor":
    case "goose":
    case "copilot-cli":
      return flavor;
    case "codex":
    case undefined:
      return undefined;
    default: {
      const _exhaustive: never = flavor;
      return _exhaustive;
    }
  }
}

function parseManifest(
  flavor: MarketplaceCatalogFlavor,
  raw: unknown,
): ParsedMarketplaceCatalog {
  switch (flavor) {
    case "claude-code":
      return parseClaudeMarketplaceManifest(raw);
    case "copilot-cli":
      return parseClaudeMarketplaceManifest(raw);
    case "codex":
      return parseCodexMarketplaceManifest(raw);
    case "cursor":
      return parseCursorMarketplaceManifest(raw);
    case "goose":
      return { marketplaceName: "", plugins: [] };
    default: {
      const _exhaustive: never = flavor;
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
    return wellKnownMarketplaceEntry(name);
  }
  return builtinMarketplaceEntry();
}

interface LoadedMarketplaceCatalog {
  marketplaceName: string;
  manifestName?: string;
  plugins: CatalogPlugin[];
  warnings: string[];
}

function loadCatalogFromDir(
  dir: string,
  platforms: PluginMarketplacePlatform[],
  registryName: string,
):
  | { ok: true; catalog: LoadedMarketplaceCatalog }
  | { ok: false; message: string } {
  const manifests = resolveManifests(dir, platforms);
  if (manifests.length === 0) {
    return {
      ok: false,
      message: MISSING_MANIFEST_MESSAGE,
    };
  }

  const plugins: CatalogPlugin[] = [];
  let marketplaceName = "";
  let manifestName: string | undefined;
  for (const manifest of manifests) {
    const raw = readCachedMarketplaceJson(manifest.manifestPath);
    if (raw === undefined) {
      return { ok: false, message: "Failed to parse marketplace manifest JSON" };
    }
    const identified = catalogWithRegistryIdentity(
      parseManifest(manifest.flavor, raw),
      registryName,
    );
    if (!marketplaceName) {
      marketplaceName = identified.marketplaceName;
      manifestName = identified.manifestName;
    }
    for (const plugin of identified.plugins) {
      plugins.push({ ...plugin, flavor: manifest.flavor });
    }
  }

  const partitioned = partitionEscapingCatalogPlugins(plugins);
  return {
    ok: true,
    catalog: {
      marketplaceName,
      ...(manifestName ? { manifestName } : {}),
      plugins: partitioned.plugins,
      warnings: partitioned.warnings,
    },
  };
}

async function checkoutBranchName(dir: string, unattended: boolean): Promise<string> {
  const result = await runCommandWithTimeout("git", [
    "-c",
    "protocol.file.allow=always",
    "-C",
    dir,
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ], { unattended });
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

const catalogRefreshInflight = new Map<string, Promise<RefreshMarketplaceCatalogResult>>();

function catalogRefreshKey(harnesstapDir: string, name: string): string {
  return `${harnesstapDir}\0${name}`;
}

/**
 * Log a failed background refresh. A timeout is expected when git or the network
 * is slow: the cached catalog stays in use, so it is an info line in the Desktop
 * agent log (or on stderr with HARNESSTAP_DEBUG=1), never a CLI error line.
 */
export function logUnattendedRefreshFailure(
  name: string,
  result: Pick<RefreshMarketplaceCatalogResult, "message" | "timedOut">,
): void {
  if (result.timedOut) {
    const note = `[ht-agent] marketplace catalog refresh for ${name}: ${result.message} Using the cached catalog.`;
    if (resolveTelemetryProduct() === "desktop") {
      // Info level, like the per-request timing lines.
      console.log(note);
    } else if (process.env.HARNESSTAP_DEBUG === "1") {
      // stderr keeps CLI stdout (and --format json) clean.
      console.error(note);
    }
    return;
  }
  console.error(`[ht-agent] marketplace catalog refresh failed for ${name}: ${result.message}`);
}

async function refreshMarketplaceCatalogNow(
  harnesstapDir: string,
  options: RefreshMarketplaceCatalogOptions,
): Promise<RefreshMarketplaceCatalogResult> {
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

  const unattended = options.unattended === true;
  const refresh = await refreshGitSource({
    url: entry.url,
    targetDir: cacheDir,
    unattended,
  });
  if (!refresh.ok) {
    return {
      ok: false,
      message: refresh.message,
      ...(refresh.timedOut ? { timedOut: true } : {}),
    };
  }

  const defaultCatalog = loadCatalogFromDir(cacheDir, entry.platforms, entry.name);
  if (!defaultCatalog.ok) {
    return defaultCatalog;
  }

  const defaultBranch = await checkoutBranchName(cacheDir, unattended);
  const extraBranches = parseTrackedBranches(entry.trackedBranches ?? []).filter(
    (branch) => branch !== defaultBranch,
  );
  const pluginVersions = versionsFromPlugins(defaultCatalog.catalog.plugins, defaultBranch);
  const pluginBatches: CatalogPlugin[][] = [defaultCatalog.catalog.plugins];
  const warnings = [...defaultCatalog.catalog.warnings];

  for (const branch of extraBranches) {
    const branchDir = mkdtempSync(join(tmpdir(), "ht-mkt-branch-"));
    try {
      const branchRefresh = await refreshGitSource({
        url: entry.url,
        targetDir: branchDir,
        ref: branch,
        unattended,
      });
      if (!branchRefresh.ok) {
        return {
          ok: false,
          message: `Tracked branch "${branch}": ${branchRefresh.message}`,
          ...(branchRefresh.timedOut ? { timedOut: true } : {}),
        };
      }
      const branchCatalog = loadCatalogFromDir(branchDir, entry.platforms, entry.name);
      if (!branchCatalog.ok) {
        return {
          ok: false,
          message: `Tracked branch "${branch}": ${branchCatalog.message}`,
        };
      }
      pluginBatches.push(branchCatalog.catalog.plugins);
      warnings.push(...branchCatalog.catalog.warnings);
      pluginVersions.push(...versionsFromPlugins(branchCatalog.catalog.plugins, branch));
    } finally {
      rmSync(branchDir, { recursive: true, force: true });
    }
  }

  const uniqueWarnings = [...new Set(warnings)];
  const catalog = {
    marketplaceName: defaultCatalog.catalog.marketplaceName,
    ...(defaultCatalog.catalog.manifestName
      ? { manifestName: defaultCatalog.catalog.manifestName }
      : {}),
    plugins: enrichCatalogPlugins(
      cacheDir,
      mergeCatalogPluginsByIdentity(pluginBatches.flat()),
    ),
    ...(uniqueWarnings.length > 0 ? { warnings: uniqueWarnings } : {}),
  };
  const stored: StoredMarketplaceCatalog = {
    ...catalog,
    marketplaceEntryName: entry.name,
    refreshedAt: new Date().toISOString(),
    indexVersion: MARKETPLACE_CATALOG_INDEX_VERSION,
    ...(refresh.sha ? { sha: refresh.sha } : {}),
    ...(pluginVersions.length > 0 ? { pluginVersions } : {}),
  };
  writeStoredCatalog(catalogPath, stored);

  return {
    ok: true,
    message: refresh.message,
    ...(refresh.sha ? { sha: refresh.sha } : {}),
    ...(uniqueWarnings.length > 0 ? { warnings: uniqueWarnings } : {}),
  };
}

/** One refresh per marketplace. Later callers share the in-flight result, including errors. */
export function refreshMarketplaceCatalog(
  harnesstapDir: string,
  options: RefreshMarketplaceCatalogOptions,
): Promise<RefreshMarketplaceCatalogResult> {
  const key = catalogRefreshKey(harnesstapDir, options.name);
  const existing = catalogRefreshInflight.get(key);
  if (existing) {
    return existing;
  }
  const job = refreshMarketplaceCatalogNow(harnesstapDir, options).finally(() => {
    if (catalogRefreshInflight.get(key) === job) {
      catalogRefreshInflight.delete(key);
    }
  });
  catalogRefreshInflight.set(key, job);
  return job;
}

function persistIndexedCatalog(
  harnesstapDir: string,
  name: string,
  stored: StoredMarketplaceCatalog,
): StoredMarketplaceCatalog {
  if (stored.indexVersion === MARKETPLACE_CATALOG_INDEX_VERSION) {
    return stored;
  }
  const next: StoredMarketplaceCatalog = {
    ...stored,
    plugins: enrichCatalogPlugins(
      marketplaceCacheDir(harnesstapDir, name),
      stored.plugins,
    ),
    indexVersion: MARKETPLACE_CATALOG_INDEX_VERSION,
  };
  writeStoredCatalog(marketplaceCatalogPath(harnesstapDir, name), next);
  return next;
}

export function listCatalogPlugins(
  harnesstapDir: string,
  options: ListCatalogPluginsOptions,
): CatalogPlugin[] {
  const stored = readStoredCatalog(marketplaceCatalogPath(harnesstapDir, options.name));
  if (!stored) {
    return [];
  }
  return persistIndexedCatalog(harnesstapDir, options.name, stored).plugins;
}

/**
 * List the cached catalog. A stale cache is returned immediately and refreshed
 * in the background. A missing catalog waits for one refresh so the first
 * read can succeed, without blocking other sidecar requests.
 */
export async function ensureMarketplaceCatalog(
  harnesstapDir: string,
  options: ListCatalogPluginsOptions & { force?: boolean },
): Promise<CatalogPlugin[]> {
  const catalogPath = marketplaceCatalogPath(harnesstapDir, options.name);
  const stored = readStoredCatalog(catalogPath);
  const settings = loadSettings(harnesstapDir);
  const maxAgeMs = marketplaceRefreshMaxAgeMs(
    settings.plugins.marketplaceRefreshMaxAgeMinutes,
  );
  const fresh = catalogIsFresh(catalogPath, maxAgeMs);
  if (stored && fresh && !options.force) {
    return listCatalogPlugins(harnesstapDir, { name: options.name });
  }
  if (stored && !options.force) {
    void refreshMarketplaceCatalog(harnesstapDir, {
      name: options.name,
      force: false,
      unattended: true,
    }).then((result) => {
      if (!result.ok) {
        logUnattendedRefreshFailure(options.name, result);
      }
    });
    return listCatalogPlugins(harnesstapDir, { name: options.name });
  }
  await refreshMarketplaceCatalog(harnesstapDir, {
    name: options.name,
    force: options.force ?? true,
    unattended: false,
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
  const loaded = loadCatalogFromDir(root, platforms, registryName);
  if (!loaded.ok) return [];
  return enrichCatalogPlugins(root, loaded.catalog.plugins);
}

export function marketplaceRootWarnings(
  root: string,
  registryName: string,
  platforms: PluginMarketplacePlatform[] = ["claude-code"],
): string[] {
  const loaded = loadCatalogFromDir(root, platforms, registryName);
  return loaded.ok ? loaded.catalog.warnings : [];
}

export function marketplaceCatalogWarnings(
  harnesstapDir: string,
  name: string,
): string[] {
  return readStoredCatalog(marketplaceCatalogPath(harnesstapDir, name))?.warnings ?? [];
}

/** Flavors present in the stored catalog, including Codex. */
export function marketplaceRowFlavors(
  harnesstapDir: string,
  entry: { name: string; platforms: PluginMarketplacePlatform[] },
): string[] {
  const plugins = listCatalogPlugins(harnesstapDir, { name: entry.name });
  const flavors: string[] = [];
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin.flavor || seen.has(plugin.flavor)) continue;
    seen.add(plugin.flavor);
    flavors.push(plugin.flavor);
  }
  return flavors.length > 0 ? flavors : [...entry.platforms];
}

/**
 * When the user did not pass `--platform`, store the registry flavors the
 * manifests actually declared. Codex stays off the registry platform list.
 */
export function alignImplicitMarketplacePlatforms(
  harnesstapDir: string,
  name: string,
): PluginMarketplacePlatform[] | undefined {
  const plugins = listCatalogPlugins(harnesstapDir, { name });
  const detected: PluginMarketplacePlatform[] = [];
  const seen = new Set<PluginMarketplacePlatform>();
  for (const plugin of plugins) {
    const platform = registryPlatformForFlavor(plugin.flavor);
    if (!platform || seen.has(platform)) continue;
    seen.add(platform);
    detected.push(platform);
  }
  if (detected.length === 0) return undefined;
  const current = listMarketplaces(harnesstapDir).find((entry) => entry.name === name);
  if (!current) return undefined;
  const same =
    current.platforms.length === detected.length
    && current.platforms.every((platform, index) => platform === detected[index]);
  if (same) return detected;
  const updated = updateMarketplace(harnesstapDir, name, { platforms: detected });
  return updated.status === "updated" ? updated.entry.platforms : undefined;
}

export function readMarketplaceManifest(root: string): unknown | undefined {
  const manifest = resolveManifests(root, ["claude-code", "cursor", "copilot-cli"])[0];
  if (!manifest) return undefined;
  return readCachedMarketplaceJson(manifest.manifestPath);
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

export async function searchCatalogPlugins(
  harnesstapDir: string,
  query: string,
  options: SearchCatalogPluginsOptions = {},
): Promise<CatalogPlugin[]> {
  const marketplaces = listCatalogSearchMarketplaces(harnesstapDir);
  if (options.refresh) {
    const failures: string[] = [];
    for (const marketplace of marketplaces) {
      const refresh = await refreshMarketplaceCatalog(harnesstapDir, {
        name: marketplace.name,
        force: true,
        unattended: false,
      });
      if (!refresh.ok) {
        failures.push(`${marketplace.name}: ${refresh.message}`);
      }
    }
    if (failures.length > 0) {
      console.error(`[ht-agent] marketplace search refresh failed: ${failures.join("; ")}`);
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
