import { CATALOG_LAYER_ALIASES } from "../constants/catalog-aliases.js";

export function normalizeCatalogSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

export function resolveCatalogLayerAlias(slug: string): string | undefined {
  return CATALOG_LAYER_ALIASES[normalizeCatalogSlug(slug)];
}

export function catalogAliasHint(slug: string): string | undefined {
  const target = resolveCatalogLayerAlias(slug);
  if (!target) {
    return undefined;
  }
  return `Did you mean "${target}"? (legacy alias for "${slug}")`;
}
