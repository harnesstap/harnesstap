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

/**
 * Presence-filtered tabs: hide empty types. Show All only when at least two
 * types are present.
 */
export function visibleResourceTypeTabs(
  counts: ReadonlyMap<string, number>,
): string[] {
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
  if (present.length >= 2) {
    return [ALL_RESOURCE_TYPE_TAB, ...present];
  }
  return present;
}

/** Selected type, or null (All / the full present set) when the tab is gone. */
export function resolveResourceTypeTab(
  selected: string | null,
  counts: ReadonlyMap<string, number>,
): string | null {
  if (selected === null || selected === ALL_RESOURCE_TYPE_TAB) {
    return null;
  }
  const visible = visibleResourceTypeTabs(counts);
  return visible.includes(selected) ? selected : null;
}
