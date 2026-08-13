import { filterLibraryResourcesBySearch } from "./resource-search";
import type { LibraryResource } from "./types";

export const LISTABLE_FILTER_RESOURCE_TYPES = [
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
] as const;

export type UpdatedPreset = "all" | "1d" | "7d" | "30d" | "90d" | "custom";

export type UpdatedFilter = {
  preset: UpdatedPreset;
  from: string | null;
  to: string | null;
};

export type NamespaceSelection =
  | { mode: "all" }
  | { mode: "unnamed" }
  | { mode: "named"; value: string };

export type ResourceFilterState = {
  search: string;
  type: string | null;
  updated: UpdatedFilter;
  namespace: NamespaceSelection;
  originKind: string | null;
};

export function defaultResourceFilterState(): ResourceFilterState {
  return {
    search: "",
    type: null,
    updated: { preset: "all", from: null, to: null },
    namespace: { mode: "all" },
    originKind: null,
  };
}

export function resetResourceFilterState(): ResourceFilterState {
  return defaultResourceFilterState();
}

export function isResourceFilterStateActive(state: ResourceFilterState): boolean {
  if (state.search.trim().length > 0) return true;
  if (state.type !== null) return true;
  if (state.updated.preset !== "all") return true;
  if (state.namespace.mode !== "all") return true;
  if (state.originKind !== null) return true;
  return false;
}

export function isUpdatedFilterValid(updated: UpdatedFilter): boolean {
  if (updated.preset !== "custom") return true;
  if (!updated.from || !updated.to) return false;
  return updated.from <= updated.to;
}

function startOfLocalDay(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 0, 0, 0, 0);
}

function endOfLocalDay(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 23, 59, 59, 999);
}

function parseLocalDate(isoDate: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  return {
    y: Number(match[1]),
    m: Number(match[2]) - 1,
    d: Number(match[3]),
  };
}

export function resolveUpdatedAtBounds(
  updated: UpdatedFilter,
  now: Date = new Date(),
): { start: Date; end: Date } | null {
  let days: number;
  switch (updated.preset) {
    case "all":
      return null;
    case "custom": {
      // Fail-open: invalid custom range → no date filter until from/to are valid.
      if (!isUpdatedFilterValid(updated) || !updated.from || !updated.to) {
        return null;
      }
      const from = parseLocalDate(updated.from);
      const to = parseLocalDate(updated.to);
      if (!from || !to) return null;
      return {
        start: startOfLocalDay(from.y, from.m, from.d),
        end: endOfLocalDay(to.y, to.m, to.d),
      };
    }
    case "1d":
      days = 1;
      break;
    case "7d":
      days = 7;
      break;
    case "30d":
      days = 30;
      break;
    case "90d":
      days = 90;
      break;
    default: {
      const _exhaustive: never = updated.preset;
      return _exhaustive;
    }
  }

  const end = endOfLocalDay(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (days - 1),
  );
  const start = startOfLocalDay(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );
  return { start, end };
}

function matchesNamespace(
  resource: LibraryResource,
  selection: NamespaceSelection,
): boolean {
  switch (selection.mode) {
    case "all":
      return true;
    case "unnamed":
      return resource.namespace == null || resource.namespace === "";
    case "named":
      return resource.namespace === selection.value;
    default: {
      const _exhaustive: never = selection;
      return _exhaustive;
    }
  }
}

export function applyLibraryResourceFilters(
  resources: LibraryResource[],
  state: ResourceFilterState,
  now: Date = new Date(),
): LibraryResource[] {
  let next = filterLibraryResourcesBySearch(resources, state.search);

  if (state.type !== null) {
    next = next.filter((resource) => resource.type === state.type);
  }

  if (state.namespace.mode !== "all") {
    next = next.filter((resource) => matchesNamespace(resource, state.namespace));
  }

  if (state.originKind !== null) {
    next = next.filter((resource) => resource.origin_kind === state.originKind);
  }

  const bounds = resolveUpdatedAtBounds(state.updated, now);
  // Fail-open: null bounds (e.g. invalid custom range) skip date filtering until valid.
  if (bounds) {
    next = next.filter((resource) => {
      if (!resource.updated_at) return false;
      const stamp = Date.parse(resource.updated_at);
      if (Number.isNaN(stamp)) return false;
      return stamp >= bounds.start.getTime() && stamp <= bounds.end.getTime();
    });
  }

  return next;
}

export type NamespaceFacetOption =
  | { mode: "unnamed" }
  | { mode: "named"; value: string };

export function buildNamespaceFacetOptions(
  resources: LibraryResource[],
): NamespaceFacetOption[] {
  const names = new Set<string>();
  let hasUnnamed = false;
  for (const resource of resources) {
    if (resource.namespace == null || resource.namespace === "") {
      hasUnnamed = true;
    } else {
      names.add(resource.namespace);
    }
  }
  const named = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ mode: "named" as const, value }));
  return hasUnnamed ? [{ mode: "unnamed" }, ...named] : named;
}

export function buildOriginFacetOptions(resources: LibraryResource[]): string[] {
  const kinds = new Set<string>();
  for (const resource of resources) {
    if (resource.origin_kind) {
      kinds.add(resource.origin_kind);
    }
  }
  return [...kinds].sort((a, b) => a.localeCompare(b));
}

const ORIGIN_KIND_LABELS: Record<string, string> = {
  local_snapshot: "Local snapshot",
  marketplace_link: "Marketplace",
  manual: "Manual",
  untracked: "Untracked",
};

export function formatOriginKindLabel(originKind: string): string {
  return ORIGIN_KIND_LABELS[originKind] ?? originKind.replaceAll("_", " ");
}
