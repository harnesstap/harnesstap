import { downloadCatalogBundle } from "./catalog-client.js";
import { importFromFile } from "./plugin-import.js";
import { updatePluginPublishedIdentity } from "../models/plugin-model.js";
import {
  formatPublishedSelectorWithVersion,
  type ResolvedRemotePluginSelector,
} from "./plugin-selector.js";
import { writePluginExportToTempFile } from "./plugin-source.js";
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

  const downloaded = await downloadCatalogBundle({
    orgSlug: parsed.org_slug,
    catalogSlug: parsed.catalog_slug,
    pluginSlug: parsed.plugin_slug,
    version: parsed.version,
    account: opts.account,
    baseUrl: opts.baseUrl,
  });
  const tempPath = writePluginExportToTempFile(downloaded.body);
  const imported = importFromFile(tempPath, { pluginNameOverride: opts.as });
  updatePluginPublishedIdentity(imported.plugin.id, {
    org_slug: parsed.org_slug,
    catalog_slug: parsed.catalog_slug,
    version: downloaded.version,
  });

  const sourceLabel = formatPublishedSelectorWithVersion({
    org: parsed.org_slug,
    catalog: parsed.catalog_slug,
    name: parsed.plugin_slug,
    version: downloaded.version,
  });

  return {
    pluginId: imported.plugin.id,
    pluginName: imported.plugin.name,
    version: downloaded.version,
    sourceLabel,
  };
}
