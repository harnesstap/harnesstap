export type CatalogPluginVisibility = "organization" | "shared" | "public";

export interface CatalogPlugin {
  orgSlug: string;
  catalogSlug: string;
  slug: string;
  name: string;
  summary: string;
  latestVersion: string | null;
  updatedAt: string | null;
  tags: string[];
  visibility: CatalogPluginVisibility;
  pluginId?: string;
  orgId?: string;
  manageable?: boolean;
}

export function normalizeCatalogPlugin(
  plugin: Partial<CatalogPlugin> & Pick<CatalogPlugin, "orgSlug" | "slug">,
): CatalogPlugin {
  return {
    orgSlug: plugin.orgSlug,
    catalogSlug: plugin.catalogSlug ?? "default",
    slug: plugin.slug,
    name: plugin.name ?? plugin.slug,
    summary: plugin.summary ?? "",
    latestVersion: plugin.latestVersion ?? null,
    updatedAt: plugin.updatedAt ?? null,
    tags: plugin.tags ?? [],
    visibility: plugin.visibility ?? "public",
    pluginId: plugin.pluginId,
    orgId: plugin.orgId,
    manageable: plugin.manageable,
  };
}

/** Catalog rows with no installable (non-yanked) version are omitted from pull/list. */
export function isCatalogPluginInstallable(plugin: CatalogPlugin): boolean {
  return Boolean(plugin.latestVersion);
}

export interface CatalogListResult {
  plugins: CatalogPlugin[];
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
