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
  fetchLayerBundleToTempFile,
  isBundleFilePath,
  isLayerUrl,
} from "./layer-source.js";

export type ResolvedApplyLayerSource =
  | { kind: "local"; layerId: string }
  | { kind: "bundle"; path: string };

export interface ResolveApplyLayerSourceOptions {
  profile?: string;
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

export async function resolveApplyLayerSource(
  selector: string,
  options: ResolveApplyLayerSourceOptions = {},
): Promise<ResolvedApplyLayerSource> {
  if (isLayerUrl(selector)) {
    const path = await fetchLayerBundleToTempFile(selector);
    return { kind: "bundle", path };
  }

  if (isBundleFilePath(selector)) {
    return { kind: "bundle", path: selector };
  }

  const localLayer = resolveLocalLayer(selector);
  if (localLayer) {
    return { kind: "local", layerId: localLayer.id };
  }

  if (!isPublishedSelector(selector)) {
    throw new Error(`Layer not found: ${selector}`);
  }

  const parsed = resolveRemoteLayerSelector(selector, {});
  const installed = await installLayerFromCatalog(parsed, {
    profile: options.profile,
    baseUrl: options.baseUrl,
  });
  options.onFetched?.(installed.sourceLabel);
  return { kind: "local", layerId: installed.layerId };
}
