import { listLayersInScope } from "./catalog-client.js";
import { isPublicCatalogEnabled } from "../config/catalog.js";
import type { CatalogLayer } from "./catalog-types.js";
import {
  parseLayerSelector,
  resolveRemoteLayerSelector,
  type ResolvedRemoteLayerSelector,
} from "./layer-selector.js";

export class LayerResolveError extends Error {
  readonly hints: string[];

  constructor(message: string, hints: string[] = []) {
    super(message);
    this.name = "LayerResolveError";
    this.hints = hints;
  }
}

export class LayerAmbiguityError extends LayerResolveError {
  readonly candidates: CatalogLayer[];

  constructor(selector: string, candidates: CatalogLayer[]) {
    const lines = candidates.map((layer) =>
      formatCatalogSelector(layer, layer.latestVersion ?? undefined),
    );
    super(
      `Ambiguous layer name: ${selector}\n${lines.map((line) => `  ${line}`).join("\n")}`,
      ["Use a fully qualified selector: org/catalog/name@version"],
    );
    this.candidates = candidates;
  }
}

function exactCatalogMatches(layers: CatalogLayer[], searchName: string): CatalogLayer[] {
  const normalized = searchName.trim().toLowerCase();
  return layers.filter(
    (layer) =>
      layer.slug.toLowerCase() === normalized
      || layer.name.toLowerCase() === normalized,
  );
}

function formatCatalogSelector(layer: CatalogLayer, version?: string): string {
  const base = `${layer.orgSlug}/${layer.catalogSlug}/${layer.slug}`;
  const resolvedVersion = version ?? layer.latestVersion ?? undefined;
  return resolvedVersion ? `${base}@${resolvedVersion}` : base;
}

export async function resolveBareNameFromCatalog(
  selector: string,
  options: { profile?: string; baseUrl?: string } = {},
): Promise<ResolvedRemoteLayerSelector> {
  if (!isPublicCatalogEnabled()) {
    throw new LayerResolveError(
      `Layer not found: ${selector}`,
      [
        "Enable catalog.publicCatalog in ~/.harnessdeck/config.jsonc",
        "Or use a published selector: org/catalog/name",
      ],
    );
  }

  const parsed = parseLayerSelector(selector);
  if (parsed.scope !== "local") {
    throw new LayerResolveError(`Layer not found: ${selector}`);
  }

  const catalogResults = await listLayersInScope(
    { q: parsed.name, limit: 100, sort: "name" },
    { profile: options.profile, baseUrl: options.baseUrl },
  );
  const matches = exactCatalogMatches(catalogResults, parsed.name);

  if (matches.length === 0) {
    throw new LayerResolveError(
      `Layer not found: ${selector}`,
      [
        "hd layer search <query>",
        "hd layer pull org/catalog/name",
        "hd layer list",
      ],
    );
  }

  if (matches.length > 1) {
    throw new LayerAmbiguityError(selector, matches);
  }

  const match = matches[0];
  if (!match) {
    throw new LayerResolveError(`Layer not found: ${selector}`);
  }

  return resolveRemoteLayerSelector(
    formatCatalogSelector(match, parsed.version ?? match.latestVersion ?? undefined),
    {},
  );
}
