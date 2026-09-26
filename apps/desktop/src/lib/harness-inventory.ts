import {
  harnessDisplayName,
  harnessIdFromDisplayName,
  SHARED_AGENTS_SECTION_ID,
} from "./harness-meta";
import { duplicatePluginNames, formatResourceDisplayName } from "./resource-display";
import type { LibraryDetailTarget } from "./library-pane";
import { filterLibraryResourcesBySearch } from "./resource-search";
import {
  countResourceTypeTabs,
  foldResourceTypeTab,
  RESOURCE_TYPE_TAB_ORDER,
  resourceTypeTabLabel,
  type TypeTabAttention,
} from "./resource-type-tabs";
import type { LibraryResource } from "./types";

declare const harnessIdBrand: unique symbol;
/** Registry platform id. Minted by the inventory parser; assignable to string. */
export type HarnessId = string & { readonly [harnessIdBrand]: true };

export function harnessId(id: string): HarnessId {
  return id as HarnessId;
}

export type HarnessRole = "main" | "alias";

export type DiskPresence = "detected" | "shared-only" | "absent";

export type LocationRelation = "native" | "shared" | "host-managed" | "related";

export type RegistryPathKey =
  | "instructions"
  | "skills"
  | "rules"
  | "mcp"
  | "permissions"
  | "hooks"
  | "agents"
  | "commands"
  | "settings"
  | "plugins";

export interface HarnessResourceRow {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  /** `~/`-relative path; row subtitle and detail `pathHint`. */
  readonly source: string;
  readonly origin_kind?: string | null;
  readonly namespace?: string | null;
  readonly origin_ref?: string | null;
}

/** One panel in the main pane. Identity is `path`. */
export interface HarnessLocation {
  readonly path: string;
  readonly surfaces: readonly RegistryPathKey[];
  readonly onDisk: boolean;
  readonly relation: LocationRelation;
  /** Owning harness display name when `relation` is `related`. */
  readonly relatedFrom: string | null;
  readonly resources: readonly HarnessResourceRow[];
}

export interface HarnessEntry {
  readonly id: HarnessId;
  readonly name: string;
  readonly supported: boolean;
  readonly supports: readonly string[];
  readonly disk: DiskPresence;
  readonly locations: readonly HarnessLocation[];
}

/**
 * Saved global preference. `aliases` never contains `main` and has no
 * duplicates. Constructors: `selectionFrom` and `selectionWith` only.
 */
export interface HarnessSelection {
  readonly main: HarnessId;
  readonly aliases: readonly HarnessId[];
}

export interface HarnessInventory {
  /** null = no saved main (fresh install). */
  readonly selection: HarnessSelection | null;
  /** Every registry harness in registry order. */
  readonly catalog: readonly HarnessEntry[];
}

export type ResourceDetailTarget = Extract<LibraryDetailTarget, { kind: "resource" }>;

export function selectionFrom(
  main: HarnessId,
  aliases: readonly HarnessId[],
): HarnessSelection {
  const seen = new Set<HarnessId>([main]);
  const deduped: HarnessId[] = [];
  for (const alias of aliases) {
    if (seen.has(alias)) continue;
    seen.add(alias);
    deduped.push(alias);
  }
  return { main, aliases: deduped };
}

export function selectionIds(selection: HarnessSelection | null): readonly HarnessId[] {
  return selection ? [selection.main, ...selection.aliases] : [];
}

export function roleOf(
  selection: HarnessSelection | null,
  id: HarnessId,
): HarnessRole | null {
  if (!selection) return null;
  if (selection.main === id) return "main";
  return selection.aliases.includes(id) ? "alias" : null;
}

export function harnessEntry(
  inventory: HarnessInventory | null,
  id: HarnessId | null,
): HarnessEntry | null {
  if (!inventory || id === null) return null;
  return inventory.catalog.find((entry) => entry.id === id) ?? null;
}

/** Sidebar rows in saved order; ids the catalog does not know are dropped. */
export function configuredHarnesses(
  inventory: HarnessInventory | null,
): readonly HarnessEntry[] {
  if (!inventory) return [];
  return selectionIds(inventory.selection)
    .map((id) => harnessEntry(inventory, id))
    .filter((entry): entry is HarnessEntry => entry !== null);
}

function isDetected(entry: HarnessEntry): boolean {
  return entry.disk === "detected";
}

function compareHarnessName(a: HarnessEntry, b: HarnessEntry): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
}

/** Add-modal rows: catalog minus configured. Detected first, then name. */
export function availableHarnesses(
  inventory: HarnessInventory | null,
): readonly HarnessEntry[] {
  if (!inventory) return [];
  const configured = new Set(selectionIds(inventory.selection));
  return inventory.catalog
    .filter((entry) => !configured.has(entry.id))
    .sort((a, b) => {
      const detectedDelta = Number(isDetected(b)) - Number(isDetected(a));
      if (detectedDelta !== 0) return detectedDelta;
      return compareHarnessName(a, b);
    });
}

/** Platform feature ids → ResourceTypeTabs short labels, registry order preserved. */
export function harnessSupportsLabel(supports: readonly string[]): string {
  return supports.map((feature) => resourceTypeTabLabel(platformFeatureTabId(feature))).join(", ");
}

function platformFeatureTabId(feature: string): string {
  return registrySurfaceTabId(feature as RegistryPathKey) ?? feature;
}

/** Resource-type tab for a registry path key. `settings` is a container only. */
export function registrySurfaceTabId(surface: string): string | null {
  switch (surface) {
    case "instructions":
      return "instruction";
    case "skills":
      return "skill";
    case "rules":
      return "rule";
    case "mcp":
      return "mcp_server";
    case "permissions":
      return "permission";
    case "hooks":
      return "hook";
    case "agents":
      return "agent";
    case "commands":
      return "command";
    case "env_vars":
      return "env_var";
    case "model_config":
      return "model_config";
    case "plugins":
      return "plugin";
    case "settings":
      return null;
    default:
      return null;
  }
}

export function defaultSelectedHarness(
  inventory: HarnessInventory | null,
): HarnessId | null {
  return inventory?.selection?.main ?? null;
}

export function harnessResourceCount(entry: HarnessEntry): number {
  return entry.locations.reduce((sum, location) => sum + location.resources.length, 0);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function harnessSummary(entry: HarnessEntry): string {
  const onDisk = entry.locations.filter((location) => location.onDisk).length;
  return `${plural(harnessResourceCount(entry), "resource")} · ${plural(onDisk, "location")} on disk`;
}

export function diskPresenceLabel(disk: DiskPresence): string {
  switch (disk) {
    case "detected":
      return "on disk";
    case "shared-only":
      return "shared paths only";
    case "absent":
      return "not on disk";
    default: {
      const exhaustive: never = disk;
      return exhaustive;
    }
  }
}

export function locationRelationLabel(location: HarnessLocation): string | null {
  switch (location.relation) {
    case "native":
      return null;
    case "shared":
      return "shared";
    case "host-managed":
      return "app-managed";
    case "related":
      return location.relatedFrom ? `also ${location.relatedFrom}` : "related";
    default: {
      const exhaustive: never = location.relation;
      return exhaustive;
    }
  }
}

const HARNESS_HOME_PREFIXES: readonly { prefix: string; id: string }[] = [
  { prefix: "~/.config/opencode", id: "opencode" },
  { prefix: "~/.github", id: "github-copilot" },
  { prefix: "~/.copilot", id: "copilot-cli" },
  { prefix: "~/.continue", id: "continue" },
  { prefix: "~/.windsurf", id: "windsurf" },
  { prefix: "~/.minimax", id: "minimax-code" },
  { prefix: "~/.claude", id: "claude-code" },
  { prefix: "~/.cursor", id: "cursor" },
  { prefix: "~/.codex", id: "codex" },
  { prefix: "~/.gemini", id: "gemini-cli" },
  { prefix: "~/.opencode", id: "opencode" },
  { prefix: "~/.muse", id: "muse-code" },
  { prefix: "~/.grok", id: "grok-build" },
  { prefix: "~/.goose", id: "goose" },
  { prefix: "~/.warp", id: "warp" },
  { prefix: "~/.cline", id: "cline" },
];

function isAgentsHubPath(path: string): boolean {
  return path === "~/.agents" || path.startsWith("~/.agents/");
}

function harnessIdFromHomePath(path: string): string | null {
  if (isAgentsHubPath(path)) {
    return SHARED_AGENTS_SECTION_ID;
  }
  for (const { prefix, id } of HARNESS_HOME_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}.`)) {
      return id;
    }
  }
  return null;
}

export interface HarnessSectionOwner {
  readonly iconId: string;
  readonly name: string;
}

/** Icon + label for a location section (harness brand or the shared Agents hub). */
export function locationSectionOwner(
  location: HarnessLocation,
  selected: Pick<HarnessEntry, "id" | "name">,
): HarnessSectionOwner {
  if (isAgentsHubPath(location.path) || location.relation === "shared") {
    return {
      iconId: SHARED_AGENTS_SECTION_ID,
      name: harnessDisplayName(SHARED_AGENTS_SECTION_ID),
    };
  }
  if (location.relation === "related") {
    const iconId =
      harnessIdFromHomePath(location.path)
      ?? (location.relatedFrom ? harnessIdFromDisplayName(location.relatedFrom) : null)
      ?? selected.id;
    return {
      iconId,
      name: location.relatedFrom ?? harnessDisplayName(iconId),
    };
  }
  return { iconId: selected.id, name: selected.name };
}

export const RESOURCE_BADGE_NAME_MAX = 20;

export function truncateResourceBadgeName(
  name: string,
  max = RESOURCE_BADGE_NAME_MAX,
): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max)}...`;
}

export function harnessDuplicatePluginNames(
  locations: readonly { resources: readonly HarnessResourceRow[] }[],
): Set<string> {
  return duplicatePluginNames(
    locations.flatMap((location) => location.resources),
  );
}

/** Plugin refs use `name@marketplace` only when the same plugin name appears twice. */
export function harnessResourceDisplayName(
  row: HarnessResourceRow,
  duplicateNames?: ReadonlySet<string>,
): string {
  return formatResourceDisplayName(
    {
      name: row.name,
      type: row.type,
      namespace: row.namespace,
      origin_ref: row.origin_ref,
      source: row.source,
    },
    { disambiguatePlugin: duplicateNames?.has(row.name) ?? false },
  );
}

export function harnessResourceBadgeLabel(
  row: HarnessResourceRow,
  duplicateNames?: ReadonlySet<string>,
): string {
  const label = harnessResourceDisplayName(row, duplicateNames);
  if (row.type === "plugin") {
    return label;
  }
  return truncateResourceBadgeName(label);
}

export interface HarnessTypeSection {
  readonly path: string;
  readonly onDisk: boolean;
  readonly owner: HarnessSectionOwner;
  readonly resources: readonly HarnessResourceRow[];
}

export interface HarnessTypeGroup {
  readonly type: string;
  readonly sections: readonly HarnessTypeSection[];
}

/**
 * Type groups, then one section per location that contributes that type
 * (native / related / shared / app-managed), preserving location order.
 */
export function groupHarnessLocationsByType(
  entry: Pick<HarnessEntry, "id" | "name">,
  locations: readonly HarnessLocation[],
): readonly HarnessTypeGroup[] {
  const sectionsByType = new Map<string, HarnessTypeSection[]>();

  for (const location of locations) {
    const owner = locationSectionOwner(location, entry);
    const rowsByType = new Map<string, HarnessResourceRow[]>();
    for (const row of location.resources) {
      const type = foldResourceTypeTab(row.type);
      const rows = rowsByType.get(type) ?? [];
      rows.push(row);
      rowsByType.set(type, rows);
    }
    const types = new Set<string>(rowsByType.keys());
    for (const surface of location.surfaces) {
      const mapped = registrySurfaceTabId(surface);
      if (mapped) types.add(foldResourceTypeTab(mapped));
    }
    for (const type of types) {
      const list = sectionsByType.get(type) ?? [];
      list.push({
        path: location.path,
        onDisk: location.onDisk,
        owner,
        resources: rowsByType.get(type) ?? [],
      });
      sectionsByType.set(type, list);
    }
  }

  const ordered: HarnessTypeGroup[] = [];
  const seen = new Set<string>();
  for (const type of RESOURCE_TYPE_TAB_ORDER) {
    const sections = sectionsByType.get(type);
    if (!sections || sections.length === 0) continue;
    ordered.push({ type, sections });
    seen.add(type);
  }
  for (const [type, sections] of sectionsByType) {
    if (seen.has(type) || sections.length === 0) continue;
    ordered.push({ type, sections });
  }
  return ordered;
}

export interface DetectProposal {
  /** detected && not configured */
  readonly add: readonly HarnessEntry[];
  /** configured && absent (shared-only is never proposed) */
  readonly remove: readonly HarnessEntry[];
}

export function detectProposal(inventory: HarnessInventory): DetectProposal {
  const add: HarnessEntry[] = [];
  const remove: HarnessEntry[] = [];
  for (const entry of inventory.catalog) {
    const role = roleOf(inventory.selection, entry.id);
    if (role === null && entry.disk === "detected") {
      add.push(entry);
    } else if (role !== null && entry.disk === "absent") {
      remove.push(entry);
    }
  }
  return { add, remove };
}

export function proposalIsEmpty(proposal: DetectProposal): boolean {
  return proposal.add.length === 0 && proposal.remove.length === 0;
}

/** Adds checked, removes unchecked. */
export function defaultProposalChoice(proposal: DetectProposal): ReadonlySet<HarnessId> {
  return new Set(proposal.add.map((entry) => entry.id));
}

export type SelectionChange =
  | { readonly kind: "add"; readonly id: HarnessId }
  | { readonly kind: "remove"; readonly id: HarnessId }
  | { readonly kind: "make-main"; readonly id: HarnessId }
  | {
      readonly kind: "apply-proposal";
      readonly add: readonly HarnessId[];
      readonly remove: readonly HarnessId[];
    };

export type SelectionRejection = "would-empty" | "unknown-harness";

export type SelectionOutcome =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "changed";
      readonly next: HarnessSelection;
      readonly added: readonly HarnessId[];
      readonly removed: readonly HarnessId[];
      /** Set when a removal took the main and the first alias was promoted. */
      readonly promotedMain: HarnessId | null;
    }
  | { readonly kind: "rejected"; readonly reason: SelectionRejection };

type FoldStep =
  | { readonly kind: "ok"; readonly next: HarnessSelection | null; readonly applied: boolean }
  | { readonly kind: "rejected"; readonly reason: SelectionRejection };

function addStep(current: HarnessSelection | null, id: HarnessId): FoldStep {
  if (roleOf(current, id) !== null) {
    return { kind: "ok", next: current, applied: false };
  }
  if (!current) {
    return { kind: "ok", next: { main: id, aliases: [] }, applied: true };
  }
  return {
    kind: "ok",
    next: { main: current.main, aliases: [...current.aliases, id] },
    applied: true,
  };
}

function removeStep(current: HarnessSelection | null, id: HarnessId): FoldStep {
  const role = roleOf(current, id);
  if (!current || role === null) {
    return { kind: "ok", next: current, applied: false };
  }
  if (current.aliases.length === 0) {
    return { kind: "rejected", reason: "would-empty" };
  }
  if (role === "main") {
    const [promoted, ...rest] = current.aliases;
    if (!promoted) {
      return { kind: "rejected", reason: "would-empty" };
    }
    return { kind: "ok", next: { main: promoted, aliases: rest }, applied: true };
  }
  return {
    kind: "ok",
    next: {
      main: current.main,
      aliases: current.aliases.filter((alias) => alias !== id),
    },
    applied: true,
  };
}

function changed(
  before: HarnessSelection | null,
  next: HarnessSelection,
  added: readonly HarnessId[],
  removed: readonly HarnessId[],
): SelectionOutcome {
  const mainRemoved = before !== null && removed.includes(before.main);
  return {
    kind: "changed",
    next,
    added,
    removed,
    promotedMain: mainRemoved ? next.main : null,
  };
}

/**
 * The only mutation algebra. Idempotent: applying the same change to its
 * result is `unchanged`.
 */
export function selectionWith(
  current: HarnessSelection | null,
  catalog: readonly HarnessEntry[],
  change: SelectionChange,
): SelectionOutcome {
  const known = new Set<HarnessId>(catalog.map((entry) => entry.id));
  const ids =
    change.kind === "apply-proposal" ? [...change.add, ...change.remove] : [change.id];
  if (ids.some((id) => !known.has(id))) {
    return { kind: "rejected", reason: "unknown-harness" };
  }

  switch (change.kind) {
    case "add": {
      const step = addStep(current, change.id);
      if (step.kind === "rejected") return step;
      if (!step.applied || !step.next) return { kind: "unchanged" };
      return changed(current, step.next, [change.id], []);
    }
    case "remove": {
      const step = removeStep(current, change.id);
      if (step.kind === "rejected") return step;
      if (!step.applied || !step.next) return { kind: "unchanged" };
      return changed(current, step.next, [], [change.id]);
    }
    case "make-main": {
      const role = roleOf(current, change.id);
      if (!current || role === null) {
        return { kind: "rejected", reason: "unknown-harness" };
      }
      if (role === "main") return { kind: "unchanged" };
      return {
        kind: "changed",
        next: {
          main: change.id,
          aliases: [current.main, ...current.aliases.filter((alias) => alias !== change.id)],
        },
        added: [],
        removed: [],
        promotedMain: null,
      };
    }
    case "apply-proposal": {
      let next = current;
      const added: HarnessId[] = [];
      const removed: HarnessId[] = [];
      for (const id of change.add) {
        const step = addStep(next, id);
        if (step.kind === "rejected") return step;
        if (step.applied) added.push(id);
        next = step.next;
      }
      for (const id of change.remove) {
        const step = removeStep(next, id);
        if (step.kind === "rejected") return step;
        if (step.applied) removed.push(id);
        next = step.next;
      }
      if (!next || (added.length === 0 && removed.length === 0)) {
        return { kind: "unchanged" };
      }
      return changed(current, next, added, removed);
    }
    default: {
      const exhaustive: never = change;
      return exhaustive;
    }
  }
}

export type RemoveCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "would-empty" | "not-configured" };

export function canRemoveHarness(
  selection: HarnessSelection | null,
  id: HarnessId,
): RemoveCheck {
  if (roleOf(selection, id) === null) {
    return { ok: false, reason: "not-configured" };
  }
  if (selectionIds(selection).length === 1) {
    return { ok: false, reason: "would-empty" };
  }
  return { ok: true };
}

export const KEEP_ONE_HARNESS_HINT = "Keep at least one harness.";

export function removalCopy(
  inventory: HarnessInventory,
  id: HarnessId,
): { readonly title: string; readonly body: string } {
  const name = harnessEntry(inventory, id)?.name ?? id;
  const selection = inventory.selection;
  const promoted =
    selection && selection.main === id ? (selection.aliases[0] ?? null) : null;
  const promotedName = promoted ? (harnessEntry(inventory, promoted)?.name ?? promoted) : null;
  return {
    title: `Remove ${name}?`,
    body:
      `${name} leaves your harness list. Files on disk stay.`
      + (promotedName ? ` ${promotedName} becomes the main harness.` : ""),
  };
}

export interface FilteredHarnessLocations {
  /** With an active search or type tab, zero-row locations are dropped. */
  readonly locations: readonly HarnessLocation[];
  /** Counts from the search-filtered set, before the type tab. */
  readonly typeCounts: ReadonlyMap<string, number>;
}

function asLibraryResource(row: HarnessResourceRow): LibraryResource {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    namespace: row.namespace ?? null,
    description: row.description,
    source: row.source,
    origin_kind: row.origin_kind,
    origin_ref: row.origin_ref,
  };
}

export interface HarnessFilterOption {
  readonly id: string;
  readonly label: string;
}

export interface HarnessFacetFilter {
  readonly origins?: ReadonlySet<string>;
  readonly marketplaces?: ReadonlySet<string>;
}

const MARKETPLACE_ORIGIN_KIND = "marketplace_link";
const MARKETPLACE_FALLBACK_LABEL = "Marketplace";

/** Marketplace catalog name from `plugin@marketplace` origin refs. */
export function harnessResourceMarketplace(
  row: Pick<HarnessResourceRow, "origin_kind" | "origin_ref">,
): string | null {
  if (row.origin_kind !== MARKETPLACE_ORIGIN_KIND) return null;
  const ref = row.origin_ref?.trim() ?? "";
  if (!ref) return MARKETPLACE_FALLBACK_LABEL;
  const separator = ref.lastIndexOf("@");
  if (separator >= 0 && separator < ref.length - 1) {
    return ref.slice(separator + 1);
  }
  return ref;
}

export function harnessOriginFilterOptions(
  entry: Pick<HarnessEntry, "id" | "name" | "locations">,
): HarnessFilterOption[] {
  const seen = new Set<string>();
  const options: HarnessFilterOption[] = [];
  for (const location of entry.locations) {
    if (location.resources.length === 0) continue;
    const owner = locationSectionOwner(location, entry);
    if (seen.has(owner.iconId)) continue;
    seen.add(owner.iconId);
    options.push({ id: owner.iconId, label: owner.name });
  }
  return options;
}

export function harnessMarketplaceFilterOptions(
  entry: Pick<HarnessEntry, "locations">,
): HarnessFilterOption[] {
  const seen = new Set<string>();
  const options: HarnessFilterOption[] = [];
  for (const location of entry.locations) {
    for (const resource of location.resources) {
      const name = harnessResourceMarketplace(resource);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      options.push({ id: name, label: name });
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

export function isHarnessFacetFilterActive(facets: HarnessFacetFilter | undefined): boolean {
  return Boolean(
    (facets?.origins && facets.origins.size > 0)
    || (facets?.marketplaces && facets.marketplaces.size > 0),
  );
}

function searchIdentity(row: Pick<HarnessResourceRow, "id" | "type" | "name" | "source" | "origin_ref">): string {
  if (row.id) return `id:${row.id}`;
  return `row:${row.type}:${row.name}:${row.source}:${row.origin_ref ?? ""}`;
}

function searchRows(
  rows: readonly HarnessResourceRow[],
  search: string,
): readonly HarnessResourceRow[] {
  if (!search.trim()) return rows;
  const matched = new Set(
    filterLibraryResourcesBySearch(rows.map(asLibraryResource), search).map(
      (resource) => searchIdentity(resource),
    ),
  );
  return rows.filter((row) => matched.has(searchIdentity(row)));
}

function marketplaceRows(
  rows: readonly HarnessResourceRow[],
  marketplaces: ReadonlySet<string> | undefined,
): readonly HarnessResourceRow[] {
  if (!marketplaces || marketplaces.size === 0) return rows;
  return rows.filter((row) => {
    const name = harnessResourceMarketplace(row);
    return name !== null && marketplaces.has(name);
  });
}

export function filterHarnessLocations(
  entry: HarnessEntry | null,
  search: string,
  typeTab: string | null,
  facets?: HarnessFacetFilter,
): FilteredHarnessLocations {
  if (!entry) {
    return { locations: [], typeCounts: new Map() };
  }
  const origins = facets?.origins;
  const originActive = Boolean(origins && origins.size > 0);
  const marketplaceActive = Boolean(facets?.marketplaces && facets.marketplaces.size > 0);
  const filtering =
    search.trim().length > 0 || typeTab !== null || originActive || marketplaceActive;
  const types: string[] = [];
  const locations: HarnessLocation[] = [];
  for (const location of entry.locations) {
    if (originActive && origins && !origins.has(locationSectionOwner(location, entry).iconId)) {
      continue;
    }
    const searched = marketplaceRows(searchRows(location.resources, search), facets?.marketplaces);
    types.push(...searched.map((row) => row.type));
    const rows =
      typeTab === null
        ? searched
        : searched.filter((row) => foldResourceTypeTab(row.type) === typeTab);
    if (filtering && rows.length === 0) continue;
    locations.push({ ...location, resources: rows });
  }
  return { locations, typeCounts: countResourceTypeTabs(types) };
}

export function resourceDetailTargetFor(
  row: HarnessResourceRow,
  duplicateNames?: ReadonlySet<string>,
): ResourceDetailTarget {
  return {
    kind: "resource",
    selector: row.id || `${row.type}:${row.name}`,
    label: harnessResourceDisplayName(row, duplicateNames),
    pathHint: row.source,
  };
}

/** No Not in profile / Inactive dots on this screen. */
export const NO_ATTENTION: ReadonlyMap<string, TypeTabAttention> = new Map();

export type HarnessesPane =
  | { readonly mode: "inventory" }
  | { readonly mode: "detail"; readonly target: ResourceDetailTarget };

export interface HarnessesViewState {
  readonly selectedId: HarnessId | null;
  readonly pane: HarnessesPane;
  readonly search: string;
  readonly typeTab: string | null;
  readonly originIds: readonly string[];
  readonly marketplaceIds: readonly string[];
  readonly editing: boolean;
}

export type HarnessesViewAction =
  | { readonly type: "inventory-loaded"; readonly inventory: HarnessInventory }
  | { readonly type: "select"; readonly id: HarnessId }
  | { readonly type: "open-detail"; readonly target: ResourceDetailTarget }
  | { readonly type: "close-detail" }
  | { readonly type: "search"; readonly value: string }
  | { readonly type: "type-tab"; readonly value: string | null }
  | { readonly type: "origin-filter"; readonly value: readonly string[] }
  | { readonly type: "marketplace-filter"; readonly value: readonly string[] }
  | { readonly type: "toggle-edit" }
  | { readonly type: "reset"; readonly inventory: HarnessInventory | null };

const INVENTORY_PANE: HarnessesPane = { mode: "inventory" };

export function initialHarnessesViewState(
  inventory: HarnessInventory | null,
): HarnessesViewState {
  return {
    selectedId: defaultSelectedHarness(inventory),
    pane: INVENTORY_PANE,
    search: "",
    typeTab: null,
    originIds: [],
    marketplaceIds: [],
    editing: false,
  };
}

export function harnessesViewReducer(
  state: HarnessesViewState,
  action: HarnessesViewAction,
): HarnessesViewState {
  switch (action.type) {
    case "inventory-loaded": {
      const stillConfigured =
        state.selectedId !== null
        && roleOf(action.inventory.selection, state.selectedId) !== null;
      return stillConfigured
        ? state
        : { ...state, selectedId: defaultSelectedHarness(action.inventory) };
    }
    case "select":
      return {
        ...state,
        selectedId: action.id,
        pane: INVENTORY_PANE,
      };
    case "open-detail":
      return { ...state, pane: { mode: "detail", target: action.target } };
    case "close-detail":
      return { ...state, pane: INVENTORY_PANE };
    case "search":
      return { ...state, search: action.value };
    case "type-tab":
      return { ...state, typeTab: action.value };
    case "origin-filter":
      return { ...state, originIds: action.value };
    case "marketplace-filter":
      return { ...state, marketplaceIds: action.value };
    case "toggle-edit":
      return state.editing
        ? { ...state, editing: false }
        : { ...state, editing: true, pane: INVENTORY_PANE };
    case "reset":
      return initialHarnessesViewState(action.inventory);
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
