import { downloadCatalogBundle } from "./catalog-client.js";
import { importFromFile } from "./layer-import.js";
import { updateLayerPublishedIdentity } from "../models/layer-model.js";
import {
  formatPublishedSelectorWithVersion,
  type ResolvedRemoteLayerSelector,
} from "./layer-selector.js";
import { writeLayerExportToTempFile } from "./layer-source.js";
import { assertInstallLayerNameAvailable } from "./layer-install-conflicts.js";

export interface InstallLayerFromCatalogOptions {
  as?: string;
  account?: string;
  baseUrl?: string;
}

export interface InstallLayerFromCatalogResult {
  layerId: string;
  layerName: string;
  version: string;
  sourceLabel: string;
}

export async function installLayerFromCatalog(
  parsed: ResolvedRemoteLayerSelector,
  opts: InstallLayerFromCatalogOptions = {},
): Promise<InstallLayerFromCatalogResult> {
  assertInstallLayerNameAvailable(parsed, opts);

  const downloaded = await downloadCatalogBundle({
    orgSlug: parsed.org_slug,
    catalogSlug: parsed.catalog_slug,
    layerSlug: parsed.layer_slug,
    version: parsed.version,
    account: opts.account,
    baseUrl: opts.baseUrl,
  });
  const tempPath = writeLayerExportToTempFile(downloaded.body);
  const imported = importFromFile(tempPath, { layerNameOverride: opts.as });
  updateLayerPublishedIdentity(imported.layer.id, {
    org_slug: parsed.org_slug,
    catalog_slug: parsed.catalog_slug,
    version: downloaded.version,
  });

  const sourceLabel = formatPublishedSelectorWithVersion({
    org: parsed.org_slug,
    catalog: parsed.catalog_slug,
    name: parsed.layer_slug,
    version: downloaded.version,
  });

  return {
    layerId: imported.layer.id,
    layerName: imported.layer.name,
    version: downloaded.version,
    sourceLabel,
  };
}
