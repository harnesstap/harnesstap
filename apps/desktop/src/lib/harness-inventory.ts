import type { LibraryDetailTarget } from "./library-pane";
import { filterLibraryResourcesBySearch } from "./resource-search";
import {
  countResourceTypeTabs,
  foldResourceTypeTab,
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
}

/** One panel in the main pane. Identity is `path`. */
export interface HarnessLocation {
  readonly path: string;
  readonly surfaces: readonly RegistryPathKey[];
  readonly onDisk: boolean;
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

function availabilityRank(entry: HarnessEntry): number {
  return (entry.disk === "detected" ? 0 : 2) + (entry.supported ? 0 : 1);
}

/** Add-modal rows: catalog minus configured. Detected first, then supported, then registry order. */
export function availableHarnesses(
  inventory: HarnessInventory | null,
): readonly HarnessEntry[] {
  if (!inventory) return [];
  const configured = new Set(selectionIds(inventory.selection));
  return inventory.catalog
    .filter((entry) => !configured.has(entry.id))
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        availabilityRank(a.entry) - availabilityRank(b.entry) || a.index - b.index,
    )
    .map(({ entry }) => entry);
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
    namespace: null,
    description: row.description,
    source: row.source,
  };
}

function searchRows(
  rows: readonly HarnessResourceRow[],
  search: string,
): readonly HarnessResourceRow[] {
  if (!search.trim()) return rows;
  const matched = new Set(
    filterLibraryResourcesBySearch(rows.map(asLibraryResource), search).map(
      (resource) => resource.id,
    ),
  );
  return rows.filter((row) => matched.has(row.id));
}

export function filterHarnessLocations(
  entry: HarnessEntry | null,
  search: string,
  typeTab: string | null,
): FilteredHarnessLocations {
  if (!entry) {
    return { locations: [], typeCounts: new Map() };
  }
  const filtering = search.trim().length > 0 || typeTab !== null;
  const types: string[] = [];
  const locations: HarnessLocation[] = [];
  for (const location of entry.locations) {
    const searched = searchRows(location.resources, search);
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

export const HARNESS_PANEL_PREVIEW_SIZE = 5;

export function visibleLocationRows(
  location: HarnessLocation,
  expanded: boolean,
): readonly HarnessResourceRow[] {
  return expanded
    ? location.resources
    : location.resources.slice(0, HARNESS_PANEL_PREVIEW_SIZE);
}

export function resourceDetailTargetFor(row: HarnessResourceRow): ResourceDetailTarget {
  return {
    kind: "resource",
    selector: row.id || `${row.type}:${row.name}`,
    label: row.name,
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
  readonly editing: boolean;
  /** Location paths whose panel shows every row. */
  readonly expandedLocations: ReadonlySet<string>;
}

export type HarnessesViewAction =
  | { readonly type: "inventory-loaded"; readonly inventory: HarnessInventory }
  | { readonly type: "select"; readonly id: HarnessId }
  | { readonly type: "open-detail"; readonly target: ResourceDetailTarget }
  | { readonly type: "close-detail" }
  | { readonly type: "search"; readonly value: string }
  | { readonly type: "type-tab"; readonly value: string | null }
  | { readonly type: "toggle-edit" }
  | { readonly type: "expand-location"; readonly path: string }
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
    editing: false,
    expandedLocations: new Set(),
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
        expandedLocations: new Set(),
      };
    case "open-detail":
      return { ...state, pane: { mode: "detail", target: action.target } };
    case "close-detail":
      return { ...state, pane: INVENTORY_PANE };
    case "search":
      return { ...state, search: action.value };
    case "type-tab":
      return { ...state, typeTab: action.value };
    case "toggle-edit":
      return state.editing
        ? { ...state, editing: false }
        : { ...state, editing: true, pane: INVENTORY_PANE };
    case "expand-location":
      return {
        ...state,
        expandedLocations: new Set([...state.expandedLocations, action.path]),
      };
    case "reset":
      return initialHarnessesViewState(action.inventory);
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
