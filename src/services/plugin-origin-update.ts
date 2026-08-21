import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import {
  getPluginById,
  getPluginResources,
  resolvePluginSelector,
  stampPluginOrigin,
} from "../models/plugin-model.js";
import { refreshGitSource } from "../plugins/refresh.js";
import type {
  OriginFingerprintKind,
  Plugin,
  ResourceMetadata,
  ResourceType,
} from "../types.js";
import { formatCatalogRequestError } from "../utils/fetch-with-timeout.js";
import { fetchCatalogPlugin } from "./catalog-client.js";
import {
  marketplaceCacheDir,
  refreshMarketplaceCatalog,
} from "./marketplace-catalog.js";
import { parseDependencyRef } from "./plugin-dependency.js";
import {
  formatOriginLocator,
  listOriginUpdateCandidates,
  recoverOriginLocator,
  selectOriginUpdateTarget,
} from "./plugin-origin-locator.js";
import { scanPluginSource } from "./plugin-source-import.js";
import { hashResourceBody } from "./resource-hash.js";

export type PluginOriginCheckStatus = "current" | "outdated" | "unknown" | "error";

export type PluginOriginCheckRow = {
  plugin_id: string;
  name: string;
  origin_locator: string;
  status: PluginOriginCheckStatus;
  local_version: string;
  origin_version?: string;
  origin_fingerprint?: string;
  message?: string;
};

export type PluginOriginCheckReport = { results: PluginOriginCheckRow[] };

export type OriginRefreshResult = {
  ok: boolean;
  sha?: string;
  message: string;
};

export type CatalogLatestResult =
  | { version: string; digest?: string }
  | { error: string; authRequired?: boolean };

export type PluginOriginUpdateDeps = {
  refreshMarketplace?: (
    harnesstapDir: string,
    options: { name: string; force: boolean },
  ) => OriginRefreshResult | Promise<OriginRefreshResult>;
  refreshGit?: (options: {
    url: string;
    targetDir: string;
  }) => OriginRefreshResult | Promise<OriginRefreshResult>;
  listCatalogLatest?: (locator: {
    org: string;
    catalog: string;
    slug: string;
  }) => CatalogLatestResult | Promise<CatalogLatestResult>;
};

const AUTHORED_CHECK_MESSAGE = "authored plugin; there is no upstream to sync from";
const DUPLICATE_LOCATOR_MESSAGE = "another working head owns this origin";

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function gitOriginCacheDir(harnesstapDir: string, url: string): string {
  const digest = createHash("sha256").update(url, "utf8").digest("hex");
  return join(harnesstapDir, "cache", "git-origins", digest);
}

function findCachedPluginRoot(cacheDir: string, pluginName: string): string | undefined {
  const underPlugins = join(cacheDir, "plugins", pluginName);
  if (isDirectory(underPlugins)) return underPlugins;

  const atRoot = join(cacheDir, pluginName);
  if (isDirectory(atRoot)) return atRoot;

  if (!isDirectory(cacheDir)) return undefined;

  for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".git") {
      continue;
    }
    const nested = join(cacheDir, entry.name, pluginName);
    if (isDirectory(nested)) return nested;
  }
  return undefined;
}

function stripVolatileMetadata(metadata: ResourceMetadata): ResourceMetadata {
  const cloned = structuredClone(metadata) as Record<string, unknown>;
  const imported = cloned.imported_from;
  if (imported && typeof imported === "object" && !Array.isArray(imported)) {
    const rest = { ...(imported as Record<string, unknown>) };
    delete rest.imported_at;
    cloned.imported_from = rest;
  }
  return cloned as ResourceMetadata;
}

function originTreeSignature(
  resources: Array<{
    type: ResourceType;
    content: string;
    metadata: ResourceMetadata;
  }>,
): string {
  return resources
    .map((resource) =>
      hashResourceBody({
        type: resource.type,
        content: resource.content,
        metadata: stripVolatileMetadata(resource.metadata),
      }),
    )
    .sort()
    .join("\n");
}

async function scanOriginTree(
  sourcePath: string,
  pluginName: string,
): Promise<Awaited<ReturnType<typeof scanPluginSource>>[number] | undefined> {
  const manifestCandidates = [
    join(sourcePath, ".claude-plugin", "marketplace.json"),
    join(sourcePath, ".cursor-plugin", "marketplace.json"),
    join(sourcePath, "marketplace.json"),
  ];
  for (const manifestPath of manifestCandidates) {
    if (!existsSync(manifestPath)) continue;
    try {
      const scans = await scanPluginSource(manifestPath);
      return scans.find((scan) => scan.plugin_name === pluginName) ?? scans[0];
    } catch {
      // try the next manifest layout
    }
  }

  const pluginRoot = findCachedPluginRoot(sourcePath, pluginName) ?? sourcePath;
  try {
    const scans = await scanPluginSource(pluginRoot);
    return scans.find((scan) => scan.plugin_name === pluginName) ?? scans[0];
  } catch {
    return undefined;
  }
}

async function originContentMatches(
  plugin: Plugin,
  sourcePath: string,
): Promise<boolean> {
  const scan = await scanOriginTree(sourcePath, plugin.name);
  if (!scan) return false;
  const localSig = originTreeSignature(getPluginResources(plugin.id));
  const originSig = originTreeSignature(scan.resources);
  return localSig === originSig;
}

function isCatalogError(
  result: CatalogLatestResult,
): result is { error: string; authRequired?: boolean } {
  return "error" in result;
}

function catalogErrorMessage(result: { error: string; authRequired?: boolean }): string {
  if (!result.authRequired) return result.error;
  if (/sign in/i.test(result.error)) return result.error;
  return `${result.error}; sign in required to check this catalog plugin`;
}

function thrownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultListCatalogLatest(locator: {
  org: string;
  catalog: string;
  slug: string;
}): Promise<CatalogLatestResult> {
  try {
    const plugin = await fetchCatalogPlugin({
      orgSlug: locator.org,
      catalogSlug: locator.catalog,
      slug: locator.slug,
    });
    const version = plugin.latestVersion ?? "";
    if (!version) {
      return { error: "Catalog plugin has no latest version" };
    }
    return { version };
  } catch (error) {
    const message = formatCatalogRequestError(error);
    return {
      error: message,
      authRequired: /401/.test(message),
    };
  }
}

function checkRow(
  plugin: Plugin,
  originLocator: string,
  status: PluginOriginCheckStatus,
  extra?: Omit<PluginOriginCheckRow, "plugin_id" | "name" | "origin_locator" | "status" | "local_version">,
): PluginOriginCheckRow {
  return {
    plugin_id: plugin.id,
    name: plugin.name,
    origin_locator: originLocator,
    status,
    local_version: plugin.version,
    ...extra,
  };
}

function authoredRow(plugin: Plugin): PluginOriginCheckRow {
  const locator = recoverOriginLocator(plugin);
  return checkRow(plugin, locator ? formatOriginLocator(locator) : "", "unknown", {
    message: AUTHORED_CHECK_MESSAGE,
  });
}

async function compareGitSha(
  plugin: Plugin,
  locatorStr: string,
  fetched: OriginRefreshResult,
  sourcePath: string,
): Promise<PluginOriginCheckRow> {
  if (!fetched.ok) {
    return checkRow(plugin, locatorStr, "error", { message: fetched.message });
  }
  const sha = fetched.sha;
  if (!sha) {
    return checkRow(plugin, locatorStr, "error", {
      message: fetched.message || "Origin refresh did not return a SHA",
    });
  }

  const stored = plugin.origin_fingerprint ?? "";
  if (stored === sha) {
    return checkRow(plugin, locatorStr, "current", {
      origin_version: sha,
      origin_fingerprint: sha,
    });
  }
  if (stored) {
    return checkRow(plugin, locatorStr, "outdated", {
      origin_version: sha,
      origin_fingerprint: sha,
    });
  }

  if (await originContentMatches(plugin, sourcePath)) {
    stampPluginOrigin(plugin.id, {
      locator: locatorStr,
      fingerprint: sha,
      fingerprintKind: "git_sha",
    });
    return checkRow(plugin, locatorStr, "current", {
      origin_version: sha,
      origin_fingerprint: sha,
    });
  }

  return checkRow(plugin, locatorStr, "outdated", {
    origin_version: sha,
    origin_fingerprint: sha,
  });
}

async function compareCatalog(
  plugin: Plugin,
  locatorStr: string,
  latest: CatalogLatestResult,
): Promise<PluginOriginCheckRow> {
  if (isCatalogError(latest)) {
    return checkRow(plugin, locatorStr, "error", {
      message: catalogErrorMessage(latest),
    });
  }

  const fingerprint = latest.digest ?? latest.version;
  const fingerprintKind: OriginFingerprintKind = latest.digest
    ? "catalog_digest"
    : "catalog_version";
  const stored = plugin.origin_fingerprint ?? "";

  if (stored === fingerprint) {
    return checkRow(plugin, locatorStr, "current", {
      origin_version: latest.version,
      origin_fingerprint: fingerprint,
    });
  }
  if (stored) {
    return checkRow(plugin, locatorStr, "outdated", {
      origin_version: latest.version,
      origin_fingerprint: fingerprint,
    });
  }

  if (latest.version !== plugin.version) {
    return checkRow(plugin, locatorStr, "outdated", {
      origin_version: latest.version,
      origin_fingerprint: fingerprint,
    });
  }

  stampPluginOrigin(plugin.id, {
    locator: locatorStr,
    fingerprint,
    fingerprintKind,
  });
  return checkRow(plugin, locatorStr, "current", {
    origin_version: latest.version,
    origin_fingerprint: fingerprint,
  });
}

export async function checkPluginOrigins(opts?: {
  name?: string;
  refresh?: boolean;
  deps?: PluginOriginUpdateDeps;
}): Promise<PluginOriginCheckReport> {
  const harnesstapDir = getHarnesstapDir();
  const force = Boolean(opts?.refresh);
  const refreshMarketplace =
    opts?.deps?.refreshMarketplace ?? refreshMarketplaceCatalog;
  const refreshGit = opts?.deps?.refreshGit ?? refreshGitSource;
  const listCatalogLatest = opts?.deps?.listCatalogLatest ?? defaultListCatalogLatest;

  if (opts?.name) {
    const named = resolvePluginSelector(opts.name);
    if (!named) {
      return { results: [] };
    }
    const plugin = getPluginById(named.id) ?? named;
    if (plugin.origin === "authored") {
      return { results: [authoredRow(plugin)] };
    }
  }

  let candidates = listOriginUpdateCandidates();
  if (opts?.name) {
    const named = resolvePluginSelector(opts.name);
    candidates = named ? candidates.filter((plugin) => plugin.id === named.id) : [];
  }

  const results: PluginOriginCheckRow[] = [];
  const locatable: Plugin[] = [];
  for (const plugin of candidates) {
    if (!recoverOriginLocator(plugin)) {
      results.push(checkRow(plugin, "", "unknown"));
      continue;
    }
    locatable.push(plugin);
  }

  const marketplaceFetches = new Map<string, Promise<OriginRefreshResult>>();
  const gitFetches = new Map<string, Promise<OriginRefreshResult>>();

  const fetchMarketplace = (name: string) => {
    const existing = marketplaceFetches.get(name);
    if (existing) return existing;
    const pending = Promise.resolve()
      .then(() => refreshMarketplace(harnesstapDir, { name, force }))
      .catch((error: unknown) => ({
        ok: false as const,
        message: thrownErrorMessage(error),
      }));
    marketplaceFetches.set(name, pending);
    return pending;
  };

  const fetchGit = (url: string) => {
    const existing = gitFetches.get(url);
    if (existing) return existing;
    const targetDir = gitOriginCacheDir(harnesstapDir, url);
    const pending = Promise.resolve()
      .then(() => refreshGit({ url, targetDir }))
      .catch((error: unknown) => ({
        ok: false as const,
        message: thrownErrorMessage(error),
      }));
    gitFetches.set(url, pending);
    return pending;
  };

  for (const { target, skipped } of selectOriginUpdateTarget(locatable)) {
    const locator = recoverOriginLocator(target);
    if (!locator) {
      results.push(checkRow(target, "", "unknown"));
      continue;
    }
    const locatorStr = formatOriginLocator(locator);
    let targetRow: PluginOriginCheckRow;

    switch (locator.kind) {
      case "marketplace": {
        const parsed = parseDependencyRef(locator.ref);
        const fetched = await fetchMarketplace(parsed.namespace);
        const cacheDir = marketplaceCacheDir(harnesstapDir, parsed.namespace);
        targetRow = await compareGitSha(target, locatorStr, fetched, cacheDir);
        break;
      }
      case "git": {
        const fetched = await fetchGit(locator.url);
        targetRow = await compareGitSha(
          target,
          locatorStr,
          fetched,
          gitOriginCacheDir(harnesstapDir, locator.url),
        );
        break;
      }
      case "catalog": {
        let latest: CatalogLatestResult;
        try {
          latest = await Promise.resolve(
            listCatalogLatest({
              org: locator.org,
              catalog: locator.catalog,
              slug: locator.slug,
            }),
          );
        } catch (error) {
          latest = { error: thrownErrorMessage(error) };
        }
        targetRow = await compareCatalog(target, locatorStr, latest);
        break;
      }
      default: {
        const _exhaustive: never = locator;
        throw new Error(`Unhandled origin locator: ${JSON.stringify(_exhaustive)}`);
      }
    }

    results.push(targetRow);
    for (const duplicate of skipped) {
      if (targetRow.status === "error") {
        results.push(
          checkRow(duplicate, locatorStr, "error", {
            message: targetRow.message,
          }),
        );
        continue;
      }
      results.push(
        checkRow(duplicate, locatorStr, "current", {
          message: DUPLICATE_LOCATOR_MESSAGE,
        }),
      );
    }
  }

  return { results };
}
