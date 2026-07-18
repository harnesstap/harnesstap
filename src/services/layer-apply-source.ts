import type { Layer } from "../types.js";
import {
  formatPublishedLayerSelector,
  getLayerByName,
  getLayerByCatalogVersion,
  getLayerByPublishedIdentity,
  listLatestPublishedLayersBySlug,
  resolveLayerSelector,
} from "../models/layer-model.js";
import {
  parseLayerSelector,
  resolveRemoteLayerSelector,
} from "./layer-selector.js";
import type { CatalogLayer } from "./catalog-types.js";
import { installLayerFromCatalog } from "./layer-catalog-install.js";
import {
  LayerResolveError,
  resolveBareNameFromCatalog,
} from "./layer-bare-name-resolve.js";
import { satisfiesConstraint } from "./plugin-constraints.js";
import { promptForChoice, shouldUseWizard } from "./wizards/shared.js";
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
  interactive?: boolean;
  noInteractive?: boolean;
  format?: "human" | "json";
  promptAmbiguity?: (input: {
    selector: string;
    candidates: CatalogLayer[];
  }) => Promise<CatalogLayer>;
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

function filterLayersByVersionConstraint(
  layers: Layer[],
  versionConstraint?: string,
): Layer[] {
  if (!versionConstraint) {
    return layers;
  }
  return layers.filter((layer) => satisfiesConstraint(versionConstraint, layer.version));
}

function getUnpublishedLocalByName(name: string): Layer | undefined {
  const layer = getLayerByName(name);
  if (!layer) {
    return undefined;
  }
  if (layer.org_slug || layer.catalog_slug) {
    return undefined;
  }
  return layer;
}

function formatLocalPublishedAmbiguity(selector: string, layers: Layer[]): string {
  const lines = layers.map((layer) => formatPublishedLayerSelector(layer));
  return `Ambiguous layer name: ${selector}\n${lines.map((line) => `  ${line}`).join("\n")}`;
}

async function promptLocalPublishedAmbiguity(
  selector: string,
  layers: Layer[],
): Promise<Layer> {
  const selected = await promptForChoice({
    message: `Multiple installed layers match "${selector}". Which one?`,
    choices: layers.map((layer) => ({
      name: formatPublishedLayerSelector(layer),
      value: layer.id,
    })),
  });
  const match = layers.find((layer) => layer.id === selected);
  if (!match) {
    throw new LayerResolveError(`Layer not found: ${selector}`);
  }
  return match;
}

async function pickLocalPublishedLayer(
  selector: string,
  layers: Layer[],
  options: ResolveApplyLayerSourceOptions,
): Promise<Layer> {
  if (layers.length === 1) {
    const only = layers[0];
    if (!only) {
      throw new LayerResolveError(`Layer not found: ${selector}`);
    }
    return only;
  }

  const canPrompt = shouldUseWizard({
    interactive: options.interactive ?? true,
    noInteractive: options.noInteractive,
    format: options.format ?? "human",
    missingRequiredArgs: false,
  });

  if (!canPrompt) {
    throw new LayerResolveError(formatLocalPublishedAmbiguity(selector, layers), [
      "Use a fully qualified selector: org/catalog/slug@version",
    ]);
  }

  return promptLocalPublishedAmbiguity(selector, layers);
}

async function resolveBareApplyLayerSource(
  selector: string,
  options: ResolveApplyLayerSourceOptions,
): Promise<ResolvedApplyLayerSource> {
  const parsed = parseLayerSelector(selector);
  if (parsed.scope !== "local") {
    throw new LayerResolveError(`Layer not found: ${selector}`);
  }

  const publishedLocals = filterLayersByVersionConstraint(
    listLatestPublishedLayersBySlug(parsed.name),
    parsed.version,
  );
  if (publishedLocals.length > 0) {
    const layer = await pickLocalPublishedLayer(selector, publishedLocals, options);
    return { kind: "local", layerId: layer.id };
  }

  const unpublishedLocal = getUnpublishedLocalByName(parsed.name);
  if (unpublishedLocal) {
    return { kind: "local", layerId: unpublishedLocal.id };
  }

  const remote = await resolveBareNameFromCatalog(selector, {
    account: options.account,
    baseUrl: options.baseUrl,
    interactive: options.interactive,
    noInteractive: options.noInteractive,
    format: options.format,
    promptAmbiguity: options.promptAmbiguity,
  });
  const installed = await installLayerFromCatalog(remote, {
    account: options.account,
    baseUrl: options.baseUrl,
  });
  options.onFetched?.(installed.sourceLabel);
  return { kind: "local", layerId: installed.layerId };
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
  if (localLayer && !isBareLayerName(selector)) {
    return { kind: "local", layerId: localLayer.id };
  }

  if (isBareLayerName(selector)) {
    return resolveBareApplyLayerSource(selector, options);
  }

  if (!isPublishedSelector(selector)) {
    throw new LayerResolveError(`Layer not found: ${selector}`, [
      "ht layer list --search <query> --remote-only",
      "ht layer pull org/catalog/name",
      "ht layer list",
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
