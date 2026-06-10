import { getLayer, mergeLayersById } from "../models/layer-model.js";
import type { MergedLayerContent } from "../models/layer-model.js";

export type { MergedLayerContent } from "../models/layer-model.js";

/**
 * Merge multiple design layers by id in order.
 * @deprecated Prefer mergeLayersForApply for project apply.
 */
export function mergePlugins(pluginIds: string[]): MergedLayerContent {
  return mergeLayersById(pluginIds);
}

/**
 * Merge multiple layer selectors in order (name, id, or name@version).
 * @deprecated Prefer mergeLayersForApply for project apply.
 */
export function mergeLayers(layerNames: string[]): MergedLayerContent {
  const layerIds: string[] = [];
  for (const name of layerNames) {
    const layer = getLayer(name);
    if (!layer) {
      throw new Error(`Layer not found: ${name}`);
    }
    layerIds.push(layer.id);
  }
  return mergeLayersById(layerIds);
}
