import { ulid } from "ulid";
import { deleteLayer } from "../models/layer-model.js";
import type { CatalogLayer } from "./catalog-types.js";
import { downloadCatalogBundle } from "./catalog-client.js";
import { importFromFile } from "./layer-import.js";
import { renderLayerShow } from "./layer-show-render.js";
import {
  formatCanonicalPublishedSelectorWithVersion,
} from "./layer-selector.js";
import { writeLayerExportToTempFile } from "./layer-source.js";

export type CatalogLayerPreviewOptions = {
  account?: string;
  baseUrl?: string;
  showId?: boolean;
};

export async function renderCatalogLayerPreviewShow(
  catalogLayer: CatalogLayer,
  opts: CatalogLayerPreviewOptions = {},
): Promise<string> {
  const downloaded = await downloadCatalogBundle({
    orgSlug: catalogLayer.orgSlug,
    catalogSlug: catalogLayer.catalogSlug,
    layerSlug: catalogLayer.slug,
    version: catalogLayer.latestVersion ?? "latest",
    account: opts.account,
    baseUrl: opts.baseUrl,
  });
  const tempPath = writeLayerExportToTempFile(downloaded.body);
  const previewLayerName = `__hd-preview-${ulid().toLowerCase()}__`;
  const imported = importFromFile(tempPath, {
    layerNameOverride: previewLayerName,
    resourceSource: "catalog-preview",
  });

  try {
    const layerLabel = formatCanonicalPublishedSelectorWithVersion({
      org: catalogLayer.orgSlug,
      catalog: catalogLayer.catalogSlug,
      name: catalogLayer.slug,
      version: downloaded.version,
    });
    return renderLayerShow(imported.layer, layerLabel, {
      showId: opts.showId,
      layerLabel,
    });
  } finally {
    deleteLayer(imported.layer.id);
  }
}
