import { listLayersInScope } from "./catalog-client.js";
import { isPublicCatalogEnabled } from "../config/catalog.js";
import {
  catalogAliasHint,
  resolveCatalogLayerAlias,
} from "./catalog-aliases.js";
import type { CatalogLayer } from "./catalog-types.js";
import {
  parseLayerSelector,
  resolveRemoteLayerSelector,
  type ResolvedRemoteLayerSelector,
} from "./layer-selector.js";
import { catalogLayerKey } from "../ui/catalog-list-render.js";
import { promptForChoice, shouldUseWizard } from "./wizards/shared.js";

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
      ["Use a fully qualified selector: org/catalog/slug@version"],
    );
    this.candidates = candidates;
  }
}

export type ResolveBareNameOptions = {
  account?: string;
  baseUrl?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: "human" | "json";
  promptAmbiguity?: (input: {
    selector: string;
    candidates: CatalogLayer[];
  }) => Promise<CatalogLayer>;
};

function exactCatalogMatches(layers: CatalogLayer[], searchName: string): CatalogLayer[] {
  const normalized = searchName.trim().toLowerCase();
  return layers.filter(
    (layer) =>
      layer.slug.toLowerCase() === normalized
      || layer.name.toLowerCase() === normalized,
  );
}

function dedupeCatalogLayersByIdentity(layers: CatalogLayer[]): CatalogLayer[] {
  const byKey = new Map<string, CatalogLayer>();
  for (const layer of layers) {
    byKey.set(catalogLayerKey(layer), layer);
  }
  return [...byKey.values()];
}

export function formatCatalogSelector(layer: CatalogLayer, version?: string): string {
  const base = `${layer.orgSlug}/${layer.catalogSlug}/${layer.slug}`;
  const resolvedVersion = version ?? layer.latestVersion ?? undefined;
  return resolvedVersion ? `${base}@${resolvedVersion}` : base;
}

function formatCatalogLayerChoiceLabel(layer: CatalogLayer): string {
  const selector = formatCatalogSelector(layer, layer.latestVersion ?? undefined);
  const summary = layer.summary?.trim() || layer.name;
  return `${selector} — ${summary}`;
}

export async function promptCatalogLayerAmbiguity(
  selector: string,
  candidates: CatalogLayer[],
): Promise<CatalogLayer> {
  const selectedKey = await promptForChoice({
    message: `Multiple catalog layers match "${selector}". Which one?`,
    choices: candidates.map((layer) => ({
      name: formatCatalogLayerChoiceLabel(layer),
      value: catalogLayerKey(layer),
    })),
  });
  const match = candidates.find((layer) => catalogLayerKey(layer) === selectedKey);
  if (!match) {
    throw new LayerResolveError(`Layer not found: ${selector}`);
  }
  return match;
}

async function pickCatalogLayerMatch(
  selector: string,
  matches: CatalogLayer[],
  options: ResolveBareNameOptions,
): Promise<CatalogLayer> {
  const unique = dedupeCatalogLayersByIdentity(matches);
  if (unique.length === 1) {
    const only = unique[0];
    if (!only) {
      throw new LayerResolveError(`Layer not found: ${selector}`);
    }
    return only;
  }

  if (options.promptAmbiguity) {
    return options.promptAmbiguity({ selector, candidates: unique });
  }

  const canPrompt = shouldUseWizard({
    interactive: options.interactive ?? true,
    noInteractive: options.noInteractive,
    format: options.format ?? "human",
    missingRequiredArgs: false,
  });
  if (!canPrompt) {
    throw new LayerAmbiguityError(selector, unique);
  }

  return promptCatalogLayerAmbiguity(selector, unique);
}

export async function resolveBareNameFromCatalog(
  selector: string,
  options: ResolveBareNameOptions = {},
): Promise<ResolvedRemoteLayerSelector> {
  if (!isPublicCatalogEnabled()) {
    throw new LayerResolveError(
      `Layer not found: ${selector}`,
      [
        "Enable catalog.publicCatalog in ~/.harnessdeck/config.jsonc",
        "Or use a published selector: org/catalog/slug",
      ],
    );
  }

  const parsed = parseLayerSelector(selector);
  if (parsed.scope !== "local") {
    throw new LayerResolveError(`Layer not found: ${selector}`);
  }

  const catalogResults = await listLayersInScope(
    { q: parsed.name, limit: 100, sort: "name" },
    { account: options.account, baseUrl: options.baseUrl },
  );
  let matches = exactCatalogMatches(catalogResults, parsed.name);

  if (matches.length === 0) {
    const aliasTarget = resolveCatalogLayerAlias(parsed.name);
    if (aliasTarget) {
      const aliasResults = await listLayersInScope(
        { q: aliasTarget, limit: 100, sort: "name" },
        { account: options.account, baseUrl: options.baseUrl },
      );
      matches = exactCatalogMatches(aliasResults, aliasTarget);
    }
  }

  if (matches.length === 0) {
    const hints = [
      "hd layer search <query>",
      "hd layer pull org/catalog/slug",
      "hd layer list",
    ];
    const aliasHint = catalogAliasHint(parsed.name);
    if (aliasHint) {
      hints.unshift(aliasHint);
    }
    throw new LayerResolveError(`Layer not found: ${selector}`, hints);
  }

  const match = await pickCatalogLayerMatch(selector, matches, options);

  return resolveRemoteLayerSelector(
    formatCatalogSelector(match, parsed.version ?? match.latestVersion ?? undefined),
    {},
  );
}
