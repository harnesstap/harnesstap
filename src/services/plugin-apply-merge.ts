import { getPluginById, mergePluginsById, type MergedPluginContent } from "../models/plugin-model.js";
import { getEnvironmentResources } from "../models/environment.js";
import type { ClaudePluginConfig, Resource } from "../types.js";

function resourceKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

function mergeResources(base: Resource[], next: Resource[]): Resource[] {
  const order: string[] = [];
  const byKey = new Map<string, Resource>();
  for (const resource of [...base, ...next]) {
    const key = resourceKey(resource);
    if (!byKey.has(key)) {
      order.push(key);
    }
    byKey.set(key, resource);
  }
  return order
    .map((key) => byKey.get(key))
    .filter((r): r is Resource => r !== undefined);
}

function mergeClaudeConfig(
  base: ClaudePluginConfig | undefined,
  next: ClaudePluginConfig | undefined,
): ClaudePluginConfig | undefined {
  if (!base && !next) return undefined;
  const marketplaces = {
    ...(base?.marketplaces ?? {}),
    ...(next?.marketplaces ?? {}),
  };
  const pluginMap = new Map(
    [...(base?.plugins ?? []), ...(next?.plugins ?? [])].map((p) => [p.id, p]),
  );
  const plugins = [...pluginMap.values()];
  return {
    ...(Object.keys(marketplaces).length > 0 ? { marketplaces } : {}),
    ...(plugins.length > 0 ? { plugins } : {}),
  };
}

function mergeMergedContent(
  base: MergedPluginContent,
  next: MergedPluginContent,
): MergedPluginContent {
  const pinMap = new Map(base.pluginPins.map((pin) => [pin.ref, pin]));
  for (const pin of next.pluginPins) {
    pinMap.set(pin.ref, pin);
  }
  return {
    plugins: [...base.plugins, ...next.plugins],
    resources: mergeResources(base.resources, next.resources),
    claude: mergeClaudeConfig(base.claude, next.claude),
    pluginPins: [...pinMap.values()],
  };
}

/**
 * Merge plugins in apply order, including each plugin's default environment resources.
 */
export function mergePluginsForApply(pluginIds: string[]): MergedPluginContent {
  let merged: MergedPluginContent = {
    plugins: [],
    resources: [],
    pluginPins: [],
  };

  for (const pluginId of pluginIds) {
    const plugin = getPluginById(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    merged = mergeMergedContent(merged, mergePluginsById([pluginId]));

    if (plugin.default_environment_id) {
      merged = {
        ...merged,
        resources: mergeResources(
          merged.resources,
          getEnvironmentResources(plugin.default_environment_id),
        ),
      };
    }
  }

  return merged;
}
