export type CatalogLayerVisibility = "organization" | "shared" | "public";

export interface CatalogLayer {
  orgSlug: string;
  catalogSlug: string;
  slug: string;
  name: string;
  summary: string;
  latestVersion: string | null;
  updatedAt: string | null;
  tags: string[];
  visibility: CatalogLayerVisibility;
  layerId?: string;
  orgId?: string;
  manageable?: boolean;
}

export function normalizeCatalogLayer(
  layer: Partial<CatalogLayer> & Pick<CatalogLayer, "orgSlug" | "slug">,
): CatalogLayer {
  return {
    orgSlug: layer.orgSlug,
    catalogSlug: layer.catalogSlug ?? "default",
    slug: layer.slug,
    name: layer.name ?? layer.slug,
    summary: layer.summary ?? "",
    latestVersion: layer.latestVersion ?? null,
    updatedAt: layer.updatedAt ?? null,
    tags: layer.tags ?? [],
    visibility: layer.visibility ?? "public",
    layerId: layer.layerId,
    orgId: layer.orgId,
    manageable: layer.manageable,
  };
}

export interface CatalogListResult {
  layers: CatalogLayer[];
  nextCursor: string | null;
}

export interface CatalogListOptions {
  q?: string;
  tag?: string;
  catalog?: string;
  limit?: number;
  cursor?: string | null;
  sort?: "updated" | "name";
  orgs?: string[];
  selectors?: string[];
}
