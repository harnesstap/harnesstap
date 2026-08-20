import { downloadCatalogPackage } from "./catalog-client.js";
import { importApPackageFiles } from "./agent-plugins/import.js";
import {
  getPluginByCatalogVersion,
  getPluginByPublishedIdentity,
  stampPluginOrigin,
  updatePluginPublishedIdentity,
} from "../models/plugin-model.js";
import {
  formatPublishedSelectorWithVersion,
  type ResolvedRemotePluginSelector,
} from "./plugin-selector.js";
import { assertInstallPluginNameAvailable } from "./plugin-install-conflicts.js";

export interface InstallPluginFromCatalogOptions {
  as?: string;
  account?: string;
  baseUrl?: string;
}

export interface InstallPluginFromCatalogResult {
  pluginId: string;
  pluginName: string;
  version: string;
  sourceLabel: string;
}

export async function installPluginFromCatalog(
  parsed: ResolvedRemotePluginSelector,
  opts: InstallPluginFromCatalogOptions = {},
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

  // Reuse an existing install of this catalog version (name may differ from slug).
  const existing =
    getPluginByCatalogVersion(parsed.org_slug, parsed.catalog_slug, downloaded.version)
    ?? getPluginByPublishedIdentity({
      name: parsed.plugin_slug,
      version: downloaded.version,
      org: parsed.org_slug,
      catalog: parsed.catalog_slug,
    });
  if (existing && !opts.as) {
    stampPluginOrigin(existing.id, { locator });
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

  return {
    pluginId: imported.id,
    pluginName: imported.name,
    version: downloaded.version,
    sourceLabel,
  };
}
