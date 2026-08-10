import { getLayerById, mergeLayersById, type MergedLayerContent } from "../models/plugin-model.js";
import { getEnvironmentResources } from "../models/environment.js";
import type { ClaudeLayerConfig, Resource } from "../types.js";

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
  base: ClaudeLayerConfig | undefined,
  next: ClaudeLayerConfig | undefined,
): ClaudeLayerConfig | undefined {
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
  base: MergedLayerContent,
  next: MergedLayerContent,
): MergedLayerContent {
  const pinMap = new Map(base.pluginPins.map((pin) => [pin.ref, pin]));
  for (const pin of next.pluginPins) {
    pinMap.set(pin.ref, pin);
  }
  return {
    layers: [...base.layers, ...next.layers],
    resources: mergeResources(base.resources, next.resources),
    claude: mergeClaudeConfig(base.claude, next.claude),
    pluginPins: [...pinMap.values()],
  };
}

/**
 * Merge layers in apply order, including each layer's default environment resources.
 */
export function mergeLayersForApply(layerIds: string[]): MergedLayerContent {
  let merged: MergedLayerContent = {
    layers: [],
    resources: [],
    pluginPins: [],
  };

  for (const layerId of layerIds) {
    const layer = getLayerById(layerId);
    if (!layer) {
      throw new Error(`Layer not found: ${layerId}`);
    }

    merged = mergeMergedContent(merged, mergeLayersById([layerId]));

    if (layer.default_environment_id) {
      merged = {
        ...merged,
        resources: mergeResources(
          merged.resources,
          getEnvironmentResources(layer.default_environment_id),
        ),
      };
    }
  }

  return merged;
}
