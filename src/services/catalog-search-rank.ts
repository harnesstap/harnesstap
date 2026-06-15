import type { CatalogLayer } from "./catalog-types.js";

function normalizedQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Lower rank means higher priority in search results. */
export function catalogSearchRank(layer: CatalogLayer, query: string): number {
  const q = normalizedQuery(query);
  if (!q) {
    return 100;
  }

  const slug = layer.slug.toLowerCase();
  const name = layer.name.toLowerCase();
  const summary = layer.summary.toLowerCase();
  const tags = layer.tags.map((tag) => tag.toLowerCase());

  if (slug === q) return 0;
  if (slug.startsWith(q)) return 1;
  if (name === q) return 2;
  if (name.includes(q)) return 3;
  if (slug.includes(q)) return 4;
  if (tags.some((tag) => tag === q)) return 5;
  if (tags.some((tag) => tag.includes(q))) return 6;
  if (summary.includes(q)) return 7;
  return 8;
}

function compareUpdatedDesc(left: CatalogLayer, right: CatalogLayer): number {
  const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
  const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
  if (rightTime !== leftTime) {
    return rightTime - leftTime;
  }
  return left.slug.localeCompare(right.slug);
}

export function rankCatalogSearchResults(
  layers: CatalogLayer[],
  query: string,
): CatalogLayer[] {
  const q = query.trim();
  if (!q) {
    return layers;
  }

  return [...layers].sort((left, right) => {
    const rankDiff = catalogSearchRank(left, q) - catalogSearchRank(right, q);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return compareUpdatedDesc(left, right);
  });
}
