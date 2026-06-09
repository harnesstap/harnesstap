import { listResources } from "../models/resource.js";
import { MATERIAL_RESOURCE_TYPES } from "../types.js";
import type { Resource } from "../types.js";
import type { PluginConstraintPin } from "./plugin-apply-validation.js";

const materialTypes = new Set<string>(MATERIAL_RESOURCE_TYPES);

function materialResourceKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

/** Collect marketplace-linked material resources imported from pinned plugin install trees. */
export function expandPluginMaterialResources(
  pins: PluginConstraintPin[],
  baseResources: Resource[] = [],
): Resource[] {
  if (pins.length === 0) {
    return baseResources;
  }

  const pinRefs = new Set(pins.map((pin) => pin.ref));
  const order: string[] = [];
  const byKey = new Map<string, Resource>();

  for (const resource of baseResources) {
    const key = materialResourceKey(resource);
    if (!byKey.has(key)) {
      order.push(key);
    }
    byKey.set(key, resource);
  }

  for (const resource of listResources({ origin_kind: "marketplace_link" })) {
    if (!resource.origin_ref || !pinRefs.has(resource.origin_ref)) {
      continue;
    }
    if (!materialTypes.has(resource.type)) {
      continue;
    }
    const key = materialResourceKey(resource);
    if (!byKey.has(key)) {
      order.push(key);
    }
    byKey.set(key, resource);
  }

  return order
    .map((key) => byKey.get(key))
    .filter((resource): resource is Resource => resource !== undefined);
}

export function countPluginMaterialResources(
  pins: PluginConstraintPin[],
  baseResources: Resource[] = [],
): number {
  const expanded = expandPluginMaterialResources(pins, baseResources);
  return Math.max(0, expanded.length - baseResources.length);
}
