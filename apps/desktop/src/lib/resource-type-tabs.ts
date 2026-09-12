import { resourceTypeGlyph, type TypeGlyph } from "./type-glyph";

/** Canonical type-tab order for Library and other typed inventories. */
export const RESOURCE_TYPE_TAB_ORDER = [
  "plugin",
  "mcp_server",
  "skill",
  "agent",
  "rule",
  "command",
  "hook",
  "instruction",
  "permission",
  "env_var",
  "model_config",
  "plugin_ref",
] as const;

export type ResourceTypeTabId = (typeof RESOURCE_TYPE_TAB_ORDER)[number];

export const ALL_RESOURCE_TYPE_TAB = "all";

/** Host pane width at or above this shows icon+label; narrower is icon-only. */
export const RESOURCE_TYPE_TABS_WIDE_MIN_PX = 900;

export type ResourceTypeTabGlyph = TypeGlyph | "layout-grid";

/**
 * Tab glyph ids. Sparkles is skill only; plugins use Layers, plugin refs
 * Package, instructions FileText.
 */
export function resourceTypeTabGlyph(type: string): ResourceTypeTabGlyph {
  if (type === ALL_RESOURCE_TYPE_TAB) {
    return "layout-grid";
  }
  return resourceTypeGlyph(type);
}

const KNOWN_TAB_TYPES = new Set<string>(RESOURCE_TYPE_TAB_ORDER);

/** Short human labels for type tabs (Desktop voice). */
export function resourceTypeTabLabel(type: string): string {
  switch (type) {
    case ALL_RESOURCE_TYPE_TAB:
      return "All";
    case "plugin":
      return "Plugins";
    case "mcp_server":
      return "MCPs";
    case "skill":
      return "Skills";
    case "agent":
      return "Subagents";
    case "rule":
      return "Rules";
    case "command":
      return "Commands";
    case "hook":
      return "Hooks";
    case "instruction":
      return "Instructions";
    case "permission":
      return "Permissions";
    case "env_var":
      return "Env vars";
    case "model_config":
      return "Model config";
    case "plugin_ref":
      return "Plugin refs";
    case "plugin_pin":
      return "Plugin pins";
    default:
      return type.replaceAll("_", " ");
  }
}

export function countResourceTypeTabs(
  types: Iterable<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const type of types) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return counts;
}

export type ResourceTypeTabOptions = {
  /** When false, omit the All tab even if several types are present. Default true. */
  includeAll?: boolean;
};

function includeAllTab(options?: ResourceTypeTabOptions): boolean {
  return options?.includeAll !== false;
}

function presentResourceTypeTabs(counts: ReadonlyMap<string, number>): string[] {
  const present: string[] = [];
  for (const type of RESOURCE_TYPE_TAB_ORDER) {
    if ((counts.get(type) ?? 0) > 0) {
      present.push(type);
    }
  }
  const extras = [...counts.keys()]
    .filter((type) => !KNOWN_TAB_TYPES.has(type) && (counts.get(type) ?? 0) > 0)
    .sort((left, right) => left.localeCompare(right));
  present.push(...extras);
  return present;
}

/**
 * Presence-filtered tabs: hide empty types. Show All only when at least two
 * types are present, unless `includeAll` is false.
 */
export function visibleResourceTypeTabs(
  counts: ReadonlyMap<string, number>,
  options?: ResourceTypeTabOptions,
): string[] {
  const present = presentResourceTypeTabs(counts);
  if (includeAllTab(options) && present.length >= 2) {
    return [ALL_RESOURCE_TYPE_TAB, ...present];
  }
  return present;
}

/**
 * Selected type, or null (All / the full present set) when the All tab applies.
 * When All is hidden, never stay on `all`: keep a still-present type, else the
 * first presence-filtered type.
 */
export function resolveResourceTypeTab(
  selected: string | null,
  counts: ReadonlyMap<string, number>,
  options?: ResourceTypeTabOptions,
): string | null {
  const visible = visibleResourceTypeTabs(counts, options);
  const present = visible.filter((type) => type !== ALL_RESOURCE_TYPE_TAB);
  if (
    selected !== null &&
    selected !== ALL_RESOURCE_TYPE_TAB &&
    visible.includes(selected)
  ) {
    return selected;
  }
  if (!includeAllTab(options)) {
    return present[0] ?? null;
  }
  return null;
}

export function resourceTypeTabItemCount(
  type: string,
  counts: ReadonlyMap<string, number>,
): number {
  if (type === ALL_RESOURCE_TYPE_TAB) {
    let total = 0;
    for (const n of counts.values()) {
      total += n;
    }
    return total;
  }
  return counts.get(type) ?? 0;
}

/** Show counts when comparing types, or when a lone type has more than one item. */
export function resourceTypeTabShowsCount(
  counts: ReadonlyMap<string, number>,
): boolean {
  const present = [...counts.values()].filter((n) => n > 0);
  if (present.length >= 2) {
    return true;
  }
  return (present[0] ?? 0) > 1;
}

/** Visible / tooltip copy. Optional count: `Skills 12`. */
export function resourceTypeTabText(
  type: string,
  counts: ReadonlyMap<string, number>,
): string {
  const label = resourceTypeTabLabel(type);
  if (!resourceTypeTabShowsCount(counts)) {
    return label;
  }
  return `${label} ${resourceTypeTabItemCount(type, counts)}`;
}

/** Compact count badge: hide zeros. All uses the total across types. */
export function resourceTypeTabShowsCompactBadge(count: number): boolean {
  return count > 0;
}

/** Singular/plural unit for compact tooltips (`skill` / `skills`). */
export function resourceTypeTabUnit(type: string, count: number): string {
  const plural = count !== 1;
  switch (type) {
    case ALL_RESOURCE_TYPE_TAB:
      return plural ? "resources" : "resource";
    case "plugin":
      return plural ? "plugins" : "plugin";
    case "mcp_server":
      return plural ? "MCPs" : "MCP";
    case "skill":
      return plural ? "skills" : "skill";
    case "agent":
      return plural ? "subagents" : "subagent";
    case "rule":
      return plural ? "rules" : "rule";
    case "command":
      return plural ? "commands" : "command";
    case "hook":
      return plural ? "hooks" : "hook";
    case "instruction":
      return plural ? "instructions" : "instruction";
    case "permission":
      return plural ? "permissions" : "permission";
    case "env_var":
      return plural ? "env vars" : "env var";
    case "model_config":
      return plural ? "model configs" : "model config";
    case "plugin_ref":
      return plural ? "plugin refs" : "plugin ref";
    case "plugin_pin":
      return plural ? "plugin pins" : "plugin pin";
    default:
      return plural ? `${type.replaceAll("_", " ")}s` : type.replaceAll("_", " ");
  }
}

/**
 * Compact tooltip / aria-label. Matches the badge: `12 resources`,
 * `1 skill` / `3 skills`. Falls back to the type label when the count is 0.
 */
export function resourceTypeTabTooltip(
  type: string,
  counts: ReadonlyMap<string, number>,
): string {
  const count = resourceTypeTabItemCount(type, counts);
  if (count <= 0) {
    return resourceTypeTabLabel(type);
  }
  return `${count} ${resourceTypeTabUnit(type, count)}`;
}
