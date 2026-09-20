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

/** Pin rows share the Plugins tab. */
const RESOURCE_TYPE_TAB_FOLD: Record<string, string> = {
  plugin_pin: "plugin",
};

/**
 * Alias / junk tabs. Hide entirely when empty, even if `emptyMode` is disable.
 * Real resource types stay visible and disabled on Global/Project inventory.
 */
const RESOURCE_TYPE_TAB_HIDE_WHEN_EMPTY = new Set(["plugin_ref"]);

/** Fold pin (and other aliases) into the tab they belong to. */
export function foldResourceTypeTab(type: string): string {
  return RESOURCE_TYPE_TAB_FOLD[type] ?? type;
}

function tabHasItems(type: string, counts: ReadonlyMap<string, number>): boolean {
  return (counts.get(type) ?? 0) > 0;
}

function keepEmptyDisabledTab(type: string): boolean {
  return KNOWN_TAB_TYPES.has(type) && !RESOURCE_TYPE_TAB_HIDE_WHEN_EMPTY.has(type);
}

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
    const folded = foldResourceTypeTab(type);
    counts.set(folded, (counts.get(folded) ?? 0) + 1);
  }
  return counts;
}

export type ResourceTypeTabEmptyMode = "hide" | "disable";

export type ResourceTypeTabOptions = {
  /** When false, omit the All tab even if several types are present. Default true. */
  includeAll?: boolean;
  /**
   * hide (default): presence-filter empty types.
   * disable: keep empty types visible and disabled (`No <type> found`).
   */
  emptyMode?: ResourceTypeTabEmptyMode;
};

function includeAllTab(options?: ResourceTypeTabOptions): boolean {
  return options?.includeAll !== false;
}

function emptyMode(options?: ResourceTypeTabOptions): ResourceTypeTabEmptyMode {
  return options?.emptyMode ?? "hide";
}

function extraPresentTabs(counts: ReadonlyMap<string, number>): string[] {
  return [...counts.keys()]
    .filter((type) => !KNOWN_TAB_TYPES.has(type) && tabHasItems(type, counts))
    .sort((left, right) => left.localeCompare(right));
}

function presentResourceTypeTabs(counts: ReadonlyMap<string, number>): string[] {
  const present: string[] = [];
  for (const type of RESOURCE_TYPE_TAB_ORDER) {
    if (tabHasItems(type, counts)) {
      present.push(type);
    }
  }
  present.push(...extraPresentTabs(counts));
  return present;
}

/**
 * Presence-filtered tabs: hide empty types. Show All only when at least two
 * types are present, unless `includeAll` is false.
 * `emptyMode: "disable"` keeps every canonical type visible (plus All).
 */
export function visibleResourceTypeTabs(
  counts: ReadonlyMap<string, number>,
  options?: ResourceTypeTabOptions,
): string[] {
  if (emptyMode(options) === "disable") {
    const tabs = [
      ...RESOURCE_TYPE_TAB_ORDER.filter(
        (type) => tabHasItems(type, counts) || keepEmptyDisabledTab(type),
      ),
      ...extraPresentTabs(counts),
    ];
    if (includeAllTab(options)) {
      return [ALL_RESOURCE_TYPE_TAB, ...tabs];
    }
    return tabs;
  }
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
  const selectedHasItems =
    selected !== null
    && selected !== ALL_RESOURCE_TYPE_TAB
    && (counts.get(selected) ?? 0) > 0;
  if (
    selected !== null &&
    selected !== ALL_RESOURCE_TYPE_TAB &&
    visible.includes(selected)
    && (emptyMode(options) !== "disable" || selectedHasItems)
  ) {
    return selected;
  }
  if (!includeAllTab(options)) {
    return present[0] ?? null;
  }
  return null;
}

/**
 * Empty/disabled styling for a type pill. Count > 0 is never empty-disabled.
 * A parent `disabled` on the tab group is separate (loading / whole-control lock).
 */
export function resourceTypeTabEmptyDisabled(
  type: string,
  counts: ReadonlyMap<string, number>,
): boolean {
  if (type === ALL_RESOURCE_TYPE_TAB) {
    return false;
  }
  return resourceTypeTabItemCount(type, counts) <= 0;
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

export const TYPE_TABS_LESS_LABEL = "Less";

/** Trailing overflow control. `1 more` / `3 more`, never the total. */
export function typeTabsMoreLabel(hiddenCount: number): string {
  return `${hiddenCount} more`;
}

export type CollapsedTypeTabFit = {
  visibleCount: number;
  hiddenCount: number;
};

/**
 * How many full pills fit on one row, leaving room for a trailing more
 * control when anything would wrap.
 */
export function collapsedTypeTabFit({
  itemWidths,
  containerWidth,
  moreWidth,
  gap,
}: {
  itemWidths: readonly number[];
  containerWidth: number;
  moreWidth: number;
  gap: number;
}): CollapsedTypeTabFit {
  const count = itemWidths.length;
  if (count === 0) {
    return { visibleCount: 0, hiddenCount: 0 };
  }
  const allWidth =
    itemWidths.reduce((sum, width) => sum + width, 0) + gap * (count - 1);
  if (allWidth <= containerWidth) {
    return { visibleCount: count, hiddenCount: 0 };
  }
  for (let visibleCount = count - 1; visibleCount >= 0; visibleCount -= 1) {
    const itemsWidth =
      visibleCount === 0
        ? 0
        : itemWidths.slice(0, visibleCount).reduce((sum, width) => sum + width, 0)
          + gap * Math.max(visibleCount - 1, 0);
    const used =
      visibleCount === 0 ? moreWidth : itemsWidth + gap + moreWidth;
    if (used <= containerWidth) {
      return { visibleCount, hiddenCount: count - visibleCount };
    }
  }
  return { visibleCount: 0, hiddenCount: count };
}

/** Visible pill copy: count then type text (`1 Skills`, `2 Plugins`). */
export function resourceTypeTabPillsText(
  type: string,
  counts: ReadonlyMap<string, number>,
): string {
  const count = resourceTypeTabItemCount(type, counts);
  return `${count} ${resourceTypeTabLabel(type)}`;
}

/** Singular/plural unit for aria-labels (`skill` / `skills`). */
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
 * Accessible name: `12 resources`, `1 skill` / `3 skills`. Falls back to
 * the type label when the count is 0.
 */
export function resourceTypeTabTooltip(
  type: string,
  counts: ReadonlyMap<string, number>,
  options?: ResourceTypeTabOptions,
): string {
  const count = resourceTypeTabItemCount(type, counts);
  if (count <= 0) {
    if (emptyMode(options) === "disable" && type !== ALL_RESOURCE_TYPE_TAB) {
      return `No ${resourceTypeTabLabel(type)} found`;
    }
    return resourceTypeTabLabel(type);
  }
  return `${count} ${resourceTypeTabUnit(type, count)}`;
}

export interface TypeTabAttention {
  toAdd: number;
  inactive: number;
}

/** Title-case type noun for attention copy (`1 Skill`, `2 Skills`, `1 MCP`). */
export function resourceTypeTabAttentionNoun(type: string, count: number): string {
  const unit = resourceTypeTabUnit(type, count);
  if (type === "mcp_server") {
    return unit;
  }
  return unit.charAt(0).toUpperCase() + unit.slice(1);
}

/** `1 MCP to add · M inactive` when those buckets have rows. */
export function typeTabAttentionTooltip(
  attention: TypeTabAttention | undefined,
  type: string,
): string | null {
  if (!attention) {
    return null;
  }
  const parts: string[] = [];
  if (attention.toAdd > 0) {
    parts.push(
      `${attention.toAdd} ${resourceTypeTabAttentionNoun(type, attention.toAdd)} to add`,
    );
  }
  if (attention.inactive > 0) {
    parts.push(`${attention.inactive} inactive`);
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" · ");
}
