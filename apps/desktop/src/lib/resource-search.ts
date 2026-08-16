import type { LibraryResource, ProfileContentsResource } from "./types";

/** Material + composition types accepted by CLI `type:query` search prefixes. */
const RESOURCE_TYPE_PREFIXES = new Set([
  "instruction",
  "skill",
  "rule",
  "mcp_server",
  "permission",
  "hook",
  "agent",
  "command",
  "env_var",
  "model_config",
  "plugin",
  "plugin_pin",
]);

/** Legacy `plugin_pin:` search prefix matches stored `plugin` rows. */
function canonicalSearchType(section: string): string {
  return section === "plugin_pin" ? "plugin" : section;
}

export function isResourceTypeSearchPrefix(section: string): boolean {
  return RESOURCE_TYPE_PREFIXES.has(section);
}

export type ListSearchQuery = {
  section: string | undefined;
  text: string;
  raw: string;
};

export function parseListSearchQuery(input: string): ListSearchQuery {
  const trimmed = input.trim();
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex <= 0) {
    return { section: undefined, text: trimmed, raw: trimmed };
  }
  const section = trimmed.slice(0, colonIndex);
  const text = trimmed.slice(colonIndex + 1);
  return { section, text, raw: trimmed };
}

export function matchesListSearchQuery(
  haystack: string,
  query: ListSearchQuery,
): boolean {
  const normalizedHaystack = haystack.toLowerCase();
  const normalizedText = query.text.trim().toLowerCase();
  if (normalizedText.length === 0) {
    return true;
  }
  return normalizedHaystack.includes(normalizedText);
}

function displayName(resource: LibraryResource): string {
  return resource.namespace
    ? `${resource.name}@${resource.namespace}`
    : resource.name;
}

/**
 * CLI-compatible resource filter: `skill:dbt` limits to type + text;
 * plain text matches name, description, and namespace display form.
 */
export function filterLibraryResourcesBySearch(
  resources: LibraryResource[],
  search: string,
): LibraryResource[] {
  const parsed = parseListSearchQuery(search);
  if (parsed.raw.length === 0) {
    return resources;
  }

  const sectionIsResourceType =
    parsed.section !== undefined && RESOURCE_TYPE_PREFIXES.has(parsed.section);

  const textQuery = sectionIsResourceType
    ? parsed
    : parsed.section !== undefined
      ? { section: undefined, text: parsed.raw, raw: parsed.raw }
      : parsed;

  return resources.filter((resource) => {
    if (
      sectionIsResourceType &&
      parsed.section !== undefined &&
      resource.type !== canonicalSearchType(parsed.section)
    ) {
      return false;
    }
    const haystack = `${displayName(resource)} ${resource.description ?? ""} ${resource.namespace ?? ""} ${resource.tags?.join(" ") ?? ""}`;
    return matchesListSearchQuery(haystack, textQuery);
  });
}

export function filterLibraryResourcesByProfile(
  resources: LibraryResource[],
  profileResources: ProfileContentsResource[] | null | undefined,
): LibraryResource[] {
  if (!profileResources) {
    return [];
  }
  const keys = new Set(
    profileResources.map((resource) => `${resource.type}:${resource.name}`),
  );
  return resources.filter((resource) =>
    keys.has(`${resource.type}:${resource.name}`),
  );
}

export function groupLibraryResourcesByType(
  resources: LibraryResource[],
): Array<{ type: string; resources: LibraryResource[] }> {
  const groups = new Map<string, LibraryResource[]>();
  for (const resource of resources) {
    const bucket = groups.get(resource.type);
    if (bucket) {
      bucket.push(resource);
    } else {
      groups.set(resource.type, [resource]);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, rows]) => ({
      type,
      resources: [...rows].sort((a, b) =>
        displayName(a).localeCompare(displayName(b)),
      ),
    }));
}

export function resourceDisplayName(resource: LibraryResource): string {
  return displayName(resource);
}

export function filterContentsResourcesBySearch(
  resources: ProfileContentsResource[],
  search: string,
): ProfileContentsResource[] {
  const parsed = parseListSearchQuery(search);
  if (parsed.raw.length === 0) {
    return resources;
  }

  const sectionIsResourceType =
    parsed.section !== undefined && RESOURCE_TYPE_PREFIXES.has(parsed.section);
  const textQuery = sectionIsResourceType
    ? parsed
    : parsed.section !== undefined
      ? { section: undefined, text: parsed.raw, raw: parsed.raw }
      : parsed;

  return resources.filter((resource) => {
    if (
      sectionIsResourceType &&
      parsed.section !== undefined &&
      resource.type !== canonicalSearchType(parsed.section)
    ) {
      return false;
    }
    return matchesListSearchQuery(
      `${resource.name} ${resource.type} ${resource.source}`,
      textQuery,
    );
  });
}

export function filterPathsBySearch(paths: string[], search: string): string[] {
  const parsed = parseListSearchQuery(search);
  if (parsed.raw.length === 0) {
    return paths;
  }
  const textQuery =
    parsed.section !== undefined
      ? { section: undefined, text: parsed.raw, raw: parsed.raw }
      : parsed;
  return paths.filter((path) => matchesListSearchQuery(path, textQuery));
}

export const LIST_PAGE_SIZE = 12;

export function nextVisibleCount(
  current: number,
  total: number,
  pageSize = LIST_PAGE_SIZE,
): number {
  return Math.min(total, current + pageSize);
}
