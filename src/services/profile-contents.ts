import { isEmptyBuiltinProfile, isProfileLayer } from "../constants/profile.js";
import {
  getLayerById,
  getLayerResources,
  resolveLayerSelector,
} from "../models/layer-model.js";
import { getEnvironmentResources } from "../models/environment.js";
import type { Resource } from "../types.js";
import { mergeLayersForApply } from "./layer-apply-merge.js";
import { formatResourceTypeSummary } from "./project-status-payload.js";
import { collectProfileLayerIds } from "./profile-apply.js";

export interface ProfileContentsResource {
  id: string;
  type: string;
  name: string;
  /** On-disk path or import origin label (hover target in desktop). */
  source: string;
}

export interface ProfileContentsLayer {
  id: string;
  name: string;
  version: string;
  resources: ProfileContentsResource[];
}

export interface ProfileContentsPin {
  ref: string;
  version_constraint: string;
}

export interface ProfileContents {
  layers: ProfileContentsLayer[];
  stack_resource_count: number;
  stack_summary: string | null;
  /** Counts by resource type, plus `layer` and `plugin_pin`. */
  type_counts: Record<string, number>;
  resources: ProfileContentsResource[];
  plugin_pins: ProfileContentsPin[];
  mcp_servers: string[];
}

function materialResources(resources: Resource[]): Resource[] {
  return resources.filter(
    (resource) => resource.type !== "plugin_pin" && resource.type !== "layer",
  );
}

function toContentsResource(resource: Resource): ProfileContentsResource {
  return {
    id: resource.id,
    type: resource.type,
    name: resource.name,
    source: resource.source,
  };
}

function toContentsResources(resources: Resource[]): ProfileContentsResource[] {
  const order: string[] = [];
  const byKey = new Map<string, ProfileContentsResource>();
  for (const resource of materialResources(resources)) {
    const key = `${resource.type}:${resource.name}`;
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, toContentsResource(resource));
    }
  }
  return order
    .map((key) => byKey.get(key))
    .filter((entry): entry is ProfileContentsResource => entry !== undefined);
}

function resourcesForLayer(layerId: string): ProfileContentsResource[] {
  const layer = getLayerById(layerId);
  const attached = getLayerResources(layerId);
  const fromEnv = layer?.default_environment_id
    ? getEnvironmentResources(layer.default_environment_id)
    : [];
  return toContentsResources([...attached, ...fromEnv]);
}

function buildTypeCounts(
  layers: ProfileContentsLayer[],
  resources: ProfileContentsResource[],
  pluginPins: ProfileContentsPin[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  if (layers.length > 0) {
    counts.layer = layers.length;
  }
  for (const resource of resources) {
    counts[resource.type] = (counts[resource.type] ?? 0) + 1;
  }
  if (pluginPins.length > 0) {
    counts.plugin_pin = pluginPins.length;
  }
  return counts;
}

export function buildProfileContents(profileName: string): ProfileContents | null {
  if (isEmptyBuiltinProfile(profileName)) {
    return {
      layers: [],
      stack_resource_count: 0,
      stack_summary: null,
      type_counts: {},
      resources: [],
      plugin_pins: [],
      mcp_servers: [],
    };
  }

  const layer = resolveLayerSelector(profileName);
  if (!layer || !isProfileLayer(layer)) {
    return null;
  }

  const layerIds = collectProfileLayerIds(layer);
  const merged = mergeLayersForApply(layerIds);
  const resources = materialResources(merged.resources);
  const summary = formatResourceTypeSummary(resources);
  const layers = merged.layers.map((entry) => ({
    id: entry.id,
    name: entry.name,
    version: entry.version,
    resources: resourcesForLayer(entry.id),
  }));
  const pluginPins = merged.pluginPins.map((pin) => ({
    ref: pin.ref,
    version_constraint: pin.version_constraint,
  }));
  const contentsResources = resources.map(toContentsResource);

  return {
    layers,
    stack_resource_count: resources.length,
    stack_summary: summary.length > 0 ? summary : null,
    type_counts: buildTypeCounts(layers, contentsResources, pluginPins),
    resources: contentsResources,
    plugin_pins: pluginPins,
    mcp_servers: resources
      .filter((resource) => resource.type === "mcp_server")
      .map((resource) => resource.name),
  };
}
