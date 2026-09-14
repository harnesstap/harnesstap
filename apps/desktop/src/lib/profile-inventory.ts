import { filterContentsResourcesBySearch } from "./resource-search";
import {
  ALL_RESOURCE_TYPE_TAB,
  countResourceTypeTabs,
  foldResourceTypeTab,
  type TypeTabAttention,
} from "./resource-type-tabs";
import type { ProfileResourceListRow } from "./contents-diff";
import type {
  DriftFileChange,
  ProfileContentsResource,
} from "./types";

export const PROFILE_INVENTORY_SECTION_ORDER = [
  "not_in_profile",
  "inactive",
  "active",
] as const;

export type ProfileInventorySectionId =
  (typeof PROFILE_INVENTORY_SECTION_ORDER)[number];

export interface ProfileInventoryItem {
  section: ProfileInventorySectionId;
  key: string;
  type: string;
  label: string;
  resource: ProfileContentsResource;
  pluginId?: string;
  pluginName?: string;
  drifted: boolean;
  driftChange?: DriftFileChange;
}

export interface PartitionProfileInventoryInput {
  profileRows: ProfileResourceListRow[];
  liveRows: ProfileResourceListRow[];
  notStaged: ProfileContentsResource[];
  fileChanges?: DriftFileChange[];
}

function membershipKey(resource: Pick<ProfileContentsResource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

function resourceFromRow(row: ProfileResourceListRow): ProfileContentsResource {
  switch (row.kind) {
    case "plugin":
      return {
        type: "plugin",
        name: row.plugin.name,
        id: row.plugin.id,
        source: row.plugin.id,
      };
    case "pin":
      return {
        type: "plugin_pin",
        name: row.pin.ref,
        id: row.pin.ref,
        source: row.pin.version_constraint,
      };
    case "resource":
      return row.resource;
    default: {
      const neverRow: never = row;
      return neverRow;
    }
  }
}

function rowAliases(row: ProfileResourceListRow): string[] {
  switch (row.kind) {
    case "plugin":
      return [
        membershipKey({ type: "plugin", name: row.plugin.name }),
        membershipKey({ type: "plugin", name: row.plugin.id }),
      ];
    case "pin":
      return [
        membershipKey({ type: "plugin_pin", name: row.pin.ref }),
        membershipKey({ type: "plugin", name: row.pin.ref }),
      ];
    case "resource":
      return [membershipKey(row.resource)];
    default: {
      const neverRow: never = row;
      return neverRow;
    }
  }
}

function collectKeys(rows: ProfileResourceListRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const alias of rowAliases(row)) {
      keys.add(alias);
    }
  }
  return keys;
}

function fileChangeForResource(
  resource: ProfileContentsResource,
  fileChanges: DriftFileChange[],
): DriftFileChange | undefined {
  const source = resource.source?.replace(/\\/g, "/");
  return fileChanges.find((change) => {
    if (change.resource?.type === resource.type && change.resource.name === resource.name) {
      return true;
    }
    if (!source) {
      return false;
    }
    return change.path.replace(/\\/g, "/") === source;
  });
}

export function partitionProfileInventory(
  input: PartitionProfileInventoryInput,
): {
  notInProfile: ProfileInventoryItem[];
  inactive: ProfileInventoryItem[];
  active: ProfileInventoryItem[];
} {
  const liveKeys = collectKeys(input.liveRows);
  const profileKeys = collectKeys(input.profileRows);
  const fileChanges = input.fileChanges ?? [];
  const driftedKeys = new Set<string>();
  const notInProfile: ProfileInventoryItem[] = [];

  for (const resource of input.notStaged) {
    const key = membershipKey(resource);
    if (resource.not_staged_kind === "update") {
      driftedKeys.add(key);
      continue;
    }
    if (profileKeys.has(key)) {
      continue;
    }
    notInProfile.push({
      section: "not_in_profile",
      key: `not-in-profile:${key}`,
      type: resource.type,
      label: resource.name,
      resource,
      drifted: false,
    });
  }

  const inactive: ProfileInventoryItem[] = [];
  const active: ProfileInventoryItem[] = [];

  for (const row of input.profileRows) {
    const resource = resourceFromRow(row);
    const key = membershipKey(resource);
    const onHarness = rowAliases(row).some((alias) => liveKeys.has(alias));
    const driftChange = fileChangeForResource(resource, fileChanges);
    const drifted = driftedKeys.has(key) || Boolean(driftChange);
    const item: ProfileInventoryItem = {
      section: onHarness ? "active" : "inactive",
      key: row.key,
      type: row.type,
      label: resource.name,
      resource,
      pluginId: row.kind === "resource" ? row.pluginId : undefined,
      pluginName: row.kind === "resource" ? row.pluginName : undefined,
      drifted: onHarness && drifted,
      ...(onHarness && driftChange ? { driftChange } : {}),
    };
    if (!item.driftChange && item.drifted && resource.source) {
      item.driftChange = {
        path: resource.source,
        type: "modified",
        resource: { type: resource.type, name: resource.name },
      };
    }
    if (onHarness) {
      active.push(item);
    } else {
      inactive.push(item);
    }
  }

  return { notInProfile, inactive, active };
}

export function filterProfileInventoryItems(
  items: ProfileInventoryItem[],
  search: string,
  typeTab: string | null,
): ProfileInventoryItem[] {
  const typed =
    typeTab === null
      ? items
      : items.filter((item) => foldResourceTypeTab(item.type) === typeTab);
  if (!search.trim()) {
    return typed;
  }
  const matched = new Set(
    filterContentsResourcesBySearch(
      typed.map((item) => item.resource),
      search,
    ).map((resource) => membershipKey(resource)),
  );
  return typed.filter((item) => matched.has(membershipKey(item.resource)));
}

/** Type-tab counts for the same item set as the inventory list (search-scoped). */
export function countInventoryTypeTabs(
  items: ProfileInventoryItem[],
): Map<string, number> {
  return countResourceTypeTabs(items.map((item) => item.type));
}

export function collectTypeTabAttention(
  items: ProfileInventoryItem[],
): Map<string, TypeTabAttention> {
  const byType = new Map<string, TypeTabAttention>();
  const all: TypeTabAttention = { toAdd: 0, inactive: 0 };
  for (const item of items) {
    if (item.section !== "not_in_profile" && item.section !== "inactive") {
      continue;
    }
    const type = foldResourceTypeTab(item.type);
    const bucket = byType.get(type) ?? { toAdd: 0, inactive: 0 };
    if (item.section === "not_in_profile") {
      bucket.toAdd += 1;
      all.toAdd += 1;
    } else {
      bucket.inactive += 1;
      all.inactive += 1;
    }
    byType.set(type, bucket);
  }
  if (all.toAdd > 0 || all.inactive > 0) {
    byType.set(ALL_RESOURCE_TYPE_TAB, all);
  }
  return byType;
}
