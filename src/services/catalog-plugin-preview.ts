import { ulid } from "ulid";
import { deletePlugin } from "../models/plugin-model.js";
import type { CatalogPlugin } from "./catalog-types.js";
import { downloadCatalogBundle } from "./catalog-client.js";
import { importFromFile } from "./plugin-import.js";
import { renderPluginShow } from "./plugin-show-render.js";
import {
  formatCanonicalPublishedSelectorWithVersion,
} from "./plugin-selector.js";
import { writePluginExportToTempFile } from "./plugin-source.js";

export type CatalogPluginPreviewOptions = {
  account?: string;
  baseUrl?: string;
  showId?: boolean;
};

export async function renderCatalogPluginPreviewShow(
  catalogPlugin: CatalogPlugin,
  opts: CatalogPluginPreviewOptions = {},
): Promise<string> {
  const downloaded = await downloadCatalogBundle({
    orgSlug: catalogPlugin.orgSlug,
    catalogSlug: catalogPlugin.catalogSlug,
    pluginSlug: catalogPlugin.slug,
    version: catalogPlugin.latestVersion ?? "latest",
    account: opts.account,
    baseUrl: opts.baseUrl,
  });
  const tempPath = writePluginExportToTempFile(downloaded.body);
  const previewPluginName = `__hd-preview-${ulid().toLowerCase()}__`;
  const imported = importFromFile(tempPath, {
    pluginNameOverride: previewPluginName,
    resourceSource: "catalog-preview",
  });

  try {
    const pluginLabel = formatCanonicalPublishedSelectorWithVersion({
      org: catalogPlugin.orgSlug,
      catalog: catalogPlugin.catalogSlug,
      name: catalogPlugin.slug,
      version: downloaded.version,
    });
    return renderPluginShow(imported.plugin, pluginLabel, {
      showId: opts.showId,
      pluginLabel,
    });
  } finally {
    deletePlugin(imported.plugin.id);
  }
}
