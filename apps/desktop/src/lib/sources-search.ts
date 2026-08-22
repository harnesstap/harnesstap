import type { PluginOriginCheckRow } from "./api/plugin-origin-update";

export type SourceKind = "local" | "marketplace" | "cloud-org" | "cloud-catalog";
export type Presence = "in_library" | "remote_only";
export type SourcesHitKind = "plugin" | "standalone";

export interface SourcesHitIdentity {
  cloud?: { org: string; catalog: string; name: string };
  marketplace?: { marketplace: string; plugin: string };
  localPluginName?: string;
  localSelector?: string;
}

export interface SourcesHit {
  id: string;
  kind: SourcesHitKind;
  name: string;
  typeLabel: string;
  version?: string;
  description?: string;
  tags?: string[];
  sourceId: string;
  sourceLabel: string;
  presence: Presence;
  identity: SourcesHitIdentity;
  originOutdated?: boolean;
}

export interface CloudIdentity {
  org: string;
  catalog: string;
  name: string;
}

export interface CloudPresenceHead {
  name: string;
  origin?: string;
  org?: string;
  catalog?: string;
  org_slug?: string;
  catalog_slug?: string;
}

export interface MarketplacePresenceResource {
  name: string;
  type: string;
  origin_kind?: string | null;
}

export interface LocalPluginHeadInput {
  name: string;
  version?: string;
  description?: string | null;
  origin?: string;
  id?: string;
  tags?: string[];
}

export interface LocalResourceInput {
  name: string;
  type: string;
  description?: string | null;
  namespace?: string | null;
  origin_kind?: string | null;
  id?: string;
  tags?: string[];
}

export interface MarketplaceSourceInput {
  sourceId: string;
  sourceLabel: string;
  marketplaceName: string;
  plugins: Array<{
    name: string;
    version?: string;
    description?: string;
    tags?: string[];
  }>;
}

export interface CloudPluginInput {
  selector: string;
  name: string;
  orgSlug: string;
  catalogSlug: string;
  version?: string;
  description?: string | null;
  tags?: string[];
}

export interface CloudSourceInput {
  sourceId: string;
  sourceLabel: string;
  plugins: CloudPluginInput[];
}

export interface MergeSourcesHitsInput {
  query?: string;
  sourceOrder: string[];
  local?: {
    sourceId: string;
    sourceLabel: string;
    heads: LocalPluginHeadInput[];
    resources: LocalResourceInput[];
  };
  marketplaces?: MarketplaceSourceInput[];
  cloud?: CloudSourceInput[];
  libraryHeads?: CloudPresenceHead[];
  libraryResources?: MarketplacePresenceResource[];
}

export interface SourcesHitGroup {
  sourceId: string;
  sourceLabel: string;
  hits: SourcesHit[];
}

export function sourcesHitFetchKey(hit: SourcesHit): string {
  const { identity } = hit;
  if (identity.marketplace) {
    return `marketplace:${identity.marketplace.marketplace}/${identity.marketplace.plugin}`;
  }
  if (identity.cloud) {
    return `cloud:${identity.cloud.org}/${identity.cloud.catalog}/${identity.cloud.name}`;
  }
  if (identity.localPluginName) {
    return `local-plugin:${identity.localPluginName}`;
  }
  if (identity.localSelector) {
    return `local:${identity.localSelector}`;
  }
  return hit.id;
}

export function sourcesHitOriginLocator(hit: SourcesHit): string | null {
  if (hit.identity.marketplace) {
    return `${hit.identity.marketplace.plugin}@${hit.identity.marketplace.marketplace}`;
  }
  if (hit.identity.cloud) {
    const { org, catalog, name } = hit.identity.cloud;
    return `${org}/${catalog}/${name}`;
  }
  return null;
}

export function applyOriginOutdated(
  hits: SourcesHit[],
  checkRows: readonly Pick<PluginOriginCheckRow, "origin_locator" | "status">[],
): SourcesHit[] {
  const outdatedLocators = new Set(
    checkRows
      .filter((row) => row.status === "outdated")
      .map((row) => row.origin_locator),
  );
  return hits.map((hit) => {
    if (hit.presence !== "in_library") {
      return hit;
    }
    const locator = sourcesHitOriginLocator(hit);
    if (!locator || !outdatedLocators.has(locator)) {
      return hit;
    }
    return { ...hit, originOutdated: true };
  });
}

export function sourcesHitUpdateBadge(hit: SourcesHit): string | null {
  return hit.originOutdated ? "Update available" : null;
}

export function presenceLabel(presence: Presence): string {
  switch (presence) {
    case "in_library":
      return "In library";
    case "remote_only":
      return "Remote only";
    default: {
      const neverPresence: never = presence;
      return neverPresence;
    }
  }
}

export function isStandaloneResourceType(type: string): boolean {
  return type !== "plugin" && type !== "plugin_pin";
}

export function matchQuery(haystack: string, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return true;
  }
  return haystack.toLowerCase().includes(normalizedQuery);
}

function presentSlug(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

export function cloudSelectorKey(identity: CloudIdentity): string {
  return `${identity.org}/${identity.catalog}/${identity.name}`;
}

export function presenceForCloud(
  identity: CloudIdentity,
  heads: CloudPresenceHead[],
): Presence {
  const inLibrary = heads.some((head) => {
    if (head.origin !== "catalog" || head.name !== identity.name) {
      return false;
    }
    const headOrg = presentSlug(head.org ?? head.org_slug);
    const headCatalog = presentSlug(head.catalog ?? head.catalog_slug);
    if (headOrg !== undefined && headOrg !== identity.org) {
      return false;
    }
    if (headCatalog !== undefined && headCatalog !== identity.catalog) {
      return false;
    }
    return true;
  });
  return inLibrary ? "in_library" : "remote_only";
}

export function cloudHitIsInLibrary(
  identity: CloudIdentity,
  heads: CloudPresenceHead[],
  pulledKeys: string[],
): Presence {
  if (pulledKeys.includes(cloudSelectorKey(identity))) {
    return "in_library";
  }
  return presenceForCloud(identity, heads);
}

function marketplaceQualifiedName(
  pluginName: string,
  marketplaceName: string,
): string {
  return `${pluginName}@${marketplaceName}`;
}

function nameMatchesMarketplacePlugin(
  resourceName: string,
  pluginName: string,
  marketplaceName: string,
): boolean {
  if (resourceName === pluginName) {
    return true;
  }
  const qualified = marketplaceQualifiedName(pluginName, marketplaceName);
  if (resourceName === qualified) {
    return true;
  }
  const suffix = `@${marketplaceName}`;
  if (!resourceName.endsWith(suffix)) {
    return false;
  }
  const localName = resourceName.slice(0, resourceName.length - suffix.length);
  return localName === pluginName;
}

export function presenceForMarketplace(
  pluginName: string,
  marketplaceName: string,
  resources: MarketplacePresenceResource[],
): Presence {
  const inLibrary = resources.some((resource) => {
    const nameMatches = nameMatchesMarketplacePlugin(
      resource.name,
      pluginName,
      marketplaceName,
    );
    if (resource.origin_kind === "marketplace_link" && nameMatches) {
      return true;
    }
    if (resource.type !== "plugin" && resource.type !== "plugin_pin") {
      return false;
    }
    return nameMatches;
  });
  return inLibrary ? "in_library" : "remote_only";
}

export function cloudIdentityFromPlugin(plugin: CloudPluginInput): CloudIdentity {
  return {
    org: plugin.orgSlug,
    catalog: plugin.catalogSlug,
    name: slugFromSelector(plugin.selector, plugin.orgSlug, plugin.catalogSlug),
  };
}

export function mergeSourcesHits(input: MergeSourcesHitsInput): SourcesHitGroup[] {
  const query = input.query ?? "";
  const libraryHeads = input.libraryHeads ?? input.local?.heads ?? [];
  const libraryResources =
    input.libraryResources ?? input.local?.resources ?? [];
  const seenCloudKeys = new Set<string>();
  const groupsById = new Map<string, SourcesHitGroup>();

  if (input.local) {
    const hits: SourcesHit[] = [];
    for (const head of input.local.heads) {
      const hit = localPluginHit(input.local, head);
      if (hitMatchesQuery(hit, query)) hits.push(hit);
    }
    for (const resource of input.local.resources) {
      if (!isStandaloneResourceType(resource.type)) continue;
      const hit = localStandaloneHit(input.local, resource);
      if (hitMatchesQuery(hit, query)) hits.push(hit);
    }
    groupsById.set(input.local.sourceId, {
      sourceId: input.local.sourceId,
      sourceLabel: input.local.sourceLabel,
      hits,
    });
  }

  for (const marketplace of input.marketplaces ?? []) {
    const hits: SourcesHit[] = [];
    for (const plugin of marketplace.plugins) {
      const hit = marketplacePluginHit(
        marketplace,
        plugin,
        libraryResources,
      );
      if (hitMatchesQuery(hit, query)) hits.push(hit);
    }
    groupsById.set(marketplace.sourceId, {
      sourceId: marketplace.sourceId,
      sourceLabel: marketplace.sourceLabel,
      hits,
    });
  }

  for (const cloud of input.cloud ?? []) {
    const hits: SourcesHit[] = [];
    for (const plugin of cloud.plugins) {
      const identity = cloudIdentityFromPlugin(plugin);
      const key = `${identity.org}/${identity.catalog}/${identity.name}`;
      if (seenCloudKeys.has(key)) continue;
      seenCloudKeys.add(key);
      const hit = cloudPluginHit(cloud, plugin, identity, libraryHeads);
      if (hitMatchesQuery(hit, query)) hits.push(hit);
    }
    groupsById.set(cloud.sourceId, {
      sourceId: cloud.sourceId,
      sourceLabel: cloud.sourceLabel,
      hits,
    });
  }

  const groups: SourcesHitGroup[] = [];
  for (const sourceId of input.sourceOrder) {
    const group = groupsById.get(sourceId);
    if (group) groups.push(group);
  }
  return groups;
}

function slugFromSelector(
  selector: string,
  orgSlug: string,
  catalogSlug: string,
): string {
  const withoutVersion = selector.split("@")[0] ?? selector;
  const prefix = `${orgSlug}/${catalogSlug}/`;
  if (withoutVersion.startsWith(prefix)) {
    return withoutVersion.slice(prefix.length);
  }
  const parts = withoutVersion.split("/");
  return parts[2] ?? parts[parts.length - 1] ?? withoutVersion;
}

function localSelector(resource: LocalResourceInput): string {
  return resource.namespace
    ? `${resource.type}:${resource.name}@${resource.namespace}`
    : `${resource.type}:${resource.name}`;
}

function localPluginHit(
  source: { sourceId: string; sourceLabel: string },
  head: LocalPluginHeadInput,
): SourcesHit {
  return {
    id: `${source.sourceId}:plugin:${head.name}`,
    kind: "plugin",
    name: head.name,
    typeLabel: "plugin",
    ...(head.version !== undefined ? { version: head.version } : {}),
    ...(head.description ? { description: head.description } : {}),
    ...(head.tags && head.tags.length > 0 ? { tags: head.tags } : {}),
    sourceId: source.sourceId,
    sourceLabel: source.sourceLabel,
    presence: "in_library",
    identity: { localPluginName: head.name },
  };
}

function localStandaloneHit(
  source: { sourceId: string; sourceLabel: string },
  resource: LocalResourceInput,
): SourcesHit {
  return {
    id: `${source.sourceId}:standalone:${localSelector(resource)}`,
    kind: "standalone",
    name: resource.name,
    typeLabel: resource.type,
    ...(resource.description ? { description: resource.description } : {}),
    ...(resource.tags && resource.tags.length > 0 ? { tags: resource.tags } : {}),
    sourceId: source.sourceId,
    sourceLabel: source.sourceLabel,
    presence: "in_library",
    identity: { localSelector: localSelector(resource) },
  };
}

function marketplacePluginHit(
  source: MarketplaceSourceInput,
  plugin: { name: string; version?: string; description?: string; tags?: string[] },
  resources: MarketplacePresenceResource[],
): SourcesHit {
  return {
    id: `${source.sourceId}:plugin:${plugin.name}`,
    kind: "plugin",
    name: plugin.name,
    typeLabel: "plugin",
    ...(plugin.version !== undefined ? { version: plugin.version } : {}),
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.tags && plugin.tags.length > 0 ? { tags: plugin.tags } : {}),
    sourceId: source.sourceId,
    sourceLabel: source.sourceLabel,
    presence: presenceForMarketplace(
      plugin.name,
      source.marketplaceName,
      resources,
    ),
    identity: {
      marketplace: {
        marketplace: source.marketplaceName,
        plugin: plugin.name,
      },
    },
  };
}

function cloudPluginHit(
  source: CloudSourceInput,
  plugin: CloudPluginInput,
  identity: CloudIdentity,
  heads: CloudPresenceHead[],
): SourcesHit {
  return {
    id: `${source.sourceId}:plugin:${identity.org}/${identity.catalog}/${identity.name}`,
    kind: "plugin",
    name: plugin.name,
    typeLabel: "plugin",
    ...(plugin.version !== undefined ? { version: plugin.version } : {}),
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.tags && plugin.tags.length > 0 ? { tags: plugin.tags } : {}),
    sourceId: source.sourceId,
    sourceLabel: source.sourceLabel,
    presence: presenceForCloud(identity, heads),
    identity: { cloud: identity },
  };
}

function hitMatchesQuery(hit: SourcesHit, query: string): boolean {
  const parts = [hit.name, hit.description ?? "", ...(hit.tags ?? [])];
  switch (hit.kind) {
    case "plugin":
      break;
    case "standalone": {
      parts.push(hit.typeLabel);
      const selector = hit.identity.localSelector ?? "";
      const at = selector.lastIndexOf("@");
      if (at >= 0) {
        parts.push(selector.slice(at + 1));
      }
      break;
    }
    default: {
      const neverKind: never = hit.kind;
      return neverKind;
    }
  }
  return matchQuery(parts.join(" "), query);
}
