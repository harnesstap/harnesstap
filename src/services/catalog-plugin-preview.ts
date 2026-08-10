import { ulid } from "ulid";
import { deletePlugin } from "../models/plugin-model.js";
import type { CatalogPlugin } from "./catalog-types.js";
import { downloadCatalogPackage } from "./catalog-client.js";
import { importApPackageFiles } from "./agent-plugins/import.js";
import { renderPluginShow } from "./plugin-show-render.js";
import {
  formatCanonicalPublishedSelectorWithVersion,
} from "./plugin-selector.js";

export type CatalogPluginPreviewOptions = {
  account?: string;
  baseUrl?: string;
  showId?: boolean;
};

export async function renderCatalogPluginPreviewShow(
  catalogPlugin: CatalogPlugin,
  opts: CatalogPluginPreviewOptions = {},
): Promise<string> {
  const downloaded = await downloadCatalogPackage({
    orgSlug: catalogPlugin.orgSlug,
    catalogSlug: catalogPlugin.catalogSlug,
    pluginSlug: catalogPlugin.slug,
    version: catalogPlugin.latestVersion ?? "latest",
    account: opts.account,
    baseUrl: opts.baseUrl,
  });
  const previewPluginName = `__hd-preview-${ulid().toLowerCase()}__`;
  const imported = importApPackageFiles(downloaded.files, {
    as: previewPluginName,
    origin: "catalog",
  });

  try {
    const pluginLabel = formatCanonicalPublishedSelectorWithVersion({
      org: catalogPlugin.orgSlug,
      catalog: catalogPlugin.catalogSlug,
      name: catalogPlugin.slug,
      version: downloaded.version,
    });
    return renderPluginShow(imported, pluginLabel, {
      showId: opts.showId,
      pluginLabel,
    });
  } finally {
    deletePlugin(imported.id);
  }
}
