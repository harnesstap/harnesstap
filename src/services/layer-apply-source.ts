import type { Layer } from "../types.js";
import {
  getLayerByCatalogVersion,
  getLayerByName,
  getLayerByPublishedIdentity,
  resolveLayerSelector,
} from "../models/layer-model.js";
import {
  parseLayerSelector,
  resolveRemoteLayerSelector,
} from "./layer-selector.js";
import { installLayerFromCatalog } from "./layer-catalog-install.js";
import {
  LayerResolveError,
  resolveBareNameFromCatalog,
} from "./layer-bare-name-resolve.js";
import {
  fetchLayerExportToTempFile,
  isLayerExportFilePath,
  isLayerUrl,
} from "./layer-source.js";

export type ResolvedApplyLayerSource =
  | { kind: "local"; layerId: string }
  | { kind: "layer-export"; path: string };

export interface ResolveApplyLayerSourceOptions {
  account?: string;
  baseUrl?: string;
  onFetched?: (sourceLabel: string) => void;
}

function resolveLocalLayer(selector: string): Layer | undefined {
  const direct = resolveLayerSelector(selector);
  if (direct) {
    return direct;
  }

  try {
    const parsed = parseLayerSelector(selector);
    if (parsed.scope !== "published") {
      return undefined;
    }

    if (parsed.version) {
      const byPublishedIdentity = getLayerByPublishedIdentity({
        name: parsed.name,
        version: parsed.version,
        org: parsed.org,
        catalog: parsed.catalog,
      });
      if (byPublishedIdentity) {
        return byPublishedIdentity;
      }

      return getLayerByCatalogVersion(parsed.org, parsed.catalog, parsed.version);
    }

    return getLayerByName(parsed.name);
  } catch {
    return undefined;
  }
}

function isPublishedSelector(selector: string): boolean {
  try {
    return parseLayerSelector(selector).scope === "published";
  } catch {
    return false;
  }
}

function isBareLayerName(selector: string): boolean {
  if (isLayerUrl(selector) || isLayerExportFilePath(selector)) {
    return false;
  }
  return !selector.includes("/");
}

export async function resolveApplyLayerSource(
  selector: string,
  options: ResolveApplyLayerSourceOptions = {},
): Promise<ResolvedApplyLayerSource> {
  if (isLayerUrl(selector)) {
    const path = await fetchLayerExportToTempFile(selector);
    return { kind: "layer-export", path };
  }

  if (isLayerExportFilePath(selector)) {
    return { kind: "layer-export", path: selector };
  }

  const localLayer = resolveLocalLayer(selector);
  if (localLayer) {
    return { kind: "local", layerId: localLayer.id };
  }

  if (isBareLayerName(selector)) {
    const parsed = await resolveBareNameFromCatalog(selector, options);
    const installed = await installLayerFromCatalog(parsed, {
      account: options.account,
      baseUrl: options.baseUrl,
    });
    options.onFetched?.(installed.sourceLabel);
    return { kind: "local", layerId: installed.layerId };
  }

  if (!isPublishedSelector(selector)) {
    throw new LayerResolveError(`Layer not found: ${selector}`, [
      "hd layer search <query>",
      "hd layer pull org/catalog/name",
      "hd layer list",
    ]);
  }

  const parsed = resolveRemoteLayerSelector(selector, {});
  const installed = await installLayerFromCatalog(parsed, {
    account: options.account,
    baseUrl: options.baseUrl,
  });
  options.onFetched?.(installed.sourceLabel);
  return { kind: "local", layerId: installed.layerId };
}
