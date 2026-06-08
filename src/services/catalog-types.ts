export type CatalogLibraryVisibility = "organization" | "shared" | "public";

export interface CatalogLibrary {
  orgSlug: string;
  slug: string;
  name: string;
  summary: string;
  latestVersion: string | null;
  updatedAt: string | null;
  tags: string[];
  visibility: CatalogLibraryVisibility;
}

export interface CatalogListResult {
  libraries: CatalogLibrary[];
  nextCursor: string | null;
}

export interface CatalogListOptions {
  q?: string;
  tag?: string;
  limit?: number;
  cursor?: string | null;
  sort?: "updated" | "name";
  orgs?: string[];
  selectors?: string[];
}
