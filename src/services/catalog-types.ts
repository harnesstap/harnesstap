export type CatalogLibraryVisibility = "organization" | "shared" | "public";

export interface CatalogLibrary {
  orgSlug: string;
  catalogSlug: string;
  slug: string;
  name: string;
  summary: string;
  latestVersion: string | null;
  updatedAt: string | null;
  tags: string[];
  visibility: CatalogLibraryVisibility;
}

export function normalizeCatalogLibrary(
  library: Partial<CatalogLibrary> & Pick<CatalogLibrary, "orgSlug" | "slug">,
): CatalogLibrary {
  return {
    orgSlug: library.orgSlug,
    catalogSlug: library.catalogSlug ?? "default",
    slug: library.slug,
    name: library.name ?? library.slug,
    summary: library.summary ?? "",
    latestVersion: library.latestVersion ?? null,
    updatedAt: library.updatedAt ?? null,
    tags: library.tags ?? [],
    visibility: library.visibility ?? "public",
  };
}

export interface CatalogListResult {
  libraries: CatalogLibrary[];
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
