import { downloadCatalogPackage, fetchCatalogPlugin } from "./catalog-client.js";
import {
  CatalogDependencyVersionError,
  CatalogPackageNotFoundError,
} from "./catalog-package-errors.js";
import { importApPackageFiles } from "./agent-plugins/import.js";
import {
  findPluginForCatalogInstall,
  getPluginById,
  getPluginByName,
  listPluginVersions,
  stampPluginOrigin,
  updatePluginPublishedIdentity,
} from "../models/plugin-model.js";
import {
  formatCanonicalPublishedSelectorWithVersion,
  formatPublishedSelectorWithVersion,
  parsePluginSelector,
  resolveRemotePluginSelector,
  type ResolvedRemotePluginSelector,
} from "./plugin-selector.js";
import { assertInstallPluginNameAvailable } from "./plugin-install-conflicts.js";
import { trackPluginInstalled } from "../telemetry/index.js";
import { listDependencies } from "./plugin-dependency.js";
import {
  parseVersionConstraint,
  satisfiesConstraint,
} from "./plugin-constraints.js";
import type { Plugin } from "../types.js";

export interface InstallPluginFromCatalogOptions {
  as?: string;
  account?: string;
  baseUrl?: string;
  onFetched?: (sourceLabel: string) => void;
}

export interface InstallPluginFromCatalogResult {
  pluginId: string;
  pluginName: string;
  version: string;
  sourceLabel: string;
}

function catalogIdentity(
  plugin: Plugin,
): { org: string; catalog: string } | undefined {
  if (plugin.org_slug && plugin.catalog_slug) {
    return { org: plugin.org_slug, catalog: plugin.catalog_slug };
  }
  return undefined;
}

function findLocalSatisfyingPlugin(
  name: string,
  constraint: string,
): Plugin | undefined {
  const trimmed = constraint.trim();
  const versions = listPluginVersions(name);
  if (versions.length === 0) {
    return undefined;
  }
  if (!trimmed || trimmed === "*" || trimmed === "latest") {
    return getPluginByName(name);
  }
  const matching = versions.find((version) =>
    satisfiesConstraint(trimmed, version),
  );
  return matching ? getPluginByName(name, matching) : undefined;
}

function exactPinnedVersion(constraint: string): string | undefined {
  const trimmed = constraint.trim();
  if (!trimmed || trimmed === "*" || trimmed === "latest") {
    return undefined;
  }
  try {
    const parsed = parseVersionConstraint(trimmed);
    return parsed.kind === "exact" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function catalogTargetForDependency(
  parent: Plugin,
  depName: string,
  depRef: string,
  sourceKind: string,
): { org: string; catalog: string; slug: string } | undefined {
  if (sourceKind === "catalog") {
    try {
      const parsed = parsePluginSelector(depRef);
      if (parsed.scope === "published") {
        return { org: parsed.org, catalog: parsed.catalog, slug: parsed.name };
      }
    } catch {
      // Fall through to parent catalog identity.
    }
  }
  if (sourceKind === "marketplace" || sourceKind === "git") {
    return undefined;
  }
  if (depRef.startsWith("./") || depRef.startsWith("../")) {
    return undefined;
  }
  const parentCatalog = catalogIdentity(parent);
  if (!parentCatalog) {
    return undefined;
  }
  return { ...parentCatalog, slug: depName };
}

async function resolveCatalogFetchVersion(input: {
  org: string;
  catalog: string;
  slug: string;
  constraint: string;
  account?: string;
  baseUrl?: string;
}): Promise<{ version: string; available: string[] }> {
  const pinned = exactPinnedVersion(input.constraint);
  let available: string[] = [];
  let latest: string | null = null;
  try {
    const listed = await fetchCatalogPlugin(
      {
        orgSlug: input.org,
        catalogSlug: input.catalog,
        slug: input.slug,
      },
      { account: input.account, baseUrl: input.baseUrl },
    );
    latest = listed.latestVersion;
    if (listed.latestVersion) {
      available = [listed.latestVersion];
    }
  } catch {
    // Listing can fail independently of a later package download.
  }

  if (pinned) {
    return { version: pinned, available };
  }
  if (latest && (
    !input.constraint.trim()
    || input.constraint.trim() === "*"
    || input.constraint.trim() === "latest"
    || satisfiesConstraint(input.constraint, latest)
  )) {
    return { version: latest, available };
  }
  throw new CatalogDependencyVersionError({
    pluginName: input.slug,
    version: input.constraint.trim() || "*",
    catalog: `${input.org}/${input.catalog}`,
    available,
    requirer: "",
  });
}

/**
 * Fetch missing library dependencies from the same catalog the parent
 * package came from (including `source: "local"` edges in catalog packages).
 * Recurses through transitive deps. Marketplace/git/path refs are left to
 * their existing apply paths.
 */
export async function ensureMissingCatalogDependencies(
  pluginIds: string[],
  opts: InstallPluginFromCatalogOptions = {},
  seen: Set<string> = new Set(),
): Promise<InstallPluginFromCatalogResult[]> {
  const pulled: InstallPluginFromCatalogResult[] = [];
  const queue = [...pluginIds];

  while (queue.length > 0) {
    const pluginId = queue.shift();
    if (!pluginId || seen.has(pluginId)) {
      continue;
    }
    seen.add(pluginId);
    const plugin = getPluginById(pluginId);
    if (!plugin) {
      continue;
    }

    for (const dependency of listDependencies(pluginId)) {
      const local = findLocalSatisfyingPlugin(
        dependency.name,
        dependency.version_constraint,
      );
      if (local) {
        queue.push(local.id);
        continue;
      }

      const target = catalogTargetForDependency(
        plugin,
        dependency.name,
        dependency.ref,
        dependency.source_kind,
      );
      if (!target) {
        continue;
      }

      const requirer = `${plugin.name}@${plugin.version}`;
      let fetchVersion: string;
      let available: string[] = [];
      try {
        const resolved = await resolveCatalogFetchVersion({
          org: target.org,
          catalog: target.catalog,
          slug: target.slug,
          constraint: dependency.version_constraint,
          account: opts.account,
          baseUrl: opts.baseUrl,
        });
        fetchVersion = resolved.version;
        available = resolved.available;
      } catch (error) {
        if (error instanceof CatalogDependencyVersionError) {
          throw new CatalogDependencyVersionError({
            pluginName: target.slug,
            version: error.version,
            catalog: `${target.org}/${target.catalog}`,
            available: error.available,
            requirer,
          });
        }
        throw error;
      }

      const fetchKey = formatCanonicalPublishedSelectorWithVersion({
        org: target.org,
        catalog: target.catalog,
        name: target.slug,
        version: fetchVersion,
      });
      if (seen.has(`fetch:${fetchKey}`)) {
        continue;
      }
      seen.add(`fetch:${fetchKey}`);

      try {
        const installed = await installPluginFromCatalog(
          resolveRemotePluginSelector(fetchKey, {}),
          opts,
          seen,
        );
        opts.onFetched?.(installed.sourceLabel);
        pulled.push(installed);
        queue.push(installed.pluginId);
      } catch (error) {
        if (!(error instanceof CatalogPackageNotFoundError)) {
          throw error;
        }
        if (available.length > 0) {
          throw new CatalogDependencyVersionError({
            pluginName: target.slug,
            version: fetchVersion,
            catalog: `${target.org}/${target.catalog}`,
            available,
            requirer,
          });
        }
        try {
          const listed = await fetchCatalogPlugin(
            {
              orgSlug: target.org,
              catalogSlug: target.catalog,
              slug: target.slug,
            },
            { account: opts.account, baseUrl: opts.baseUrl },
          );
          throw new CatalogDependencyVersionError({
            pluginName: target.slug,
            version: fetchVersion,
            catalog: `${target.org}/${target.catalog}`,
            available: listed.latestVersion ? [listed.latestVersion] : [],
            requirer,
          });
        } catch (listedError) {
          if (listedError instanceof CatalogDependencyVersionError) {
            throw listedError;
          }
          // Plugin is not in that catalog: leave it for local-inventory errors.
        }
      }
    }
  }

  return pulled;
}

export async function installPluginFromCatalog(
  parsed: ResolvedRemotePluginSelector,
  opts: InstallPluginFromCatalogOptions = {},
  seen: Set<string> = new Set(),
): Promise<InstallPluginFromCatalogResult> {
  assertInstallPluginNameAvailable(parsed, opts);

  const downloaded = await downloadCatalogPackage({
    orgSlug: parsed.org_slug,
    catalogSlug: parsed.catalog_slug,
    pluginSlug: parsed.plugin_slug,
    version: parsed.version,
    account: opts.account,
    baseUrl: opts.baseUrl,
  });

  const sourceLabel = formatPublishedSelectorWithVersion({
    org: parsed.org_slug,
    catalog: parsed.catalog_slug,
    name: parsed.plugin_slug,
    version: downloaded.version,
  });

  const locator = `${parsed.org_slug}/${parsed.catalog_slug}/${parsed.plugin_slug}`;

  // Reuse this catalog plugin version. Do not treat a sibling package that
  // happens to share org/catalog/version (e.g. two 1.0.0 plugins) as a hit.
  const existing = findPluginForCatalogInstall({
    org: parsed.org_slug,
    catalog: parsed.catalog_slug,
    pluginSlug: parsed.plugin_slug,
    version: downloaded.version,
  });
  if (existing && !opts.as) {
    stampPluginOrigin(existing.id, { locator });
    await ensureMissingCatalogDependencies([existing.id], opts, seen);
    return {
      pluginId: existing.id,
      pluginName: existing.name,
      version: downloaded.version,
      sourceLabel,
    };
  }

  const imported = importApPackageFiles(downloaded.files, {
    as: opts.as,
    origin: "catalog",
  });
  updatePluginPublishedIdentity(imported.id, {
    org_slug: parsed.org_slug,
    catalog_slug: parsed.catalog_slug,
    version: downloaded.version,
  });
  stampPluginOrigin(imported.id, { locator });
  trackPluginInstalled({
    pluginSlug: parsed.plugin_slug,
    source: "catalog",
  });

  await ensureMissingCatalogDependencies([imported.id], opts, seen);

  return {
    pluginId: imported.id,
    pluginName: imported.name,
    version: downloaded.version,
    sourceLabel,
  };
}
