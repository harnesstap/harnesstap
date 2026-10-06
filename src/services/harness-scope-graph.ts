import { getPluginResources, resolvePluginSelector } from "../models/plugin-model.js";
import type { Resource } from "../types.js";
import {
  HARNESS_SCOPE_ALL,
  intersectHarnessScopes,
  resourceHarnessScope,
  unionHarnessScopes,
  withHarnessScope,
  type HarnessScope,
} from "./harness-scope.js";

export function applyIncomingHarnessScope(
  resources: Resource[],
  incoming: HarnessScope,
): Resource[] {
  if (incoming.kind === "all") {
    return resources;
  }
  return resources.map((resource) =>
    withHarnessScope(
      resource,
      intersectHarnessScopes(resourceHarnessScope(resource), incoming),
    ),
  );
}

/**
 * Walk plugin-ref attachments so a scoped nested plugin only materializes on
 * the intersection of its own memberships and the parent ref's scope.
 */
export function incomingScopeByPluginId(pluginIds: readonly string[]): Map<string, HarnessScope> {
  const incoming = new Map<string, HarnessScope>();
  const root = pluginIds[0];
  if (root) {
    incoming.set(root, HARNESS_SCOPE_ALL);
  }
  for (const pluginId of pluginIds) {
    const parentIncoming = incoming.get(pluginId) ?? HARNESS_SCOPE_ALL;
    for (const resource of getPluginResources(pluginId)) {
      if (resource.type !== "plugin") continue;
      const child = resolvePluginSelector(resource.name);
      if (!child || !pluginIds.includes(child.id)) continue;
      const next = intersectHarnessScopes(parentIncoming, resourceHarnessScope(resource));
      const existing = incoming.get(child.id);
      incoming.set(child.id, existing ? unionHarnessScopes(existing, next) : next);
    }
  }
  return incoming;
}
