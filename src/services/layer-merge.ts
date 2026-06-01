import { getLayer, getLayerResources } from "../models/layer.js";
import { listLayerPlugins } from "../models/plugin.js";
import type {
  ClaudePluginEntry,
  ClaudeLayerConfig,
  Layer,
  Resource,
} from "../types.js";

export interface MergedLayerContent {
  layers: Layer[];
  resources: Resource[];
  claude?: ClaudeLayerConfig;
  pluginPins: Array<{ ref: string; version_constraint: string }>;
}

function resourceKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
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
  const pluginMap = new Map<string, ClaudePluginEntry>();
  for (const p of base?.plugins ?? []) {
    pluginMap.set(p.id, p);
  }
  for (const p of next?.plugins ?? []) {
    pluginMap.set(p.id, p);
  }
  const plugins = [...pluginMap.values()];
  return {
    ...(Object.keys(marketplaces).length > 0 ? { marketplaces } : {}),
    ...(plugins.length > 0 ? { plugins } : {}),
  };
}

/**
 * Merge multiple layers in order; later layers override earlier ones for
 * resources (by type:name), plugin pins (by ref), and Claude config.
 */
export function mergeLayers(layerNames: string[]): MergedLayerContent {
  const layers: Layer[] = [];
  const resourceOrder: string[] = [];
  const resourceByKey = new Map<string, Resource>();
  const pluginPins = new Map<string, { ref: string; version_constraint: string }>();
  let claude: ClaudeLayerConfig | undefined;

  for (const name of layerNames) {
    const layer = getLayer(name);
    if (!layer) {
      throw new Error(`Layer not found: ${name}`);
    }
    layers.push(layer);

    for (const resource of getLayerResources(layer.id)) {
      const key = resourceKey(resource);
      if (!resourceByKey.has(key)) {
        resourceOrder.push(key);
      }
      resourceByKey.set(key, resource);
    }

    for (const pin of listLayerPlugins(layer.id)) {
      pluginPins.set(pin.ref, {
        ref: pin.ref,
        version_constraint: pin.version_constraint,
      });
    }

    claude = mergeClaudeConfig(claude, layer.claude);
  }

  const resources = resourceOrder
    .map((key) => resourceByKey.get(key))
    .filter((r): r is Resource => r !== undefined);

  return {
    layers,
    resources,
    claude,
    pluginPins: [...pluginPins.values()],
  };
}
