import { getPreset, getPresetResources } from "../models/preset.js";
import { listPresetPlugins } from "../models/plugin.js";
import type {
  ClaudePluginEntry,
  ClaudePresetConfig,
  Preset,
  Resource,
} from "../types.js";

export interface MergedPresetContent {
  presets: Preset[];
  resources: Resource[];
  claude?: ClaudePresetConfig;
  pluginPins: Array<{ ref: string; version_constraint: string }>;
}

function resourceKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

function mergeClaudeConfig(
  base: ClaudePresetConfig | undefined,
  next: ClaudePresetConfig | undefined,
): ClaudePresetConfig | undefined {
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
 * Merge multiple presets in order; later presets override earlier ones for
 * resources (by type:name), plugin pins (by ref), and Claude config.
 */
export function mergePresets(presetNames: string[]): MergedPresetContent {
  const presets: Preset[] = [];
  const resourceOrder: string[] = [];
  const resourceByKey = new Map<string, Resource>();
  const pluginPins = new Map<string, { ref: string; version_constraint: string }>();
  let claude: ClaudePresetConfig | undefined;

  for (const name of presetNames) {
    const preset = getPreset(name);
    if (!preset) {
      throw new Error(`Preset not found: ${name}`);
    }
    presets.push(preset);

    for (const resource of getPresetResources(preset.id)) {
      const key = resourceKey(resource);
      if (!resourceByKey.has(key)) {
        resourceOrder.push(key);
      }
      resourceByKey.set(key, resource);
    }

    for (const pin of listPresetPlugins(preset.id)) {
      pluginPins.set(pin.ref, {
        ref: pin.ref,
        version_constraint: pin.version_constraint,
      });
    }

    claude = mergeClaudeConfig(claude, preset.claude);
  }

  const resources = resourceOrder
    .map((key) => resourceByKey.get(key))
    .filter((r): r is Resource => r !== undefined);

  return {
    presets,
    resources,
    claude,
    pluginPins: [...pluginPins.values()],
  };
}
